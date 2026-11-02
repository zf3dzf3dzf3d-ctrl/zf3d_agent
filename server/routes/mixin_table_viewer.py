# -*- coding: utf-8 -*-
"""Mixin: 数据表查看器（/api/table-viewer）—— 用户可视化浏览 table_memory 建的表。

数据源：server/data/memory.db（memory_core.MemoryCore 的 _tables/_rows 两张表）。
GET  ?action=list              列出所有表（含行数）
GET  ?action=rows&table=X      取某表全部行（limit 可选，默认 500）
"""
import os
import json
import sqlite3

_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'memory.db')


def _db_rows(sql, params=()):
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


class MixinTableViewer:
    # ===== GET /api/table-viewer?action=list|rows =====
    def _handle_table_viewer_get(self, query):
        from urllib.parse import parse_qs
        qs = parse_qs(query or '')
        action = (qs.get('action') or ['list'])[0]

        try:
            if action == 'list':
                tables = _db_rows("SELECT name, created_at FROM _tables ORDER BY created_at")
                result = []
                for t in tables:
                    cnt = _db_rows("SELECT COUNT(*) AS n FROM _rows WHERE table_name=?", (t['name'],))
                    result.append({'name': t['name'], 'created_at': t['created_at'], 'count': cnt[0]['n'] if cnt else 0})
                self._send_json({'ok': True, 'tables': result})
                return

            if action == 'rows':
                table = (qs.get('table') or [''])[0].strip()
                # 兼容非浏览器客户端（如 curl/命令行）直接发原始 UTF-8 字节的情况：
                # parse_qs 会把字节按 latin-1 解码导致中文乱码，这里尝试还原
                try:
                    table = table.encode('latin-1').decode('utf-8')
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass  # 已经是正常 UTF-8 解码，无需处理
                if not table:
                    self._send_json({'ok': False, 'error': '需要提供 table 参数'})
                    return
                exists = _db_rows("SELECT 1 FROM _tables WHERE name=?", (table,))
                if not exists:
                    self._send_json({'ok': False, 'error': '表不存在: %s' % table})
                    return
                try:
                    limit = max(1, min(2000, int((qs.get('limit') or ['500'])[0])))
                except ValueError:
                    limit = 500
                rows = _db_rows(
                    "SELECT id, data, created_at, updated_at FROM _rows WHERE table_name=? ORDER BY id LIMIT ?",
                    (table, limit))
                # 解析 data JSON；自动汇总所有出现过的字段作为列
                parsed = []
                columns = ['id']
                seen = set()
                for r in rows:
                    try:
                        d = json.loads(r.get('data') or '{}')
                    except Exception:
                        d = {'_raw': r.get('data')}
                    if not isinstance(d, dict):
                        d = {'_raw': str(d)}
                    item = {'id': r['id']}
                    for k, v in d.items():
                        if k not in seen:
                            seen.add(k)
                            columns.append(k)
                        item[k] = v
                    item['_created_at'] = r.get('created_at')
                    parsed.append(item)
                columns.append('_created_at')
                self._send_json({'ok': True, 'table': table, 'columns': columns, 'rows': parsed, 'count': len(parsed)})
                return

            self._send_json({'ok': False, 'error': '未知 action: %s' % action})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})
