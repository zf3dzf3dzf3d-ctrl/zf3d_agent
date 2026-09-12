# -*- coding: utf-8 -*-
"""
memory_core.py —— 通用表格记忆核心（领域无关）
====================================================
设计原则：
- 核心完全不关心业务。是游泳记录、游戏战绩、发帖运营数据……都一样。
- 表由外部（大模型/上层应用）按需创建，data 字段为自由 JSON，不预定义 schema。
- 大模型负责"填写内容"，本模块只负责"最简单的数据库操作"。

底层：SQLite 单文件（默认 data/memory.db），data 列存 JSON。

接口（够用即可）：
  create_table(name)                      建表（幂等）
  list_tables()                           列出所有表
  insert(table, data)                     插入一条，返回 id
  query(table, where=None, order=None, limit=None)   查询
  get(table, id)                          按主键取一条
  update(table, id, data)                 修改
  delete(table, id)                       删除
  stats(table, field, where=None)         对某数值字段自动统计（均值/最大/最小/趋势）
"""

import json
import os
import sqlite3
from datetime import datetime

DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "memory.db")


class MemoryCore:
    def __init__(self, db_path: str = None):
        self.db_path = db_path or DEFAULT_DB
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._init_db()

    # ---------- 内部 ----------
    def _conn(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self):
        with self._conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS _tables (
                    name TEXT PRIMARY KEY,
                    created_at TEXT
                )
            """)
            c.execute("""
                CREATE TABLE IF NOT EXISTS _rows (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    table_name TEXT,
                    data TEXT,              -- 自由 JSON，内容由大模型决定
                    created_at TEXT,
                    updated_at TEXT
                )
            """)
            c.execute("CREATE INDEX IF NOT EXISTS idx_rows_table ON _rows(table_name)")

    def _check_table(self, c, table):
        row = c.execute("SELECT 1 FROM _tables WHERE name=?", (table,)).fetchone()
        if not row:
            raise ValueError(f"表不存在: {table}，请先 create_table('{table}')")

    # ---------- 表操作 ----------
    def create_table(self, name: str) -> dict:
        with self._conn() as c:
            c.execute("INSERT OR IGNORE INTO _tables(name, created_at) VALUES(?, ?)",
                      (name, datetime.now().isoformat(timespec="seconds")))
        return {"ok": True, "table": name}

    def list_tables(self) -> list:
        with self._conn() as c:
            rows = c.execute("SELECT name, created_at FROM _tables ORDER BY created_at").fetchall()
        return [{"name": r["name"], "created_at": r["created_at"]} for r in rows]

    def drop_table(self, name: str) -> dict:
        with self._conn() as c:
            c.execute("DELETE FROM _rows WHERE table_name=?", (name,))
            c.execute("DELETE FROM _tables WHERE name=?", (name,))
        return {"ok": True, "dropped": name}

    # ---------- 行操作 ----------
    def insert(self, table: str, data: dict) -> dict:
        now = datetime.now().isoformat(timespec="seconds")
        with self._conn() as c:
            self._check_table(c, table)
            cur = c.execute(
                "INSERT INTO _rows(table_name, data, created_at, updated_at) VALUES(?,?,?,?)",
                (table, json.dumps(data, ensure_ascii=False), now, now))
            return {"ok": True, "id": cur.lastrowid}

    def get(self, table: str, row_id: int) -> dict | None:
        with self._conn() as c:
            self._check_table(c, table)
            r = c.execute("SELECT * FROM _rows WHERE table_name=? AND id=?",
                          (table, row_id)).fetchone()
        return self._row_to_dict(r) if r else None

    def query(self, table: str, where: dict = None, order: str = "id DESC",
              limit: int = None, offset: int = 0) -> list:
        """where: {json字段: 值} 精确匹配（值取自 data JSON 内）；order 只允许 id/created_at。"""
        sql = "SELECT * FROM _rows WHERE table_name=?"
        params = [table]
        where = where or {}
        for k, v in where.items():
            if k in ("id", "created_at"):
                sql += f" AND {k}=?"
                params.append(v)
            else:
                sql += " AND json_extract(data, ?)=?"
                params.append(f"$.{k}")
                params.append(v if isinstance(v, (int, float)) else str(v))
        order = order if order in ("id DESC", "id ASC", "created_at DESC", "created_at ASC") else "id DESC"
        sql += f" ORDER BY {order}"
        if limit:
            sql += " LIMIT ? OFFSET ?"
            params += [limit, offset]
        with self._conn() as c:
            self._check_table(c, table)
            rows = c.execute(sql, params).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def update(self, table: str, row_id: int, data: dict) -> dict:
        with self._conn() as c:
            self._check_table(c, table)
            old = c.execute("SELECT data FROM _rows WHERE table_name=? AND id=?",
                            (table, row_id)).fetchone()
            if not old:
                return {"ok": False, "error": "记录不存在"}
            merged = json.loads(old["data"])
            merged.update(data)
            c.execute("UPDATE _rows SET data=?, updated_at=? WHERE table_name=? AND id=?",
                      (json.dumps(merged, ensure_ascii=False),
                       datetime.now().isoformat(timespec="seconds"), table, row_id))
            return {"ok": True, "id": row_id}

    def delete(self, table: str, row_id: int) -> dict:
        with self._conn() as c:
            self._check_table(c, table)
            c.execute("DELETE FROM _rows WHERE table_name=? AND id=?", (table, row_id))
            return {"ok": True}

    def count(self, table: str, where: dict = None) -> int:
        return len(self.query(table, where=where, limit=None))

    # ---------- 通用统计（不知道字段含义也能算） ----------
    def stats(self, table: str, field: str, where: dict = None) -> dict:
        """对 data 中某数值字段做自动统计：条数/均值/最大/最小/最近趋势。"""
        rows = self.query(table, where=where, order="id ASC")
        values = [r["data"].get(field) for r in rows
                  if isinstance(r["data"].get(field), (int, float))]
        if not values:
            return {"ok": False, "error": f"字段 {field} 无数值数据"}
        n = len(values)
        recent = values[-5:]
        prev = values[:-5]
        trend = 0.0
        if prev and sum(prev) / len(prev) != 0:
            trend = round((sum(recent) / len(recent) - sum(prev) / len(prev))
                          / (sum(prev) / len(prev)) * 100, 1)
        return {
            "ok": True, "table": table, "field": field,
            "count": n,
            "avg": round(sum(values) / n, 2),
            "max": max(values), "min": min(values),
            "first": values[0], "last": values[-1],
            "trend_pct": trend,   # 最近5条 相对 之前的 均值变化百分比
        }

    # ---------- 工具 ----------
    @staticmethod
    def _row_to_dict(r) -> dict:
        return {
            "id": r["id"],
            "table": r["table_name"],
            "data": json.loads(r["data"]),
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }


if __name__ == "__main__":
    # 演示：完全不同的两个领域，用同一个核心
    m = MemoryCore()
    m.create_table("游泳打卡")
    m.create_table("游戏战绩")

    m.insert("游泳打卡", {"日期": "2026-09-01", "距离米": 1500, "用时分": 45, "状态": "好"})
    m.insert("游泳打卡", {"日期": "2026-09-02", "距离米": 1800, "用时分": 50, "状态": "好"})
    m.insert("游戏战绩", {"日期": "2026-09-01", "段位": "黄金", "胜场": 8, "负场": 4})

    print(m.list_tables())
    print(m.stats("游泳打卡", "距离米"))
    print(m.query("游戏战绩", where={"段位": "黄金"}))
