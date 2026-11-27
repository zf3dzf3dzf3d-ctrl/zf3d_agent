# -*- coding: utf-8 -*-
"""广场免弹窗自动登录端点 POST /api/plaza/authticket。

设计：
- 仅对同源/本机 Origin 放行（复用入口统一 _check_origin）；
  服务本身只绑 127.0.0.1，因此等效"只有本机页面能取到 token"。
- 返回 token（论坛配置.json 第一个）+ 自动生成的唯一昵称（访客-xxxx）。
- 前端拿到后存 localStorage，之后打开 plaza.html 自动进入，无弹窗。
"""
import json
import secrets


def _is_local_origin(handler):
    """authticket 下发 token 的硬校验：必须带本机 Origin（蜂群安全审查【中1】整改）。

    _check_origin 对「无 Origin 头」放行（非浏览器客户端），
    但 token 下发面必须更窄：curl/脚本类无 Origin 请求一律拒绝。
    """
    origin = (handler.headers.get('Origin') or '').strip().lower()
    if not origin:
        return False
    # Host 必须是本机回环【2026-11-23 防 DNS 重绑定】：旧校验只比 Origin==Host，
    # 攻击页把自身域名重绑定到 127.0.0.1 后两者同为 evil.com:8580 可双双通过，
    # token 即被第三方页面偷走。服务只绑 127.0.0.1，合法访问 Host 必为回环主机名。
    host = (handler.headers.get('Host') or '').strip().lower()
    hostname = host.rsplit(':', 1)[0].strip('[]') if host else ''
    if hostname not in ('127.0.0.1', 'localhost', '::1'):
        return False
    # Origin 形如 http://127.0.0.1:8580，须与 Host 同主机同端口
    for scheme in ('http://', 'https://'):
        if origin.startswith(scheme):
            return origin[len(scheme):] == host
    return False


def _load_tokens():
    """与 plaza.ws_plaza._load_tokens 同源逻辑（避免 import 触发 WS 模块副作用）。"""
    import os
    cfg_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))), 'private', '论坛配置.json')
    fallback = r''
    for p in (cfg_path, fallback):
        try:
            cfg = json.load(open(p, 'r', encoding='utf-8-sig'))
            t = cfg.get('token')
            if isinstance(t, list) and t:
                return t
            if t:
                return [t]
        except Exception:
            continue
    return []


def handle_plaza_authticket(handler):
    """处理 POST /api/plaza/authticket。handler 为 DBHandler 实例。

    前置保证：do_POST 入口已完成 _drain_body / _check_origin。
    本端点额外强制：必须带本机 Origin（无 Origin 头的脚本请求不放行）。
    """
    if not _is_local_origin(handler):
        handler._send_json({'ok': False, 'error': 'Forbidden: local-origin required'})
        return
    toks = _load_tokens()
    if not toks:
        handler._send_json({'ok': False, 'error': '未配置论坛 token，请检查 private/论坛配置.json'})
        return
    # 请求方可带 name 指定昵称（前端记住上次昵称时用）；不带则自动生成
    want = ''
    try:
        body = handler._read_json() or {}
        want = str(body.get('name') or '').strip()[:32]
    except Exception:
        want = ''
    if not want:
        want = '访客-%04d' % secrets.randbelow(10000)
    handler._send_json({'ok': True, 'token': toks[0], 'name': want})
    return
