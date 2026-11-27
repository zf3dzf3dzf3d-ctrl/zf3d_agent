#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WS 帧基础共享模块（纯标准库）
实现模式复制自 server/remote/ws_server.py @ commit 3f65072（握手 L152-235 / 帧解析 L178-217）。
供 server/plaza/ws_plaza.py 等新 WS 服务引用，避免手写协议多副本漂移。
旧 ws_server.py 暂不改造引用本模块（第 3 轮收口裁决：留缝不添险）。
"""
import base64
import hashlib
import json
import os
import struct

MAGIC = b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
MAX_FRAME = 8 * 1024 * 1024   # 8MB 上限，防滥用


def handshake(sock, origin_checker=None):
    """服务端完成 WebSocket 握手（RFC6455），成功返回 True。

    origin_checker: 可选回调 headers->bool（【2026-11-23】防跨站网页 CSWSH）。
    浏览器发起的 WS 连接必带 Origin 头；回调返回 False 时以 403 拒绝升级。
    不传回调则行为与旧版完全一致（本地机器人等非浏览器客户端仍可用）。
    """
    data = b''
    while b'\r\n\r\n' not in data:
        chunk = sock.recv(4096)
        if not chunk:
            return False
        data += chunk
        if len(data) > 16384:
            return False
    headers = {}
    head, _, _ = data.partition(b'\r\n\r\n')
    for line in head.decode('utf-8', 'replace').split('\r\n')[1:]:
        if ':' in line:
            k, v = line.split(':', 1)
            headers[k.strip().lower()] = v.strip()
    if origin_checker is not None and not origin_checker(headers):
        try:
            sock.sendall(b'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        except Exception:
            pass
        return False
    key = headers.get('sec-websocket-key')
    if not key:
        return False
    accept = base64.b64encode(
        hashlib.sha1(key.encode() + MAGIC).digest()).decode()
    resp = ('HTTP/1.1 101 Switching Protocols\r\n'
            'Upgrade: websocket\r\nConnection: Upgrade\r\n'
            f'Sec-WebSocket-Accept: {accept}\r\n\r\n')
    sock.sendall(resp.encode())
    return True


def client_handshake(sock, host, port):
    """测试/客户端侧：发起 WS 握手并校验 Sec-WebSocket-Accept，成功返回 True"""
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f'GET / HTTP/1.1\r\nHost: {host}:{port}\r\n'
           'Upgrade: websocket\r\nConnection: Upgrade\r\n'
           f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n')
    sock.sendall(req.encode())
    data = b''
    while b'\r\n\r\n' not in data:
        chunk = sock.recv(4096)
        if not chunk:
            return False
        data += chunk
    head = data.partition(b'\r\n\r\n')[0].decode('utf-8', 'replace')
    expect = base64.b64encode(
        hashlib.sha1(key.encode() + MAGIC).digest()).decode()
    return '101' in head.split('\r\n')[0] and expect in head


def recv_exact(sock, n):
    buf = b''
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def recv_frame(sock):
    """返回 (opcode, bytes) 或 None（断开）。支持普通长度帧。"""
    try:
        hdr = recv_exact(sock, 2)
        if not hdr:
            return None
        b1, b2 = hdr[0], hdr[1]
        opcode = b1 & 0x0F
        masked = b2 & 0x80
        ln = b2 & 0x7F
        if ln == 126:
            ext = recv_exact(sock, 2)
            if not ext:
                return None
            ln = struct.unpack('>H', ext)[0]
        elif ln == 127:
            ext = recv_exact(sock, 8)
            if not ext:
                return None
            ln = struct.unpack('>Q', ext)[0]
        if ln > MAX_FRAME:
            return None
        mask = recv_exact(sock, 4) if masked else None
        payload = recv_exact(sock, ln) if ln else b''
        if mask and payload:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        if opcode == 0x8:          # close
            return None
        return (opcode, payload)
    except Exception:
        return None


def send_frame(sock, obj, send_lock=None):
    """发送 JSON 文本帧（服务器不掩码）；send_lock 可选保证并发安全"""
    try:
        payload = json.dumps(obj, ensure_ascii=False,
                             separators=(',', ':')).encode('utf-8')
        ln = len(payload)
        if ln < 126:
            hdr = struct.pack('>BB', 0x81, ln)
        elif ln < 65536:
            hdr = struct.pack('>BBH', 0x81, 126, ln)
        else:
            hdr = struct.pack('>BBQ', 0x81, 127, ln)
        if send_lock:
            with send_lock:
                sock.sendall(hdr + payload)
        else:
            sock.sendall(hdr + payload)
        return True
    except Exception:
        return False
