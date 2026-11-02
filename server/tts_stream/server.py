# -*- coding: utf-8 -*-
"""
独立 WebSocket 服务：默认端口 8524（private/port.json -> tts_stream.port）。
纯标准库、daemon 线程，崩溃只影响本模块。
"""
import base64
import json
import socket
import struct
import threading

from . import providers
from . import queue as tq

_clients = []          # [(sock, send_lock)]
_c_lock = threading.Lock()


def start_tts_stream(host='127.0.0.1', port=8524):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((host, port))
    srv.listen(8)
    threading.Thread(target=_accept_loop, args=(srv,), daemon=True).start()
    threading.Thread(target=_worker_loop, daemon=True).start()
    try:
        from ..config import QUIET_CONSOLE
    except Exception:
        QUIET_CONSOLE = True
    if not QUIET_CONSOLE:
        print('[tts_stream] 流式TTS服务已启动 ws://%s:%d (provider=%s)' % (
            host, port, (providers.active() or providers.get()) and (providers.active() or providers.get()).name or 'none'))
    return True


def _accept_loop(srv):
    while True:
        try:
            sock, _ = srv.accept()
            threading.Thread(target=_client_thread, args=(sock,), daemon=True).start()
        except Exception:
            continue


def _handshake(sock):
    data = b''
    while b'\r\n\r\n' not in data:
        chunk = sock.recv(4096)
        if not chunk:
            return False
        data += chunk
        if len(data) > 8192:
            return False
    key = ''
    for line in data.partition(b'\r\n\r\n')[0].decode('utf-8', 'replace').split('\r\n')[1:]:
        if ':' in line:
            k, v = line.split(':', 1)
            if k.strip().lower() == 'sec-websocket-key':
                key = v.strip()
    if not key:
        return False
    import hashlib
    accept = base64.b64encode(hashlib.sha1(
        (key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
    sock.sendall((
        'HTTP/1.1 101 Switching Protocols\r\n'
        'Upgrade: websocket\r\nConnection: Upgrade\r\n'
        'Sec-WebSocket-Accept: %s\r\n\r\n' % accept).encode())
    return True


def _recv_frame(sock):
    """返回 (opcode, payload) 或 None。"""
    hdr = _recv_n(sock, 2)
    if not hdr:
        return None
    fin_op = hdr[0]
    opcode = fin_op & 0x0F
    masked = hdr[1] & 0x80
    ln = hdr[1] & 0x7F
    if ln == 126:
        ext = _recv_n(sock, 2)
        if not ext:
            return None
        ln = struct.unpack('>H', ext)[0]
    elif ln == 127:
        ext = _recv_n(sock, 8)
        if not ext:
            return None
        ln = struct.unpack('>Q', ext)[0]
    if ln > 1 << 20:
        return None
    mask = _recv_n(sock, 4) if masked else b'\x00\x00\x00\x00'
    if not mask:
        return None
    payload = _recv_n(sock, ln) if ln else b''
    if payload is None:
        return None
    if masked:
        payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return opcode, payload


def _recv_n(sock, n):
    buf = b''
    while len(buf) < n:
        c = sock.recv(n - len(buf))
        if not c:
            return None
        buf += c
    return buf


def _send_json(cli, obj):
    """cli = (sock, send_lock)。文本帧。"""
    sock, lock = cli
    payload = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    try:
        with lock:
            if len(payload) < 126:
                hdr = struct.pack('>BB', 0x81, len(payload))
            elif len(payload) < 65536:
                hdr = struct.pack('>BBH', 0x81, 126, len(payload))
            else:
                hdr = struct.pack('>BBQ', 0x81, 127, len(payload))
            sock.sendall(hdr + payload)
        return True
    except Exception:
        _drop(cli)
        return False


def _drop(cli):
    with _c_lock:
        if cli in _clients:
            _clients.remove(cli)
    try:
        cli[0].close()
    except Exception:
        pass


def _client_thread(sock):
    if not _handshake(sock):
        try:
            sock.close()
        except Exception:
            return
        return
    cli = (sock, threading.Lock())
    with _c_lock:
        _clients.append(cli)
    _send_json(cli, {'t': 'hello', 'provider': (providers.active() or providers.get()) and (providers.active() or providers.get()).name or 'none'})
    try:
        while True:
            frame = _recv_frame(sock)
            if frame is None:
                break
            opcode, payload = frame
            if opcode == 0x8:   # close
                break
            if opcode == 0x9:   # ping
                continue
            try:
                msg = json.loads(payload.decode('utf-8'))
            except Exception:
                continue
            _handle_msg(cli, msg)
    except Exception:
        pass
    finally:
        _drop(cli)


def _handle_msg(cli, msg):
    t = msg.get('t')
    if t == 'ping':
        _send_json(cli, {'t': 'pong'})
    elif t == 'stop':
        tq.clear()
    elif t == 'say':
        text = (msg.get('text') or '').strip()
        if text:
            tq.put(text, voice=msg.get('voice'), rate=msg.get('rate') or 100)


def _broadcast(obj):
    with _c_lock:
        clis = list(_clients)
    for cli in clis:
        _send_json(cli, obj)


def _worker_loop():
    """后台播报线程：从队列取任务 → provider 流式合成 → 广播分片。"""
    while True:
        try:
            item = tq.get()
        except Exception:
            continue
        sid = item['sid']
        tq.reset_stop()
        provider = providers.active() or providers.get()
        if not provider:
            _broadcast({'t': 'error', 'sid': sid, 'msg': '无可用TTS引擎(未配置key或模块禁用)'})
            tq.task_done()
            continue
        _broadcast({'t': 'start', 'sid': sid})
        seq = 0
        try:
            for audio, err in provider.synthesize_stream(item['text'], voice=item.get('voice'), rate=item.get('rate') or 100):
                if tq.stop_requested():
                    break
                if err:
                    _broadcast({'t': 'error', 'sid': sid, 'msg': err})
                    break
                if audio:
                    _broadcast({'t': 'chunk', 'sid': sid, 'seq': seq,
                                'data': base64.b64encode(audio).decode('ascii')})
                    seq += 1
            _broadcast({'t': 'end', 'sid': sid, 'seqs': seq})
        except Exception as e:
            try:
                _broadcast({'t': 'error', 'sid': sid, 'msg': str(e)})
                _broadcast({'t': 'end', 'sid': sid, 'seqs': seq})
            except Exception:
                pass
        tq.task_done()
