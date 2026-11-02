import sys, json, urllib.request, urllib.error
sys.stdout.reconfigure(encoding='utf-8')
body = json.dumps({
    'url': 'https://httpbin.org/post',
    'method': 'POST',
    'headers': {},
    'body': {'model': 'my-custom-model', 'messages': [{'role': 'user', 'content': 'hi'}]},
}).encode()
for port in (8575, 8565, 8574, 8559):
    try:
        req = urllib.request.Request('http://127.0.0.1:%d/api/proxy' % port, data=body,
                                     headers={'Content-Type': 'application/json'})
        r = urllib.request.urlopen(req, timeout=15)
        print(port, r.status, r.read()[:200])
    except urllib.error.HTTPError as e:
        print(port, 'HTTP', e.code, e.read()[:200])
    except Exception as e:
        print(port, 'ERR', repr(e)[:120])
