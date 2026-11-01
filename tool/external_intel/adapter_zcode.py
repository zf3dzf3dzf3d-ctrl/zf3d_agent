# -*- coding: utf-8 -*-
"""P0-1 zcode_sqlite 只读适配器原型
mode=ro 读 ~/.zcode/cli/db/db.sqlite，归一化输出统计。
零写入纪律：URI ro 打开 + 断言无写操作。
"""
import os, sqlite3, getpass, socket, json, sys

HOME = os.path.expanduser("~")
SRC = os.path.join(HOME, ".zcode", "cli", "db", "db.sqlite")

OWNER = f"{socket.gethostname()}|{getpass.getuser()}|zcode"

def main():
    assert os.path.exists(SRC), f"源库不存在: {SRC}"
    import shutil, tempfile
    tmp = os.path.join(tempfile.gettempdir(), "zi_zcode_copy.sqlite")
    shutil.copy2(SRC, tmp)
    conn = sqlite3.connect(f"file:{tmp.replace(os.sep, '/')}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # 探表结构
    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
    print("tables:", tables)

    # 找会话表与消息表（按常见命名探查）
    def pick(cands):
        for t in cands:
            if t in tables:
                return t
        return None

    sess_t = pick(["sessions", "session", "conversations"])
    msg_t = pick(["messages", "message", "chat_messages"])
    print("session_table:", sess_t, "message_table:", msg_t)

    for t in (sess_t, msg_t):
        cols = [r["name"] for r in cur.execute(f"PRAGMA table_info({t})")]
        print(f"{t} cols:", cols)

    n_sess = cur.execute(f"SELECT COUNT(*) FROM {sess_t}").fetchone()[0]
    n_msg = cur.execute(f"SELECT COUNT(*) FROM {msg_t}").fetchone()[0]
    print(f"OWNER={OWNER} sessions={n_sess} messages={n_msg}")

    # 归一化样例（前2条消息）
    rows = cur.execute(f"SELECT * FROM {msg_t} LIMIT 2").fetchall()
    for r in rows:
        print(json.dumps({k: (str(r[k])[:80]) for k in r.keys()}, ensure_ascii=False))

    conn.close()
    return 0

if __name__ == "__main__":
    sys.exit(main())
