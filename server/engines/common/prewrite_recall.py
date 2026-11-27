# -*- coding: utf-8 -*-
"""
prewrite_recall.py - 模块D 写前记忆推送（M1 影子模式）
=====================================================
策划案 v1.2：并行协作与记忆推送增强，模块D（推荐度 88/A）。

影子模式（v1.2 裁决 A3 条款）：
- 写类工具调用前，按目标文件名/关键词检索 project_record 记忆库
- 只记录命中结果到影子日志，【不注入工具结果、不拦截、不改变任何执行流】
- 采集 3 天后按销案判据复盘：影子期内有效样本 >=3 条且命中率 >=30% 才决定是否
  升级为注入模式（M1.5）；样本不足则续期，不硬推进

设计红线（蜂群收口共识）：
- 任何异常一律吞掉，绝不影响主链路（与 tool_audit_hook 同款纪律）
- 免疫卡/记忆检索收敛为单通道：本模块是唯一检索入口，返回体含 recall:N-hit 显式标注
- 延迟预算：单次检索目标 <50ms（v1.2 裁决：先实测基准再定指标），超预算只记 prewrite_slow
"""
import os
import json
import time
import threading

_LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
_LOCK = threading.Lock()

# 写类工具名集合（引擎链 + HTTP 链通用；小写精确匹配）
WRITE_TOOLS = {
    'write_file', 'replace_text', 'append', 'move_file', 'delete',
    'write', 'edit', 'create_file', 'save_file', 'multiedit',
}

# 影子开关：环境变量实时读取，设 ZF_PREWRITE_SHADOW=0 一键全关（降级纪律）
_ENV_KEY = 'ZF_PREWRITE_SHADOW'

# 提取可检索关键词：path/path/file_path/target 等常见参数名
_PATH_KEYS = ('path', 'file_path', 'filepath', 'target', 'file', 'src', 'dst')


def _extract_keywords(args):
    """从工具参数提取文件名/目录名关键词，最多 3 个。"""
    kws = []
    try:
        for k in _PATH_KEYS:
            v = args.get(k)
            if isinstance(v, str) and v.strip():
                base = os.path.basename(v.strip())
                stem = os.path.splitext(base)[0]
                if stem and len(stem) >= 3:
                    kws.append(stem)
    except Exception:
        pass
    return kws[:3]


def _search_memory(keywords):
    """检索 private/记忆/ 目录：文件名含关键词即命中。带 60s 缓存索引（防刷盘）。
    返回 (hits:list[记录名], cost_ms)。任何异常返回 ([], 0)。"""
    t0 = time.time()
    hits = []
    try:
        global _IDX_CACHE, _IDX_TS
        mem_dir = os.path.join(os.path.dirname(os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
            'private', '记忆')
        if not os.path.isdir(mem_dir):
            return [], (time.time() - t0) * 1000
        now = time.time()
        if _IDX_CACHE is None or now - _IDX_TS > 60:
            names = []
            for dirpath, dirnames, filenames in os.walk(mem_dir):
                dirnames[:] = [d for d in dirnames if d not in
                               ('__pycache__', 'browser_profile')]
                for fn in filenames:
                    if fn.endswith('.md') and '.bak' not in fn:
                        names.append(fn.lower())
            _IDX_CACHE = names
            _IDX_TS = now
        low_kws = [k.lower() for k in keywords]
        hits = [n for n in _IDX_CACHE if any(k in n for k in low_kws)][:10]
    except Exception:
        pass
    return hits, (time.time() - t0) * 1000


_IDX_CACHE = None
_IDX_TS = 0.0


def _log(rec):
    """影子日志落盘 logs/prewrite_shadow-YYYYMM.jsonl，append-only，失败静默。"""
    try:
        os.makedirs(_LOG_DIR, exist_ok=True)
        fname = os.path.join(_LOG_DIR, 'prewrite_shadow-%s.jsonl' % time.strftime('%Y%m'))
        with _LOCK:
            with open(fname, 'a', encoding='utf-8') as f:
                f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    except Exception:
        pass


def pre_write_check(source, tool_name, args):
    """写前记忆影子探针。任何情况都不抛错、不拦截。
    返回 str：'recall:N-hit'（供调用方标注，影子模式下仅记录）或 ''。"""
    try:
        if os.environ.get(_ENV_KEY, '1') != '1':
            return ''
        name = str(tool_name or '').strip().lower()
        if name not in WRITE_TOOLS:
            return ''
        kws = _extract_keywords(args if isinstance(args, dict) else {})
        if not kws:
            return ''
        hits, cost_ms = _search_memory(kws)
        _log({
            'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
            'source': str(source or '?'),
            'tool': name,
            'keywords': kws,
            'hits': hits,
            'hit_count': len(hits),
            'cost_ms': round(cost_ms, 1),
            'mode': 'shadow',
        })
        if cost_ms > 50:
            _log({'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
                  'kind': 'prewrite_slow', 'cost_ms': round(cost_ms, 1), 'tool': name})
        return 'recall:%d-hit' % len(hits) if hits else ''
    except Exception:
        return ''


def shadow_stats(days=3):
    """复盘用：统计近 N 天影子日志的有效样本与命中率（销案判据数据源）。"""
    try:
        total = hit = 0
        fname = os.path.join(_LOG_DIR, 'prewrite_shadow-%s.jsonl' % time.strftime('%Y%m'))
        if os.path.isfile(fname):
            with open(fname, 'r', encoding='utf-8') as f:
                for line in f:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if r.get('kind') == 'prewrite_slow' or r.get('mode') != 'shadow':
                        continue
                    total += 1
                    if r.get('hit_count', 0) > 0:
                        hit += 1
        return {'total': total, 'hit': hit,
                'hit_rate': round(hit / total, 3) if total else 0.0}
    except Exception:
        return {'total': 0, 'hit': 0, 'hit_rate': 0.0}
