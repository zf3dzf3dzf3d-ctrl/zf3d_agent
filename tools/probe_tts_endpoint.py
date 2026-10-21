# -*- coding: utf-8 -*-
"""枚举 resource_id x speaker 组合找到可用配置"""
import json, os, socket, ssl

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
key = json.load(open(os.path.join(BASE, 'private', 'api_keys.json'), encoding='utf-8-sig'))['keys']['火山方舟']
HOST = 'openspeech.bytedance.com'
PATH = '/api/v3/plan/tts/unidirectional'

def try_one(rid, speaker):
    body = json.dumps({
        'user': {'uid': 'zf3d_agent'},
        'req_params': {
            'text': '你好，画布玩偶语音测试。',
            'speaker': speaker,
            'audio_params': {'format': 'mp3', 'sample_rate': 24000},
        },
    }).encode()
    s = ssl.create_default_context().wrap_socket(socket.create_connection((HOST, 443), timeout=30), server_hostname=HOST)
    hdr = ('POST %s HTTP/1.1\r\nHost: %s\r\nX-Api-Key: %s\r\nX-Api-Resource-Id: %s\r\n'
           'Content-Type: application/json\r\nConnection: close\r\nContent-Length: %d\r\n\r\n'
           % (PATH, HOST, key, rid, len(body))).encode()
    s.sendall(hdr + body)
    buf = b''
    while True:
        try:
            c = s.recv(65536)
        except socket.timeout:
            break
        if not c:
            break
        buf += c
    s.close()
    hidx = buf.find(b'\r\n\r\n')
    return (buf[hidx+4:] if hidx >= 0 else b'')[:400]

combos = [
    ('seed-tts-2.0', 'zh_female_shuangkuaisisi_moon_bigtts'),
    ('volcano_tts', 'zh_female_shuangkuaisisi_moon_bigtts'),
    ('tts', 'zh_female_shuangkuaisisi_moon_bigtts'),
    ('seed-tts-2.0', 'doubao-seed-tts-2.0'),
    ('seed-tts-2.0', 'zh_female_wanqudashu_mars_bigtts'),
    ('seed-tts-2.0', 'zh_female_roumeiwanfangxue'),
    ('agent-tts', 'zh_female_shuangkuaisisi_moon_bigtts'),
    ('doubao', 'zh_female_shuangkuaisisi_moon_bigtts'),
]
for rid, sp in combos:
    r = try_one(rid, sp)
    print(rid, '|', sp, '=>', r[:220])
