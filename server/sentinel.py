#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sentinel.py - 四级隐私防护 P3：网警巡逻（异常行为哨兵）

三路哨兵，全部只读巡检、绝不阻塞业务：
1. 行为哨兵：读审计链尾部统计异常 —— 拦截率骤增、kill_switch 触发、高危命令
2. 网络哨兵：从审计链统计出域动作画像，高频外发告警
3. 文件哨兵：监视 private/ 敏感目录异常变动（白名单外新增脚本即告警）

API:
  patrol(force=False) -> {'alerts': [...], ...}
  patrol_report()     -> 人类可读报告
CLI:
  python sentinel.py patrol
"""

import os
import sys
import json
import time
from collections import Counter

from util_log import get_logger

log = get_logger('sentinel')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_chain
import kill_switch

_BASE = os.path.dirname(os.path.abspath(__file__))
_PRIVATE = os.path.join(_BASE, 'private')
_STATE = os.path.join(_PRIVATE, 'sentinel_state.json')

_TAIL_N = 200

# 高危命令片段
_DANGEROUS_PATTERNS = [
    'rm -rf', 'rmdir /s', 'del /f /s /q', 'format ', 'diskpart',
    'reg delete', 'vssadmin delete', 'cipher /w',
    'schtasks /create', 'invoke-expression', '-enc ',
]

# private/ 白名单（脚本/可执行类）
_ALLOWED_SCRIPTS = {
    'audit_chain.py', 'egress_gate.py', 'kill_switch.py', 'sentinel.py',
    'self_check.py', 'browser_guard.py', 'KILL_SWITCH',
}

_PATROL_INTERVAL = 300  # 防风暴最小间隔（秒）


def _load_state():
    try:
        with open(_STATE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'last_patrol': 0}


def _save_state(st):
    try:
        os.makedirs(_PRIVATE, exist_ok=True)
        with open(_STATE, 'w', encoding='utf-8') as f:
            json.dump(st, f, ensure_ascii=False, indent=1)
    except Exception:
        pass


def _read_tail(n=_TAIL_N):
    """读审计链尾部 n 条（dict 列表）。detail 字段反序列化为 dict。"""
    path = audit_chain.log_path()
    if not os.path.exists(path):
        return []
    lines = []
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if line:
                lines.append(line)
    out = []
    for ln in lines[-n:]:
        try:
            rec = json.loads(ln)
            if isinstance(rec.get('detail'), str):
                try:
                    rec['detail'] = json.loads(rec['detail'])
                except Exception:
                    pass
            out.append(rec)
        except Exception:
            continue
    return out


# ---------- 1. 行为哨兵 ----------

def behavior_patrol():
    alerts = []
    try:
        entries = _read_tail()
    except Exception as e:
        return [{'type': 'audit_read_failed', 'level': 'warn',
                 'msg': '审计链读取失败: ' + str(e)[:100]}]
    if not entries:
        return alerts

    n = len(entries)
    n_blocked = sum(1 for e in entries if str(e.get('action', '')).endswith('_blocked'))
    if n >= 10 and n_blocked / n > 0.2:
        alerts.append({
            'type': 'block_rate_spike', 'level': 'warn',
            'msg': '最近 %d 条审计中 %d 条被拦截(%.0f%%)，疑似异常行为或策略过严'
                   % (n, n_blocked, n_blocked * 100.0 / n)})

    for e in entries:
        if e.get('action') == 'killswitch_on':
            alerts.append({'type': 'killswitch_triggered', 'level': 'critical',
                           'msg': '紧急停止开关已被触发 actor=%s' % e.get('actor')})

    for e in entries:
        d = e.get('detail')
        if not isinstance(d, dict):
            continue
        cmd = str(d.get('cmd') or d.get('target') or d.get('content') or '')
        low = cmd.lower()
        for pat in _DANGEROUS_PATTERNS:
            if pat in low:
                alerts.append({
                    'type': 'dangerous_command', 'level': 'critical',
                    'msg': '审计链发现高危命令片段 [%s] (entry#%s)' % (pat, e.get('ts'))})
                break

    # 审计链完整性校验（lightweight: 前 50 条）
    vr = audit_chain.verify(max_lines=50)
    if vr.get('total', 0) > 0 and not vr.get('ok'):
        alerts.append({
            'type': 'audit_chain_broken', 'level': 'critical',
            'msg': '审计链完整性校验失败！疑似被篡改 broken_at=%s' % vr.get('broken_at')})
    return alerts


# ---------- 2. 网络哨兵 ----------

def network_patrol():
    alerts = []
    entries = _read_tail()
    egress = [e for e in entries if e.get('kind') == 'egress']
    kinds = Counter(e.get('action') for e in egress)
    for k, c in kinds.items():
        if c > 50:
            alerts.append({
                'type': 'egress_flood', 'level': 'warn',
                'msg': '出域动作 %s 在最近 %d 条审计中出现 %d 次，疑似数据外泄尝试'
                       % (k, len(entries), c)})
    return alerts


# ---------- 3. 文件哨兵 ----------

def file_patrol():
    alerts = []
    try:
        for name in os.listdir(_PRIVATE):
            p = os.path.join(_PRIVATE, name)
            if not os.path.isfile(p):
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext in ('.py', '.exe', '.bat', '.cmd', '.ps1', '.js', '.vbs'):
                if name not in _ALLOWED_SCRIPTS:
                    alerts.append({
                        'type': 'private_new_script', 'level': 'critical',
                        'msg': 'private/ 出现非白名单脚本文件: %s' % name})
    except Exception as e:
        alerts.append({'type': 'file_patrol_failed', 'level': 'warn',
                       'msg': '文件哨兵巡检失败: ' + str(e)[:100]})
    return alerts


# ---------- 主入口 ----------

def patrol(force=False):
    st = _load_state()
    now = time.time()
    if not force and now - st.get('last_patrol', 0) < _PATROL_INTERVAL:
        return {'skipped': True, 'alerts': [],
                'msg': '距上次巡逻不足 %d 秒，跳过（force 可强制）' % _PATROL_INTERVAL}

    alerts = behavior_patrol() + file_patrol() + network_patrol()

    for a in alerts:  # 告警留痕（注意：不递归触发 level=critical 的新巡逻）
        audit_chain.record('sentinel', 'patrol_alert',
                           {'type': a['type'], 'msg': a['msg'][:160]},
                           actor='sentinel', level=a['level'])

    st['last_patrol'] = now
    _save_state(st)
    return {
        'skipped': False,
        'kill_on': kill_switch.is_on(),
        'alerts': alerts,
        'alert_count': len(alerts),
        'critical_count': sum(1 for a in alerts if a.get('level') == 'critical'),
    }


def patrol_report(force=True):
    r = patrol(force=force)
    lines = ['===== 网警巡逻报告 =====']
    if r.get('skipped'):
        lines.append(r['msg'])
        return '\n'.join(lines)
    lines.append('紧急停止开关: %s' % ('ON(已停机!)' if r['kill_on'] else 'OFF'))
    lines.append('告警总数: %d (critical: %d)' % (r['alert_count'], r['critical_count']))
    for a in r['alerts']:
        lines.append('  [%s][%s] %s' % (a['level'].upper(), a['type'], a['msg']))
    if not r['alerts']:
        lines.append('  无告警，一切正常。')
    return '\n'.join(lines)


if __name__ == '__main__':
    log.info(patrol_report(force=True))
