# -*- coding: utf-8 -*-
import urllib.request, json
ids = ['3e53c657-401f-4e21-a0cb-1e1807c3d833',
       '07d26c32-3ce5-488b-a941-28098dfc406d',
       '4b167112-e79e-4453-a466-311ba5a26e96']
d = json.dumps({'delete': ids}).encode()
r = urllib.request.Request('http://127.0.0.1:8188/queue', data=d,
                           headers={'Content-Type': 'application/json'})
print(urllib.request.urlopen(r, timeout=15).status)
