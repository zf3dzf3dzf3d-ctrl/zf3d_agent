# -*- coding: utf-8 -*-
import subprocess, sys, os, time
BASE = os.path.dirname(os.path.abspath(__file__))
PY = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\python\python.exe"
svc = subprocess.Popen([PY, "-X", "utf8", os.path.join(BASE, "browser_service.py"), "--headless"],
                       stdout=open(os.path.join(BASE, "test_run.log"), "w", encoding="utf-8"),
                       stderr=subprocess.STDOUT, cwd=BASE)
time.sleep(12)

import urllib.request, json

def call(method, path, data=None):
    try:
        if method == "POST":
            req = urllib.request.Request("http://127.0.0.1:8765" + path,
                                         data=json.dumps(data or {}).encode("utf-8"),
                                         headers={"Content-Type": "application/json"})
        else:
            req = "http://127.0.0.1:8765" + path
        r = urllib.request.urlopen(req, timeout=90)
        return "OK " + r.read().decode("utf-8")[:400]
    except urllib.error.HTTPError as e:
        return "HTTP" + str(e.code) + " " + e.read().decode("utf-8")[:400]
    except Exception as e:
        return "ERR " + str(e)

out = []
out.append(call("GET", "/status"))
out.append(call("POST", "/open", {"url": "https://example.com", "incognito": True}))
out.append(call("POST", "/incognito/close", {}))
out.append(call("POST", "/open", {"url": "https://example.com"}))
out.append(call("GET", "/memory?keyword=example"))
out.append(call("GET", "/memory"))
svc.terminate()

with open(os.path.join(BASE, "test_result.txt"), "w", encoding="utf-8") as f:
    f.write("\n=====\n".join(out))
print("TEST DONE")
