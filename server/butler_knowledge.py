#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
butler_knowledge - 员工知识自动检索注入（策划案 v3 P1）
零人工选择：员工接任务时自动检索 private/记忆/ 与 项目记录 相关 md，
关键词打分取 Top-N，注入到投窗消息头部。

设计要点（蜂群收口裁决落地）：
- 双副本去重：project_record 存在「全局/」前缀镜像，按内容 sha1 去重，只保留一份。
- 性能兜底：扫描结果按 (mtime, path) 缓存 300s，2658+ 条记录不重复扫描。
- 空命中不注入：得分<=0 或命中片段为空时返回 ''，调用方直接跳过。
- 来源标注：每个片段带 [来源: <文件名>]，员工可追溯。
"""
import os
import re
import json
import time
import hashlib
import threading

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEM_DIR = os.path.join(BASE, 'private', '记忆')
PRJ_DIR = os.path.join(BASE, '项目记录')

# 注入上限（策划案 v3：每片 <=1500 字，总量 <=6000 字，Top-N <=5 片）
MAX_SNIPPET = 1500
MAX_TOTAL = 6000
TOP_N = 5
_CACHE_TTL = 300  # 秒

_cache_lock = threading.Lock()
_file_cache = []          # [(path, mtime, size, text)]
_cache_ts = 0.0

_STOPWORDS = set('的了是在和与及或对对于关于这个那个我们你们他们如何怎么什么可以需要进行使用完成实现')
_WORD_RE = re.compile(r'[\u4e00-\u9fff]{2,}|[A-Za-z_][A-Za-z0-9_]{2,}')


def _iter_md_files():
    """扫描两个知识目录的 .md（不含 .bak），mtime 缓存 300s。"""
    global _file_cache, _cache_ts
    with _cache_lock:
        now = time.time()
        if _file_cache and now - _cache_ts < _CACHE_TTL:
            return _file_cache
        files = []
        for root_dir in (MEM_DIR, PRJ_DIR):
            if not os.path.isdir(root_dir):
                continue
            for dirpath, dirnames, filenames in os.walk(root_dir):
                dirnames[:] = [d for d in dirnames if not d.startswith('.')]
                for fn in filenames:
                    if fn.lower().endswith('.md') and not fn.endswith('.bak'):
                        p = os.path.join(dirpath, fn)
                        try:
                            st = os.stat(p)
                            files.append((p, st.st_mtime, st.st_size))
                        except OSError:
                            pass
        texts = []
        for p, mtime, size in files:
            try:
                if size > 200 * 1024:
                    continue  # 超 200KB 的 md 跳过，防大文件拖慢
                with open(p, 'r', encoding='utf-8', errors='ignore') as f:
                    texts.append((p, mtime, size, f.read()))
            except OSError:
                pass
        _file_cache = texts
        _cache_ts = now
        return texts


def _keywords(task_desc):
    """任务描述分词：中文 2+ 字词块 + 英文标识符，去停用词。"""
    words = _WORD_RE.findall(str(task_desc or ''))
    return [w for w in words if w not in _STOPWORDS][:20]


def _content_sha1(text):
    # 去掉「全局/」前缀差异后再哈希，双副本镜像内容一致 → 同一哈希
    norm = re.sub(r'^全局/', '', text.strip())
    return hashlib.sha1(norm.encode('utf-8', 'ignore')).hexdigest()


def _score_doc(keywords, text):
    """关键词命中计分：标题行命中权重 x3，正文 x1。"""
    if not keywords:
        return 0
    score = 0
    head = text[:400]  # 标题/开头区
    for w in keywords:
        if w in head:
            score += 3
        score += min(text.count(w), 10)
    return score


def _pick_snippet(keywords, text):
    """取第一个含最多关键词命中的行块（<=MAX_SNIPPET 字）。"""
    lines = text.splitlines()
    best_i, best_hit = 0, 0
    for i, line in enumerate(lines):
        hit = sum(1 for w in keywords if w in line)
        if hit > best_hit:
            best_i, best_hit = i, hit
    if best_hit == 0:
        return ''
    start = max(0, best_i - 2)
    buf, total = [], 0
    for line in lines[start:]:
        if total + len(line) > MAX_SNIPPET:
            break
        buf.append(line)
        total += len(line)
        if len(buf) >= 30:
            break
    return '\n'.join(buf).strip()


def search_knowledge(task_desc):
    """主入口：返回注入文本（无命中返回 ''）。
    格式：【自动知识检索】以下是与任务相关的记忆片段（来源已标注）：
    [来源: xxx.md] ...片段...
    """
    keywords = _keywords(task_desc)
    if not keywords:
        return ''
    seen_sha = set()
    scored = []
    for path, _mtime, _size, text in _iter_md_files():
        sha = _content_sha1(text)
        if sha in seen_sha:
            continue  # 双副本镜像去重
        seen_sha.add(sha)
        s = _score_doc(keywords, text)
        if s > 0:
            scored.append((s, path, text))
    if not scored:
        return ''
    scored.sort(key=lambda x: -x[0])
    parts, total = [], 0
    for s, path, text in scored[:TOP_N]:
        snip = _pick_snippet(keywords, text)
        if not snip:
            continue
        src = os.path.basename(path)
        block = '[来源: %s]\n%s' % (src, snip)
        if total + len(block) > MAX_TOTAL:
            break
        parts.append(block)
        total += len(block)
    if not parts:
        return ''
    return '【自动知识检索】以下是与任务相关的记忆片段（来源已标注，仅供参照）：\n\n' + '\n\n---\n\n'.join(parts)


def build_inject_message(timer):
    """组装点：员工定时器投窗消息 = 知识注入(可选) + 原 task_prompt。
    auto_cap=false 时直接返回原消息（旧行为回退）。
    返回 (final_msg, inject_len)。"""
    prompt = str(timer.get('task_prompt') or '')
    if not timer.get('auto_cap', True):
        return prompt, 0
    try:
        inject = search_knowledge(prompt)
    except Exception:
        inject = ''  # 检索故障不阻塞投窗
    if not inject:
        return prompt, 0
    return inject + '\n\n---\n【任务】' + prompt, len(inject)
