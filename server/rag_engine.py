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
        with open(CONFIG_PATH, 'r', encoding='utf-8-sig') as f:
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
        with open(KEYS_PATH, 'r', encoding='utf-8-sig') as f:
            keys = json.load(f).get('keys', {})
        return keys.get(cfg.get('key_name', ''), '')
    except Exception:
        return ''


# ---------- 数据库 ----------

def _db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute('PRAGMA busy_timeout=30000')
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
    """语义分块：先按标题/段落/句子边界切小段，再把小段聚合到 size 附近，
    避免固定字符切割把一句话/一个知识点拦腰切断。"""
    import re as _re
    text = (text or '').strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]
    # 一级切分：标题行 / 空行段落
    blocks = [b.strip() for b in _re.split(r'\n\s*\n|(?=^#{1,6}\s)', text, flags=_re.M) if b.strip()]
    # 二级切分：超长块按句子边界再切
    atoms = []
    for b in blocks:
        if len(b) <= size:
            atoms.append(b)
            continue
        sents = [s for s in _re.split(r'(?<=[。！？!?；;\.\n])', b) if s.strip()]
        cur = ''
        for s in sents:
            if len(cur) + len(s) > size and cur:
                atoms.append(cur)
                cur = s
            else:
                cur += s
        if cur:
            atoms.append(cur)
    # 聚合：相邻小段合并到 size 附近（保留 overlap 语义：超过时不硬塞）
    chunks, cur, cur_len = [], '', 0
    for a in atoms:
        if cur and cur_len + len(a) > size:
            chunks.append(cur)
            tail = cur[-overlap:] if overlap > 0 else ''
            cur, cur_len = (tail + a if tail else a), len(tail) + len(a)
        else:
            cur = (cur + '\n' + a) if cur else a
            cur_len = len(cur)
    if cur:
        chunks.append(cur)
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


def _bm25_scores(query, rows, top_n=50):
    """轻量 BM25（零依赖）：对 rows[{content,...}] 打关键词相关分。返回 {idx: score}。"""
    import re as _re
    k1, b = 1.5, 0.75
    # 中英混合分词：连续汉字逐字+二元组，拉丁按词
    def toks(s):
        s = (s or '').lower()
        han = _re.findall(r'[\u4e00-\u9fff]', s)
        bigrams = [''.join(p) for p in zip(han, han[1:])]
        words = _re.findall(r'[a-z0-9]{2,}', s)
        return bigrams + han + words
    q_toks = toks(query)
    if not q_toks or not rows:
        return {}
    docs = [toks(r['content']) for r in rows]
    N = len(docs)
    avgdl = sum(len(d) for d in docs) / N or 1.0
    df = {}
    for d in docs:
        for t in set(d):
            df[t] = df.get(t, 0) + 1
    scores = {}
    for i, d in enumerate(docs):
        tf = {}
        for t in d:
            tf[t] = tf.get(t, 0) + 1
        s = 0.0
        for q in set(q_toks):
            if q not in tf:
                continue
            idf = math.log(1 + (N - df.get(q, 0) + 0.5) / (df.get(q, 0) + 0.5))
            s += idf * tf[q] * (k1 + 1) / (tf[q] + k1 * (1 - b + b * len(d) / avgdl))
        if s > 0:
            scores[i] = s
    return scores


def search(query, top_k=5, min_score=0.3):
    """混合检索：向量语义 + BM25 关键词加权融合（RRF 思路）。
    返回 [{doc_name, content, score, vec_score, bm25_score}]，按相关度降序。"""
    qv = embed_texts([query])[0]
    with _lock:
        conn = _db()
        try:
            rows = conn.execute('SELECT c.content, c.embedding, c.dim, d.name AS doc_name '
                                'FROM chunks c JOIN documents d ON d.id=c.doc_id').fetchall()
        finally:
            conn.close()
    rows = [dict(r) for r in rows]
    if not rows:
        return []
    # 向量分支：预归一化矩阵一次点积（比逐条循环快一个量级）
    n = len(qv)
    vec_scores = [0.0] * len(rows)
    qnorm = math.sqrt(sum(x * x for x in qv)) or 1e-9
    for i, r in enumerate(rows):
        blob = r['embedding']
        if len(blob) // 4 != n:
            continue
        vec = struct.unpack('%df' % n, blob)
        dot = sum(x * y for x, y in zip(qv, vec))
        vnorm = math.sqrt(sum(x * x for x in vec)) or 1e-9
        vec_scores[i] = dot / (qnorm * vnorm)
    # BM25 分支
    bm = _bm25_scores(query, rows)
    # 归一化后加权融合：向量 0.6 + BM25 0.4；任一维度缺失时用另一维度归一分
    vmax = max(vec_scores) or 1.0
    bmax = max(bm.values()) if bm else 1.0
    results = []
    for i, r in enumerate(rows):
        vs = vec_scores[i] / vmax
        bs = (bm.get(i, 0.0) / bmax) if bm else 0.0
        fused = 0.6 * vs + 0.4 * bs
        if vec_scores[i] >= min_score or bs > 0:
            results.append({'doc_name': r['doc_name'], 'content': r['content'],
                            'score': round(fused, 4),
                            'vec_score': round(vec_scores[i], 4),
                            'bm25_score': round(bm.get(i, 0.0), 4)})
    results.sort(key=lambda x: -x['score'])
    return results[:top_k]


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
