# -*- coding: utf-8 -*-
"""能力策略与审批路由（M1.4，2026-11-24）。

GET  /api/policy/status          模式 + 引擎状态 + 在途请求数
POST /api/policy/mode            {mode, ttl_sec?}  切换权限模式（full/readonly 需本机桌面确认）
GET  /api/policy/pending         在途待批请求清单（不含参数原文）
POST /api/policy/approve         {request_id}      批准 → 换发票据（需本机桌面确认）
POST /api/policy/reject          {request_id}      拒绝 → 请求作废（需本机桌面确认）

安全设计：approve/reject/mode(full) 都会弹出**本机原生确认窗口**（util_desktop_confirm）——
本机回环请求免 token 是产品边界，恶意网页发的跨站请求无法完成这种确认；智能体自己调用
这些端点同样会弹窗，不点确认就不生效（防自我提权）。确认有 10 秒冷却防弹窗轰炸。
"""
import time

from routes.dispatcher import route_get, route_post
from util_log import get_logger

log = get_logger('policy_route')

_confirm_last = {'ts': 0.0, 'action': ''}


def _confirm(action, text):
    """本机桌面确认（10 秒冷却防弹窗轰炸）。返回 True=人在电脑前点了确认。"""
    now = time.time()
    if now - _confirm_last['ts'] < 60 and _confirm_last['action'] == action:
        return False, '确认框冷却中（60 秒内重复请求）'
    try:
        from util_desktop_confirm import ask
    except ImportError:
        return False, '确认框模块不可用，fail-closed 拒绝'
    _confirm_last['ts'] = now
    _confirm_last['action'] = action
    return ask('朱峰智能体无限 · 权限确认', text), ''


@route_get('/api/policy/status')
def _h_policy_status(self, path, parsed):
    try:
        from util_policy import get_default_engine, get_mode
        import util_ticket as ut
        st = get_default_engine().status()
        mode = get_mode()
        pend = ut.pending_requests()
        self._send_json({'ok': True, 'mode': mode, 'engine': st,
                         'pending_count': len(pend.get('pending') or [])})
    except ImportError as e:
        self._send_json({'ok': False, 'error': '策略模块缺失: %s' % e}, 500)


@route_post('/api/policy/mode')
def _h_policy_mode(self, path, parsed):
    try:
        body = self._read_body() or {}
    except (ValueError, UnicodeDecodeError):
        body = {}
    mode = str((body or {}).get('mode') or '').strip()
    ttl = (body or {}).get('ttl_sec')
    try:
        from util_policy import get_mode, set_mode, MODE_FULL, MODE_READONLY
    except ImportError as e:
        self._send_json({'ok': False, 'error': '策略模块缺失: %s' % e}, 500)
        return
    if mode in (MODE_FULL, MODE_READONLY):
        ok, err = _confirm('mode_' + mode,
                           '确认把权限模式切换为「%s」？%s'
                           % (mode, '完全访问将免审批放行 ask 类操作（1 小时后自动回落）。'
                              if mode == MODE_FULL else '只读模式将拒绝写/执行/出域类能力。'))
        if not ok:
            self._send_json({'ok': False, 'err': err or '未获本机桌面确认（拒绝）'}, 403)
            return
    r = set_mode(mode, ttl_sec=int(ttl) if ttl else None, by='policy_route')
    if not r.get('ok'):
        self._send_json(r, 400)
        return
    self._send_json({'ok': True, 'mode': get_mode()})


@route_get('/api/policy/pending')
def _h_policy_pending(self, path, parsed):
    try:
        import util_ticket as ut
        self._send_json(ut.pending_requests())
    except ImportError as e:
        self._send_json({'ok': False, 'error': '票据模块缺失: %s' % e}, 500)


@route_post('/api/policy/approve')
def _h_policy_approve(self, path, parsed):
    try:
        body = self._read_body() or {}
    except (ValueError, UnicodeDecodeError):
        body = {}
    rid = str((body or {}).get('request_id') or '').strip()
    if not rid:
        self._send_json({'ok': False, 'err': '缺少 request_id'}, 400)
        return
    try:
        import util_ticket as ut
    except ImportError as e:
        self._send_json({'ok': False, 'error': '票据模块缺失: %s' % e}, 500)
        return
    pend = {p['request_id']: p for p in ut.pending_requests().get('pending') or []}
    info = pend.get(rid)
    if not info:
        self._send_json({'ok': False, 'err': 'no_such_request（不存在或已过期）'}, 404)
        return
    ok, err = _confirm('approve', '批准 %s 调用 %s？（会话 %s）'
                       % (info['capability'], info['target'][:60], info['session_id'][:30]))
    if not ok:
        self._send_json({'ok': False, 'err': err or '未获本机桌面确认（拒绝）'}, 403)
        return
    r = ut.approve_request(rid, by='policy_route')
    if not r.get('ok'):
        self._send_json(r, 409)
        return
    self._send_json({'ok': True, 'ticket': r.get('ticket'),
                     'expires_in': r.get('expires_in'),
                     'hint': '携带 _policy_ticket 重试原调用（票据一次性，10 分钟内有效）'})


@route_post('/api/policy/reject')
def _h_policy_reject(self, path, parsed):
    try:
        body = self._read_body() or {}
    except (ValueError, UnicodeDecodeError):
        body = {}
    rid = str((body or {}).get('request_id') or '').strip()
    if not rid:
        self._send_json({'ok': False, 'err': '缺少 request_id'}, 400)
        return
    try:
        import util_ticket as ut
    except ImportError as e:
        self._send_json({'ok': False, 'error': '票据模块缺失: %s' % e}, 500)
        return
    ok, err = _confirm('reject', '确认拒绝这条待批请求？')
    if not ok:
        self._send_json({'ok': False, 'err': err or '未获本机桌面确认（拒绝）'}, 403)
        return
    self._send_json(ut.reject_request(rid, by='policy_route'))
