# -*- coding: utf-8 -*-
"""测试火山方舟双向流式 TTS WebSocket (unidirectional)"""
import json, os, base64, asyncio, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
keys = json.load(open(os.path.join(BASE, 'private', 'api_keys.json'), encoding='utf-8-sig'))['keys']
ark_key = keys.get('火山方舟') or ''

# 先探测可用端点(简单 HTTP POST 看报错)
import urllib.request, urllib.error
for url, body in [
    ('https://openspeech.bytedance.com/api/v1/tts', None),
]:
    pass

# 用 websocket-client 或原生方式试试 unidirectional HTTP
req = urllib.request.Request(
    'https://ark.cn-beijing.volces.com/api/v3/tts/unidirectional',
    data=json.dumps({
        'user': {'uid': 'test'},
        'req_params': {
            'text': '你好，我是画布玩偶，测试语音连接。',
            'speaker': 'zh_female_cancan',
            'audio_params': {'format': 'mp3', 'sample_rate': 24000},
        },
    }).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ark_key},
)
try:
    resp = urllib.request.urlopen(req, timeout=30)
    data = resp.read()
    out = os.path.join(BASE, 'tts_resp.bin')
    open(out, 'wb').write(data)
    print('OK', resp.status, len(data), 'bytes, head:', data[:16])
except urllib.error.HTTPError as e:
    print('FAIL', e.code, e.read()[:600].decode('utf-8', 'ignore'))
except Exception as e:
    print('FAIL', e)
