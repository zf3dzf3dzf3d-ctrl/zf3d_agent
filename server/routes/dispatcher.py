# -*- coding: utf-8 -*-
"""路由注册表（自 api_dispatch_post.do_POST / api_dispatch_get.do_GET 巨型
if-elif 分发链逐步迁移的中枢，重构 Step1 骨架）。

用法：
    在 MixinDispatchPost.do_POST / MixinDispatchGet.do_GET 的
    安全三件套（_drain_body / _check_origin / token）之后、巨型 if-elif 链之前：
        if dispatch_post(self, path):
            return
    GET 同理：if dispatch_get(self, path, parsed): return

    各业务域在对应 mixin 文件中用装饰器注册：
        from routes.dispatcher import route_post
        @route_post('/api/xxx')
        def _h(self): ...

注意：
- 注册表命中即消费请求并返回 True；未命中返回 False，回落到原有 if-elif 链。
- 已迁移端点与旧链重复注册是安全的：旧链在注册表之后才执行，先命中先短路。
- handler 签名统一为 fn(handler, path, parsed)；内部自行读 body / 发响应。
"""
import threading

_REGISTRY_LOCK = threading.Lock()
_POST_ROUTES = {}   # path 精确匹配 -> fn(handler, path, parsed)
_GET_ROUTES = {}    # path 精确匹配 -> fn(handler, path, parsed)
_POST_PREFIX = []   # [(prefix, fn)]  startswith 匹配，按注册顺序
_GET_PREFIX = []
_POST_PREV = {}     # T2.4 注册栈：key 被插件覆盖时存原注册者，unregister(restore=True) 回栈恢复
_GET_PREV = {}


def route_post(path):
    """注册 POST 精确路由。path 可为 str 或 tuple/list（多路径同函数）。"""
    def deco(fn):
        with _REGISTRY_LOCK:
            for p in (path if isinstance(path, (tuple, list)) else [path]):
                if p in _POST_ROUTES:
                    _POST_PREV.setdefault(p, _POST_ROUTES[p])  # T2.4 注册栈
                _POST_ROUTES[p] = fn
        return fn
    return deco


def route_get(path):
    """注册 GET 精确路由。path 可为 str 或 tuple/list。"""
    def deco(fn):
        with _REGISTRY_LOCK:
            for p in (path if isinstance(path, (tuple, list)) else [path]):
                if p in _GET_ROUTES:
                    _GET_PREV.setdefault(p, _GET_ROUTES[p])  # T2.4 注册栈
                _GET_ROUTES[p] = fn
        return fn
    return deco


def route_post_prefix(prefix):
    """注册 POST 前缀路由（用于 /api/vault/* 之类 startswith 端点）。"""
    def deco(fn):
        with _REGISTRY_LOCK:
            _POST_PREFIX.append((prefix, fn))
        return fn
    return deco


def route_get_prefix(prefix):
    def deco(fn):
        with _REGISTRY_LOCK:
            _GET_PREFIX.append((prefix, fn))
        return fn
    return deco


def unregister(path, restore=False):
    """S8：插件 disable 时注销其注册的精确路由（post+get 双侧）。
    T7 增补：前缀路由精确等值注销（kernel_ctx._reg_prefix 登记 (kind, prefix)）。
    T2.4 增补：restore=True 时回注册栈——插件曾覆盖静态接线（domain_*）的 key，
    插件禁用后恢复原注册者而非留 404（route.games 试点语义：禁用=回到迁移前）。"""
    global _POST_PREFIX, _GET_PREFIX
    with _REGISTRY_LOCK:
        cur = _POST_ROUTES.pop(path, None)
        if restore:
            prev = _POST_PREV.pop(path, None)
            if prev is not None and cur is not None:
                _POST_ROUTES[path] = prev
        cur = _GET_ROUTES.pop(path, None)
        if restore:
            prev = _GET_PREV.pop(path, None)
            if prev is not None and cur is not None:
                _GET_ROUTES[path] = prev
        _POST_PREFIX = [(p2, f2) for (p2, f2) in _POST_PREFIX if p2 != path]
        _GET_PREFIX = [(p2, f2) for (p2, f2) in _GET_PREFIX if p2 != path]


def dispatch_post(handler, path, parsed):
    """POST 分发入口：命中注册表返回 True（请求已被消费），否则 False。"""
    fn = _POST_ROUTES.get(path)
    if fn is None:
        for prefix, pfn in _POST_PREFIX:
            if path.startswith(prefix):
                fn = pfn
                break
    if fn is None:
        return False
    fn(handler, path, parsed)
    return True


def dispatch_get(handler, path, parsed):
    """GET 分发入口：语义同 dispatch_post。"""
    fn = _GET_ROUTES.get(path)
    if fn is None:
        for prefix, pfn in _GET_PREFIX:
            if path.startswith(prefix):
                fn = pfn
                break
    if fn is None:
        return False
    fn(handler, path, parsed)
    return True


# 导入各业务域路由模块（注册副作用）。逐域迁移后在此追加 import。
def _load_domains():
    from routes import domain_policy  # noqa: F401  (M1.4 能力策略：模式/审批/待批请求)
    from routes import domain_growth_fengkong  # noqa: F401  (growth + fengkong 两域)
    from routes import domain_batch_ask  # noqa: F401  (batch-ask 批量提问，DSH P1-③)
    from routes import domain_music  # noqa: F401  (i音乐：搜索/歌词/B站转MP3播放/本地)
    from routes import domain_games  # noqa: F401  (i游戏：featured/search/detail/list+mylist)
    from routes import domain_chess  # noqa: F401  (i棋：三棋 move/score)
    from routes import domain_contest  # noqa: F401  (i大赛：场次/一键开始/计时/题库)
    from routes import domain_evolve   # noqa: F401  (i进化·肉鸽三抽：draw/keep/skills/skill_op/summary)
    from routes import domain_lab    # noqa: F401  (i进化实验室：status/curve/journal，20261123 自 if-elif 链迁出样板)
    from routes import domain_verify  # noqa: F401  (审核师箭头配对，20261123 迁出)
    from routes import domain_igen  # noqa: F401  (i模型生成：ComfyUI 桥接 M1-v4)
    from routes import domain_town   # noqa: F401  (i小镇：events/memories 只读 + E3 记忆治理)
    from routes import domain_dispatch_core  # noqa: F401  (重构Step3第一刀：swarm/save/perf-log 三域)
    from routes import domain_script   # noqa: F401  (i剧本杀：list/start/secret/vote 单机局 MVP)
    from routes import domain_legacy_post  # noqa: F401  (机械拆分：post 巨链 return 型精确分支)
    from routes import domain_legacy_get   # noqa: F401  (机械拆分：get 巨链 return 型精确分支)
    from routes import domain_write_ops_post  # noqa: F401  (2026-11-23 GET写操作迁POST：models-refresh/workspace+backup open-folder/tv-refresh/escape-new)
    from routes import domain_key_reveal  # noqa: F401  (2026-11-24 明文显钥二次验证：POST /api/models/reveal-key[/setup])


_loaded = False
_load_lock = threading.Lock()


def ensure_loaded():
    """幂等加载全部业务域路由模块（首次分发时触发）。"""
    global _loaded
    if _loaded:
        return
    with _load_lock:
        if _loaded:
            return
        _load_domains()
        _loaded = True
