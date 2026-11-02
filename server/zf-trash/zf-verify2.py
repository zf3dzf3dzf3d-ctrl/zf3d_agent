# -*- coding: utf-8 -*-
import urllib.request, json, sys
sys.stdout.reconfigure(encoding='utf-8')
r = urllib.request.urlopen('http://127.0.0.1:8570/api/models/config', timeout=10)
raw = r.read().decode('utf-8', 'replace')
print('status', r.status, 'len', len(raw))
print(raw[:600])
