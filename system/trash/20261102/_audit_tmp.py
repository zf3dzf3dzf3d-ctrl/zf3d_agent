import json, os, glob, sqlite3
base = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\public\canvas\进化树\maps'
def cnt(roots):
    t = 0
    for x in roots:
        t += 1
        t += cnt(x.get('children', []))
    return t
out = []
for f in glob.glob(os.path.join(base, '*.json')):
    d = json.load(open(f, encoding='utf-8'))
    out.append('%s nodecount=%d today=%s mtime=%s' % (
        os.path.basename(f).encode('ascii','replace').decode(),
        cnt(d.get('roots', [])),
        d.get('meta', {}).get('today_only'),
        os.path.getmtime(f)))
db = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\private\db\zf3d_canvas.db'
c = sqlite3.connect(db).cursor()
out.append('db_total=%d' % c.execute('select count(*) from capability').fetchone()[0])
for r in c.execute('select subject_type,subject_id,count(*) from capability group by 1,2'):
    out.append('subj %s' % (r,))
open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\_audit_chk.txt', 'w', encoding='utf-8').write('\n'.join(out))
