# -*- coding: utf-8 -*-
"""
rag_engine.py — 本地知识库 RAG 引擎（可插拔模块）

设计原则：
- 完全自包含：引擎、向量库(SQLite)、配置全在本 rag/ 目录内
- 零依赖：只用 Python 标准库（sqlite3/urllib/math/json）
- 可插拔：整个 rag/ 目录删除即彻底移除，不影响主项目
- 向量化：智谱 embedding-3（2048维），Key 从 private/api_keys.json 动态读取

数据存储：rag/kb.db（SQLite）
  documents(id, name, source, created_at)
  chunks(id, doc_id, ord, content, embedding BLOB, dim)

对外接口：
  ingest_text(name, text, source='')     -> 入库（自动分块+向量化）
  search(query, top_k=5)                 -> 相似检索 [{content, score, doc_name}]
  delete_document(doc_id) / list_documents() / stats()
"""
import json
import math
import os
import sqlite3
import struct
import threading
import time
import urllib.request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
DB_PATH = os.path.join(BASE_DIR, 'kb.db')
CONFIG_PATH = os.path.join(BASE_DIR, 'config.json')
KEYS_PATH = os.path.join(PROJECT_ROOT, 'private', 'api_keys.json')

_lock = threading.Lock()

# ---------- 配置 ----------

DEFAULT_CONFIG = {
    'enabled': True,
    'embedding_provider': 'zhipu',
    'embedding_model': 'embedding-3',
    'embedding_url': 'https://open.bigmodel.cn/api/paas/v4/embeddings',
    'key_name': '智谱 GLM',   # 在 api_keys.json 中的键名
    'chunk_size': 500,         # 分块字符数
    'chunk_overlap': 50,       # 块间重叠
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    try:
        with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
            saved = json.load(f)
            if isinstance(saved, dict):
                cfg.update(saved)
    except Exception:
        pass
    return cfg


def save_config(cfg):
    with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _get_api_key(cfg):
    try:
        with open(KEYS_PATH, 'r', encoding='utf-8') as f:
            keys = json.load(f).get('keys', {})
        return keys.get(cfg.get('key_name', ''), '')
    except Exception:
        return ''


# ---------- 数据库 ----------

def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('''CREATE TABLE IF NOT EXISTS documents(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        source TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now','localtime')))''')
    conn.execute('''CREATE TABLE IF NOT EXISTS chunks(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ord INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        dim INTEGER NOT NULL)''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id)')
    return conn


# ---------- 向量化 ----------

def embed_texts(texts, cfg=None):
    """批量向量化，返回 [[float,...], ...]；失败抛异常"""
    cfg = cfg or load_config()
    key = _get_api_key(cfg)
    if not key:
        raise RuntimeError('未找到向量化 API Key（%s）' % cfg.get('key_name'))
    url = cfg.get('embedding_url')
    out = []
    # 智谱单次限制，分批每批 16 条
    for i in range(0, len(texts), 16):
        batch = texts[i:i + 16]
        body = json.dumps({'model': cfg['embedding_model'],
                           'input': batch if len(batch) > 1 else batch[0]}).encode('utf-8')
        req = urllib.request.Request(url, data=body, headers={
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key})
        resp = urllib.request.urlopen(req, timeout=60)
        data = json.loads(resp.read().decode('utf-8'))
        items = sorted(data.get('data', []), key=lambda d: d.get('index', 0))
        for it in items:
            out.append([float(x) for x in it['embedding']])
    return out


# ---------- 分块 ----------

def _split_chunks(text, size, overlap):
    text = text.strip()
    if len(text) <= size:
        return [text] if text else []
    chunks = []
    step = size - overlap
    i = 0
    while i < len(text):
        chunks.append(text[i:i + size])
        i += step
    return chunks


def _pack(vec):
    return struct.pack('%df' % len(vec), *vec)


def _unpack(blob):
    n = len(blob) // 4
    return list(struct.unpack('%df' % n, blob))


# ---------- 对外接口 ----------

def ingest_text(name, text, source='', cfg=None):
    """入库一段文档文本。返回 {doc_id, chunks}"""
    cfg = cfg or load_config()
    text = (text or '').strip()
    if not text:
        raise ValueError('文本为空')
    chunks = _split_chunks(text, cfg['chunk_size'], cfg['chunk_overlap'])
    vectors = embed_texts(chunks, cfg)
    with _lock:
        conn = _db()
        try:
            cur = conn.execute('INSERT INTO documents(name, source) VALUES(?,?)', (name, source))
            doc_id = cur.lastrowid
            for o, (c, v) in enumerate(zip(chunks, vectors)):
                conn.execute('INSERT INTO chunks(doc_id, ord, content, embedding, dim) VALUES(?,?,?,?,?)',
                             (doc_id, o, c, _pack(v), len(v)))
            conn.commit()
            return {'ok': True, 'doc_id': doc_id, 'chunks': len(chunks)}
        finally:
            conn.close()


def _cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-9
    nb = math.sqrt(sum(y * y for y in b)) or 1e-9
    return dot / (na * nb)


def search(query, top_k=5, min_score=0.3):
    """语义检索。返回 [{doc_name, content, score}]，按相关度降序"""
    qv = embed_texts([query])[0]
    with _lock:
        conn = _db()
        try:
            rows = conn.execute('SELECT c.content, c.embedding, c.dim, d.name AS doc_name '
                                'FROM chunks c JOIN documents d ON d.id=c.doc_id').fetchall()
        finally:
            conn.close()
    scored = []
    for r in rows:
        vec = _unpack(r['embedding'])
        if len(vec) != len(qv):
            continue
        s = _cosine(qv, vec)
        if s >= min_score:
            scored.append({'doc_name': r['doc_name'], 'content': r['content'], 'score': round(s, 4)})
    scored.sort(key=lambda x: -x['score'])
    return scored[:top_k]


def list_documents():
    conn = _db()
    try:
        rows = conn.execute('''SELECT d.id, d.name, d.source, d.created_at,
                               (SELECT COUNT(*) FROM chunks WHERE doc_id=d.id) AS chunk_count
                               FROM documents d ORDER BY d.id DESC''').fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def delete_document(doc_id):
    with _lock:
        conn = _db()
        try:
            conn.execute('PRAGMA foreign_keys=ON')
            conn.execute('DELETE FROM chunks WHERE doc_id=?', (doc_id,))
            cur = conn.execute('DELETE FROM documents WHERE id=?', (doc_id,))
            conn.commit()
            return {'ok': True, 'deleted': cur.rowcount}
        finally:
            conn.close()


def stats():
    conn = _db()
    try:
        docs = conn.execute('SELECT COUNT(*) AS n FROM documents').fetchone()['n']
        chunks = conn.execute('SELECT COUNT(*) AS n FROM chunks').fetchone()['n']
        return {'docs': docs, 'chunks': chunks, 'db_path': DB_PATH}
    finally:
        conn.close()


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    print(json.dumps(stats(), ensure_ascii=False))
