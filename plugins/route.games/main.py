# -*- coding: utf-8 -*-
"""route.games：i游戏域路由实现体插件（策划案v4 T2.4 首个迁移试点）。

实现体自 server/routes/mixin_games.py 逐行等价搬运（self→handler，签名换装），
经 ctx.route 注册覆盖 domain_games 的静态接线；禁用时内核 teardown 走注册栈
restore，自动恢复 domain_games 原注册——"禁用=回到迁移前"，零 404 窗口。
共享服务面（_steam_*/_cheapshark_*/_cache_get/_mylist_*）暂经 handler 调用
（App 实例即服务总线），随 T5 存储收口下沉为 ctx 服务。
互斥锁真源 _games_lock 迁移期自 mixin_games 模块引用（.gateignore 已登记）。
"""
import threading
import urllib.parse

_GAMES_GET_PATHS = ('/api/games/featured', '/api/games/search',
                    '/api/games/detail', '/api/games/list')
# 注意：/api/games/free 分支在 mixin 中存在但 domain_games 从未注册（历史死分支），
# 等价搬运原则下本插件同样不注册；其激活与否属业务决策，不随迁移顺带。


def _games_get(handler):
    """搬运自 mixin_games._handle_games_get（self→handler）。"""
    from routes import mixin_games as _mg
    parsed = urllib.parse.urlparse(handler.path)
    qs = urllib.parse.parse_qs(parsed.query)
    path = parsed.path
    try:
        if path == '/api/games/featured':
            # 两个上游并行拉取，任一失败降级为空列表（提速 + 防一个超时拖死整页）
            box = {}
            def _pull(k, fn):
                try:
                    box[k] = fn()
                except Exception:
                    box[k] = []
            th1 = threading.Thread(target=_pull, args=('featured', handler._steam_featured))
            th2 = threading.Thread(target=_pull, args=('deals', handler._cheapshark_deals))
            th1.start(); th2.start()
            th1.join(25); th2.join(25)
            return handler._send_json({'ok': True,
                                       'featured': box.get('featured') or [],
                                       'deals': box.get('deals') or []})
        if path == '/api/games/search':
            kw = (qs.get('kw') or [''])[0].strip()
            if not kw:
                return handler._send_json({'ok': False, 'err': 'kw required'}, 400)
            return handler._send_json({'ok': True, 'items': handler._steam_search(kw)})
        if path == '/api/games/detail':
            appid = (qs.get('appid') or [''])[0].strip()
            if not appid.isdigit():
                return handler._send_json({'ok': False, 'err': 'appid required'}, 400)
            d = handler._steam_detail(appid)
            if d is None:
                return handler._send_json({'ok': False, 'err': 'not found'}, 404)
            return handler._send_json({'ok': True, 'game': d})
        if path == '/api/games/free':
            return handler._send_json({'ok': True, **handler._games_free()})
        if path == '/api/games/list':
            with _mg._games_lock:
                lst = handler._mylist_load()
            return handler._send_json({'ok': True, 'list': lst})
        return handler._send_json({'ok': False, 'err': 'unknown path'}, 404)
    except Exception as e:
        # 上游超时兜底：把所有可用的过期缓存吐给前端，宁旧勿错
        fallback = {}
        for name, key, ttl in (('featured', 'featured', 1800), ('deals', 'deals', 1800),
                               ('steam_free', 'free_steam', 3600), ('epic_free', 'free_epic', 1800)):
            c = handler._cache_get(key, ttl, stale=True)
            if c is not None:
                fallback[name] = True
        if fallback:
            return handler._send_json({'ok': True, 'degraded': True,
                                       'err': '上游超时，已用缓存数据（%s）' % ','.join(fallback),
                                       **handler._stale_bundle(fallback)})
        return handler._send_json({'ok': False, 'err': 'upstream failed: %s' % e}, 502)


def _games_post(handler):
    """搬运自 mixin_games._handle_games_post（self→handler，body 自读）。"""
    from routes import mixin_games as _mg
    import time
    try:
        body = handler._read_json()
    except Exception:
        body = None
    if not isinstance(body, dict):
        return handler._send_json({'ok': False, 'err': 'bad body'}, 400)
    action = str(body.get('action') or '')
    appid = str(body.get('appid') or '').strip()
    status = str(body.get('status') or '').strip()
    if status not in ('', 'want', 'playing', 'played'):
        return handler._send_json({'ok': False, 'err': 'bad status'}, 400)
    now = int(time.time() * 1000)
    with _mg._games_lock:
        lst = handler._mylist_load()
        if action == 'remove':
            lst = [g for g in lst if g.get('appid') != appid]
        elif action == 'status' and status:
            hit = None
            for g in lst:
                if g.get('appid') == appid:
                    hit = g
                    break
            if hit:
                hit['status'] = status
                hit['updatedAt'] = now
            else:
                lst.append({'appid': appid, 'name': str(body.get('name') or '未命名'),
                            'status': status, 'createdAt': now, 'updatedAt': now})
        else:
            return handler._send_json({'ok': False, 'err': 'bad action'}, 400)
        try:
            handler._mylist_save(lst)
        except Exception as e:
            return handler._send_json({'ok': False, 'err': 'save failed: %s' % e}, 500)
    return handler._send_json({'ok': True, 'count': len(lst)})


def setup(ctx):
    ctx.route.get(_GAMES_GET_PATHS)(lambda h, p, q: _games_get(h))
    ctx.route.post('/api/games/list')(lambda h, p, q: _games_post(h))
    ctx.log.info("route.games: 5 GET + 1 POST registered（覆盖 domain_games 静态接线，禁用回栈恢复）")


def teardown(ctx):
    ctx.log.info("route.games teardown（注册栈恢复 domain_games 原接线）")
