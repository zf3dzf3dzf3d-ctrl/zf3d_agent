# -*- coding: utf-8 -*-
"""i游戏域路由（S1 路由注册表化第一步：games 五端点迁移进 dispatcher 注册表）。

来源：api_dispatch_get.py L1103-1105 与 api_dispatch_post.py 的 games 手写分发，
业务逻辑全在 mixin_games.py（MixinGames._handle_games_get / _handle_games_post），
本域文件只做注册表接线，零业务逻辑复制。

新端点示例：加一行 @route_get('/api/games/xxx') 指到对应 handler 即可，
不再手改两个 dispatch 巨文件（404 漏接根源消除）。
"""
from routes.dispatcher import route_get, route_post

_GAMES_GET_PATHS = ('/api/games/featured', '/api/games/search',
                    '/api/games/detail', '/api/games/list')


@route_get(_GAMES_GET_PATHS)
def _games_get(handler, path, parsed):
    handler._handle_games_get()


@route_post('/api/games/list')
def _games_post(handler, path, parsed):
    handler._handle_games_post(handler._read_json())
