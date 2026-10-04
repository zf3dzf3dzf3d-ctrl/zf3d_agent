# -*- coding: utf-8 -*-
"""朱峰智能体管家 · 总指挥（Butler / Conductor）。

职责：轮询 server/data/_crew/ 下所有黑板，
- 依赖解锁：前置片全 done 的片置 ready（ Depends 锁由 crew_claim 强校验兜底）
- 防重复派发：dispatched 标记 + 模块锁，同片只派一次
- 派发上限熔断：单 crew 每日派发次数封顶（防 Bug 循环派发）
- 事件记录：所有动作 append 到 <crew_id>.bus.jsonl，主对话可 bus-tail 回看

本模块只做"组织"，不做"施工"——真正派窗仍由上层 dispatch_swarm / 蜂群通道执行，
总指挥通过回调钩子 dispatch_hook(crew_id, slice, api_base) 注入，便于各通道接驳。
"""

import glob
import json
import os
import threading
import time

_LOCK = threading.Lock()
_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'data', '_crew')

# 每日派发熔断（单 crew），环境变量可调
DAILY_DISPATCH_CAP = int(os.environ.get('ZF_BUTLER_DAILY_CAP', '50'))
# 死窗回收：dispatched 后超过该秒数仍未 claimed → 回收重派；重派超过上限 → 挂起等人工
STALE_TIMEOUT = int(os.environ.get('ZF_BUTLER_STALE_SEC', '1800'))
REDISPATCH_MAX = int(os.environ.get('ZF_BUTLER_REDISPATCH_MAX', '3'))

# 默认模型路由表：按分片标题/简介关键词自动选模型（分片显式带 model 字段时优先）
ROUTE_RULES = [
    ('审核', 'glm-4-flash'),      # 审核类 → 便宜快速
    ('文案', 'glm-4-flash'),
    ('代码', 'glm-4.6'),          # 写码 → 强模型
    ('施工', 'glm-4.6'),
]
DEFAULT_MODEL = 'glm-4.6'


def self_check():
    """启动自检：总指挥与 crew_board 黑板必须指向同一物理目录（防重构错位）。"""
    try:
        from engines.common import crew_board as _cb
        crew_dir = getattr(_cb, '_DATA_DIR', None) or getattr(_cb, 'DATA_DIR', None)
    except Exception:
        try:
            import crew_board as _cb2
            crew_dir = getattr(_cb2, '_DATA_DIR', None) or getattr(_cb2, 'DATA_DIR', None)
        except Exception:
            crew_dir = None
    same = bool(crew_dir) and os.path.realpath(crew_dir) == os.path.realpath(_DATA_DIR)
    if not same:
        _bus_append('_self_check', {'from': 'butler', 'type': 'path-mismatch',
                                    'text': '目录错位! butler=%s crew=%s' % (_DATA_DIR, crew_dir)})
    return {'ok': same, 'butler_dir': os.path.realpath(_DATA_DIR),
            'crew_dir': os.path.realpath(crew_dir) if crew_dir else None}


def attach_batch(crew_id, slice_id, batch_id):
    """回写蜂群批次号到分片，便于追踪派发去向。"""
    with _LOCK:
        board = _load(crew_id)
        if board is None:
            return
        for s in board.get('slices', []):
            if s['id'] == slice_id:
                s['batch_id'] = batch_id
                _save(crew_id, board)
                return


def reclaim_stale(crew_id, timeout_sec=None):
    """死窗回收：dispatched 超时仍未 claimed → 回收重派；超上限 → 挂起等人工。"""
    timeout_sec = timeout_sec or STALE_TIMEOUT
    now = time.time()
    with _LOCK:
        board = _load(crew_id)
        if board is None or board.get('closed'):
            return {'reclaimed': [], 'blocked': []}
        reclaimed, blocked, dirty = [], [], False
        for s in board.get('slices', []):
            if not s.get('dispatched') or s.get('status') != 'pending':
                continue
            if now - float(s.get('dispatched_at') or 0) < timeout_sec:
                continue
            rc = int(s.get('redispatch_count') or 0)
            if rc >= REDISPATCH_MAX:
                s['status'] = 'blocked'
                s['blocked_reason'] = '重派 %d 次仍未认领，挂起等人工' % rc
                blocked.append({'slice_id': s['id'], 'reason': s['blocked_reason']})
                _bus_append(crew_id, {'from': 'butler', 'type': 'blocked',
                                      'text': '分片 %s 重派超限，挂起待人工' % s['id']})
            else:
                s['dispatched'] = False
                s['redispatch_count'] = rc + 1
                reclaimed.append({'slice_id': s['id'], 'try': rc + 1})
                _bus_append(crew_id, {'from': 'butler', 'type': 'reclaim',
                                      'text': '分片 %s 派发超时未认领，回收重派(第%d次)' % (s['id'], rc + 1)})
            dirty = True
        if dirty:
            _save(crew_id, board)
    return {'reclaimed': reclaimed, 'blocked': blocked}


def _board_path(crew_id):
    return os.path.join(_DATA_DIR, '%s.json' % crew_id)


def _bus_path(crew_id):
    return os.path.join(_DATA_DIR, '%s.bus.jsonl' % crew_id)


def _load(crew_id):
    try:
        with open(_board_path(crew_id), 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _save(crew_id, board):
    os.makedirs(_DATA_DIR, exist_ok=True)
    p = _board_path(crew_id)
    tmp = p + '.tmp.%d' % threading.get_ident()
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(board, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)


def _bus_append(crew_id, obj):
    try:
        os.makedirs(_DATA_DIR, exist_ok=True)
        obj = dict(obj, ts=time.time())
        with open(_bus_path(crew_id), 'a', encoding='utf-8') as f:
            f.write(json.dumps(obj, ensure_ascii=False) + '\n')
    except Exception:
        pass


def route_model(slice_obj):
    """按分片内容选模型：显式 model 字段 > 关键词路由 > 默认。"""
    m = str(slice_obj.get('model') or '').strip()
    if m:
        return m
    text = (slice_obj.get('title') or '') + (slice_obj.get('brief') or '')
    for kw, model in ROUTE_RULES:
        if kw in text:
            return model
    return DEFAULT_MODEL


def ready_slices(crew_id):
    """返回当前依赖已解锁、待派发的分片 id 列表（不含已 dispatched/claimed/done）。"""
    board = _load(crew_id)
    if board is None or board.get('closed'):
        return []
    done_ids = {s['id'] for s in board.get('slices', []) if s.get('status') == 'done'}
    ready = []
    for s in board.get('slices', []):
        if s.get('status') != 'pending' or s.get('dispatched'):
            continue
        deps = s.get('depends_on') or []
        if all(d in done_ids for d in deps):
            ready.append(s['id'])
    return ready


def mark_dispatched(crew_id, slice_id, model, dispatched_by='butler'):
    """原子标记已派发（含熔断检查）。返回 {'ok':bool,...}"""
    with _LOCK:
        board = _load(crew_id)
        if board is None:
            return {'ok': False, 'error': '黑板不存在: %s' % crew_id}
        target = None
        for s in board.get('slices', []):
            if s['id'] == slice_id:
                target = s
                break
        if target is None:
            return {'ok': False, 'error': '分片不存在: %s' % slice_id}
        if target.get('dispatched'):
            return {'ok': False, 'error': 'CREW_ALREADY_DISPATCHED', 'hint': '该片已派发过，防重复'}
        if target.get('status') != 'pending':
            return {'ok': False, 'error': '该片状态非 pending: %s' % target.get('status')}
        # 每日熔断计数
        today = time.strftime('%Y%m%d')
        meta = board.setdefault('meta', {})
        cnt = meta.get('dispatch_count_%s' % today, 0)
        if cnt >= DAILY_DISPATCH_CAP:
            _bus_append(crew_id, {'from': 'butler', 'type': 'circuit-break',
                                  'text': '今日派发已达上限 %d，熔断。请人工确认后调大 ZF_BUTLER_DAILY_CAP' % DAILY_DISPATCH_CAP})
            return {'ok': False, 'error': 'CREW_DAILY_CAP', 'cap': DAILY_DISPATCH_CAP}
        target['dispatched'] = True
        target['dispatched_at'] = time.time()
        target['routed_model'] = model
        target['dispatched_by'] = dispatched_by
        meta['dispatch_count_%s' % today] = cnt + 1
        _save(crew_id, board)
    _bus_append(crew_id, {'from': 'butler', 'type': 'dispatch',
                          'text': '总指挥派发分片 %s → 模型 %s' % (slice_id, model)})
    return {'ok': True, 'slice_id': slice_id, 'model': model}


def scan_all(dispatch_hook=None, real=False):
    """扫全部黑板：返回每 crew 的 ready 列表；给 dispatch_hook 则逐片派发。
    real=True 时才真实调用钩子开子窗（real=False 仅标记派发、不执行钩子）。"""
    results = []
    for p in glob.glob(os.path.join(_DATA_DIR, '*.json')):
        base = os.path.basename(p)
        if base.endswith('.tmp') or '.bus.' in base:
            continue
        crew_id = base[:-5]
        rc = reclaim_stale(crew_id)
        ready = ready_slices(crew_id)
        item = {'crew_id': crew_id, 'ready': ready, 'dispatched': [],
                'reclaimed': rc.get('reclaimed') or [], 'blocked': rc.get('blocked') or []}
        if dispatch_hook and ready:
            board = _load(crew_id)
            slices = {s['id']: s for s in (board or {}).get('slices', [])}
            for sid in ready:
                model = route_model(slices.get(sid, {}))
                r = mark_dispatched(crew_id, sid, model)
                if r.get('ok'):
                    info = {'slice_id': sid, 'model': model}
                    item['dispatched'].append(info)
                    try:
                        t0 = time.time()
                        hook_r = dispatch_hook(crew_id, slices.get(sid, {}), model) if real else None  # real 为本函数形参
                        cost = round(time.time() - t0, 3)
                        info['cost_sec'] = cost
                        if isinstance(hook_r, dict):
                            info['batch_id'] = hook_r.get('batch_id')
                        # 成本日志：模型+耗时落总线，供路由策略校准
                        _bus_append(crew_id, {'from': 'butler', 'type': 'cost',
                                              'text': '分片 %s 模型 %s 钩子耗时 %ss' % (sid, model, cost),
                                              'model': model, 'cost_sec': cost, 'slice_id': sid})
                    except Exception as e:
                        _bus_append(crew_id, {'from': 'butler', 'type': 'dispatch-hook-error',
                                              'text': '派发钩子异常: %r' % e})
        results.append(item)
    return results


def status(crew_id=None):
    """管家看板：单 crew 或全部的进度概览。"""
    if crew_id:
        board = _load(crew_id)
        if board is None:
            return {'ok': False, 'error': '黑板不存在: %s' % crew_id}
        slices = [{'id': s['id'], 'title': s.get('title'), 'status': s.get('status'),
                   'model': s.get('model') or (s.get('routed_model') if s.get('dispatched') else ''),
                   'depends_on': s.get('depends_on') or [], 'dispatched': bool(s.get('dispatched')),
                   'claimed_by': s.get('claimed_by'), 'done_summary': (s.get('done_summary') or '')[:120]}
                  for s in board.get('slices', [])]
        return {'ok': True, 'crew_id': crew_id, 'closed': bool(board.get('closed')), 'slices': slices}
    out = []
    for p in glob.glob(os.path.join(_DATA_DIR, '*.json')):
        base = os.path.basename(p)
        if '.bus.' in base:
            continue
        cid = base[:-5]
        board = _load(cid) or {}
        sl = board.get('slices', [])
        out.append({'crew_id': cid,
                    'total': len(sl),
                    'done': sum(1 for s in sl if s.get('status') == 'done'),
                    'claimed': sum(1 for s in sl if s.get('status') == 'claimed'),
                    'pending': sum(1 for s in sl if s.get('status') == 'pending')})
    return {'ok': True, 'crews': out}
