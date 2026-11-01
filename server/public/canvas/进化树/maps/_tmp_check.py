import json, sys, os, glob, sqlite3
sys.stdout.reconfigure(encoding='utf-8')
M = 'public/canvas/进化树/maps/'
for n in os.listdir(M):
    p = M + n
    if not os.path.isfile(p) or n.endswith('.py'):
        continue
    print('=====', n, os.path.getsize(p))
    if '.bak' in n:
        continue
    try:
        d = json.load(open(p, encoding='utf-8'))
    except Exception as e:
        print(' ERR', e); continue
    if isinstance(d, dict):
        print(' keys=', list(d))
        caps = d.get('capability', [])
        print(' nodes=', len(caps))
        for c in caps[:8]:
            print('  ', c.get('id'), str(c.get('text'))[:30], c.get('status'), c.get('x'), c.get('y'))
        links = d.get('capability_link', [])
        print(' links=', len(links))
        print(' meta=', d.get('meta'))
print('===== zf3d db')
for p in glob.glob('**/zf3d_canvas.db', recursive=True):
    if 'node_modules' in p: continue
    print(p, os.path.getsize(p))
    con = sqlite3.connect(p)
    for (t,) in con.execute("SELECT name FROM sqlite_master WHERE type='table'"):
        n2 = con.execute('SELECT COUNT(*) FROM "%s"' % t).fetchone()[0]
        print(' table', t, 'rows=', n2)
        if t == 'capability' and n2:
            for row in con.execute('SELECT id,text,status,clarity FROM capability LIMIT 15'):
                print('   ', row)
