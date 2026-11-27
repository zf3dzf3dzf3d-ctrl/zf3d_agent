#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""long_term_memory - 长期记忆管理"""

import json
import time

TOOL_NAME = 'long_term_memory'

CATEGORY = 'long_term_memory'


def handle(body, ctx):
    """处理工具请求"""
    try:
        action = body.get('action', 'list')

        if action == 'save':
            _do_save(body, ctx)
        elif action == 'get':
            _do_get(body, ctx)
        elif action == 'search':
            _do_search(body, ctx)
        elif action == 'list':
            _do_list(body, ctx)
        elif action == 'review':
            _do_review(body, ctx)
        elif action == 'delete':
            _do_delete(body, ctx)
        else:
            ctx.send_json({'ok': False, 'error': f'未知操作: {action}'})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})


# ============ AGI 化改造（2026-11-24，草案见 project_record「全局/AGI种子/记忆系统AGI化改造草案-20261124-alpha」）============
# ①记忆强度：save 带强度字段；get/search 命中即巩固（access_count+1 / last_accessed_at 刷新 / strength+0.1 封顶10.0）
# ②遗忘排序：list/search 按 score = strength / log2(天数间隔+2) 降序，常用浮上来；只降权永不删除
# ④兜底检索：search 0 命中时降级扫 project_record 记忆目录（文件名+首标题匹配），返回疑似记录清单
# 兼容性：旧条目缺强度字段时读取时补默认值（strength=1.0），不迁移不重写

import os as _os
import math as _math

_MAX_STRENGTH = 10.0

# ⑤参数化（续班4，2026-11-24）：衰减/巩固节奏提为常量，调参改这里即可，不动公式本体
_DECAY_SMOOTH_DAYS = 2.0   # 遗忘曲线平滑天数：分母 log2(天数间隔+此值)，越大遗忘越慢
_REINFORCE_STEP = 0.1      # 每次命中巩固的强度增量


def _norm_memory(mem):
    """旧条目补默认强度字段（不重写库，返回补全后的 dict）。"""
    if not isinstance(mem, dict):
        return mem
    mem.setdefault('strength', 1.0)
    mem.setdefault('access_count', 0)
    mem.setdefault('last_accessed_at', mem.get('created_at', int(time.time() * 1000)))
    return mem


def _recall_score(mem, now_ms=None):
    """遗忘曲线打分：strength / log2(天数间隔+平滑天数)。strength 越大越牢、越久没碰衰减越多。"""
    now_ms = now_ms or int(time.time() * 1000)
    last = mem.get('last_accessed_at') or mem.get('created_at') or now_ms
    days = max(0.0, (now_ms - last) / 86400000.0)
    denom = _math.log2(days + _DECAY_SMOOTH_DAYS)
    return (mem.get('strength', 1.0) or 1.0) / (denom if denom > 0 else 1.0)


def _reinforce_ids(ctx, ids):
    """命中即巩固：锁内对命中条目 access_count+1 / last_accessed_at 刷新 / strength+步长（封顶）。
    调用方必须已持有 ctx.db_lock（本函数不再加锁，防重入死锁——遵守锁改动审计纪律）。"""
    if not ids:
        return 0
    conn = ctx.get_db()
    try:
        placeholders = ','.join('?' * len(ids))
        rows = conn.execute(
            f'SELECT key, value FROM app_data WHERE category=? AND key IN ({placeholders})',
            [CATEGORY] + list(ids)
        ).fetchall()
        changed = 0
        now_ms = int(time.time() * 1000)
        for key, raw in rows:  # 元组解包：兼容 Row 与普通 tuple 行工厂（Row 迭代即字段序），防裸连接静默空转
            try:
                mem = json.loads(raw)
            except Exception:
                continue
            mem = _norm_memory(mem)
            mem['access_count'] = int(mem.get('access_count', 0)) + 1
            mem['last_accessed_at'] = now_ms
            mem['strength'] = min(_MAX_STRENGTH, round(float(mem.get('strength', 1.0)) + _REINFORCE_STEP, 2))
            conn.execute(
                'UPDATE app_data SET value=?, updated_at=? WHERE category=? AND key=?',
                (json.dumps(mem, ensure_ascii=False), now_ms, CATEGORY, key)
            )
            changed += 1
        if changed:
            conn.commit()
        return changed
    finally:
        conn.close()


def _apply_reinforce_delta(memories, ids):
    """与 _reinforce_ids 同步的内存侧增量：让本次响应立即反映巩固后的值（防显示滞后一拍）。"""
    now_ms = int(time.time() * 1000)
    idset = set(i for i in ids if i)
    for m in memories:
        if isinstance(m, dict) and m.get('id') in idset:
            m['access_count'] = int(m.get('access_count', 0)) + 1
            m['last_accessed_at'] = now_ms
            m['strength'] = min(_MAX_STRENGTH, round(float(m.get('strength', 1.0)) + _REINFORCE_STEP, 2))


def _search_fallback(ctx, terms, limit=8):
    """④兜底检索：long_term 0 命中时，扫记忆目录文件名/首标题做关键词匹配，返回疑似记录清单。
    只读不写；找不到目录时返回空清单（不干扰主流程）。"""
    results = []
    try:
        base = getattr(ctx, 'base_dir', None)
    except Exception:
        base = None
    if not base:
        return results
    rec_dir = _os.path.join(str(base), 'private', '记忆')
    if not _os.path.isdir(rec_dir):
        return results
    now = time.time()
    # 护栏（bravo 意见②，2026-11-24）：兜底扫描加 5 秒硬超时，防超大记忆目录 walk 拖死主对话响应
    _fb_deadline = time.time() + 5.0
    for root, dirs, files in _os.walk(rec_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.')]
        if time.time() > _fb_deadline:
            break
        for f in files:
            if not f.endswith('.md') or f == '索引.md':
                continue
            fp = _os.path.join(root, f)
            name_hit = any(t in f for t in terms)
            title = ''
            try:
                with open(fp, 'r', encoding='utf-8', errors='replace') as fh:
                    head = fh.read(2048)
                for line in head.splitlines():
                    ls = line.strip()
                    if ls.startswith('#'):
                        title = ls.lstrip('#').strip()
                        break
                if not name_hit and title:
                    name_hit = any(t in title for t in terms)
                if not name_hit:
                    continue
                rel = _os.path.relpath(fp, rec_dir).replace('\\', '/')
                mtime = _os.stat(fp).st_mtime
                results.append({
                    'name': rel,
                    'title': title[:60],
                    'days_ago': round((now - mtime) / 86400.0, 1),
                    'hint': '长期记忆未命中，疑似相关项目记录，可用 project_record read 深读'
                })
            except Exception:
                continue
            if len(results) >= limit or time.time() > _fb_deadline:
                break
        if len(results) >= limit or time.time() > _fb_deadline:
            break
    return results


def _do_save(body, ctx):
    """创建记忆"""
    title = body.get('title', '')
    content = body.get('content', '')
    keywords = body.get('keywords', [])
    tags = body.get('tags', [])

    if not title and not content:
        ctx.send_json({'ok': False, 'error': '需要提供 title 或 content'})
        return

    mem_id = 'mem_' + str(int(time.time() * 1000))
    now = int(time.time() * 1000)
    memory = {
        'id': mem_id,
        'title': title,
        'content': content,
        'keywords': keywords if isinstance(keywords, list) else [],
        'tags': tags if isinstance(tags, list) else [],
        'strength': 1.0,
        'access_count': 0,
        'last_accessed_at': now,
        'created_at': now,
        'updated_at': now
    }

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            conn.execute(
                'INSERT INTO app_data (category, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                (CATEGORY, mem_id, json.dumps(memory, ensure_ascii=False), now, now)
            )
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'memory': memory})


def _do_get(body, ctx):
    """按ID获取记忆"""
    memory_id = body.get('memory_id')
    memory_ids = body.get('memory_ids')

    ids = []
    if memory_id:
        ids = [memory_id]
    elif memory_ids and isinstance(memory_ids, list):
        ids = memory_ids

    if not ids:
        ctx.send_json({'ok': False, 'error': '需要提供 memory_id 或 memory_ids'})
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            placeholders = ','.join('?' * len(ids))
            rows = conn.execute(
                f'SELECT value FROM app_data WHERE category=? AND key IN ({placeholders})',
                [CATEGORY] + ids
            ).fetchall()
        finally:
            conn.close()

    memories = []
    hit_ids = []
    for row in rows:
        try:
            m = _norm_memory(json.loads(row['value']))
            memories.append(m)
            if m.get('id'):
                hit_ids.append(m['id'])
        except Exception:
            pass

    # ①命中即巩固：get 到的记忆 access_count+1/刷新时间/强度+0.1（失败不影响读取主流程）
    try:
        _reinforce_ids(ctx, hit_ids)
        _apply_reinforce_delta(memories, hit_ids)  # 响应同步反映巩固后值
    except Exception:
        pass

    ctx.send_json({'ok': True, 'memories': memories, 'count': len(memories)})


def _do_search(body, ctx):
    """搜索记忆"""
    keyword = body.get('keyword', '')
    keywords = body.get('keywords', [])
    match_mode = body.get('match_mode', 'any')  # any=OR, all=AND
    limit = body.get('limit', 20)

    search_terms = []
    if keyword:
        search_terms.append(keyword)
    if keywords and isinstance(keywords, list):
        search_terms.extend(keywords)

    if not search_terms:
        ctx.send_json({'ok': False, 'error': '需要提供 keyword 或 keywords'})
        return

    search_terms_lower = [t.lower() for t in search_terms]

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            rows = conn.execute(
                'SELECT value FROM app_data WHERE category=? ORDER BY created_at DESC',
                [CATEGORY]
            ).fetchall()
        finally:
            conn.close()

    matched = []
    for row in rows:
        try:
            mem = _norm_memory(json.loads(row['value']))
        except Exception:
            continue

        searchable = ' '.join([
            mem.get('title', ''),
            mem.get('content', ''),
            ' '.join(mem.get('keywords', [])),
            ' '.join(mem.get('tags', []))
        ]).lower()

        if match_mode == 'all':
            # 所有关键词都必须匹配
            if all(term in searchable for term in search_terms_lower):
                matched.append(mem)
        else:
            # 任一关键词匹配即可
            if any(term in searchable for term in search_terms_lower):
                matched.append(mem)

    # ②遗忘排序：按 recall score = strength / log2(天数间隔+2) 降序（常用+最近的浮上来）
    matched.sort(key=_recall_score, reverse=True)
    matched = matched[:limit]

    # ①命中即巩固（DB 写 + 响应同步）
    try:
        _reinforce_ids(ctx, [m.get('id') for m in matched if m.get('id')])
        _apply_reinforce_delta(matched, [m.get('id') for m in matched])
    except Exception:
        pass

    # ④兜底检索：长期记忆 0 命中 → 降级扫项目记录目录返回疑似清单
    fb = []
    if not matched:
        try:
            fb = _search_fallback(ctx, search_terms)
        except Exception:
            fb = []

    resp = {'ok': True, 'memories': matched, 'count': len(matched)}
    if fb:
        resp['fallback_records'] = fb
        resp['note'] = '长期记忆未命中，已降级检索项目记录，找到 %d 条疑似相关（可用 project_record read 深读）' % len(fb)
    ctx.send_json(resp)


def _do_list(body, ctx):
    """列出所有记忆（②按遗忘曲线分数排序：常用+最近的浮上来；只降权永不删除）"""
    limit = body.get('limit', 20)

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            rows = conn.execute(
                'SELECT value FROM app_data WHERE category=? ORDER BY created_at DESC',
                [CATEGORY]
            ).fetchall()
        finally:
            conn.close()

    memories = []
    for row in rows:
        try:
            memories.append(_norm_memory(json.loads(row['value'])))
        except Exception:
            pass

    # ②遗忘排序：score 高在前，取前 limit 条（只影响展示顺序，数据不动）
    memories.sort(key=_recall_score, reverse=True)
    memories = memories[:limit]

    ctx.send_json({'ok': True, 'memories': memories, 'count': len(memories)})


def _do_review(body, ctx):
    """⑥遗忘审查（草案遗留收尾件，bravo 2026-11-25）：只读分析，列清理候选+理由，永不自动删。
    候选规则（全部只降权/只提示，删除必须走显式 delete 由 AI/用户拍板）：
    - low_score: 召回分低于阈值（strength 低 × 久未访问）
    - never_accessed: 从未访问过的老条目（存了不用=没存）
    - duplicate: title 关键词重叠疑似双写（≥4 字公共子串，与 memory_map 体检同源规则）"""
    limit = body.get('limit', 10)
    min_score = body.get('min_score', 0.55)

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            rows = conn.execute(
                'SELECT value FROM app_data WHERE category=? ORDER BY created_at DESC',
                [CATEGORY]
            ).fetchall()
        finally:
            conn.close()

    now_ms = int(time.time() * 1000)
    memories = []
    for row in rows:
        try:
            memories.append(_norm_memory(json.loads(row['value'])))
        except Exception:
            continue

    candidates = []
    for m in memories:
        score = _recall_score(m, now_ms)
        reasons = []
        days_ago = round(max(0.0, (now_ms - (m.get('last_accessed_at') or m.get('created_at') or now_ms)) / 86400000.0), 1)
        if score < min_score:
            reasons.append(f'召回分 {score:.2f} < {min_score}（低强度×久未访问，已沉底）')
        if int(m.get('access_count', 0)) == 0 and days_ago >= 7:
            reasons.append(f'存后 {days_ago} 天从未被访问（存了不用=没存）')
        title = (m.get('title') or '').strip()
        for other in memories:
            if other is m:
                continue
            ot = (other.get('title') or '').strip()
            if not title or not ot:
                continue
            hit = _common_substr_len(title, ot)
            if hit >= 4:
                reasons.append(f'标题与「{ot[:24]}」疑似双写（公共子串 {hit} 字）')
                break
        if reasons:
            candidates.append({
                'id': m.get('id'),
                'title': title[:60],
                'strength': m.get('strength'),
                'access_count': m.get('access_count'),
                'days_since_access': days_ago,
                'score': round(score, 2),
                'reasons': reasons,
                'hint': '仅候选提示；确认无用后用 delete 显式清理（或继续保留，遗忘只降权不删除）'
            })

    # 候选按召回分升序：最"沉底"的排最前
    candidates.sort(key=lambda c: c['score'])
    candidates = candidates[:limit if isinstance(limit, int) and limit > 0 else 10]

    ctx.send_json({
        'ok': True,
        'total': len(memories),
        'candidates': candidates,
        'candidate_count': len(candidates),
        'principle': '遗忘审查只列候选永不自动删；删除必须显式 delete 且建议先确认'
    })


def _common_substr_len(a, b, min_len=4):
    """最长公共子串长度（O(n*m) 小串够用），用于疑似双写检测。"""
    best = 0
    for i in range(len(a)):
        for j in range(len(b)):
            k = 0
            while i + k < len(a) and j + k < len(b) and a[i + k] == b[j + k]:
                k += 1
            if k > best:
                best = k
            if best >= min_len and k == 0:
                pass
    return best


def _do_delete(body, ctx):
    """按ID删除记忆"""
    memory_id = body.get('memory_id')
    memory_ids = body.get('memory_ids')

    ids = []
    if memory_id:
        ids = [memory_id]
    elif memory_ids and isinstance(memory_ids, list):
        ids = memory_ids

    if not ids:
        ctx.send_json({'ok': False, 'error': '需要提供 memory_id 或 memory_ids'})
        return

    with ctx.db_lock:
        conn = ctx.get_db()
        try:
            placeholders = ','.join('?' * len(ids))
            cur = conn.execute(
                f'DELETE FROM app_data WHERE category=? AND key IN ({placeholders})',
                [CATEGORY] + ids
            )
            deleted = cur.rowcount
            conn.commit()
        finally:
            conn.close()

    ctx.send_json({'ok': True, 'deleted': deleted})
