# -*- coding: utf-8 -*-
"""archive.py —— 原文一字不删的 append-only 落盘

铁律：写进 turns.jsonl 的内容与模型收到的原文一致，
读回时 blob 引用重算 sha256 校验，不一致即数据事故。
"""
import json
import os
import hashlib
import threading
import time

from . import config

_LOCKS = {}
_LOCKS_GUARD = threading.Lock()


def _lock_for(path):
    with _LOCKS_GUARD:
        lk = _LOCKS.get(path)
        if lk is None:
            lk = threading.RLock()
            _LOCKS[path] = lk
        return lk


def _write_blob(sdir, text):
    """超长内容分片落盘，返回定位引用（不含原文）。"""
    raw = text.encode('utf-8', 'replace')
    sha = hashlib.sha256(raw).hexdigest()
    rel = sha[:2] + os.sep + sha + '.txt'
    full = os.path.join(sdir, config.BLOBS_DIR, rel)
    if not os.path.exists(full):
        os.makedirs(os.path.dirname(full), exist_ok=True)
        tmp = full + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(raw)
        os.replace(tmp, full)
    return {'kind': 'blob', 'sha256': sha, 'bytes': len(raw), 'path': rel}


def append_turn(session_id, turn_no, messages, meta=None):
    """追加一轮。messages 为该轮发送给模型的完整快照。

    返回 {'ok','turns','sha256','bytes','blobs'}
    """
    sdir = config.session_dir(session_id)
    tpath = os.path.join(sdir, config.TURNS_FILE)
    lk = _lock_for(tpath)
    with lk:
        rec = {
            'turn': int(turn_no),
            'ts': round(time.time(), 3),
            'messages': [],
            'meta': dict(meta or {}),
        }
        blob_refs = []
        for m in messages or []:
            if not isinstance(m, dict):
                rec['messages'].append(m)
                continue
            content = m.get('content')
            if isinstance(content, str) and len(content) > config.BLOB_THRESHOLD:
                ref = _write_blob(sdir, content)
                blob_refs.append(ref)
                nm = dict(m)
                nm['content'] = {'kind': 'blob', 'sha256': ref['sha256'],
                                 'bytes': ref['bytes'], 'path': ref['path']}
                rec['messages'].append(nm)
            elif isinstance(content, list):
                nm = dict(m)
                ncontent = []
                for seg in content:
                    if isinstance(seg, dict) and isinstance(seg.get('text'), str) \
                            and len(seg['text']) > config.BLOB_THRESHOLD:
                        ref = _write_blob(sdir, seg['text'])
                        blob_refs.append(ref)
                        s2 = dict(seg)
                        s2['text'] = None
                        s2['blob'] = {'kind': 'blob', 'sha256': ref['sha256'],
                                      'bytes': ref['bytes'], 'path': ref['path']}
                        ncontent.append(s2)
                    else:
                        ncontent.append(seg)
                nm['content'] = ncontent
                rec['messages'].append(nm)
            else:
                rec['messages'].append(m)

        line = json.dumps(rec, ensure_ascii=False)
        raw = line.encode('utf-8')
        sha = hashlib.sha256(raw).hexdigest()
        with open(tpath, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
        return {'ok': True, 'turns': count_turns(session_id), 'sha256': sha,
                'bytes': len(raw), 'blobs': len(blob_refs)}


def count_turns(session_id):
    tpath = os.path.join(config.session_dir(session_id), config.TURNS_FILE)
    if not os.path.exists(tpath):
        return 0
    n = 0
    with open(tpath, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                n += 1
    return n


def verify(session_id):
    """全量读回校验：每行可 JSON 解析，blob 可定位且 sha 匹配。"""
    sdir = config.session_dir(session_id)
    tpath = os.path.join(sdir, config.TURNS_FILE)
    bad = []
    n = 0
    if not os.path.exists(tpath):
        return {'ok': True, 'turns': 0, 'bad': []}
    with open(tpath, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f, 1):
            line = line.rstrip('\n')
            if not line.strip():
                continue
            n += 1
            try:
                rec = json.loads(line)
            except Exception as e:
                bad.append({'line': i, 'err': 'json: %s' % e})
                continue
            for m in rec.get('messages') or []:
                if isinstance(m, dict):
                    _check_blobs(sdir, m.get('content'), i, bad)
    return {'ok': not bad, 'turns': n, 'bad': bad}


def _check_blobs(sdir, content, line_no, bad):
    refs = []
    if isinstance(content, dict) and content.get('kind') == 'blob':
        refs.append(content)
    elif isinstance(content, list):
        for seg in content:
            if isinstance(seg, dict) and isinstance(seg.get('blob'), dict):
                refs.append(seg['blob'])
    for r in refs:
        full = os.path.join(sdir, config.BLOBS_DIR, r.get('path') or '')
        if not os.path.exists(full):
            bad.append({'line': line_no, 'err': 'blob missing', 'sha': r.get('sha256')})
            continue
        with open(full, 'rb') as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        if sha != r.get('sha256'):
            bad.append({'line': line_no, 'err': 'sha mismatch', 'sha': r.get('sha256')})


def read_turn(session_id, turn_no, resolve_blobs=True):
    """读指定轮原文（blob 还原为全文）。"""
    sdir = config.session_dir(session_id)
    tpath = os.path.join(sdir, config.TURNS_FILE)
    if not os.path.exists(tpath):
        return None
    want = int(turn_no)
    with open(tpath, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            if int(rec.get('turn') or 0) == want:
                if resolve_blobs:
                    for m in rec.get('messages') or []:
                        if isinstance(m, dict):
                            m['content'] = _resolve(sdir, m.get('content'))
                return rec
    return None


def _resolve(sdir, content):
    if isinstance(content, dict) and content.get('kind') == 'blob':
        return _read_blob(sdir, content)
    if isinstance(content, list):
        out = []
        for seg in content:
            if isinstance(seg, dict) and isinstance(seg.get('blob'), dict):
                s2 = dict(seg)
                s2['text'] = _read_blob(sdir, seg['blob'])
                s2.pop('blob', None)
                out.append(s2)
            else:
                out.append(seg)
        return out
    return content


def _read_blob(sdir, ref):
    try:
        with open(os.path.join(sdir, config.BLOBS_DIR, ref.get('path') or ''),
                  'r', encoding='utf-8') as f:
            return f.read()
    except Exception:
        return '[blob 读取失败: %s]' % (ref.get('sha256') or '')


def iter_turns(session_id):
    """顺序迭代所有轮（不还原 blob，省内存）。"""
    tpath = os.path.join(config.session_dir(session_id), config.TURNS_FILE)
    if not os.path.exists(tpath):
        return
    with open(tpath, 'r', encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            try:
                yield json.loads(line)
            except Exception:
                continue


def _flatten_for_search(session_id, rec):
    """把一轮拍平为可搜文本，blob 引用还原为原文（否则大块分片后搜不到）。"""
    sdir = config.session_dir(session_id)
    parts = []
    for m in rec.get('messages') or []:
        if not isinstance(m, dict):
            continue
        c = m.get('content')
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, list):
            for seg in c:
                if isinstance(seg, dict):
                    t = seg.get('text')
                    if isinstance(t, str):
                        parts.append(t)
                    b = seg.get('blob')
                    if isinstance(b, dict):
                        parts.append(_read_blob(sdir, b))
        elif isinstance(c, dict) and c.get('kind') == 'blob':
            parts.append(_read_blob(sdir, c))
    return json.dumps(parts, ensure_ascii=False)


def search(session_id, keyword, limit=None):
    """归档全文搜关键词，返回命中轮摘要。"""
    limit = int(limit or config.MAX_ARCHIVE_SEARCH_HITS)
    kw = str(keyword or '').strip()
    if not kw:
        return []
    hits = []
    for rec in iter_turns(session_id):
        body = _flatten_for_search(session_id, rec)
        if kw in body:
            hits.append({
                'turn': rec.get('turn'),
                'ts': rec.get('ts'),
                'snippet': _snippet(body, kw),
            })
            if len(hits) >= limit:
                break
    return hits


def _snippet(text, kw, width=300):
    i = text.find(kw)
    if i < 0:
        return ''
    a = max(0, i - width // 2)
    b = min(len(text), i + len(kw) + width // 2)
    return ('...' if a > 0 else '') + text[a:b] + ('...' if b < len(text) else '')


def dir_size(session_id):
    sdir = config.session_dir(session_id)
    total = 0
    for root, _dirs, files in os.walk(sdir):
        for fn in files:
            try:
                total += os.path.getsize(os.path.join(root, fn))
            except Exception:
                pass
    return total


def list_sessions():
    """所有会话归档及占用，供管理入口展示。"""
    root = config.ensure_root()
    out = []
    for sid in sorted(os.listdir(root)):
        d = os.path.join(root, sid)
        if os.path.isdir(d):
            out.append({'session': sid, 'turns': count_turns(sid), 'bytes': dir_size(sid)})
    return out


def delete_session(session_id):
    """手动清理入口（默认不自动删）。"""
    import shutil
    sdir = config.session_dir(session_id)
    if os.path.isdir(sdir):
        shutil.rmtree(sdir, ignore_errors=True)
        return True
    return False


def total_size():
    root = config.ensure_root()
    total = 0
    for sid in os.listdir(root):
        if os.path.isdir(os.path.join(root, sid)):
            total += dir_size(sid)
    return total
