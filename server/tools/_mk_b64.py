import base64, subprocess, os, sys
code = r'''
import sqlite3, shutil, os, json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
root = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.6.0"
src = os.path.join(root, "private", "db", "zf3d_canvas.db")
dst = os.path.join(root, "server", "data", "_tmp_canvas.db")
shutil.copy(src, dst)
if os.path.exists(src + "-wal"): shutil.copy(src + "-wal", dst + "-wal")
con = sqlite3.connect(dst)
tables = [r[0] for r in con.execute("select name from sqlite_master where type='table'")]
print("TABLES:", tables)
for t in tables:
    n = con.execute("select count(*) from [%s]" % t).fetchone()[0]
    cols = [c[1] for c in con.execute("pragma table_info([%s])" % t)]
    print(t, n, cols[:18])
con.close()
'''
b = base64.b64encode(code.encode("utf-8")).decode()
script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_run_b64.py")
with open(script, "w", encoding="utf-8") as f:
    f.write("import base64;exec(base64.b64decode('%s').decode('utf-8'))" % b)
print("WROTE", script)
