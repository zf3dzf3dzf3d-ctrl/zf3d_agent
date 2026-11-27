# -*- coding: utf-8 -*-
"""蜂群 + 游戏存档 + 前端性能埋点 三域路由迁移（重构 Step3 第一刀）。

端点清单（与旧链 api_dispatch_post.py 行为逐字节等价，注册表先命中短路，
旧链分支暂保留作为回退，验稳后下轮删除）：
POST /api/swarm/submit   -> MixinDispatchPost._handle_swarm_post（蜂群派发）
POST /api/swarm/status   -> 同上
POST /api/swarm/collect  -> 同上
POST /api/swarm/list     -> 同上
POST /api/save           -> _handle_game_save_post（游戏存档 SQLite）
POST /api/perf-log       -> _handle_perf_log_post（前端 FPS 埋点 CSV）

热重载安全（架构师约束 2026-11-20）：handler 为绑定方法字符串解析，
ensure_loaded 时机在每次分发入口执行且 _loaded 幂等——热重载重建
DBHandler 后注册表仍指向域级包装函数（每次调用时经 getattr 取最新
绑定方法），不存在残留旧闭包问题。
"""
from routes.dispatcher import route_post
from routes._shared import *  # noqa: F401,F403


def _swarm(handler, path, parsed):
    """蜂群四端点统一入口：委派给 Mixin 同名 handler（逻辑未动，原样搬）。"""
    handler._handle_swarm_post()


def _game_save(handler, path, parsed):
    handler._handle_game_save_post()


def _perf_log(handler, path, parsed):
    handler._handle_perf_log_post()


route_post(('/api/swarm/submit', '/api/swarm/status',
            '/api/swarm/collect', '/api/swarm/list'))(_swarm)
route_post('/api/save')(_game_save)
route_post('/api/perf-log')(_perf_log)
