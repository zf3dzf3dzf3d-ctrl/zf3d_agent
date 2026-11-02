# -*- coding: utf-8 -*-
import zipfile, sys, json, io
sys.stdout.reconfigure(encoding='utf-8')
for z in ['private/backups/记忆快照/记忆_20261026_043539.zip', 'private/backups/记忆快照/记忆_20261025_091343.zip', 'private/backups/记忆快照/记忆_20261024_030722.zip']:
    try:
        zf = zipfile.ZipFile(z)
        names = zf.namelist()
        hits = [n for n in names if 'models' in n.lower()]
        print('===', z, len(names), 'entries; model hits:', hits)
        for h in hits[:5]:
            data = zf.read(h)
            try:
                j = json.loads(data.decode('utf-8-sig'))
                ms = j.get('models', []) if isinstance(j, dict) else j
                print('   ', h, 'count=', len(ms), [m.get('name') for m in ms][:15])
            except Exception as e:
                print('   ', h, 'not json', len(data))
    except Exception as e:
        print(z, 'err', e)
