# -*- coding: utf-8 -*-
"""browser_plugin —— 独立可插拔浏览器内核包。

外部使用方式（引擎/任何项目均可）：

    import sys; sys.path.insert(0, r'<路径>/server')
    from browser_plugin import engine

    # 执行内置动作
    engine.dispatch_or('goto', {'url': 'https://zf3d.com'})

    # 注册自定义动作（扩展点）
    @engine.register('my_zf3d_login')
    def my_login(eng, params):
        s = engine.get_session(params.get('session') or 'default')
        def _do(s):
            ctx, page = s._ensure()
            page = s._pick_page(None)
            page.goto('https://www.zf3d.com/login.asp')
            ...
            return {'ok': True}
        return s.run(_do)

会话隔离：每个 session 一个 profile 目录，登录态互不干扰。
动作注册表：engine.list_actions() 查看全部，unregister() 可移除。
"""
from . import engine
from .engine import (register, unregister, list_actions, get_session,
                     close_session, list_sessions, BrowserSession)
