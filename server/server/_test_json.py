# -*- coding: utf-8 -*-
"""诊断：构造 JSON 请求按官方 HTTP 接口示例（JSON 体 + X-Api-Key）"""
import sys, os, io, json, socket, ssl, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
import tts_engine
key, m = tts_engine.get_api_key()

host = 'openspeech.bytedance.com'
body_obj = {
    'user': {'uid': 'zf3d_agent'},
    'req_params': {
        'text': '你好。',
        'speaker': 'zh_female_shuangkuaisisi_moon_bigtts',
        'audio_params': {'format': 'mp3', 'sample_rate': 24000},
    },
}
body = json.dumps(body_obj).encode()
raw = socket.create_connection((host, 443), timeout=30)
ctx = ssl.create_default_context()
s = ctx.wrap_socket(raw, server_hostname=host)
hdrs = [
    'POST /api/v3/plan/tts/unidirectional HTTP/1.1',
    'Host: %s' % host,
    'X-Api-Key: %s' % key,
    'X-Api-Resource-Id: seed-tts-2.0',
    'Content-Type: application/json',
    'Connection: close',
    'Content-Length: %d' % len(body),
]
s.sendall(('\r\n'.join(hdrs) + '\r\n\r\n').encode() + body)
buf = b''
s.settimeout(20)
try:
    while True:
        c = s.recv(65536)
        if not c:
            break
        buf += c
except socket.timeout:
    pass
hidx = buf.find(b'\r\n\r\n')
print(buf[:hidx].decode('utf-8', 'replace'))
bodyb = buf[hidx+4:]
print('body bytes:', len(bodyb))
print(bodyb[:120].hex())
with open('tts_bin.bin', 'wb') as f:
    f.write(bodyb)
