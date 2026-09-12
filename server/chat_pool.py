# -*- coding: utf-8 -*-
"""chat_pool：对话池——请求生命周期托管 + 断点续读缓冲区（池系统 v1.0 完整版）。

产品语义（用户定义，见 docs/池系统设计方案-2026-09-09.md）：
- 槽位(Slot) = 一个对话框(box)在池中的常驻位置，游戏对象池语义：
  可擦除、可复用、池本身常驻进程生命周期。
- Turn = 一轮"发往大模型"的托管请求，前端 turn_id 幂等（Wi-Fi 瞬断重发不重复计费）。
- 事件缓冲 = 上游回复先落槽位（seq 单调递增），浏览器随时订阅、
  断线带游标(cursor)续读——请求所有权在服务器手里，浏览器断了照收。

与现有系统分工（铁律）：chat_gate=交警（谁先走），池=车队+仓库。
worker 内 acquire/release 与旧路径同参同义，让道/AIMD/小狗守卫零改动兼容；
小狗守卫/风筝不耦合（本模块只提供只读快照）。

锁序约定（防死锁）：slot.lock/cond 在内层，_POOL_LOCK 在外层独立使用；
凡需要同时持有两者时，一律先 slot 后 _POOL_LOCK（见 submit/_cleanup_once）。
"""
import os
import json
import time
import threading

_BASE = os.path.dirname(os.path.abspath(__file__))
_CFG_PATH = os.path.join(_BASE, 'private', 'chat_pool.json')

DEFAULT_CFG = {
    'enabled': True,            # 总开关：false=前端自动走旧 /api/proxy(_stream)
    'max_slots': 64,             # 槽位上限（超了按闲置时长淘汰）
    'slot_idle_sec': 1800,       # 空闲槽位回收时长
    'replay_keep_sec': 600,      # Turn 结束后事件缓冲保留时长（断线重连窗口，需大于前端轮间重试间隔 300s，避免重连时缓冲已被清理导致 gone）
    'event_max_count': 4000,     # 单轮事件条数上限（防内存膨胀，超限停缓冲打标记）
    'event_max_bytes': 8000000,  # 单轮缓冲字节上限
    'conn_pool': {
        'enabled': True,         # 连接池开关：false=worker 用 _urlopen_retry（完全旧行为）
        'per_host': 3,
        'idle_sec': 60,
    },
}

_cfg = dict(DEFAULT_CFG)
_cfg_mtime = 0.0
_CFG_LOCK = threading.Lock()

_POOL_LOCK = threading.Lock()
_slots = {}          # box_id -> Slot
_turns = {}          # turn_id -> box_id（幂等索引，随缓冲清理）
_seq = 0
_bg_started = False


def _load_cfg():
    """mtime 热加载（与 chat_gate 同款模式：外部手改 json 即时生效）。"""
    global _cfg, _cfg_mtime
    try:
        mtime = os.path.getmtime(_CFG_PATH)
    except OSError:
        # 配置缺失：落一份默认配置（首次部署/误删自愈）
        try:
            os.makedirs(os.path.dirname(_CFG_PATH), exist_ok=True)
            with open(_CFG_PATH, 'w', encoding='utf-8') as f:
                json.dump(DEFAULT_CFG, f, ensure_ascii=False, indent=2)
            _cfg_mtime = os.path.getmtime(_CFG_PATH)
        except Exception:
            pass
        _cfg = dict(DEFAULT_CFG)
    else:
        if mtime != _cfg_mtime:
            _cfg_mtime = mtime
            try:
                with open(_CFG_PATH, 'r', encoding='utf-8-sig') as f:
                    d = json.load(f)
                merged = dict(DEFAULT_CFG)
                if isinstance(d, dict):
                    merged.update({k: v for k, v in d.items() if k in DEFAULT_CFG})
                _cfg = merged
            except Exception:
                pass
    try:
        import conn_pool
        conn_pool.apply_cfg(_cfg.get('conn_pool') or {})
    except Exception:
        pass
    return _cfg


def cfg():
    _load_cfg()
    return _cfg


def enabled():
    try:
        return bool(cfg().get('enabled'))
    except Exception:
        return False


def _log(level, box_id, action, detail):
    """写 app_logs（失败静默，不阻断请求）。"""
    try:
        from routes.mixin_base import db_write_log
        db_write_log(level, box_id, action, detail)
    except Exception:
        pass


class Slot:
    """对话槽位：box 在池中的常驻位置。线程安全靠 self.lock + self.cond。

    注意：self.cond = Condition(self.lock)，同一线程不可重入（普通 Lock），
    持锁期间只能调用 *_locked 方法，不能再 with self.cond。
    """

    def __init__(self, box_id):
        self.box_id = box_id
        self.lock = threading.Lock()
        self.cond = threading.Condition(self.lock)
        self.events = []            # 本轮事件缓冲 [{seq, kind, ...}, ...]
        self.next_seq = 1
        self.turn = None            # 当前 Turn（dict），None=空闲
        self.engine = ''
        self.provider = ''
        self.model = ''
        self.loop_mode = ''
        self.project_path = ''
        self.last_active = time.time()
        self.created_at = time.time()
        self.stats = {'turns': 0, 'prompt_tokens': 0, 'completion_tokens': 0,
                      'cached_tokens': 0, 'net_errors': 0}
        self._buffer_bytes = 0
        self._truncated = False

    # ---- 事件缓冲 ----
    def emit(self, kind, data):
        """追加事件并唤醒所有订阅者。事件必须是可 JSON 序列化的纯数据。"""
        now = time.time()
        with self.cond:
            ev = {'seq': self.next_seq, 'kind': kind, 'ts': round(now, 2)}
            ev.update(data if isinstance(data, dict) else {})
            # 缓冲上限保护：超限不再缓冲 chunk（直播不受影响，重放标记截断）
            if kind == 'chunk':
                try:
                    size = len(json.dumps(ev, ensure_ascii=False))
                except Exception:
                    size = 256
                limit_n = int(cfg().get('event_max_count', 4000))
                limit_b = int(cfg().get('event_max_bytes', 8000000))
                if len(self.events) >= limit_n or self._buffer_bytes + size > limit_b:
                    if not self._truncated:
                        self._truncated = True
                        _log('warn', self.box_id, 'pool-buffer-truncated',
                             '事件缓冲达上限，后续增量不再可重放（直播不受影响）')
                    self.next_seq += 1     # seq 继续前进，订阅端游标不回退
                    self.cond.notify_all()
                    return
                self._buffer_bytes += size
            self.events.append(ev)
            self.next_seq += 1
            self.cond.notify_all()

    def reset_for_turn_locked(self):
        """新 Turn 开始：擦除旧缓冲（对象池"重写"语义）。调用方必须已持锁。"""
        self.events = []
        self.next_seq = 1
        self._buffer_bytes = 0
        self._truncated = False

    def snapshot_turn(self):
        """当前 Turn 的可序列化快照（剥离内部对象）。"""
        with self.lock:
            t = self.turn
            if not t:
                return None
            return {k: t.get(k) for k in ('turn_id', 'state', 'provider', 'model',
                                          'engine', 'created_at', 'started_at',
                                          'ended_at', 'error', 'superseded')}


def _new_turn(box_id, turn_id, body):
    provider = ''
    model = ''
    engine = ''
    try:
        from urllib.parse import urlparse
        provider = urlparse(str(body.get('_target_url') or '')).hostname or ''
    except Exception:
        pass
    try:
        model = str((body.get('_body') or {}).get('model') or '')[:60]
    except Exception:
        pass
    try:
        engine = str(body.get('_engine') or '')
    except Exception:
        pass
    return {
        'turn_id': turn_id, 'state': 'waiting', 'box': box_id,
        'provider': provider, 'model': model, 'engine': engine,
        'created_at': time.time(), 'started_at': None, 'ended_at': None,
        'error': '', 'usage': {}, 'superseded': False,
        'cancel_evt': threading.Event(),   # 内部对象：快照时剥离
    }


def _get_slot(box_id):
    """取/建槽位（超上限时淘汰闲置且无 Turn 的槽位）。"""
    c = cfg()
    with _POOL_LOCK:
        slot = _slots.get(box_id)
        if slot is None:
            slot = Slot(box_id)
            _slots[box_id] = slot
            max_slots = int(c.get('max_slots', 64))
            if len(_slots) > max_slots:
                now = time.time()
                for bid in sorted(_slots, key=lambda b: _slots[b].last_active):
                    if bid == box_id:
                        continue
                    s = _slots.get(bid)
                    if s is not None and s.turn is None and now - s.last_active > 30:
                        _slots.pop(bid, None)
                    if len(_slots) <= max_slots:
                        break
        slot.last_active = time.time()
        return slot


def find_slot(box_id):
    """供 SSE 订阅端查询；不存在返回 None。"""
    with _POOL_LOCK:
        return _slots.get(box_id)


def _engine_own_tools(body):
    """own_tools 引擎（服务端 agent 循环）不走池——回退旧路径。"""
    try:
        import engines_loader
        eng_id = str(body.get('_engine') or '') or engines_loader.DEFAULT_ENGINE
        return bool(engines_loader.engine_owns_tools(eng_id))
    except Exception:
        return False


def submit(body, turn_id=''):
    """POST /api/chat-pool/chat 入口：托管发起一轮上游请求。

    返回（全部可 JSON 序列化）：
      {'ok': True, 'slot_id', 'turn_id', 'state'}
      {'ok': False, 'fallback': 'proxy_stream'}   ← 引擎形态不支持，前端回退旧路径
      {'ok': False, 'status': 400, 'error': ...}  ← 参数问题（对齐旧 /api/proxy 形状）
    """
    global _seq
    c = cfg()
    _ensure_bg_thread()
    if not c.get('enabled'):
        return {'ok': False, 'fallback': 'proxy_stream', 'error': 'chat_pool disabled'}
    if not isinstance(body, dict):
        return {'ok': False, 'status': 400, 'error': 'Invalid body'}
    if not body.get('_target_url'):
        return {'ok': False, 'status': 400, 'error': 'Missing _target_url'}
    if _engine_own_tools(body):
        return {'ok': False, 'fallback': 'proxy_stream',
                'error': 'own_tools engine not pooled'}

    box_id = str(body.get('_box_id') or body.get('box_id') or '') or '_general'
    if not turn_id:
        with _POOL_LOCK:
            _seq += 1
            turn_id = 'tp%d-%d' % (int(time.time()), _seq)
    turn_id = str(turn_id)

    slot = _get_slot(box_id)
    with slot.cond:
        cur = slot.turn
        # 幂等（分两段）：
        #  a) 同 turn_id 且仍在跑（waiting/running）→ 直接返回现状（Wi-Fi 瞬断重投/前端
        #     重试同 id 重投都不再铸造新 Turn，断线重连语义）
        #  b) 同 turn_id 已完结 → 落到下方正常建轮（重试想重跑，原 id 重建 fresh run）
        if cur and cur.get('turn_id') == turn_id and cur.get('state') in ('waiting', 'running'):
            return {'ok': True, 'slot_id': box_id, 'turn_id': turn_id,
                    'state': cur.get('state', 'waiting')}
        with _POOL_LOCK:
            _seen_turn = turn_id in _turns
        if cur and cur.get('state') in ('waiting', 'running'):
            if _seen_turn:
                # 【让位 2026-09-10】老代次 Turn 的重试撞上更新的 Turn：绝不夺位再杀。
                # 旧行为（任何不同 id 的 submit 都收割在途 Turn）曾导致同框两条循环
                # 互相收割的死亡风暴：每次重试=一次谋杀，Turn 全部 3~10 秒夭折。
                # 报告被取代，调用方应安静退出让位给新 Turn。
                return {'ok': False, 'status': 0, 'superseded': True,
                        'error': 'superseded by newer turn'}
            # 孤儿收割：全新逻辑请求提交时旧 Turn 还在跑 → 自动取消
            # （根治旧路径"浏览器掐断后孤儿请求继续占上游"的雪崩问题）
            cur['superseded'] = True
            try:
                cur['cancel_evt'].set()
            except Exception:
                pass
            _log('info', box_id, 'pool-orphan-reaped',
                 '新Turn %s 取消旧Turn %s（孤儿收割）'
                 % (turn_id[-12:], str(cur.get('turn_id', ''))[-12:]))
        turn = _new_turn(box_id, turn_id, body)
        slot.turn = turn
        slot.engine = turn['engine']
        slot.provider = turn['provider']
        slot.model = turn['model']
        try:
            slot.loop_mode = str(body.get('_loop_mode') or '')
            slot.project_path = str(body.get('_project_path') or '')
        except Exception:
            pass
        slot.reset_for_turn_locked()
        slot.stats['turns'] += 1
        with _POOL_LOCK:
            _turns[turn_id] = box_id

    t = threading.Thread(target=_turn_worker, args=(slot, turn, body),
                         name='pool-turn-%s' % turn_id[-8:], daemon=True)
    t.start()
    _log('info', box_id, 'pool-turn-start',
         'Turn %s 入池 | provider=%s | model=%s'
         % (turn_id[-12:], turn['provider'], turn['model']))
    return {'ok': True, 'slot_id': box_id, 'turn_id': turn_id, 'state': 'waiting'}


def cancel(box_id, turn_id=''):
    """停止一轮 Turn（用户停止/超时掐断都走这里）。"""
    slot = find_slot(str(box_id or ''))
    if not slot:
        return {'ok': False, 'error': 'slot not found'}
    with slot.lock:
        t = slot.turn
        if not t:
            return {'ok': False, 'error': 'no active turn'}
        if turn_id and t.get('turn_id') != str(turn_id):
            return {'ok': False, 'error': 'turn mismatch'}
        t['cancel_evt'].set()
        return {'ok': True, 'turn_id': t.get('turn_id'), 'state': t.get('state')}


def _turn_worker(slot, turn, body):
    """Turn 工作线程：过闸门 → 发上游 → 事件落缓冲 → 释放闸门 → 收尾。

    阻塞在闸门 acquire 的是本线程，不占浏览器连接也不占 HTTP 线程——
    这是池相对旧架构的关键优势（旧路径浏览器 fetch 全程被闸门排队拖着）。
    所有路径统一在 finally 收尾（done 事件 + release + 记账），不会双收尾。
    """
    ticket = None
    ok, err, net_err = True, '', ''
    try:
        import chat_gate
        try:
            ticket = chat_gate.acquire(
                turn['box'], engine=turn['engine'], model=turn['model'],
                entry='pool', provider=turn['provider'])
        except chat_gate.GateRejected as gr:
            # 闸门拒绝：与旧路径同形（{ok:false, gate:true, status, error}）
            _emit(slot, turn, 'result',
                  {'result': {'ok': False, 'gate': True,
                              'status': int(getattr(gr, 'http_code', 503)),
                              'error': str(gr)}})
            turn['state'] = 'failed'
            turn['error'] = str(gr)
            return
        except Exception as ge:
            # 闸门自身异常不阻断业务（放行直通），与旧路径一致
            print('[ChatPool] 闸门异常(直通放行): %s' % ge)
            ticket = None

        # 排队期间被取消/被新 Turn 取代 → 立即归还车道（主动取消不毒化 AIMD）
        if turn['cancel_evt'].is_set():
            turn['state'] = 'cancelled'
            return

        turn['state'] = 'running'
        turn['started_at'] = time.time()
        _emit(slot, turn, 'meta', {'state': 'running', 'turn_id': turn['turn_id']})

        from routes import pool_worker
        ok, err, net_err, usage = pool_worker.run_upstream(
            body, turn, lambda kind, data: _emit(slot, turn, kind, data))
        turn['usage'] = usage or {}
        if turn['cancel_evt'].is_set():
            # 非流式读取是阻塞的，取消在读取结束后生效：状态必须服从用户意图
            turn['state'] = 'cancelled'
            ok = True   # 主动取消不算失败（AIMD 不受用户停止影响）
        elif ok:
            turn['state'] = 'done'
        else:
            turn['state'] = 'failed'
            turn['error'] = str(err or net_err)[:500]
    except Exception as e:
        ok, err = False, str(e)
        turn['state'] = 'failed'
        turn['error'] = str(e)[:500]
        _emit(slot, turn, 'error', {'error': '池内部错误: %s' % e, 'status': 0, 'ok': False})
        print('[ChatPool] turn worker 异常: %s' % e)
    finally:
        if ticket:
            try:
                import chat_gate
                # error 传网络级失败优先（带 '<urlopen error' 前缀，闸门让道识别器认这个）
                chat_gate.release(ticket, ok=ok and not net_err, error=net_err or err)
            except Exception:
                pass
        _emit(slot, turn, 'done', {'state': turn['state'],
                                  'usage': turn.get('usage') or {},
                                  'net_err': bool(net_err),
                                  'superseded': bool(turn.get('superseded'))})
        _finish_turn(slot, turn)
        # 用量记账（前缀缓存观测数据）+ 缓存命中率观测 + Token 用量入库
        u = turn.get('usage') or {}
        try:
            import cache_watch
            _fp = cache_watch.prefix_fingerprint((body.get('_body') or {}))
            cache_watch.record_usage(slot.provider, slot.model, u,
                                     box_id=slot.box_id, fp=_fp)
        except Exception:
            pass
        try:
            import token_usage_stats
            token_usage_stats.record_token_usage(
                provider=slot.provider, model=slot.model, box_id=slot.box_id,
                prompt_tokens=u.get('prompt_tokens'),
                completion_tokens=u.get('completion_tokens'),
                cached_tokens=u.get('cached_tokens'))
        except Exception:
            pass
        try:
            with slot.lock:
                slot.stats['prompt_tokens'] += int(u.get('prompt_tokens') or 0)
                slot.stats['completion_tokens'] += int(u.get('completion_tokens') or 0)
                slot.stats['cached_tokens'] += int(u.get('cached_tokens') or 0)
                if net_err:
                    slot.stats['net_errors'] += 1
        except Exception:
            pass


def _emit(slot, turn, kind, data):
    """事件落缓冲；Turn 已被新 Turn 取代时静默丢弃（无人订阅）。"""
    with slot.lock:
        if slot.turn is not turn:
            return
    slot.emit(kind, data)


def _finish_turn(slot, turn):
    turn['ended_at'] = time.time()
    u = turn.get('usage') or {}
    failed = turn['state'] == 'failed'
    _log('error' if failed else 'info', turn['box'], 'pool-turn-done',
         'Turn %s %s | prompt=%s completion=%s cached=%s | err=%s'
         % (turn['turn_id'][-12:], turn['state'],
            u.get('prompt_tokens', '-'), u.get('completion_tokens', '-'),
            u.get('cached_tokens', '-'), (turn.get('error') or '')[:300]))


# ===== 只读快照（面板/状态接口用；小狗守卫/风筝本期不接，只留接口）=====

def active_snapshot():
    """轻量活跃快照：仅正在跑的 Turn（几百字节级）。"""
    cfg()
    now = time.time()
    with _POOL_LOCK:
        slots = list(_slots.values())
    out = []
    for s in slots:
        with s.lock:
            t = s.turn
            if not t or t.get('state') not in ('waiting', 'running'):
                continue
            out.append({
                'box': s.box_id, 'turn_id': t.get('turn_id'),
                'state': t.get('state'), 'provider': t.get('provider'),
                'model': t.get('model'), 'engine': t.get('engine'),
                'age': round(now - (t.get('created_at') or now), 1),
                'run_now': round(now - t['started_at'], 1) if t.get('started_at') else 0,
                'seq': s.next_seq - 1,
            })
    return {'ok': True, 'active': out, 'now': now}


def status_snapshot():
    """全池状态（含每槽用量统计与连接池视图）。"""
    c = cfg()
    now = time.time()
    with _POOL_LOCK:
        all_slots = list(_slots.items())
    slots_out = []
    for bid, s in all_slots:
        with s.lock:
            slots_out.append({
                'box': bid, 'engine': s.engine, 'provider': s.provider,
                'model': s.model, 'loop_mode': s.loop_mode,
                'turn': ({k: s.turn.get(k) for k in
                          ('turn_id', 'state', 'created_at', 'started_at', 'ended_at',
                           'error', 'usage')}
                         if s.turn else None),
                'events_buffered': len(s.events), 'next_seq': s.next_seq,
                'truncated': s._truncated,
                'last_active_age': round(now - s.last_active, 1),
                'stats': dict(s.stats),
            })
    try:
        import conn_pool
        cp = conn_pool.snapshot()
    except Exception:
        cp = {}
    # 缓存命中率观测（前缀缓存观测 v1.1）
    try:
        import cache_watch
        cw = cache_watch.snapshot()
    except Exception:
        cw = {}
    return {
        'ok': True, 'enabled': bool(c.get('enabled')),
        'slots': slots_out, 'slot_count': len(slots_out),
        'conn_pool': cp,
        'cache_watch': cw,
        'cfg': {k: v for k, v in c.items() if k != 'conn_pool'},
        'now': now,
    }


# ===== 后台清理 =====

def _bg_cleanup():
    while True:
        try:
            time.sleep(30)
            _cleanup_once()
        except Exception:
            pass


def _cleanup_once():
    """每 30s：①Turn 完结超 replay_keep → 擦除缓冲（对象池"擦除"语义）
    ②槽位闲置超 slot_idle_sec → 回收复用 ③连接池清空闲。"""
    c = cfg()
    now = time.time()
    replay_keep = float(c.get('replay_keep_sec', 600))
    idle_sec = float(c.get('slot_idle_sec', 1800))
    with _POOL_LOCK:
        box_ids = list(_slots.keys())
    for bid in box_ids:
        s = _slots.get(bid)
        if s is None:
            continue
        with s.cond:
            t = s.turn
            if t and t.get('state') in ('done', 'failed', 'cancelled') \
                    and t.get('ended_at') and now - t['ended_at'] > replay_keep:
                _turns.pop(t.get('turn_id', ''), None)
                s.events = []
                s._buffer_bytes = 0
                s.turn = None
            if s.turn is None and now - s.last_active > idle_sec:
                with _POOL_LOCK:
                    if _slots.get(bid) is s:
                        _slots.pop(bid, None)
    try:
        import conn_pool
        conn_pool.cleanup_idle()
    except Exception:
        pass


def _ensure_bg_thread():
    global _bg_started
    with _POOL_LOCK:
        if _bg_started:
            return
        _bg_started = True
    threading.Thread(target=_bg_cleanup, name='chat-pool-cleanup',
                     daemon=True).start()
