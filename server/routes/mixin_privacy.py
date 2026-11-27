# -*- coding: utf-8 -*-
"""
mixin_privacy.py —— i隐私 API（挂到主 server 的 mixin）
- GET  /api/privacy/status  台账摘要 + 健康报告（只读，密钥只显前8字符已在台账层保证）
- POST /api/privacy/scan    触发重扫（复用 scripts/i_privacy_scan.py 的 scan 逻辑，子进程）
销毁类动作（archive/wipe/restore）不开放 HTTP API，走 CLI 三重闸（策划案硬约束）。
"""
import os, json, subprocess, sys

_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SCAN = os.path.join(_BASE, 'scripts', 'i_privacy_scan.py')
_PY = sys.executable
_LEDGER = os.path.join(_BASE, '..', 'private', '隐私台账.json')
_HEALTH = os.path.join(_BASE, '..', 'private', '隐私健康报告.json')
_LOCK = {'busy': False}


def _load(path):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def handle_privacy_status(qs=None):
    ledger = _load(_LEDGER) or {}
    health = _load(_HEALTH) or {}
    items = ledger.get('items') or []
    # 摘要：按风险分级计数 + 高危/中危条目（路径+类别，不含内容）
    from collections import Counter
    cnt = Counter(i.get('risk') or 'low' for i in items)
    warn = [{'id': i.get('id'), 'path': i.get('path'), 'cat': i.get('cat'),
             'risk': i.get('risk'), 'git_tracked': bool(i.get('git_tracked'))}
            for i in items if (i.get('risk') in ('high', 'mid', 'medium'))]
    warn.sort(key=lambda x: (0 if x['risk'] == 'high' else 1, x['path']))
    return {'ok': True, 'count': ledger.get('count', len(items)),
            'risk_count': {'high': cnt.get('high', 0), 'mid': cnt.get('mid', cnt.get('medium', 0)),
                           'low': cnt.get('low', 0)},
            'health': health.get('summary') or health.get('health') or health,
            'warn': warn[:200], 'generated': ledger.get('generated')}


def handle_privacy_scan():
    if _LOCK['busy']:
        return {'ok': False, 'err': 'scan-in-progress'}
    _LOCK['busy'] = True
    try:
        r = subprocess.run([_PY, '-X', 'utf8', _SCAN, 'scan'],
                           capture_output=True, text=True, timeout=300, cwd=_BASE)
        ok = (r.returncode == 0)
        return {'ok': ok, 'stdout': (r.stdout or '')[-2000:], 'stderr': (r.stderr or '')[-500:]}
    except Exception as e:
        return {'ok': False, 'err': str(e)}
    finally:
        _LOCK['busy'] = False


def handle_privacy_get(path, qs):
    if path == '/api/privacy/status':
        return handle_privacy_status(qs)
    return {'ok': False, 'err': 'unknown privacy api'}, 404


def handle_privacy_post(path):
    if path == '/api/privacy/scan':
        return handle_privacy_scan()
    return {'ok': False, 'err': 'unknown privacy api'}, 404
