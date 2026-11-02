import sqlite3, glob, os
for p in glob.glob(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\server\**\*.db', recursive=True):
    if 'browser_plugin' in p: continue
    try:
        c = sqlite3.connect(p)
        t = [r[0] for r in c.execute("select name from sqlite_master where type='table'")]
        print(os.path.basename(p), '->', t[:15])
    except Exception as e:
        print(p, 'ERR', e)
