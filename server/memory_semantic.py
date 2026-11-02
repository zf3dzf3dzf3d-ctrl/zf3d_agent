# -*- coding: utf-8 -*-
"""
memory_semantic.py —— 记忆语义层（零依赖）
在 memory_core 表格记忆之上加一层"语义召回"：
- 写入记忆（insert/insert_semantic）时同步向量化（复用 rag_engine.embed_texts，embedding 失败自动降级为仅表格存储）
- 查询时按语义相似召回 top-k 相关记忆，无需精确字段匹配
向量存 data/semantic.db（SQLite）：{table, row_id, text, embedding BLOB}
"""
import json
import math
import os
import sqlite3
import struct
import threading
from datetime import datetime

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import memory_core

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SEM_DB = os.path.join(BASE_DIR, 'data', 'semantic.db')
DIM_MISMATCH_TOLERANT = True

_lock = threading.Lock()


def _db():
    conn = sqlite3.connect(SEM_DB, timeout=30)
    conn.execute('PRAGMA busy_timeout=30000')
    conn.row_factory = sqlite3.Row
    conn.execute('''CREATE TABLE IF NOT EXISTS _sem(
        table_name TEXT NOT NULL,
        row_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        dim INTEGER NOT NULL,
        created_at TEXT,
        PRIMARY KEY(table_name, row_id))''')
    return conn


def _pack(vec):
    return struct.pack('%df' % len(vec), *vec)


def _unpack(blob):
    n = len(blob) // 4
    return list(struct.unpack('%df' % n, blob))


def _row_text(data):
    """把自由 JSON 记忆压成一段可向量化文本。"""
    if isinstance(data, str):
        return data
    parts = []
    for k, v in (data or {}).items():
        parts.append('%s:%s' % (k, v))
    return ' '.join(parts)[:2000]


def _embed(texts):
    """复用 RAG 引擎的向量化。不可用返回 None（降级为关键词子串匹配）。"""
    try:
        import rag_engine
        return rag_engine.embed_texts(texts)
    except Exception:
        return None


def _hash_embed(text, dim=256):
    """零依赖兜底向量化：字符 n-gram 哈希投影。离线/无 key 时仍可用语义召回。"""
    import hashlib, re as _re
    v = [0.0] * dim
    t = (text or '')
    grams = _re.findall(r'[\u4e00-\u9fff]', t) + _re.findall(r'[a-z0-9]{2,}', t.lower())
    grams += [''.join(p) for p in zip(_re.findall(r'[\u4e00-\u9fff]', t),
                                       _re.findall(r'[\u4e00-\u9fff]', t)[1:])]
    for g in grams:
        h = int(hashlib.md5(g.encode('utf-8')).hexdigest(), 16)
        v[h % dim] += 1.0 if (h >> 8) & 1 else -1.0
    norm = math.sqrt(sum(x * x for x in v)) or 1e-9
    return [x / norm for x in v]


class SemanticMemory:
    def __init__(self, core: memory_core.MemoryCore = None):
        self.core = core or memory_core.MemoryCore()

    def insert(self, table, data):
        """写入表格记忆 + 同步向量化。返回 {ok, id, embedded}"""
        r = self.core.insert(table, data)
        if r.get('ok'):
            text = _row_text(data)
            vecs = _embed([text]) or [_hash_embed(text)]
            try:
                with _lock, _db() as c:
                    c.execute('INSERT OR REPLACE INTO _sem VALUES(?,?,?,?,?,?)',
                              (table, r['id'], text, _pack(vecs[0]), len(vecs[0]),
                               datetime.now().isoformat(timespec='seconds')))
                r['embedded'] = True
            except Exception:
                r['embedded'] = False
        return r

    def delete(self, table, row_id):
        with _lock, _db() as c:
            c.execute('DELETE FROM _sem WHERE table_name=? AND row_id=?', (table, row_id))
        return self.core.delete(table, row_id)

    def update(self, table, row_id, data):
        r = self.core.update(table, row_id, data)
        if r.get('ok'):
            row = self.core.get(table, row_id)
            if row:
                text = _row_text(row['data'])
                vecs = _embed([text]) or [_hash_embed(text)]
                try:
                    with _lock, _db() as c:
                        c.execute('INSERT OR REPLACE INTO _sem VALUES(?,?,?,?,?,?)',
                                  (table, row_id, text, _pack(vecs[0]), len(vecs[0]),
                                   datetime.now().isoformat(timespec='seconds')))
                except Exception:
                    pass
        return r

    def search_semantic(self, query, tables=None, top_k=5, min_score=0.2):
        """语义召回：跨表（或指定表）按向量相似度召回记忆。
        向量化不可用时降级为子串匹配。"""
        qv = _embed([query]) or [_hash_embed(query)]
        with _db() as c:
            if tables:
                rows = []
                for t in tables:
                    rows += [dict(r) for r in c.execute(
                        'SELECT * FROM _sem WHERE table_name=?', (t,)).fetchall()]
            else:
                rows = [dict(r) for r in c.execute('SELECT * FROM _sem').fetchall()]
        if not rows:
            return []
        results = []
        if qv:
            q = qv[0]
            for r in rows:
                if len(r['embedding']) // 4 != len(q):
                    continue
                v = _unpack(r['embedding'])
                dot = sum(x * y for x, y in zip(q, v))
                na = math.sqrt(sum(x * x for x in q)) or 1e-9
                nb = math.sqrt(sum(x * x for x in v)) or 1e-9
                s = dot / (na * nb)
                if s >= min_score:
                    results.append({'table': r['table_name'], 'id': r['row_id'],
                                    'text': r['text'], 'score': round(s, 4)})
        else:
            # 降级：关键词子串
            for r in rows:
                if query in r['text'] or any(w in r['text'] for w in query.split()):
                    results.append({'table': r['table_name'], 'id': r['row_id'],
                                    'text': r['text'], 'score': 0.5})
        results.sort(key=lambda x: -x['score'])
        return results[:top_k]

    def recall_for_context(self, query, top_k=3, tables=None):
        """给主脑用：返回一段可直接注入 system prompt 的记忆文本（无命中返回空串）。"""
        hits = self.search_semantic(query, tables=tables, top_k=top_k)
        if not hits:
            return ''
        lines = ['[相关历史记忆]']
        for h in hits:
            lines.append('- (%s#%s, %.2f) %s' % (h['table'], h['id'], h['score'], h['text'][:300]))
        return '\n'.join(lines)


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    m = SemanticMemory()
    m.core.create_table('项目笔记')
    print(m.insert('项目笔记', {'主题': '蜂群调度', '要点': '失败仲裁会换备用模型重跑'}))
    print(m.insert('项目笔记', {'主题': '午餐', '要点': '今天吃了面条'}))
    print(m.recall_for_context('蜂群 失败后怎么办'))
