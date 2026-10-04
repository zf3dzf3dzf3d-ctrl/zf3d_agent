# -*- coding: utf-8 -*-
# chat_gate 拆分分段模块：由原 chat_gate.py 按行段【无改动】切分，
# 由 chat_gate.py 门面加载后合并进同一命名空间（分段之间为隐式互相引用）。
def _eff_gap(lane):
    """v4 该车道当前有效放行间隔 = 基准 gap × AIMD 倍数。
    收紧态（mult>1）保证至少 0.1×mult 秒的真实隔离——否则用户把基准 gap
    调成 0（极限通畅）时 0×任何倍数=0，失败退避将完全失效。"""
    mult = _lane_gap_mult.get(lane, 1.0)
    g = _gap * mult
    if mult > 1.005:
        g = max(g, 0.1 * mult)
    return g


def _prio_providers_locked():
    """v4.5 当前优先级活动状态（调用方需持锁）：
    返回 (档1活动 provider 集, 让停 provider 集)。
    档1活动 = 存在档1票处于 queued/gapped/running（同模型普通票据此减速）；
    让停   = 存在档2票处于 queued/gapped/running，或该 provider 处于档2
    跑完后的让道保持期 _prio_hold_until（同模型普通票据此完全让停）。"""
    now = time.time()
    t1_active, t2_active = set(), set()
    for i in _active.values():
        pr = i.get('priority') or 0
        if pr <= 0:
            continue
        if i.get('state') not in ('queued', 'gapped', 'running'):
            continue
        p = i.get('provider') or ''
        if pr >= 2:
            t2_active.add(p)
        else:
            t1_active.add(p)
    held = set(t2_active)
    for p, until in _prio_hold_until.items():
        if now < until:
            held.add(p)
    return t1_active, held


def _pick_ticket_locked(lane):
    """v4.5 优先级选票（调用方需持锁）：从本车道排队票中选出下一张放行的票。
    规则（作用域=同一个大模型，不同大模型互不影响）：
      ① 让停过滤：普通票/档1票的 provider 在让停集中 → 不可选（held=True）；
      ② 排序：优先级降序 → 入队时间升序（同档先来先跑）。
    无可选票返回 None（worker 空转，等下次唤醒或每秒兜底重扫）。"""
    _t1_active, held_providers = _prio_providers_locked()
    cands = [i for i in _active.values()
             if i.get('state') == 'queued' and i.get('lane') == lane]
    elig = []
    for i in cands:
        p = i.get('provider') or ''
        pr = i.get('priority') or 0
        is_held = pr < 2 and p in held_providers
        i['held'] = is_held          # 展示标记（面板/守卫可见"让道等待"）
        if not is_held:
            elig.append(i)
    if not elig:
        return None
    elig.sort(key=lambda x: (-(x.get('priority') or 0), x.get('enqueued') or 0))
    return elig[0]


def _lane_worker_loop(lane):
    """
    单车道真串行主循环：选票（v4.5 优先级）→ 间隔等待（v4：按该车道 AIMD 倍数
    收紧）→ 放行 → 阻塞等 release() 归还许可 → 取下一张票。
    放行后 _RUN_TIMEOUT 未归还则强制回收。
    v4.5：queue 仅作"有新票"唤醒信号，真正跑哪张由 _pick_ticket_locked 按
    （优先级降序, 入队时间升序）从本车道排队票中选；被档2让停的普通票留在
    逻辑队列里不跑（state 仍 queued，面板/守卫可见 held 标记）。
    """
    last_end = 0.0
    while True:
        try:
            _lane_queues[lane].get(timeout=1.0)   # 唤醒信号（票面内容不使用）
        except queue.Empty:
            # 每秒兜底重扫（覆盖"逻辑排队但唤醒名额被优先票占用"的滞留票）。
            # 退役判定必须同时看逻辑残留：优先级选票下"唤醒票被顶替"后，
            # 物理队列空≠没有未跑的票，直接退出会丢请求（v3 语义不再成立）。
            with _gate_lock('_gate_worker.py'):
                _residual = any(i.get('state') == 'queued'
                                and i.get('lane') == lane
                                for i in _active.values())
            if _lane_gen.get(lane, -1) == -1 and not _residual:
                # 已退役且无残留 → 退出
                with _gate_lock('_gate_worker.py'):
                    _lane_workers.pop(lane, None)
                    _lane_queues.pop(lane, None)
                    _lane_last_end.pop(lane, None)
                    _lane_gen.pop(lane, None)
                print('[ChatGate] 车道 %d worker 已退役退出' % lane)
                return
            # 注意：这里【不能 continue】——超时后必须落到底部重扫，
            # 否则滞留票（唤醒名额被优先票顶替）在物理队列空了之后永远没人捞。
        with _gate_lock('_gate_worker.py'):
            info = _pick_ticket_locked(lane)
            if info is None:
                continue
            ticket = info['ticket']
            # ① 车道间隔：v4 有效间隔 = 基准 gap × 本车道 AIMD 收紧倍数
            eff_gap = _eff_gap(lane)
            # v4.5 档1减速：普通票且其 provider 有档1票活动 → 放行间隔 ×3。
            # 下限 0.3s：用户把基准 gap 调成 0 时 0×3=0，减速会完全失效。
            if (info.get('priority') or 0) < 1:
                _t1_active, _held = _prio_providers_locked()
                if (info.get('provider') or '') in _t1_active:
                    eff_gap = max(eff_gap * _PRIO_DECEL_MULT, 0.1 * _PRIO_DECEL_MULT)
            wait_more = eff_gap - (time.time() - last_end) if last_end > 0 else 0.0
            if wait_more > 0:
                info['state'] = 'gapped'   # 间隔等待中（面板可见）
        try:
            if wait_more > 0:
                time.sleep(wait_more)
        except Exception:
            pass
        # ② 放行前复查开关/策略（排队+间隔期间可能被面板改了）
        # 【v4.7.2 致命修复】此前本锁块一直延伸到 evt/done_evt 取值处，把
        # "满载让位等待"的 time.sleep(0.3)×最长120s 也包在全局锁内——模型分组
        # 一旦满载，车道 worker 就抱着 _LOCK 睡一两分钟，全系统（面板/发消息/
        # 状态查询/主脑）全部陪葬。这就是"经常卡住、偶尔通行"的真正根因。
        # 现在锁只包住真正的检查/占位瞬间，一切 sleep 都在锁外。
        _do_continue = False
        with _gate_lock('_gate_worker.py'):
            info = _active.get(ticket)
            if info is None:
                _do_continue = True
            else:
                http_code = 503
                if not _enabled:
                    info['state'] = 'rejected'
                    info['error'] = '排队期间闸门被暂停（面板可恢复后重发）'
                else:
                    rule = _box_rules.get(info['box'])
                    if rule is not None and not rule.get('allowed', True):
                        info['state'] = 'rejected'
                        info['error'] = '排队期间该对话被设置为【不通过】'
                        http_code = 403
                if info['state'] == 'rejected':
                    info['ended'] = time.time()
                    info['wait_s'] = round(info['ended'] - info['enqueued'], 2)
                    info['http_code'] = http_code
                    evt = info.pop('_evt', None)
                    info.pop('_done', None)
                    _record(info, final=True)
                    _active.pop(ticket, None)
                    _refresh_queue_positions(lane)
                    if evt:
                        evt.set()   # HTTP 线程醒来收到 GateRejected
                    _do_continue = True
        if _do_continue:
            last_end = time.time()
            with _gate_lock('_gate_worker.py'):
                _lane_last_end[lane] = last_end
            continue
        # ===== 放行：此刻起该请求在本车道独占上游通道 =====
        # v4.3 组容量钳制：该请求所属模型组的 running 已达 max_parallel
        # → 暂不放行（票留在本车道队首），0.3s 后重查；组内任意一张
        # release 立即腾出名额。这是"并行不超容量"的强制点。
        # 【占位原子性】检查通过后必须在【同一把锁内】立即把 state 置为
        # running 占位——否则三条车道 worker 同时过检再各自标记，会超发。
        _prov_of_ticket = info.get('provider') or ''
        if _prov_of_ticket and _auto_cfg.get('provider_group'):
            _waited = 0.0
            while True:
                _placed = False
                with _gate_lock('_gate_worker.py'):
                    if _active.get(ticket) is None:
                        info = None
                        break
                    cap = get_max_parallel(_prov_of_ticket)
                    if cap <= 0:
                        _placed = True
                        break
                    grp_running = sum(1 for i in _active.values()
                                      if i.get('state') == 'running'
                                      and i.get('provider') == _prov_of_ticket)
                    if grp_running < cap:
                        info['state'] = 'running'   # 持锁占位（原子）
                        info['started'] = time.time()
                        _placed = True
                        break
                if _placed or info is None:
                    break
                # 满载：先触发一次性探测（未测过时），再让位等待（锁外！）
                try:
                    if _prov_of_ticket not in _provider_max_parallel:
                        start_probe(_prov_of_ticket)
                except Exception:
                    pass
                time.sleep(0.3)
                _waited += 0.3
                if _waited > 120:
                    break   # 极端兜底：等了2分钟强制放行（宁可超限不饿死）
            if info is None:
                continue
        # 放行成功后触发探测：组内【全部车道满载】即触发（未探测时）。
        # 触发条件必须取 min(容量, 组车道数)——分组模式下组车道数可能
        # 小于默认容量(4)，若只看容量则永远够不着（车道物理并行先到顶）。
        if _prov_of_ticket and info is not None:
            try:
                with _gate_lock('_gate_worker.py'):
                    _cap_now = get_max_parallel(_prov_of_ticket)
                    _grp_now = sum(1 for i in _active.values()
                                   if i.get('state') == 'running'
                                   and i.get('provider') == _prov_of_ticket)
                    _grp_lanes = _provider_lane_count(_prov_of_ticket, time.time())
                if _grp_now >= min(_cap_now, _grp_lanes) \
                        and _prov_of_ticket not in _provider_max_parallel:
                    start_probe(_prov_of_ticket)
            except Exception:
                pass
        with _gate_lock('_gate_worker.py'):
            info['state'] = 'running'
            info['started'] = time.time()
            info['wait_s'] = round(info['started'] - info['enqueued'], 2)
            info['queue_pos'] = 0
            _refresh_queue_positions(lane)
            evt = info.get('_evt')
            done_evt = info.get('_done')
        if evt:
            evt.set()   # HTTP 线程醒来去连上游
        # ③ 车道内真串行核心：阻塞等该请求 release() 归还许可
        finished = done_evt.wait(timeout=_RUN_TIMEOUT)
        last_end = time.time()
        with _gate_lock('_gate_worker.py'):
            _lane_last_end[lane] = last_end
        if not finished:
            # 超时强制回收：单个挂死请求不能堵死整条车道；同时向 AIMD 记失败
            with _gate_lock('_gate_worker.py'):
                info = _active.pop(ticket, None)
                if info is not None:
                    info.pop('_evt', None)
                    info.pop('_done', None)
                    info['ended'] = time.time()
                    info['state'] = 'failed'
                    info['error'] = '运行超过 %d 分钟未归还许可，闸门强制回收' % (_RUN_TIMEOUT // 60)
                    if info.get('started'):
                        info['run_s'] = round(info['ended'] - info['started'], 2)
                    _record(info, final=True)
            if info is not None:
                print('[ChatGate] %s 车道%d 运行超时未归还许可，已强制回收（box=%s）'
                      % (ticket, lane, info.get('box')))
                _note_result(lane, False, None)


# ---------------------------------------------------------------------------
# v4 AIMD 自适应：单车道间隔收紧/回落 + 全局车道数收缩/回升
# ---------------------------------------------------------------------------

def _slow_by_history(lane, run_s):
    """run_s 超过该车道滚动中位数 × slow_mult → 判定"响应变慢"（样本≥5 才判）。"""
    hist = _lane_run_hist.get(lane) or []
    if len(hist) < 5 or not run_s:
        return False
    s = sorted(hist)
    med = s[len(s) // 2]
    return med > 0 and run_s > _auto_cfg.get('slow_mult', 2.5) * med


def _note_result(lane, ok, run_s, error=''):
    """v4 核心：把每次请求结果反馈给自适应器（acquire/release 之外只读状态）。
    AIMD——失败×2 / 变慢×1.5 / 成功×0.75（下限 1.0 上限 max_gap_mult）。
    【v4.7】非拥塞类失败（余额402/鉴权401/参数400等，非网络错误）不收紧——
    它们不代表上游过载，此前 402 连续触发 ×2 连乘把车道逼到 16 倍(32s)间隔，
    上游恢复后又因成功样本稀疏恢复极慢，表现为"比以前卡很多"。"""
    if lane is None:
        return
    with _gate_lock('_gate_worker.py'):
        if _auto_cfg.get('enabled'):
            mult = _lane_gap_mult.get(lane, 1.0)
            slow = _slow_by_history(lane, run_s) if ok else False
            if not ok:
                if error and not _is_net_error(error):
                    pass    # 业务类失败：不动 AIMD（不收紧也不放松）
                else:
                    mult = min(float(_auto_cfg.get('max_gap_mult', 16.0)), mult * 2.0)
            elif slow:
                mult = min(float(_auto_cfg.get('max_gap_mult', 16.0)), mult * 1.5)
            else:
                mult = max(1.0, mult * (0.5 if mult > 2.0 else 0.75))
            _lane_gap_mult[lane] = mult
            if slow:
                print('[ChatGate][auto] 车道%d 响应变慢(%.1fs>中位数×%.1f)，间隔收紧至×%.1f'
                      % (lane, run_s, _auto_cfg.get('slow_mult', 2.5), mult))
        if run_s:
            h = _lane_run_hist.setdefault(lane, [])
            h.append(float(run_s))
            if len(h) > 20:
                del h[:len(h) - 20]
        # 全局窗口（车道数自适应依据；auto 关闭时不收集）
        if _auto_cfg.get('enabled'):
            _global_hist.append(bool(ok))   # 只存成败布尔（曾存(ok,ts)元组导致
            # 按元组恒真统计 fails 永远=0，只升不降——v4 收口修复）
            if len(_global_hist) > _GLOBAL_HIST_MAX:
                del _global_hist[:len(_global_hist) - _GLOBAL_HIST_MAX]
    _maybe_adjust_lanes()


def _maybe_adjust_lanes():
    """v4 全局车道数自适应：失败潮收缩 / 健康潮回升（冷却防振荡，仅内存不写盘）。"""
    global _last_lane_adjust
    if not _auto_cfg.get('enabled'):
        return
    now = time.time()
    if now - _last_lane_adjust < _LANE_ADJUST_COOLDOWN:
        return
    with _gate_lock('_gate_worker.py'):
        n = len(_global_hist)
        if n < 10:
            return
        fails = sum(1 for ok in _global_hist if not ok)
        ratio = fails / float(n)
        lo = max(1, int(_auto_cfg.get('min_lanes', 2)))
        hi = max(lo, int(_auto_cfg.get('max_lanes', 6)))
        old, target = _lanes, None
        if ratio > 0.5 and _lanes > lo:
            target = _lanes - 1
        elif n >= 20 and ratio < 0.1 and _lanes < hi:
            target = _lanes + 1
    if target is not None:
        _set_lanes_inmem(target)
        _last_lane_adjust = now
        print('[ChatGate][auto] 车道数自适应 %d → %d（近%d次失败率 %.0f%%）'
              % (old, target, n, ratio * 100))


def _set_lanes_inmem(n):
    """auto 内部调车道数：只改内存不落盘（重启后仍从配置 lanes 起步）。"""
    global _lanes
    n = max(1, min(16, int(n)))
    with _gate_lock('_gate_worker.py'):
        if n == _lanes:
            return
        _lanes = n
    _retire_overflow_lanes()
    _ensure_lanes()


# ---------------------------------------------------------------------------
# 监控与统计（内部）
# ---------------------------------------------------------------------------

def _refresh_queue_positions(lane=None):
    """给指定车道（None=全部车道）排队中的请求编号。调用方需持锁。
    v4.5：位次按（优先级降序, 入队时间升序）——与 _pick_ticket_locked 的
    实际选票顺序一致，面板/守卫显示的"第N位"就是真实放行顺序。"""
    for l, q in _lane_queues.items():
        if lane is not None and l != lane:
            continue
        waiting = sorted([i for i in _active.values()
                          if i.get('state') == 'queued' and i.get('lane') == l],
                         key=lambda x: (-(x.get('priority') or 0),
                                        x.get('enqueued', 0)))
        for pos, i in enumerate(waiting, 1):
            i['queue_pos'] = pos


def _record(info, final=False):
    """写历史与统计。final=True 时从 _active 摘除并进 history。"""
    with _gate_lock('_gate_worker.py'):
        if final:
            _history.append({k: v for k, v in info.items()
                             if k not in ('_evt', '_done')})
            if len(_history) > _MAX_HISTORY:
                del _history[:len(_history) - _MAX_HISTORY]
            st = _box_stats.setdefault(info['box'], {
                'total': 0, 'ok': 0, 'fail': 0, 'rejected': 0, 'last': 0})
            st['total'] += 1
            if info['state'] == 'done':
                st['ok'] += 1
            elif info['state'] == 'failed':
                st['fail'] += 1
                # v4.7 记录最近失败明细，供主脑 chat_health 事件直接定位修复
                st['last_fail_ts'] = time.time()
                st['last_fail_ticket'] = info.get('ticket', '')
                st['last_fail_err'] = str(info.get('error') or info.get('msg') or info.get('reason') or '未知错误')[:300]
            elif info['state'] == 'rejected':
                st['rejected'] += 1
            st['last'] = time.time()


# ---------------------------------------------------------------------------
# 管理 API 支持（被 routes/mixin_gate.py 调用）
# ---------------------------------------------------------------------------

def status_snapshot():
    """面板轮询：全局状态 + 模型分组 + 各车道状态（含自适应收紧）+ 历史与统计。
    【v4.7 抗锁卡死】锁 3 秒拿不到就返回 stale 标记的降级快照，绝不让面板轮询挂死
    （此前锁被异常持有期间，token 统计/概览面板等全部打不开）。"""
    _load_cfg()
    now = time.time()
    if not _LOCK.acquire(timeout=3.0):
        return {'ok': True, 'stale': True, 'gate_busy': True, 'lanes_detail': [],
                'queue_len': -1, 'running': -1, 'active': [], 'history': [],
                'boxes': [], 'provider_groups': [], 'probe': {}, 'now': now}
    try:
        # v4 模型分组视图（v4.3：与 active_snapshot 共用，含每模型并发容量）
        groups = _provider_groups_view(now)
        # 车道总览（含 v4 收紧倍数/健康状态）
        lanes_detail = []
        for l in sorted(k for k in _lane_queues.keys() if 1 <= k <= _lanes):
            retired = _lane_gen.get(l, 0) != 0
            if retired:
                continue  # 退役车道不计入车道总览
            mult = _lane_gap_mult.get(l, 1.0)
            eff = _eff_gap(l)
            lanes_detail.append({
                'lane': l, 'retired': retired, 'gap_mult': round(mult, 2),
                'eff_gap': round(eff, 2),
                'health': 'retired' if retired else ('收紧' if mult > 1.005 else '正常'),
                'last_end': _lane_last_end.get(l, 0.0),
                'gap_left': round(max(0.0, eff - (now - _lane_last_end[l])), 1)
                if _lane_last_end.get(l, 0.0) > 0 and not retired else 0.0,
            })
        active_list = []
        for i in sorted(_active.values(),
                        key=lambda x: (x.get('lane', 0), x.get('enqueued', 0), x.get('ticket'))):
            d = {k: v for k, v in i.items() if k not in ('_evt', '_done')}
            if d['state'] == 'queued':
                d['wait_now'] = round(now - d['enqueued'], 1)
            elif d['state'] == 'running' and d.get('started'):
                d['run_now'] = round(now - d['started'], 1)
            elif d['state'] == 'holding':
                d['hold_left'] = round(max(0.0, d.get('hold_left', 0)), 1)
            elif d['state'] == 'gapped':
                base = _lane_last_end.get(d.get('lane'), 0.0)
                d['gap_left'] = round(max(0.0, _eff_gap(d.get('lane'))
                                          - (now - base)), 1) if base > 0 else 0.0
            active_list.append(d)
        history = [h for h in _history[-50:]]
        history.reverse()  # 最新在前
        boxes = []
        for box, st in sorted(_box_stats.items(), key=lambda kv: -kv[1]['total']):
            rule = _box_rules.get(box, {})
            boxes.append({'box': box, 'allowed': rule.get('allowed', True),
                          'note': rule.get('note', ''),
                          'priority': _prio_of(box), **st})
        running = sum(1 for i in active_list if i['state'] == 'running')
        return {
            'ok': True,
            'enabled': _enabled,
            'gap': _gap,
            'lanes': _lanes,
            'auto': dict(_auto_cfg),
            'provider_groups': groups,
            'probe': probe_snapshot(),
            'lanes_detail': lanes_detail,
            'queue_len': sum(1 for i in active_list if i['state'] in ('queued', 'gapped')),
            'running': running,
            'active': active_list,
            'history': history,
            'boxes': boxes,
            'now': now,
        }
    finally:
        _LOCK.release()


def _provider_lane_count(provider_key, now):
    """v4.3 该模型组当前分到的车道数（分组瓜分算法与 _lane_for 一致）。"""
    active = sorted([p for p, ts in _provider_last_seen.items()
                     if now - ts < _PROVIDER_TTL])
    n = len(active)
    if n <= 1:
        return _lanes
    if provider_key not in active:
        return 0
    idx = active.index(provider_key)
    return sum(1 for lane in range(1, _lanes + 1) if (lane - 1) % n == idx)


def _provider_groups_view(now):
    """v4.2 模型分组视图（status/active 快照共用）：
    活跃模型按域名 round-robin 瓜分互不相交的车道组；仅一家活跃时不分组。"""
    active = sorted([p for p, ts in _provider_last_seen.items()
                     if now - ts < _PROVIDER_TTL])
    n = len(active)
    if not (n > 1 and _auto_cfg.get('provider_group')):
        return []
    out = []
    for i, p in enumerate(active):
        lanes_of = [lane for lane in range(1, _lanes + 1)
                    if (lane - 1) % n == i]
        out.append({'provider': p, 'lanes': lanes_of,
                    'max_parallel': get_max_parallel(p),
                    'ago': round(now - _provider_last_seen[p])})
    return out


def _lanes_health_view(now):
    """v4.6 车道健康俯视：每条车道 [状态, 该道排队数, AIMD 收紧倍数]。
    status: idle=空闲 / run=通行 / q=有排队 / tight=被减速（gap_mult>1.2）。
    风筝概览车道条直接渲染，一眼看出哪条道堵/哪条道被收紧。"""
    rows = []
    with _gate_lock('_gate_worker.py'):
        for lane in range(1, _lanes + 1):
            cnt = {'running': 0, 'queued': 0}
            longest = 0.0
            for i in _active.values():
                if i.get('lane') != lane:
                    continue
                st = i.get('state')
                if st in cnt:
                    cnt[st] += 1
                if st in ('queued', 'gapped'):
                    longest = max(longest, now - i.get('enqueued', now))
            mult = float(_lane_gap_mult.get(lane, 1.0))
            status = 'idle'
            if cnt['running']:
                status = 'run'
            if cnt['queued']:
                status = 'q'
            if mult > 1.2:
                status = 'tight'
            rows.append({'lane': lane, 'status': status,
                         'queue': cnt['queued'], 'gap_mult': round(mult, 2),
                         'longest_wait': round(longest, 1),
                         'running': cnt['running'],
                         'active': cnt['running'] + cnt['queued']})
    return rows


def active_snapshot():
    """v4.1 轻量快照：仅当前活跃票据（小狗守卫红绿灯联动轮询专用，
    不含历史/统计，响应体只有几百字节）。每张票带：
    state（queued=红灯排队 gapped=红灯间隔 running=绿灯放行 holding=应急休整）、
    run_now（绿灯已跑秒数）、wait_now（红灯已等秒数）、queue_pos（车道内排位）。
    v4.2 增补：模型分组视图 + 自适应车道上下限（风筝龙概览显示用）。
    v4.5 增补：每票带 priority（优先级档位）/held（被档2让停），
    顶层带 priorities（当前设了优先级的对话及距自动降回秒数）。"""
    _load_cfg()
    now = time.time()
    if not _LOCK.acquire(timeout=3.0):
        return {'ok': True, 'stale': True, 'gate_busy': True, 'enabled': _enabled,
                'lanes': _lanes, 'active': [], 'running': -1, 'queue_len': -1,
                'now': now}
    try:
        out = []
        for i in sorted(_active.values(),
                        key=lambda x: (x.get('lane', 0), x.get('enqueued', 0))):
            d = {k: i.get(k) for k in ('ticket', 'box', 'provider', 'entry',
                                       'lane', 'state', 'queue_pos',
                                       'priority', 'held')}
            if i['state'] in ('queued', 'gapped'):
                d['wait_now'] = round(now - i['enqueued'], 1)
            elif i['state'] == 'running' and i.get('started'):
                d['run_now'] = round(now - i['started'], 1)
            elif i['state'] == 'holding':
                d['hold_left'] = round(max(0.0, i.get('hold_left', 0)), 1)
            out.append(d)
        return {'ok': True, 'enabled': _enabled, 'lanes': _lanes,
                'auto_min_lanes': max(1, int(_auto_cfg.get('min_lanes', 2))),
                'auto_max_lanes': max(1, int(_auto_cfg.get('max_lanes', 6))),
                'provider_groups': _provider_groups_view(now),
                'probe': probe_snapshot(),
                'priorities': priorities_view(now),
                'lanes_health': _lanes_health_view(now),
                'running': sum(1 for d in out if d['state'] == 'running'),
                'queue_len': sum(1 for d in out if d['state'] in ('queued', 'gapped')),
                'active': out, 'now': now}
    finally:
        _LOCK.release()


