# -*- coding: utf-8 -*-
"""browser_engine —— 独立可插拔的内置浏览器引擎。

与 HTTP 层完全解耦，任何引擎（server.py / 别的项目 / 直接 python 调用）都能用：

    from browser_engine import BrowserEngine, register_action

    eng = BrowserEngine()          # 或 BrowserEngine(profile='xxx', headless=False)
    print(eng.do('goto', url='example.com'))
    print(eng.do('screenshot'))
    eng.do('close')

扩展动作：

    from browser_engine import register_action

    @register_action('my_action')
    def _my(ctx, page, params):
        return {'ok': True, 'custom': True}

包结构：
    engine.py     BrowserEngine 核心（生命周期 / 工作线程 / 多标签）
    registry.py   动作注册表（装饰器注册，自动合并内置 + 外部动作）
    actions.py    内置动作集（goto/click/fill/screenshot/tabs/...）
    config.py     配置（JSON 持久化 + 默认值）
"""
from .engine import BrowserEngine
from .registry import register_action, get_actions
from .config import BrowserConfig, DEFAULT_CONFIG

__all__ = ['BrowserEngine', 'register_action', 'get_actions',
           'BrowserConfig', 'DEFAULT_CONFIG']
