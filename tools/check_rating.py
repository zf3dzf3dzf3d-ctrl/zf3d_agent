import sqlite3, sys
sys.stdout.reconfigure(encoding='utf-8')
conn = sqlite3.connect('C:/work/web/data/zf3d.db')
c = conn.cursor()

c.execute('SELECT id, title, rating FROM works WHERE id=25263')
r = c.fetchone()
print(f'works.rating: {r}')

c.execute("SELECT id, target_type, target_id, content, user_id FROM comments WHERE target_id=25263 AND target_type='work_review'")
rows = c.fetchall()
if not rows:
    print("No work_review comments found locally")
for r in rows:
    print(f'comment: id={r[0]} type={r[1]} target={r[2]} user={r[4]} content={r[3][:100]}')

conn.close()
