import sqlite3,os
c=sqlite3.connect('private/db/zf3d_canvas.db');cur=c.cursor();res=[]
for t in ['settings','app_data','kv_store']:
    ks=[r[0] for r in cur.execute('select key from '+t).fetchall()]
    res.append('%s n=%d arrows=%s sample=%s'%(t,len(ks),[k for k in ks if 'arrow' in k.lower()],ks[:10]))
res.append('cols %s'%[r[1] for r in cur.execute('pragma table_info(canvas_nodes)').fetchall()])
res.append('snapjson=%s'%os.path.exists('_snapshot_data.json'))
open('_vchk.out','w',encoding='utf-8').write('\n'.join(res))
