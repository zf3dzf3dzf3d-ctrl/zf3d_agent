# -*- coding: utf-8 -*-
"""诊断2：看看 400 的具体 message"""
import socket, ssl, os, sys, io
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import tts_engine
appid, token, m = tts_engine.get_api_keys()

host = 'openspeech.bytedance.com'
raw = socket.create_connection((host, 443), timeout=30)
ctx = ssl.create_default_context()
s = ctx.wrap_socket(raw, server_hostname=host)
payload = b'{}'
hdrs = [
    'Authorization: Bearer; %s' % token,
    'X-Api-Resource-Id: seed-tts-2.0',
    'X-Api-App-Key: %s' % (appid or ''),
    'X-Api-Access-Key: %s' % token,
    'Content-Type: application/octet-stream',
]
head = ('POST /api/v3/tts/unidirectional HTTP/1.1\r\nHost: %s\r\n%s\r\n\r\n'
        % (host, '\r\n'.join(hdrs + ['Content-Length: 2'])))
s.sendall(head.encode() + payload)
buf = b''
s.settimeout(6)
try:
    while True:
        c = s.recv(65536)
        if not c: break
        buf += c
except socket.timeout:
    pass
hidx = buf.find(b'\r\n\r\n')
print(buf[hidx+4:].decode('utf-8', 'replace'))
