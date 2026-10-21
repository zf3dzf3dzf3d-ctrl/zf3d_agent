# -*- coding: utf-8 -*-
"""P3 CEL 规则引擎：用于路由/过滤/成本守门等可热配置规则。

- 规则文件 private/rules.cel.json，热加载（mtime 变化即重编译）。
- 表达式编译缓存（按表达式文本），编译失败立即记录并跳过该规则。
- 求值失败不抛异常，返回 fallback 默认策略（evaluate 返回 None / first_match 返回 None）。

规则文件格式：
{
  "rules": [
    {"name": "route_big_ctx", "expr": "request.tokens > 60000",
     "action": {"protocol": "responses", "ctx_mode": "full"}, "stop": false}
  ],
  "fallback": {"protocol": "auto", "ctx_mode": "truncate"}
}
"""
import json
import os
import threading
import time

try:
    import celpy
    _HAS_CEL = True
except Exception:
    celpy = None
    _HAS_CEL = False

_RULES_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
    os.path.dirname(os.path.abspath(__file__))))), 'private', 'rules.cel.json')

_lock = threading.Lock()
_cache = {'mtime': None, 'rules': [], 'fallback': {}, 'err': None}
_expr_cache = {}   # expr text -> compiled program（编译缓存）


def _compile(expr):
    """编译 CEL 表达式（带缓存）。失败返回 None。"""
    if not _HAS_CEL:
        return None
    prog = _expr_cache.get(expr)
    if prog is not None:
        return prog
    try:
        env = celpy.Environment()
        ast = env.compile(expr)
        prog = env.program(ast)
    except Exception:
        prog = False   # False 表示编译失败（区别于未缓存 None）
    _expr_cache[expr] = prog
    return prog


def _load_rules():
    """热加载规则文件，mtime 变化才重新解析。"""
    st = _RULES_PATH
    try:
        mtime = os.path.getmtime(st)
    except OSError:
        return _cache
    if _cache['mtime'] == mtime:
        return _cache
    with _lock:
        if _cache['mtime'] == mtime:
            return _cache
        try:
            with open(st, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            rules = [r for r in (data.get('rules') or []) if isinstance(r, dict)]
            _cache['rules'] = rules
            _cache['fallback'] = dict(data.get('fallback') or {})
            _cache['err'] = None
        except Exception as e:
            _cache['err'] = str(e)
        _cache['mtime'] = mtime
    return _cache


def evaluate(expr, facts):
    """求值单个 CEL 表达式。任何失败返回 None（不抛 500）。"""
    prog = _compile(expr)
    if not prog:
        return None
    try:
        if _HAS_CEL:
            cel_facts = celpy.celpy.json_to_cel(json.loads(json.dumps(facts, default=str)))
            r = prog.evaluate(cel_facts)
            return bool(r)
        return None
    except Exception:
        return None


def first_match(facts):
    """按序匹配规则，返回第一条命中规则的 action dict；无命中/失败返回 None。"""
    c = _load_rules()
    for r in c['rules']:
        if evaluate(r.get('expr') or 'false', facts):
            action = dict(r.get('action') or {})
            action['_rule'] = r.get('name') or 'unnamed'
            return action
    return None


def resolve_policy(facts):
    """规则匹配 -> 命中返回 action，否则返回 fallback 默认策略（可能为空 dict）。

    gateway.call_upstream(ctx, payload, policy=resolve_policy(facts)) 即完成接入。
    """
    hit = first_match(facts)
    if hit is not None:
        return hit
    return dict(_load_rules()['fallback'])


def status():
    """调试接口：规则数/引擎可用性/加载错误。"""
    c = _load_rules()
    return {'cel': _HAS_CEL, 'rules': len(c['rules']),
            'fallback': c['fallback'], 'error': c['err'],
            'path': _RULES_PATH}
