# -*- coding: utf-8 -*-
"""
vector_memory —— 记忆库向量分层检索（v5.4.6 B1）
================================================
对 private/记忆/*.md 做语义相似检索，弥补 project_record 只能按文件名/关键词查的短板。

分层设计（无第三方依赖、离线可用）：
  1. 分层索引：记忆文件按 mtime 增量索引，滑窗分块（600字/步300字），块级建索引
  2. 嵌入：字符 bigram hash 向量（默认，离线零成本）；可选外部 embedding API
     （设置 ZF_EMBED_URL/ZF_EMBED_KEY 时走 HTTP embedding，自动降级回 hash）
  3. 混合打分：cosine(向量) * 0.6 + bm25(关键词) * 0.4，语义+字面双保险
索引缓存落盘 private/记忆/_vector_index.json，文件未变不重建。

对外接口（供工具层注册）：
  search_memory(query, top_k=6) -> {'_ok', 'hits':[{file, chunk, score, snippet}]}
"""
import os
import re
import json
import math
import time

_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.normpath(os.path.join(_DIR, '..', '..', '..'))
MEM_DIRS = [d for d in (
    os.path.join(_ROOT, 'private', '记忆'),                      # 项目根记忆库（主）
    os.path.join(_ROOT, 'server', 'private', '记忆'),            # server 本地记忆（兼容）
) if os.path.isdir(d)]
INDEX_PATH = os.path.join(MEM_DIRS[0], '_vector_index.json') if MEM_DIRS else \
    os.path.join(_ROOT, 'private', '记忆', '_vector_index.json')

CHUNK_SIZE = 600
CHUNK_STEP = 300
TOP_K = int(os.environ.get('ZF_VEC_MEM_TOPK', '6'))
VEC_DIM = 256          # hash 向量维度
W_VEC, W_BM25 = 0.6, 0.4

# 【D4 记忆老化】默认关闭；开启后旧记忆按 mtime 半衰期降档（不删除，只降分）。
# ZF_MEM_AGING=1 开启；ZF_MEM_HALF_LIFE_DAYS 半衰期（默认90天）；
# ZF_MEM_AGING_WHITELIST 逗号分隔文件名白名单，命中者永不降权（策划案/用户偏好等关键文件）。
AGING_ON = os.environ.get('ZF_MEM_AGING', '') in ('1', 'true', 'on')
HALF_LIFE_DAYS = max(1, int(os.environ.get('ZF_MEM_HALF_LIFE_DAYS', '90') or 90))
AGING_WHITELIST = {s.strip() for s in
                   (os.environ.get('ZF_MEM_AGING_WHITELIST', '') or '').split(',') if s.strip()}


def _aging_factor(path, now=None):
    """按文件 mtime 算衰减因子 (0,1]：半个半衰期得 0.5。白名单/关闭时恒为 1。"""
    if not AGING_ON:
        return 1.0
    try:
        fn = os.path.basename(path)
        if fn in AGING_WHITELIST:
            return 1.0
        age_days = ((now or time.time()) - os.path.getmtime(path)) / 86400.0
        if age_days <= 0:
            return 1.0
        return 0.5 ** (age_days / HALF_LIFE_DAYS)
    except OSError:
        return 1.0

TOOL_SCHEMA = {
    'name': 'search_memory',
    'description': ('按语义+关键词混合检索长期记忆库（private/记忆/*.md 的策划案/总结/偏好等）。'
                    '适合"之前做过什么/某方案结论/用户偏好"这类模糊问题，'
                    '精确文件名查找请用 project_record list/search。'),
    'input_schema': {
        'type': 'object',
        'properties': {
            'query': {'type': 'string', 'description': '自然语言问题或关键词'},
            'top_k': {'type': 'integer', 'description': '返回条数，默认6'},
        },
        'required': ['query'],
    },
}

_STOP = set('的了吗呢吧啊呀哦是在有和与或对被把从到向于以之为及还有个这那它他她你们我'
            '的了吗呢吧啊呀哦是在有和与或对被把从到向于以之为及还the a of to in is and or'.split())


def _tokens(text):
    """中英混合分词：连续中文按单字+bigram，连续英文按词。"""
    out = []
    for seg in re.findall(r'[\u4e00-\u9fff]+|[a-zA-Z0-9_]+', text.lower()):
        if re.match(r'[a-zA-Z0-9_]', seg[0]):
            out.append(seg)
        else:
            out.extend(ch for ch in seg if ch not in _STOP)
            out.extend(seg[i:i + 2] for i in range(len(seg) - 1))
    return out


def _hash_vec(tokens):
    """字符 token hash 成归一化稀疏向量（list[float]，长度 VEC_DIM）。"""
    v = [0.0] * VEC_DIM
    for t in tokens:
        h = 0
        for c in t:
            h = (h * 131 + ord(c)) & 0x7FFFFFFF
        v[h % VEC_DIM] += 1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _cosine(a, b):
    return sum(x * y for x, y in zip(a, b))


def _chunks(text):
    """滑窗分块。"""
    text = re.sub(r'\n{3,}', '\n\n', text.strip())
    if len(text) <= CHUNK_SIZE:
        return [text] if text else []
    out = []
    for i in range(0, len(text), CHUNK_STEP):
        c = text[i:i + CHUNK_SIZE]
        if len(c) >= 80 or i == 0:
            out.append(c)
        if i + CHUNK_SIZE >= len(text):
            break
    return out


def _build_index(force=False):
    """增量构建索引：{file: {mtime, chunks: [{text, vec}]} }。"""
    idx = {}
    if not force and os.path.isfile(INDEX_PATH):
        try:
            with open(INDEX_PATH, 'r', encoding='utf-8') as f:
                idx = json.load(f)
        except (OSError, ValueError):
            idx = {}
    changed = False
    for MEM_DIR in MEM_DIRS:
        for fn in os.listdir(MEM_DIR):
            if not fn.endswith('.md') or fn == '_vector_index.json':
                continue
            p = os.path.join(MEM_DIR, fn)
            mt = os.path.getmtime(p)
            rec = idx.get(fn)
            if rec and abs(rec.get('mtime', 0) - mt) < 1:
                continue
            changed = True
            try:
                with open(p, 'r', encoding='utf-8', errors='ignore') as f:
                    text = f.read()
            except OSError:
                continue
            chunks = [{'text': c, 'vec': _hash_vec(_tokens(c))}
                      for c in _chunks(text)]
            idx[fn] = {'mtime': mt, 'chunks': chunks, 'dir': MEM_DIR}
    # 清理已删除文件（按各文件所属目录匹配）
    known = {}
    for MEM_DIR in MEM_DIRS:
        for fn in os.listdir(MEM_DIR):
            if fn.endswith('.md'):
                known[(os.path.normpath(MEM_DIR), fn)] = True
    for k in list(idx):
        rec = idx[k]
        key = (os.path.normpath(rec.get('dir') or MEM_DIRS[0]), k)
        if not known.get(key):
            del idx[k]
            changed = True
    if changed:
        try:
            with open(INDEX_PATH, 'w', encoding='utf-8') as f:
                json.dump(idx, f, ensure_ascii=False)
        except OSError:
            pass
    return idx


def search_memory(query, top_k=None):
    """混合检索记忆库。query 必填，top_k 默认 TOP_K。"""
    if not query or not str(query).strip():
        return {'_ok': False, 'error': 'query 不能为空'}
    top_k = int(top_k or TOP_K)
    idx = _build_index()
    qv = _hash_vec(_tokens(query))
    qtok = set(_tokens(query))
    scored = []
    for fn, rec in idx.items():
        chunks = rec.get('chunks') or []
        # 【D4 老化】按源文件 mtime 计算衰减因子（默认关闭=恒1）
        fdir = rec.get('dir') or MEM_DIRS[0]
        fpath = os.path.join(fdir, fn)
        decay = _aging_factor(fpath)
        # 文件内 IDF 简化：按块频
        df = {}
        for c in chunks:
            for t in set(_tokens(c['text'])):
                df[t] = df.get(t, 0) + 1
        N = max(len(chunks), 1)
        for ci, c in enumerate(chunks):
            sv = _cosine(qv, c['vec'])
            st = 0.0
            for t in qtok:
                if t in df:
                    st += math.log(N / df[t]) * 1.0
            st = min(st / 5.0, 1.0)  # 归一化粗调
            raw = W_VEC * sv + W_BM25 * st
            score = raw * decay
            # 【D4】衰减后不得因固定阈值把老记忆整条滤没：按衰减比例放宽门槛
            if score > 0.05 * max(decay, 0.25):
                scored.append({'file': fn, 'chunk': ci, 'score': round(score, 4),
                               'snippet': c['text'][:300],
                               **({'aged': round(decay, 3)} if decay < 0.999 else {})})
    scored.sort(key=lambda x: -x['score'])
    return {'_ok': True, 'total': len(scored), 'hits': scored[:top_k],
            'note': '全文请用 project_record read 按 file 名取'}


def run(args):
    return search_memory(str(args.get('query') or ''), args.get('top_k'))


if __name__ == '__main__':
    import sys
    q = ' '.join(sys.argv[1:]) or '沙箱'
    r = search_memory(q)
    print(json.dumps(r, ensure_ascii=False, indent=1)[:2000])
