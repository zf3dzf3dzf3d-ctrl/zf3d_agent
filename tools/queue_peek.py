# -*- coding: utf-8 -*-
import urllib.request, json, sys

q = json.loads(urllib.request.urlopen('http://127.0.0.1:8188/queue', timeout=15).read())
for e in q['queue_running'] + q['queue_pending']:
    p = e[2]
    v = p.get('71', {}).get('inputs', {}).get('value', '')
    dim = p.get('77:54', {}).get('inputs', {})
    print(e[0], e[1], 'len=%d' % len(v), v[:30].replace('\n', ' '), dim.get('width'), dim.get('height'), dim.get('length'))
