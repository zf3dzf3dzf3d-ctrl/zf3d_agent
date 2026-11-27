# -*- coding: utf-8 -*-
"""T5 回归：ctx.db 命名空间 SQLite（策划案 v4 K1）。

用法：python tests/test_t5_ctx_db.py   （退出码 0 = PASS）
全程走临时目录，不触碰生产 plugin_store。
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "server"))

from kernel_ctx import _CtxDb  # noqa: E402

PASS, FAIL = [], []


def check(name, ok, detail=""):
    (PASS if ok else FAIL).append((name, detail))
    print(("  [PASS] " if ok else "  [FAIL] ") + name + (("  | " + detail) if detail else ""))


def main():
    tmp = tempfile.mkdtemp(prefix="t5_ctx_db_")
    os.chdir(tmp)
    db = _CtxDb("tool.t5probe")
    try:
        # 幂等：库文件固定于 server/data/plugin_store（生产语义），重复跑先清表
        db.execute("DROP TABLE IF EXISTS t")
        n = db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
        check("T1 建表", n in (-1, 0))
        db.execute("INSERT INTO t (v) VALUES (?)", ("你好",))
        db.execute("INSERT INTO t (v) VALUES (?)", ("world",))
        rows = db.query("SELECT id, v FROM t ORDER BY id")
        check("T2 写入+查询", len(rows) == 2 and rows[0]["v"] == "你好", str(rows))
        rid = db.execute("UPDATE t SET v=? WHERE v=?", ("改", "world"))
        check("T3 更新 rowcount", rid == 1, str(rid))
        try:
            db.execute("ATTACH DATABASE 'evil.db' AS evil")
            check("T4 ATTACH 拦截", False, "未拦截")
        except PermissionError:
            check("T4 ATTACH 拦截", True)
        try:
            db.query("DETACH evil")
            check("T5 DETACH 拦截", False, "未拦截")
        except PermissionError:
            check("T5 DETACH 拦截", True)
        # 命名空间隔离：另一插件的库文件独立存在
        db2 = _CtxDb("ui.other")
        rows2 = db2.query("SELECT name FROM sqlite_master WHERE type='table'")
        check("T6 物理隔离（他插件库无 t 表）", all(r["name"] != "t" for r in rows2), str(rows2))
        db.close()
        db2.close()
    finally:
        os.chdir(ROOT)
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n结果: %d PASS / %d FAIL" % (len(PASS), len(FAIL)))
    sys.exit(0 if not FAIL else 1)


if __name__ == "__main__":
    main()
