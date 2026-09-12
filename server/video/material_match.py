# -*- coding: utf-8 -*-
"""material_match.py - 素材自动搜配

按文案关键词自动从本地素材库匹配配图/配视频：
1. 从每段文案提取关键词（jieba 分词 + 停用词过滤，无 jieba 时退化为 n-gram 匹配）
2. 素材库建立索引：文件名 + 同名 .txt 描述文件 的关键词倒排索引
3. 按关键词重合度打分排序，返回每段文案最佳素材

供 auto_producer / video_edit produce 调用：materials 未给时可用素材库路径自动搜配。
"""
import os
import re

# 常用停用词
_STOP = set('的了是在有和与人这个那也都很就都而及或着一个上中也们到说要去你会着看好'
            '我们你们他们自己什么没有现在这样那样因为所以但是然后如果这么那么'
            'video mp4 jpg png mov 素材 final final_ output new'.split())


def extract_keywords(text, topn=8):
    """提取文案关键词。优先 jieba，退化为正则切分。"""
    text = text.strip()
    kws = []
    try:
        import jieba
        import jieba.analyse
        kws = [w for w in jieba.analyse.extract_tags(text, topK=topn) if w not in _STOP]
    except ImportError:
        # 退化：2~4 字滑窗 + 单字过滤
        cn = re.findall(r'[\u4e00-\u9fff]{2,4}|[a-zA-Z]{2,}', text)
        seen = set()
        for w in cn:
            w = w.lower()
            if w not in _STOP and w not in seen:
                seen.add(w)
                kws.append(w)
            if len(kws) >= topn:
                break
    return kws


def build_index(lib_dir):
    """扫描素材库，建立 {素材文件: 关键词集合} 索引。
    支持 mp4/mov/jpg/png/webp；同名 .txt 描述文件内容并入关键词。
    """
    exts = {'.mp4', '.mov', '.jpg', '.jpeg', '.png', '.webp'}
    index = {}
    if not os.path.isdir(lib_dir):
        return index
    for root, _dirs, files in os.walk(lib_dir):
        for f in files:
            ext = os.path.splitext(f)[1].lower()
            if ext not in exts:
                continue
            path = os.path.join(root, f)
            stem = os.path.splitext(f)[0]
            kws = set(extract_keywords(stem, topn=10))
            # 同名描述文件
            desc = os.path.join(root, stem + '.txt')
            if os.path.exists(desc):
                try:
                    with open(desc, 'r', encoding='utf-8-sig', errors='replace') as fh:
                        kws |= set(extract_keywords(fh.read(2000), topn=15))
                except OSError:
                    pass
            index[path] = kws
    return index


def match(text, index, topn=3, min_score=1):
    """给一段文案匹配素材。返回 [(path, score, keyword)] 按分排序。"""
    kws = set(extract_keywords(text, topn=12))
    if not kws:
        return []
    scored = []
    for path, pk in index.items():
        hits = kws & pk
        if hits:
            scored.append((path, len(hits), sorted(hits)[0]))
    scored.sort(key=lambda x: -x[1])
    return [(p, s, k) for p, s, k in scored[:topn] if s >= min_score]


def auto_assign(script_lines, lib_dir):
    """给多段文案自动分配素材（每段用过的素材降权避免重复）。
    返回 [{text, materials:[path,...]}]
    """
    index = build_index(lib_dir)
    used = {}
    result = []
    for line in script_lines:
        hits = match(line, index, topn=6)
        # 按使用次数升权排序：优先没被用过的
        hits.sort(key=lambda h: used.get(h[0], 0))
        mats = [h[0] for h in hits[:2]]
        for m in mats:
            used[m] = used.get(m, 0) + 1
        result.append({'text': line, 'materials': mats})
    return result
