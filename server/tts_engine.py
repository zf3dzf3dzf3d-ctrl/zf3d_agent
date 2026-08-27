# -*- coding: utf-8 -*-
"""
TTS 语音合成引擎（火山方舟 Agent Plan 语音模型 doubao-seed-tts-2.0）
HTTP Chunked 单向流式接口（chunked 传输）：
  POST https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional
请求头:
  X-Api-Key: <专属 API Key>
  X-Api-Resource-Id: seed-tts-2.0
请求体首帧二进制协议: [0x11,0x10,0x12,0x00] + len(gzip JSON) + gzip(JSON)
响应 chunked 分片帧: msg_type=0xC 音频 / 0xB JSON 确认 / 0xF 错误。仅标准库。
"""
import gzip
import json
import os
import socket
import ssl
import struct
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIO_OUT_DIR = os.path.join(BASE_DIR, 'public', 'audio')
os.makedirs(AUDIO_OUT_DIR, exist_ok=True)

TTS_HOST = 'openspeech.bytedance.com'
TTS_PATH = '/api/v3/plan/tts/unidirectional'
RESOURCE_ID = 'seed-tts-2.0'


def _build_first_frame(request_json):
    payload = gzip.compress(json.dumps(request_json).encode('utf-8'))
    return bytes([0x11, 0x10, 0x11, 0x00]) + struct.pack('>I', len(payload)) + payload


def _gunzip(p):
    if p:
        try:
            return gzip.decompress(p)
        except Exception:
            pass
    return p


def _dechunk(data):
    """解析 HTTP/1.1 chunked body，返回原始 body 字节"""
    out = bytearray()
    off = 0
    while True:
        eol = data.find(b'\r\n', off)
        if eol < 0:
            break
        line = data[off:eol].split(b';')[0].strip()
        try:
            size = int(line, 16)
        except ValueError:
            # 不是 chunked，直接原样返回
            return data
        if size == 0:
            break
        out.extend(data[eol + 2:eol + 2 + size])
        off = eol + 2 + size + 2
    return bytes(out)


def _parse_response_body(bodyb):
    """解析分片二进制帧，返回 (audio_bytes, last_json, error)"""
    audio = bytearray()
    last_json = {}
    error = None
    off = 0
    while off + 4 <= len(bodyb):
        hsize = (bodyb[off] & 0x0F) * 4
        if hsize == 0:
            hsize = 4
        msg_type = (bodyb[off + 1] >> 4) & 0x0F
        flags = bodyb[off + 1] & 0x0F
        comp = bodyb[off + 2] & 0x0F
        base = off + hsize
        if msg_type in (0xB, 0xF):  # JSON 帧 / 错误帧
            idx = base
            seq = 0
            code = -1
            if idx + 4 <= len(bodyb):
                seq = struct.unpack('>i', bodyb[idx:idx + 4])[0]
                idx += 4
            if msg_type == 0xF and idx + 4 <= len(bodyb):
                code = struct.unpack('>i', bodyb[idx:idx + 4])[0]
                idx += 4
            if idx + 4 > len(bodyb):
                break
            psize = struct.unpack('>I', bodyb[idx:idx + 4])[0]
            idx += 4
            p = bodyb[idx:idx + psize]
            if comp == 1:
                p = _gunzip(p)
            if p:
                try:
                    last_json.update(json.loads(p.decode('utf-8')))
                except Exception:
                    last_json['raw'] = p[:300].decode('utf-8', 'replace')
            if msg_type == 0xF:
                error = (last_json or {}).get('message') or ('错误码 %s' % code)
            elif seq < 0 or last_json.get('is_last'):
                return bytes(audio), last_json, error
            off = idx + psize
        elif msg_type == 0xC:  # 音频帧
            idx = base
            if flags & 0x01:
                idx += 4  # 跳过 sequence
            if idx + 4 > len(bodyb):
                break
            psize = struct.unpack('>I', bodyb[idx:idx + 4])[0]
            idx += 4
            p = bodyb[idx:idx + psize]
            if comp == 1:
                p = _gunzip(p)
            audio.extend(p)
            off = idx + psize
        else:
            off += 4
    return bytes(audio), last_json, error


def tts_synthesize(text, api_key,
                   speaker='zh_female_shuangkuaisisi_moon_bigtts',
                   encoding='mp3', sample_rate=24000,
                   speech_rate=100, loudness_rate=100,
                   resource_id=RESOURCE_ID, timeout=60):
    """调用火山 TTS HTTP 接口。返回 (audio_bytes, meta)。"""
    request_json = {
        'user': {'uid': 'zf3d_agent'},
        'req_params': {
            'text': text,
            'speaker': speaker,
            'audio_params': {
                'format': encoding,
                'sample_rate': sample_rate,
                'speech_rate': max(50, min(200, int(speech_rate))),
                'loudness_rate': max(50, min(200, int(loudness_rate))),
            },
        },
    }
    first = _build_first_frame(request_json)
    raw = socket.create_connection((TTS_HOST, 443), timeout=timeout)
    ctx = ssl.create_default_context()
    s = ctx.wrap_socket(raw, server_hostname=TTS_HOST)
    headers = [
        'POST %s HTTP/1.1' % TTS_PATH,
        'Host: %s' % TTS_HOST,
        'X-Api-Key: %s' % api_key,
        'X-Api-Resource-Id: %s' % resource_id,
        'X-Api-Request-Id: zf3d-%d' % int(time.time() * 1000),
        'Content-Type: application/json',
        'X-Api-App-Key: %s' % api_key,
        'X-Api-Access-Key: %s' % api_key,
        'Connection: close',
        'Content-Length: %d' % len(first),
    ]
    s.sendall(('\r\n'.join(headers) + '\r\n\r\n').encode() + first)

    buf = b''
    status_line = ''
    is_chunked = False
    deadline = time.time() + timeout
    while True:
        try:
            c = s.recv(65536)
        except socket.timeout:
            break
        if not c:
            break
        buf += c
        if not status_line and b'\r\n\r\n' in buf:
            head_end = buf.find(b'\r\n\r\n')
            head = buf[:head_end].decode('utf-8', 'replace').lower()
            status_line = buf.split(b'\r\n')[0].decode('utf-8', 'replace')
            is_chunked = 'transfer-encoding: chunked' in head
            if any(code in status_line for code in ('400', '401', '403', '404', '429', '500')):
                try:
                    while time.time() < deadline:
                        c2 = s.recv(65536)
                        if not c2:
                            break
                        buf += c2
                except Exception:
                    pass
                break
        if time.time() > deadline:
            break
    try:
        s.close()
    except Exception:
        pass

    if buf.startswith(b'HTTP'):
        hidx = buf.find(b'\r\n\r\n')
        bodyb = buf[hidx + 4:] if hidx >= 0 else b''
    else:
        bodyb = buf

    if is_chunked:
        bodyb = _dechunk(bodyb)

    stripped = bodyb.lstrip()
    if stripped.startswith(b'{'):
        try:
            j = json.loads(stripped.decode('utf-8'))
            err_msg = ((j.get('header') or {}).get('message')) or str(j)[:300]
            return None, {'error': err_msg}
        except Exception:
            pass

    audio, last_json, error = _parse_response_body(bodyb)
    if error and not audio:
        return None, {'error': error, 'meta': last_json}
    if audio:
        return bytes(audio), {'meta': last_json}
    return None, {'error': error or ('未收到音频数据; %s; body=%s' % (
        status_line, bodyb[:200].hex()))}


def synth_to_file(text, api_key, **kw):
    """合成并保存到 public/audio/。返回 {url, file, bytes} 或 {error}"""
    result, meta = tts_synthesize(text, api_key, **kw)
    if not result:
        d = dict(meta or {})
        d.setdefault('error', 'TTS 合成失败')
        return d
    fname = 'tts_%s.mp3' % time.strftime('%Y%m%d_%H%M%S')
    fpath = os.path.join(AUDIO_OUT_DIR, fname)
    with open(fpath, 'wb') as f:
        f.write(result)
    rel = '/public/audio/' + fname
    return {'file': rel, 'url': rel, 'bytes': len(result), 'format': kw.get('encoding', 'mp3'),
            'voice': kw.get('speaker', '')}


def get_api_key():
    """从模型配置读取语音模型的专属 API Key。支持 "appId|key" 分隔格式，取最后一段。"""
    try:
        import sys as _sys
        cfg_dir = os.path.dirname(os.path.abspath(__file__))
        if cfg_dir not in _sys.path:
            _sys.path.insert(0, cfg_dir)
        from model_config import load_models_config
        cfg = load_models_config()
        items = None
        if isinstance(cfg, dict):
            items = cfg.get('models') or cfg.get('list')
        for m in (items or []):
            if m.get('modelType') == 'speech' or m.get('id') == 'ark-speech-tts':
                key = m.get('apiKey') or ''
                for sep in (',', '|', ';'):
                    if sep in key:
                        parts = [p.strip() for p in key.split(sep) if p.strip()]
                        return parts[-1], m
                return key.replace('Bearer;', '').strip(), m
    except Exception as e:
        print('[tts_engine] 读密钥失败:', e)
    return '', None
