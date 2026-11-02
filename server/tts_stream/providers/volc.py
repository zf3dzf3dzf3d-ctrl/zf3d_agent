# -*- coding: utf-8 -*-
"""
火山方舟 doubao-seed-tts-2.0 流式 provider。
复用 tts_engine 的二进制协议，但改为增量读取：服务端每吐一个音频帧就立刻 yield，
不等整段合成完 —— 这就是"流式"的核心。
"""
import gzip
import json
import os
import socket
import ssl
import struct
import sys
import time

from . import BaseProvider, register

_HERE = os.path.dirname(os.path.abspath(__file__))
_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.dirname(_HERE)))  # server/
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

TTS_HOST = 'openspeech.bytedance.com'
TTS_PATH = '/api/v3/plan/tts/unidirectional'
RESOURCE_ID = 'seed-tts-2.0'
DEFAULT_SPEAKER = 'zh_female_shuangkuaisisi_moon_bigtts'

# API Key 来源与 tts_engine 一致：model_config 里 modelType=speech 的模型
_API_KEY = ''
_SPEAKER_CFG = ''


def _load_key():
    global _API_KEY, _SPEAKER_CFG
    try:
        from model_config import load_models_config
        cfg = load_models_config(include_key=True)
        items = None
        if isinstance(cfg, dict):
            items = cfg.get('list') or cfg.get('models')
        for m in (items or []):
            if m.get('modelType') == 'speech' or m.get('id') == 'ark-speech-tts':
                key = m.get('apiKey') or ''
                for sep in (',', '|', ';'):
                    if sep in key:
                        parts = [p.strip() for p in key.split(sep) if p.strip()]
                        key = parts[-1]
                        break
                _API_KEY = key.replace('Bearer;', '').strip()
                _SPEAKER_CFG = m.get('voice') or m.get('speaker') or ''
                return
    except Exception:
        pass


_load_key()


class VolcStreamProvider(BaseProvider):
    name = 'volc'

    def available(self):
        return bool(_API_KEY)

    def synthesize_stream(self, text, voice=None, rate=100, chunk_limit=0):
        """增量合成生成器：逐帧 yield mp3 bytes；出错时 yield 后停止。"""
        speaker = voice or _SPEAKER_CFG or DEFAULT_SPEAKER
        req = {
            'user': {'uid': 'zf3d_agent'},
            'req_params': {
                'text': text,
                'speaker': speaker,
                'audio_params': {
                    'format': 'mp3',
                    'sample_rate': 24000,
                    'speech_rate': max(50, min(200, int(rate))),
                    'loudness_rate': 100,
                },
            },
        }
        payload = gzip.compress(json.dumps(req).encode('utf-8'))
        first = bytes([0x11, 0x10, 0x11, 0x00]) + struct.pack('>I', len(payload)) + payload

        try:
            raw = socket.create_connection((TTS_HOST, 443), timeout=10)
            ctx = ssl.create_default_context()
            s = ctx.wrap_socket(raw, server_hostname=TTS_HOST)
        except Exception as e:
            yield b'', '连接失败: %s' % e
            return

        try:
            headers = [
                'POST %s HTTP/1.1' % TTS_PATH,
                'Host: %s' % TTS_HOST,
                'X-Api-Key: %s' % _API_KEY,
                'X-Api-Resource-Id: %s' % RESOURCE_ID,
                'X-Api-Request-Id: zf3d-%d' % int(time.time() * 1000),
                'Content-Type: application/json',
                'X-Api-App-Key: %s' % _API_KEY,
                'X-Api-Access-Key: %s' % _API_KEY,
                'Connection: close',
                'Content-Length: %d' % len(first),
            ]
            s.sendall(('\r\n'.join(headers) + '\r\n\r\n').encode() + first)

            buf = b''
            body_started = False
            chunked = False
            deadline = time.time() + 60

            while time.time() < deadline:
                try:
                    c = s.recv(65536)
                except socket.timeout:
                    break
                if not c:
                    break
                buf += c
                if not body_started and b'\r\n\r\n' in buf:
                    head_end = buf.find(b'\r\n\r\n')
                    head = buf[:head_end].decode('utf-8', 'replace').lower()
                    status = buf.split(b'\r\n')[0].decode('utf-8', 'replace')
                    chunked = 'transfer-encoding: chunked' in head
                    if any(code in status for code in ('400', '401', '403', '404', '429', '500')):
                        # 错误：继续收完 body 再报错退出
                        while time.time() < deadline:
                            try:
                                c2 = s.recv(65536)
                            except Exception:
                                break
                            if not c2:
                                break
                            buf += c2
                        body = buf[head_end + 4:]
                        if chunked:
                            body = _dechunk(body)
                        msg = _extract_error(body)
                        yield b'', msg
                        return
                    buf = buf[head_end + 4:]
                    body_started = True

                if not body_started:
                    continue

                # 增量解析二进制帧
                while True:
                    audio, err, consumed, done = _parse_frames(buf, chunked)
                    if err:
                        yield b'', err
                        return
                    if audio:
                        yield audio, ''
                    if consumed > 0:
                        buf = buf[consumed:]
                    if done or consumed == 0:
                        break
        finally:
            try:
                s.close()
            except Exception:
                pass


def _dechunk(data):
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
            return data
        if size == 0:
            break
        out.extend(data[eol + 2:eol + 2 + size])
        off = eol + 2 + size + 2
    return bytes(out)


def _extract_error(bodyb):
    stripped = bodyb.lstrip()
    if stripped.startswith(b'{'):
        try:
            j = json.loads(stripped.decode('utf-8'))
            return ((j.get('header') or {}).get('message')) or str(j)[:300]
        except Exception:
            pass
    # 尝试二进制错误帧
    _, err, _, _ = _parse_frames(bodyb, False, error_only=True)
    return err or '未收到音频数据'


def _gunzip(p):
    if p:
        try:
            return gzip.decompress(p)
        except Exception:
            pass
    return p


def _parse_frames(bodyb, chunked=False, error_only=False):
    """增量解析响应帧。
    返回 (audio_bytes, error_msg, consumed, done)。consumed=0 表示数据不够需再收。"""
    off = 0
    audio = b''
    while off + 4 <= len(bodyb):
        hsize = (bodyb[off] & 0x0F) * 4
        if hsize == 0:
            hsize = 4
        if off + hsize > len(bodyb):
            return b'', '', 0, False
        msg_type = (bodyb[off + 1] >> 4) & 0x0F
        flags = bodyb[off + 1] & 0x0F
        comp = bodyb[off + 2] & 0x0F
        base = off + hsize

        if msg_type in (0xB, 0xF):  # JSON / 错误帧
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
                return b'', '', 0, False
            psize = struct.unpack('>I', bodyb[idx:idx + 4])[0]
            if idx + 4 + psize > len(bodyb):
                return b'', '', 0, False
            p = bodyb[idx + 4:idx + 4 + psize]
            if comp == 1:
                p = _gunzip(p)
            last_json = {}
            if p:
                try:
                    last_json.update(json.loads(p.decode('utf-8')))
                except Exception:
                    pass
            if msg_type == 0xF:
                return b'', (last_json or {}).get('message') or ('服务错误码 %s' % code), idx + 4 + psize, True
            if seq < 0 or last_json.get('is_last'):
                return b'', '', idx + 4 + psize, True
            off = idx + 4 + psize
        elif msg_type == 0xC:  # 音频帧
            if error_only:
                return b'', '', 0, False
            idx = base
            if flags & 0x01:
                idx += 4
            if idx + 4 > len(bodyb):
                return b'', '', 0, False
            psize = struct.unpack('>I', bodyb[idx:idx + 4])[0]
            if idx + 4 + psize > len(bodyb):
                return b'', '', 0, False
            p = bodyb[idx + 4:idx + 4 + psize]
            if comp == 1:
                p = _gunzip(p)
            off = idx + 4 + psize
            if p:
                audio += p
        else:
            off += 4
    return audio, '', off if off > 0 else 0, False


register(VolcStreamProvider())
