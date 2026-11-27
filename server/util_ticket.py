# -*- coding: utf-8 -*-
"""util_ticket.py - M1.2 审批票据（策划案 M1.2；M3.1 包化时迁 server/zf/policy）。

解决什么问题
------------
人是针对**具体的一次调用**做的批准，而审批与执行隔着一次往返（前端拿到批准 → 重新提交调用）。
这个间隙里票据可能被：换参数重放（批 A 执行 B）、跨会话挪用（甲会话的批准给乙会话用）、
原样重放（一次批准反复执行）、超时冒用（批完一小时才用）。本模块把四样东西焊在一张票据上：

    票据 = 随机 ID × (capability, 参数哈希, 会话 ID, 调用 ID) × 一次性 × 10 分钟

使用契约（M1.3 接入 syscall / PolicyEngine 的 ask 通路时按此执行）
----------------------------------------------------------------
  1. PolicyEngine 判定为 ask → 走人的审批 UI；
  2. 人批准 → 调 issue(capability, params, session_id, call_id) 得票据；
  3. 前端把票据随**原调用原参数**重新提交；
  4. 执行闸门在真正执行前调 consume(ticket, capability, params, session_id, call_id)：
     任一绑定不符 / 已用过 / 已过期 / 已撤销 → 拒绝并进审计链；全部吻合 → 原子核销（一次性）后放行。

性质与边界
----------
  - 票据存进程内存：服务重启即全部失效（倾向拒绝——重启后让人重新批，不做持久化）；
  - 每张票据只对应一次执行；想再次执行同样的调用，让人重新批；
  - 参数哈希是规范化 JSON 的 SHA-256（键排序、去空白），同样的参数不同键序算同一次批准；
  - session_id / call_id 缺失一律拒发（无法定位责任的批准不存在）；
  - 每次签发/核销/拒绝都写审计哈希链（失败不阻断、记日志）。

用法（示意）
------------
    import util_ticket as ut
    t = ut.issue('shell', {'cmd': 'git push'}, session_id='box_1', call_id='c42')
    # 执行前：
    ok, reason = ut.consume(t['ticket'], 'shell', {'cmd': 'git push'}, 'box_1', 'c42')
"""
from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
from typing import Any, Dict, Optional, Tuple

from util_log import get_logger

log = get_logger('util_ticket')

TTL_SECONDS = 600          # 默认有效期 10 分钟（策划案 M1.2）
TTL_MAX = 3600             # 上限 1 小时
MAX_PENDING = 500          # 在途票据上限（防灌水；超过先清过期，仍满则拒发）

_ok = lambda b: {'ok': bool(b)}


def _now() -> float:
    """时间源（测试可整体替换）。"""
    return time.time()


def params_hash(params: Any) -> str:
    """参数的规范化哈希：字典按键排序去空白序列化；字符串按原文。同参数不同键序 = 同哈希。"""
    if isinstance(params, str):
        data = params.encode('utf-8')
    else:
        data = json.dumps(params, ensure_ascii=False, sort_keys=True,
                          separators=(',', ':')).encode('utf-8')
    return hashlib.sha256(data).hexdigest()


class _Ticket(object):
    __slots__ = ('ticket', 'capability', 'phash', 'session_id', 'call_id',
                 'created_at', 'expires_at', 'used', 'revoked')

    def __init__(self, ticket: str, capability: str, phash: str,
                 session_id: str, call_id: str, ttl: int) -> None:
        self.ticket = ticket
        self.capability = capability
        self.phash = phash
        self.session_id = session_id
        self.call_id = call_id
        self.created_at = _now()
        self.expires_at = self.created_at + ttl
        self.used = False
        self.revoked = False

    def alive(self) -> bool:
        return not (self.used or self.revoked or self.expires_at < _now())


_lock = threading.Lock()
_tickets: Dict[str, _Ticket] = {}


def _audit(action: str, detail: Dict[str, Any]) -> None:
    """审计哈希链留痕。失败不阻断（审计写不进去不拦合法执行），但要记日志。"""
    try:
        import audit_chain
        audit_chain.record('approve_ticket', action, detail, actor='user', level='warn')
    except (ImportError, OSError, TypeError) as e:
        log.warning('票据审计留痕失败: %s' % e)


def _purge_expired() -> None:
    # 已过期/已核销/已撤销的条目保留一个 TTL 周期再清：重放时才能给出准确的
    # already_used / revoked / expired，而不是笼统的 no_such_ticket；容量由上限兜底。
    cutoff = _now() - TTL_SECONDS
    dead = [k for k, t in _tickets.items() if t.expires_at < cutoff]
    for k in dead:
        _tickets.pop(k, None)


def issue(capability: str, params: Any, session_id: str, call_id: str,
          ttl: int = TTL_SECONDS) -> Dict[str, Any]:
    """签发一张审批票据。四元组（capability, 参数哈希, 会话, 调用 ID）全部绑定。

    返回 {'ok', 'ticket', 'expires_in'} 或 {'ok': False, 'err'}。"""
    cap = str(capability or '').strip()
    sess = str(session_id or '').strip()
    call = str(call_id or '').strip()
    if not cap:
        return {'ok': False, 'err': 'capability 为空'}
    if not sess or not call:
        return {'ok': False, 'err': 'session_id / call_id 缺失（无法定位责任的批准不存在）'}
    ph = params_hash(params)
    ttl = max(1, min(int(ttl), TTL_MAX))
    tid = 'tk-' + secrets.token_urlsafe(24)
    with _lock:
        _purge_expired()
        if len(_tickets) >= MAX_PENDING:
            return {'ok': False, 'err': '在途票据已达上限，请稍后重试'}
        _tickets[tid] = _Ticket(tid, cap, ph, sess, call, ttl)
    _audit('issue', {'cap': cap[:40], 'session': sess[:40], 'call': call[:40],
                     'ph': ph[:12], 'ttl': ttl})
    log.info('票据签发 cap=%s session=%s call=%s ttl=%ds' % (cap[:30], sess[:30], call[:30], ttl))
    return {'ok': True, 'ticket': tid, 'expires_in': ttl}


def _lookup(ticket: str) -> Optional[_Ticket]:
    return _tickets.get(str(ticket or '').strip())


def consume(ticket: str, capability: str, params: Any,
            session_id: str, call_id: str) -> Tuple[bool, str]:
    """执行前核销。全部绑定吻合 → 原子核销并放行；任何不符 → 拒绝并给出机器可读原因。

    返回 (ok, reason)。reason 取值：ok / no_such_ticket / revoked / already_used /
    expired / capability_mismatch / params_mismatch / session_mismatch / call_mismatch。"""
    cap = str(capability or '').strip()
    sess = str(session_id or '').strip()
    call = str(call_id or '').strip()
    ph = params_hash(params)
    with _lock:
        _purge_expired()
        t = _lookup(ticket)
        if t is None:
            reason = 'no_such_ticket'
        elif t.revoked:
            reason = 'revoked'
        elif t.used:
            reason = 'already_used'          # 重放失效：一次性
        elif t.expires_at < _now():
            reason = 'expired'
        elif t.capability != cap:
            reason = 'capability_mismatch'
        elif t.phash != ph:
            reason = 'params_mismatch'       # 换参数失效：批 A 执行 B 被拦
        elif t.session_id != sess:
            reason = 'session_mismatch'      # 跨会话失效
        elif t.call_id != call:
            reason = 'call_mismatch'
        else:
            t.used = True                    # 原子核销：同锁内先判后改
            reason = 'ok'
    detail = {'reason': reason, 'cap': cap[:40], 'session': sess[:40], 'call': call[:40]}
    if reason == 'ok':
        _audit('consume', detail)
        log.info('票据核销放行 cap=%s call=%s' % (cap[:30], call[:30]))
    else:
        _audit('consume_deny', detail)
        log.info('票据拒绝 %s cap=%s call=%s' % (reason, cap[:30], call[:30]))
    return reason == 'ok', reason


def peek(ticket: str) -> Dict[str, Any]:
    """查看票据状态（不核销）。供审批 UI 展示；不含参数原文，只含哈希前缀。"""
    with _lock:
        t = _lookup(ticket)
        if t is None:
            return {'ok': False, 'err': 'no_such_ticket'}
        return {'ok': True, 'capability': t.capability, 'session_id': t.session_id,
                'call_id': t.call_id, 'phash_prefix': t.phash[:12],
                'used': t.used, 'revoked': t.revoked,
                'expires_in': max(0, int(t.expires_at - _now()))}


def revoke(ticket: str, by: str = 'user') -> Dict[str, Any]:
    """作废一张在途票据（人主动撤回批准）。"""
    with _lock:
        t = _lookup(ticket)
        if t is None:
            return {'ok': False, 'err': 'no_such_ticket'}
        t.revoked = True
    _audit('revoke', {'ticket_prefix': str(ticket)[:10], 'by': str(by)[:40]})
    return {'ok': True}


def revoke_session(session_id: str) -> int:
    """作废某会话的全部在途票据（会话结束/断开时调用）。返回作废张数。"""
    sess = str(session_id or '').strip()
    n = 0
    with _lock:
        for t in _tickets.values():
            if t.session_id == sess and not (t.used or t.revoked):
                t.revoked = True
                n += 1
    if n:
        _audit('revoke_session', {'session': sess[:40], 'count': n})
    return n


def pending_for_session(session_id: str) -> Dict[str, Any]:
    """审批 UI 列出某会话的在途票据（不含参数原文）。"""
    sess = str(session_id or '').strip()
    out = []
    with _lock:
        _purge_expired()
        for t in _tickets.values():
            if t.session_id == sess and t.alive():
                out.append({'ticket': t.ticket, 'capability': t.capability,
                            'call_id': t.call_id, 'phash_prefix': t.phash[:12],
                            'expires_in': max(0, int(t.expires_at - _now()))})
    return {'ok': True, 'pending': out}


def reset_for_tests() -> None:
    """测试专用：清空全部在途票据与审批请求。生产代码不得调用。"""
    with _lock:
        _tickets.clear()
        _requests.clear()


# ===== M1.4 审批请求登记：ask 拦截时生成请求编号，人批准后换成正式票据 =====

_REQ_TTL = 600            # 审批请求的有效期（超时自动作废，与票据一致）
_MAX_REQUESTS = 100       # 在途请求上限（防灌水）
_requests: Dict[str, Dict[str, Any]] = {}
_request_seq = [0]


def register_request(capability: str, target: str, params: Any,
                     session_id: str, call_id: str) -> Dict[str, Any]:
    """登记一条待批请求（ask 拦截时由能力闸门调用）。

    同一 (capability, 参数哈希, 会话) 的在途请求自动去重——反复重试不会刷屏。
    返回 {'ok', 'request_id', 'dedup'}。"""
    cap = str(capability or '').strip()
    sess = str(session_id or '').strip()
    call = str(call_id or '').strip()
    if not cap:
        return {'ok': False, 'err': 'capability 为空'}
    ph = params_hash(params)
    rid_key = (cap, ph, sess)
    now = _now()
    with _lock:
        for k, r in list(_requests.items()):
            if now - r['created_at'] > _REQ_TTL:
                _requests.pop(k, None)
                continue
            if not r['decided'] and (r['capability'], r['phash'], r['session_id']) == rid_key:
                return {'ok': True, 'request_id': k, 'dedup': True}
        if len(_requests) >= _MAX_REQUESTS:
            return {'ok': False, 'err': '在途审批请求已达上限'}
        _request_seq[0] += 1
        rid = 'req-%d-%s' % (_request_seq[0], secrets.token_urlsafe(8))
        _requests[rid] = {'capability': cap, 'target': str(target or '')[:200], 'phash': ph,
                          'params': params, 'session_id': sess, 'call_id': call,
                          'created_at': now, 'decided': False}
    return {'ok': True, 'request_id': rid, 'dedup': False}


def approve_request(request_id: str, by: str = 'user') -> Dict[str, Any]:
    """人批准一条待批请求 → 换发正式票据（四元绑定随请求快照继承）。"""
    rid = str(request_id or '').strip()
    with _lock:
        r = _requests.get(rid)
        if r is None:
            return {'ok': False, 'err': 'no_such_request'}
        if r['decided']:
            return {'ok': False, 'err': 'already_decided'}
        if _now() - r['created_at'] > _REQ_TTL:
            _requests.pop(rid, None)
            return {'ok': False, 'err': 'request_expired'}
        r['decided'] = True
        cap, params = r['capability'], r['params']
        sess, call = r['session_id'], r['call_id']
    res = issue(cap, params, sess, call)
    if res.get('ok'):
        res['request_id'] = rid
        _audit('request_approve', {'rid': rid[:24], 'cap': cap[:40], 'by': str(by)[:40]})
    return res


def reject_request(request_id: str, by: str = 'user') -> Dict[str, Any]:
    rid = str(request_id or '').strip()
    with _lock:
        r = _requests.get(rid)
        if r is None:
            return {'ok': False, 'err': 'no_such_request'}
        if r['decided']:
            return {'ok': False, 'err': 'already_decided'}
        r['decided'] = True
    _audit('request_reject', {'rid': rid[:24], 'by': str(by)[:40]})
    return {'ok': True}


def pending_requests() -> Dict[str, Any]:
    """审批 UI 列出全部在途待批请求（不含参数原文，只含元信息）。"""
    now = _now()
    out = []
    with _lock:
        for rid, r in sorted(_requests.items(), key=lambda kv: kv[1]['created_at']):
            if r['decided'] or now - r['created_at'] > _REQ_TTL:
                continue
            out.append({'request_id': rid, 'capability': r['capability'],
                        'target': r['target'], 'session_id': r['session_id'],
                        'call_id': r['call_id'], 'phash_prefix': r['phash'][:12],
                        'age': int(now - r['created_at'])})
    return {'ok': True, 'pending': out}

