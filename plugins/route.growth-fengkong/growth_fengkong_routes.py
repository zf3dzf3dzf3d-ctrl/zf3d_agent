# -*- coding: utf-8 -*-
"""growth（智能体养成）+ fengkong（峰控文件桥/家庭设备网关）两域路由。

端点自 api_dispatch_post.do_POST（L438-463）/ api_dispatch_get.do_GET
（L90-131）原样迁出（重构 Step1），旧链保留未删（先命中注册表即短路，旧链
分支成为死代码，后续清理轮再删）。
"""
import json as _json
from routes.dispatcher import route_post, route_get

# 插件路径适配（T2 尾巴）：自持导入重指 __file__ 到源路径，dirname 链语义与源一致
import os as _pf_os  # noqa: E402
__file__ = _pf_os.path.join(_pf_os.path.dirname(_pf_os.path.abspath(__file__)),
                            '..', '..', 'server', 'routes', 'domain_growth_fengkong.py')


# ===== POST: 智能体养成：签到（P3） =====
@route_post('/api/growth/checkin')
def _post_growth_checkin(handler, path, parsed):
    handler._handle_growth_checkin()


# ===== POST: 峰控文件桥：电脑→手机推送 =====
@route_post('/api/fengkong/send')
def _post_fk_send(handler, path, parsed):
    try:
        body = _json.loads(handler._cached_body(
            int(handler.headers.get('Content-Length') or 0)) or b'{}')
    except Exception:
        body = {}
    handler._handle_fk_send(body)


# ===== POST: 峰控文件桥：手机反向上传 =====
@route_post('/api/fengkong/upload')
def _post_fk_upload(handler, path, parsed):
    try:
        clen = int(handler.headers.get('Content-Length') or 0)
    except ValueError:
        clen = 0
    if clen <= 0 or clen > 200 * 1024 * 1024:
        handler._send_json({'ok': False, 'error': 'bad size'}, 400)
        return
    handler._handle_fk_upload(handler._cached_body(clen))


# ===== GET: 峰控文件桥（文件/变更/下载/缩略图） =====
@route_get('/api/fengkong/files')
def _get_fk_files(handler, path, parsed):
    handler._handle_fk_files(parsed)


@route_get('/api/fengkong/changes')
def _get_fk_changes(handler, path, parsed):
    handler._handle_fk_changes(parsed)


@route_get('/api/fengkong/download')
def _get_fk_download(handler, path, parsed):
    handler._handle_fk_download(parsed)


@route_get('/api/fengkong/thumb')
def _get_fk_thumb(handler, path, parsed):
    handler._handle_fk_thumb(parsed)


# ===== 家庭设备网关 device_hub v1（峰控电视/家电控制） =====
# 【2026-11-23 安全整改】control/scene 为写操作，迁 POST（参数 JSON body 优先、
# query 兼容）：GET 形态可被浏览器预取/<img>跨站触发（无 Origin 头直穿
# _check_origin），docs/安全性调查报告-分发安全审计-20261122.md 点名的攻击路径。
# list 为只读保留 GET。
#
# 【2026-11-23 修复】device_hub.py 位于 server/tools/，按包名 `tools.device_hub`
# 导入会被根目录同名 `tools/` 常规包遮蔽（那是智能体工具执行注册表，
# handler_base.get_handler 在用，"No module named 'tools.device_hub'" 即此因，
# 2026-11-08 入库起 /api/device/* 线上一直打不通）。server/tools 无 __init__.py、
# 属命名空间包，即使 sys.path 前置也输给常规包，故按显式文件路径加载并缓存。
_DEVICE_HUB_MOD = None


def _device_hub():
    global _DEVICE_HUB_MOD
    if _DEVICE_HUB_MOD is None:
        import importlib.util
        import os
        _srv = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # server/
        _path = os.path.join(_srv, 'tools', 'device_hub.py')
        _spec = importlib.util.spec_from_file_location('zf_device_hub', _path)
        _mod = importlib.util.module_from_spec(_spec)
        import sys as _sys
        _sys.modules['zf_device_hub'] = _mod
        _spec.loader.exec_module(_mod)
        _DEVICE_HUB_MOD = _mod
    return _DEVICE_HUB_MOD


@route_get('/api/device/list')
def _get_device_hub_list(handler, path, parsed):
    try:
        handler._send_json(_device_hub().list_devices())
    except Exception as e:
        handler._send_json({'ok': False, 'err': str(e)}, 500)


@route_post(('/api/device/control', '/api/device/scene'))
def _post_device_hub(handler, path, parsed):
    from urllib.parse import parse_qs
    try:
        body = handler._read_body() or {}
    except Exception:
        body = {}
    qs = parse_qs(parsed.query)

    def g1(k, d=''):
        if isinstance(body, dict) and body.get(k) is not None:
            return str(body.get(k))
        return (qs.get(k) or [d])[0]

    try:
        _dh = _device_hub()
        if path == '/api/device/control':
            handler._send_json(_dh.control(g1('device'), g1('action'),
                                           g1('value') or None,
                                           g1('confirm') or None))
        else:
            handler._send_json(_dh.run_scene(g1('scene'), g1('confirm') or None))
    except Exception as e:
        handler._send_json({'ok': False, 'err': str(e)}, 500)


# ===== GET: 智能体养成系统（成长可视化） =====
@route_get(('/api/growth/full', '/api/growth/summary'))
def _get_growth_view(handler, path, parsed):
    try:
        import growth_engine
        if path == '/api/growth/full':
            handler._send_json(growth_engine.growth_full())
        else:
            handler._send_json(growth_engine.summary())
    except Exception as e:
        handler._send_json({'ok': False, 'err': str(e)}, 500)
