# -*- coding: utf-8 -*-
import json, sys, os, time
sys.stdout.reconfigure(encoding='utf-8')
for p in ['private/用户设置/user_settings.json', 'private/用户设置/user_preferences.json']:
    try:
        st = os.stat(p)
        j = json.load(open(p, encoding='utf-8'))
        print('===', p, st.st_size, time.strftime('%m-%d %H:%M', time.localtime(st.st_mtime)))
        s = json.dumps(j, ensure_ascii=False, indent=1)
        print(s[:3000])
    except Exception as e:
        print(p, 'err', e)
