# -*- coding: utf-8 -*-
"""engine.relay-auth — AI 引擎中转鉴权插件（S6）。

提供 inject_relay_headers(headers, target_url)：
zf_models_relay 线路补 X-ZF-Key(heartbeat key)+X-ZF-User(会员ID)，与
dual_protocol.py L399-418 原逻辑一致；调用方经内核插件优先、异常回退内联。

【20261123 修复FH#3】两条注册路径：
- relay_auth_headers（provides 契约名，dual_protocol 经内核 tools 注册表消费，
  读返回值完整 headers）→ 内部轨，保留完整头，标 _internal；
- relay_auth_status → 工具面，脱敏只回 {'injected', 'headers_keys'}，无密钥原文。
"""
import os
import sys

_SERVER = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'server'))
if _SERVER not in sys.path:
    sys.path.insert(0, _SERVER)


def inject_relay_headers(headers, target_url):
    """target_url 为朱峰官方中转域名时注入鉴权头；返回是否注入。headers 原地修改。
    【P0-2 修复 2026-11-23】旧子串判定可被 https://evil.com/?x=zf_models_relay 骗凭据
    （dual_protocol 的 ctx.target_url 是客户端可控的 _target_url），改
    security.is_zf_relay_url 固定域名精确匹配（模块顶部已把 server/ 插入 sys.path）。"""
    import security as _sec
    if not _sec.is_zf_relay_url(target_url):
        return False
    from zf3d_commands import _get_api_key as _zf_gk
    _zf_key = _zf_gk() or ''
    if _zf_key:
        headers['X-ZF-Key'] = _zf_key
        try:
            from zf3d_heartbeat import _get_login_status as _zf_gls
            _ls, _lu, _zf_uid = _zf_gls()
            if _zf_uid and int(_zf_uid) > 0:
                headers['X-ZF-User'] = str(_zf_uid)
        except Exception:
            pass
    return True


def setup(ctx):
    def _tool_masked(params):
        # 【20261123 修复FH#3】工具面脱敏：只回传是否注入 + 头字段名列表，
        # 绝不回传 X-ZF-Key 原文（注入发生在拷贝的 dict 上，injected 判定真实）。
        h = dict(params.get('headers') or {})
        injected = inject_relay_headers(h, params.get('target_url'))
        return {'ok': True, 'injected': injected, 'headers_keys': sorted(h.keys())}

    def _tool_internal(params):
        # 内部 provides 通道（完整 headers，仅引擎进程自身消费）：
        # dual_protocol.py L410-413 经内核 tools 注册表按名字
        # 'relay_auth_headers' 取 exec，读返回值 _ar['headers'] 完整头注入请求。
        # 该消费路径与 AI 工具面同源，故拆为两个注册项区分两条路径——
        # 契约名 'relay_auth_headers' 保留完整返回，勿改名勿脱敏。
        h = dict(params.get('headers') or {})
        injected = inject_relay_headers(h, params.get('target_url'))
        return {'ok': True, 'injected': injected, 'headers': h}

    ctx.tool.register({
        'name': 'relay_auth_headers',  # provides 契约名，dual_protocol 硬编码消费
        'description': '（内部轨）zf_models_relay 线路鉴权头注入，返回完整 headers，勿直调',
        'params': {'headers': 'object', 'target_url': 'str'},
        'exec': _tool_internal,
        '_internal': True,  # 纵深防御标记：未来通用工具分发面应过滤 _internal 工具
    })
    ctx.tool.register({
        'name': 'relay_auth_status',
        'description': 'zf_models_relay 线路鉴权头注入检查（脱敏：不回传 X-ZF-Key 原文）',
        'params': {'headers': 'object', 'target_url': 'str'},
        'exec': _tool_masked,
    })
