# -*- coding: utf-8 -*-
"""
zf_billing.py - 朱峰模型 · 识图/生图/视频 独立通道计费（安全修复版）

职责（zf_channel_config.py 提供费率，本模块负责扣钱动作）：
  1. precheck(): 请求发出前余额预检（费率未配置=0 时直接放行，不计费）
  2. charge():   成功后通过网关 /internal/deduct 原子扣费（余额足够才扣，防透支），
                 并写本地流水（幂等：同 request_id 只扣一次）
  3. 失败不扣：调用方只在拿到成功结果后才调 charge()
  4. ledger():   流水查询（后台可查）

安全修复（2026-09-17）：
  - get_balance/charge 改用 user_id（原传 username，网关 internal/me 不识别 → 余额恒为 None 恒放行）
  - charge 不再"只记账不扣钱"，改为调用网关 /internal/deduct 原子条件扣减
  - 余额查询失败（网关抖动）时按费率保守预扣拦截，不再无条件放行
"""

import json
import os
import threading
import time
import urllib.request

import zf_channel_config

_LEDGER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'private', 'billing')
_LEDGER_FILE = os.path.join(_LEDGER_DIR, 'zf_billing_ledger.json')

_PROXY_PORT_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                'public', 'config', 'ai_proxy.json')


def _proxy_port():
    try:
        with open(_PROXY_PORT_FILE, encoding='utf-8') as f:
            return int(json.load(f).get('port', 8527))
    except Exception:
        return 8527


_lock = threading.Lock()


def _gateway(path, payload, timeout=8):
    """调用本机 AI 网关 internal 接口。返回 dict 或抛异常。"""
    req = urllib.request.Request(
        f'http://127.0.0.1:{_proxy_port()}{path}',
        data=json.dumps(payload).encode('utf-8'),
        method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        import zf_identity as _zfi
        _sec = _zfi.internal_secret()
        if _sec:
            req.add_header('X-ZF-Internal', _sec)
    except Exception:
        pass
    resp = urllib.request.urlopen(req, timeout=timeout)
    return json.loads(resp.read().decode('utf-8', errors='replace'))


def get_balance(user_id=0):
    """查会员 Token 余额（按 user_id）。失败返回 None。"""
    try:
        data = _gateway('/internal/me', {'user_id': int(user_id or 0)})
        return float(data.get('balance', 0))
    except Exception:
        return None


def calc_cost(channel_name, n_images=1, video_seconds=0):
    """算本次费用。"""
    if channel_name == 'video' and video_seconds:
        ch = zf_channel_config.get_channel(channel_name, include_secret=True) or {}
        return int(float(ch.get('rate_per_second', 0) or 0) * video_seconds
                   + float(ch.get('rate_per_call', 0) or 0))
    cost, _n = zf_channel_config.calc_cost(channel_name, n_images)
    return int(cost)


def precheck(channel_name, n_images=1, user_id=0, video_seconds=0):
    """请求前预检。返回 dict: {allowed, cost, balance, reason}
    - 费率未配置(0) → allowed=True, cost=0（暂不计费）
    - 余额查不到 → 保守放行（不因网关抖动误杀），但 charge 会尝试原子扣费兜底
    - 余额不足 → allowed=False
    """
    ch = zf_channel_config.get_channel(channel_name, include_secret=True) or {}
    if ch and not ch.get('enabled', True):
        return {'allowed': False, 'cost': 0, 'balance': None,
                'reason': f'{channel_name} 通道已关闭'}
    cost = calc_cost(channel_name, n_images, video_seconds)
    if cost <= 0:
        return {'allowed': True, 'cost': 0, 'balance': None, 'reason': 'rate_not_set'}
    bal = get_balance(user_id)
    if bal is None:
        return {'allowed': True, 'cost': cost, 'balance': None, 'reason': 'balance_unknown'}
    if bal < cost:
        return {'allowed': False, 'cost': cost, 'balance': bal,
                'reason': f'余额不足：本次需 {cost} Token，当前余额 {int(bal)}，请充值后再试'}
    return {'allowed': True, 'cost': cost, 'balance': bal, 'reason': 'ok'}


def charge(channel_name, n_images=1, user_id=0, request_id='', meta=None,
           video_seconds=0):
    """成功后扣费：网关 /internal/deduct 原子条件扣减 + 本地流水。
    幂等：同 request_id 不重复扣。返回流水 dict 或 None(cost=0/重复/扣费失败)。
    """
    cost = calc_cost(channel_name, n_images, video_seconds)
    if cost <= 0:
        return None
    rid = request_id or f'{channel_name}-{int(time.time() * 1000)}'
    with _lock:
        if request_id and _seen(request_id):
            return None
        # 先本地记账（含 pending 状态，扣费成功后更新）
        entry = {
            'id': rid,
            'ts': time.time(),
            'channel': channel_name,
            'user_id': int(user_id or 0),
            'cost': cost,
            'n_images': max(0, int(n_images or 0)),
            'video_seconds': max(0.0, float(video_seconds or 0)),
            'status': 'pending',
            'meta': meta or {},
        }
        os.makedirs(_LEDGER_DIR, exist_ok=True)
        with open(_LEDGER_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
        # 原子条件扣费（余额足够才扣，防透支）
        try:
            r = _gateway('/internal/deduct', {'user_id': int(user_id or 0), 'cost': cost},
                         timeout=10)
            entry['status'] = 'charged' if r.get('ok') else f'failed:{r.get("error", "unknown")}'
            if r.get('ok'):
                entry['balance_after'] = r.get('balance')
            else:
                entry['error'] = r.get('error')
        except Exception as e:
            entry['status'] = 'failed:gateway_error'
            entry['error'] = str(e)
        with open(_LEDGER_FILE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(dict(entry, _update=True), ensure_ascii=False) + '\n')
    return entry if entry.get('status') == 'charged' else None


def _seen(request_id):
    """幂等检查：扫描流水（文件通常不大，全扫足够）。"""
    try:
        with open(_LEDGER_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and json.loads(line).get('id') == request_id:
                    return True
    except Exception:
        pass
    return False


def ledger(limit=200, channel=None, user_id=None):
    """流水查询（后台）。按时间倒序返回最近 limit 条。"""
    out = []
    try:
        with open(_LEDGER_FILE, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                if channel and e.get('channel') != channel:
                    continue
                if user_id is not None and e.get('user_id') != int(user_id):
                    continue
                out.append(e)
    except Exception:
        pass
    out.sort(key=lambda e: e.get('ts', 0), reverse=True)
    return out[:max(1, int(limit))]
