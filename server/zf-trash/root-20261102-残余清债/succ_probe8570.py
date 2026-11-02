import urllib.request, urllib.error, json
def post(url, obj):
    req = urllib.request.Request(url, data=json.dumps(obj).encode(),
        headers={"Content-Type":"application/json","Origin":"http://127.0.0.1:8570","User-Agent":"Mozilla/5.0"})
    try:
        r = urllib.request.urlopen(req, timeout=15)
        print(url.split('/api/')[1], "->", r.status, r.read(1500).decode("utf-8","ignore"))
    except urllib.error.HTTPError as e:
        print(url.split('/api/')[1], "HTTP", e.code, e.read(300).decode("utf-8","ignore"))
    except Exception as e:
        print(url.split('/api/')[1], "EXC", repr(e))

post("http://127.0.0.1:8570/api/swarm/status", {"batch_id":"sw-6682509fcd"})
post("http://127.0.0.1:8570/api/swarm/collect", {"batch_id":"sw-6682509fcd"})
