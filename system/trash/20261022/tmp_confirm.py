# -*- coding: utf-8 -*-
import urllib.request, json
URL = 'http://127.0.0.1:8570/api/tools/capability_tree'
def call(b):
    req = urllib.request.Request(URL, data=json.dumps(b).encode(), headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=10).read().decode())
p = call({'action': 'emerge_pending'})
print('before', p['count'])
ok = 0
for it in p.get('items', []):
    r = call({'action': 'confirm', 'event_id': it['id']})
    if r.get('ok'):
        ok += 1
print('confirmed', ok, 'after', call({'action': 'emerge_pending'})['count'])
