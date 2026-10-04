# -*- coding: utf-8 -*-
"""动作注册表：内置动作 + 外部插件动作统一注册。

动作签名：fn(engine, ctx, page, params) -> dict
  engine  BrowserEngine 实例（可访问 .cfg / .ensure_browser() / .active_page 等）
  ctx     Playwright 持久化上下文
  page    当前活动页
  params  调用参数 dict

外部扩展方式（任意模块，import 即注册）：
    from browser_engine import register_action

    @register_action('login_aliyun')
    def _login(engine, ctx, page, params):
        page.goto('https://www.aliyun.com')
        return {'ok': True}

高级：register_action 还支持 actions 包 / 插件目录自动加载（load_plugins）。
"""
import os
import traceback

_ACTIONS = {}          # name -> callable
_META = {}             # name -> {'module':..., 'doc':...}


def register_action(name, meta=None):
    """装饰器：注册一个浏览器动作。重名即覆盖（热更新友好）。"""
    def deco(fn):
        _ACTIONS[name] = fn
        _META[name] = {'module': getattr(fn, '__module__', ''),
                       'doc': (getattr(fn, '__doc__') or '').strip(),
                       **(meta or {})}
        return fn
    return deco


def unregister_action(name):
    _ACTIONS.pop(name, None)
    _META.pop(name, None)


def get_actions():
    """返回 {name: fn} 副本。"""
    return dict(_ACTIONS)


def list_actions():
    """返回动作元信息列表（给 /api/browser?action=actions 用）。"""
    return [{'name': n, **_META.get(n, {})} for n in sorted(_ACTIONS)]


def load_plugins(paths):
    """加载外部动作插件（.py 文件或目录）。import 时通过装饰器自动注册。

    插件查找顺序：传入路径优先，其次 browser_engine/plugins/ 目录。
    """
    if isinstance(paths, str):
        paths = [paths]
    default_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'plugins')
    for p in list(paths) + [default_dir]:
        if not p or not os.path.isdir(p):
            continue
        import sys, importlib, glob
        if p not in sys.path:
            sys.path.insert(0, p)
        for f in glob.glob(os.path.join(p, '*.py')):
            mod_name = os.path.splitext(os.path.basename(f))[0]
            if mod_name.startswith('_'):
                continue
            try:
                importlib.import_module(mod_name)
            except Exception:
                traceback.print_exc()


def dispatch(name, engine, ctx, page, params):
    """执行动作，未知动作返回错误 dict。"""
    fn = _ACTIONS.get(name)
    if fn is None:
        return {'ok': False, 'error': '未知 action: %s' % name}
    return fn(engine, ctx, page, params or {})
