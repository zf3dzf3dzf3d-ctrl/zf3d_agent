import sqlite3, json, sys
sys.stdout.reconfigure(encoding='utf-8')
con = sqlite3.connect(r'private/db/zf3d_canvas.db')
cur = con.cursor()
cur.execute("pragma table_info(canvas_nodes)")
print("cols:", [c[1] for c in cur.fetchall()])
cur.execute("select count(*) from canvas_nodes")
print("count:", cur.fetchone())
cur.execute("select id, title, x, y from canvas_nodes")
for r in cur.fetchall():
    print(r)
