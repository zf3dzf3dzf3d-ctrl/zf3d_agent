# -*- coding: utf-8 -*-
import json, os, time, sys
sys.stdout.reconfigure(encoding='utf-8')
base = os.path.dirname(os.path.abspath(__file__))
for rel in ['data/api_keys.json', 'api_keys.json', '../ai_keys.json']:
    p = os.path.join(base, rel)
    if os.path.exists(p):
        st = os.stat(p)
        t = open(p, encoding='utf-8').read()
        print('===', p, st.st_size, time.strftime('%m-%d %H:%M', time.localtime(st.st_mtime)))
        try:
            j = json.loads(t)
            if isinstance(j, dict):
                print('top keys:', list(j.keys())[:8])
                for k, v in list(j.items())[:40]:
                    if isinstance(v, dict):
                        print(' ', k, 'keys=', list(v.keys())[:8], 'keylen=', len(str(v.get('key', ''))))
                    else:
                        print(' ', k, type(v).__name__, str(v)[:60])
        except Exception as e:
            print('parse err', e, t[:200])
    else:
        print('missing:', p)
