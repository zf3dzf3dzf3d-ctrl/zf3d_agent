import json, urllib.request, time, io

def main():
    body = {'model': 'glm-5.3-flash', 'messages': [{'role': 'user', 'content': '回复ok'}],
            '_relay': 'zfglm-flash', 'stream': False}
    req = urllib.request.Request('http://127.0.0.1:8570/api/proxy',
                                 data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    t = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=120)
        d = json.loads(r.read())
        c = ''
        if isinstance(d.get('data'), dict):
            c = d['data'].get('choices', [{}])[0].get('message', {}).get('content', '')
        out = 'HTTP %s %.1fs | %s' % (r.status, time.time() - t, str(c)[:120])
    except Exception as e:
        out = 'FAIL %.1fs %s' % (time.time() - t, e)
    io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\_zf_test_out.txt', 'w', encoding='utf-8').write(out)

main()
