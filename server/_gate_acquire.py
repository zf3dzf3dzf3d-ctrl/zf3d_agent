# -*- coding: utf-8 -*-
# chat_gate 拆分分段模块：由原 chat_gate.py 按行段【无改动】切分，
# 由 chat_gate.py 门面加载后合并进同一命名空间（分段之间为隐式互相引用）。

# ---------------------------------------------------------------------------
# 对外主接口：许可（被 proxy / proxy_stream 调用，同步阻塞直到放行或拒绝）
# ---------------------------------------------------------------------------

def acquire(box_id, engine='', model='', entry='proxy', provider=''):
    """
    请求进入闸门。返回 ticket 字符串；被拒绝时 raise GateRejected(原因, http_code)。

    参数：
      box_id   : 对话框 ID（前端 _box_id），隔离与管控的最小单位
      engine   : 引擎 id（zf_core / claude_code_style / ...），监控展示
      model    : 模型名（截断存 60 字符），监控展示
      entry    : 'proxy' | 'proxy_stream'
      provider : v4 模型分组键（上游接口域名，如 open.bigmodel.cn）。
                 空 = 不分组走全池（兼容无 _target_url 的请求）。
    """
    global _seq
    _load_cfg()  # 热更新配置（含 lanes / auto 热调整）
    _ensure_lanes()

    with _gate_lock('_gate_acquire.py'):
        _seq += 1
        ticket = 'g%d-%d' % (int(time.time()), _seq)

    box_key = str(box_id or '未知对话')
    provider_key = str(provider or '')[:80]
    with _gate_lock('_gate_acquire.py'):
        prio = _prio_of(box_key)      # v4.5 惰性过期（空闲超10分钟自动降回普通）
        if prio > 0:
            _box_priority_ts[box_key] = time.time()   # 有请求即刷新保活
        lane = _lane_for(box_key, provider_key)   # 分组/全池粘性车道
    info = {
        'ticket': ticket, 'box': box_key, 'entry': entry, 'lane': lane,
        'provider': provider_key,
        'engine': str(engine or '-'), 'model': str(model or '')[:60],
        'state': 'queued',              # queued -> gapped -> running -> done/failed/rejected
        'priority': prio, 'held': False,  # v4.5 优先级档位 / 被档2让停标记
        'enqueued': time.time(), 'started': None, 'ended': None,
        'wait_s': None, 'run_s': None, 'error': '', 'queue_pos': 0,
    }

    # ① 检查全局开关与每对话策略（拒绝即刻返回，不入队）
    with _gate_lock('_gate_acquire.py'):
        if not _enabled:
            info['state'] = 'rejected'
            info['error'] = '闸门全局暂停中（面板可恢复）'
            info['ended'] = time.time()
            _record(info, final=True)
            raise GateRejected(info['error'], 503)
        rule = _box_rules.get(box_key)
        if rule is not None and not rule.get('allowed', True):
            info['state'] = 'rejected'
            info['error'] = '该对话已被管理员设置为【不通过】（面板可恢复）'
            info['ended'] = time.time()
            _record(info, final=True)
            raise GateRejected(info['error'], 403)

    # ①.5【报废车让道】近期网络级失败的对话先进入"应急休整区"（不占车道）：
    #     指数退避期间车道完全让给健康对话；HTTP 线程挂起等休息整还天然吸收
    #     前端 3 秒重试风暴（请求不失败返回，重试器就不会再发新单）。
    #     休整期间面板可暂停/禁用该对话（即时生效）；auto 关闭时跳过（旧行为）。
    if _auto_cfg.get('enabled'):
        hold_until = 0.0
        with _gate_lock('_gate_acquire.py'):
            nf = _box_net_fail.get(box_key)
            if nf and time.time() - nf[1] > _NET_FAIL_TTL:
                _box_net_fail.pop(box_key, None)   # 旧失败已过期，视为恢复
                nf = None
            if nf and nf[0] > 0:
                hold_until = nf[1] + _net_backoff(nf[0])
        if hold_until > time.time():
            info['state'] = 'holding'
            info['hold_left'] = round(hold_until - time.time(), 1)
            with _gate_lock('_gate_acquire.py'):
                _active[ticket] = info   # 面板/小狗守卫可见"应急休整中"
            print('[ChatGate][让道] 「%s」网络级失败×%d，应急休整 %.1fs 让出车道'
                  % (box_key, nf[0], hold_until - time.time()))
            while True:
                time.sleep(0.5)
                now = time.time()
                with _gate_lock('_gate_acquire.py'):
                    if not _enabled:
                        info['state'] = 'rejected'
                        info['error'] = '应急休整期间闸门被暂停（面板可恢复后重发）'
                        info['http_code'] = 503
                    else:
                        rule = _box_rules.get(box_key)
                        if rule is not None and not rule.get('allowed', True):
                            info['state'] = 'rejected'
                            info['error'] = '应急休整期间该对话被设置为【不通过】'
                            info['http_code'] = 403
                        else:
                            info['hold_left'] = round(max(0.0, hold_until - now), 1)
                    _rejected = info['state'] == 'rejected'
                if _rejected:
                    info['ended'] = time.time()
                    _record(info, final=True)
                    with _gate_lock('_gate_acquire.py'):
                        _active.pop(ticket, None)
                    raise GateRejected(info['error'], info['http_code'])
                if now >= hold_until:
                    break
            # 休整结束：脱离 holding（重新走正常排队流程），排队等待从现在起算
            with _gate_lock('_gate_acquire.py'):
                _active.pop(ticket, None)
            info['state'] = 'queued'
            info['enqueued'] = time.time()
            info['hold_left'] = 0.0

    # ② 进粘性车道排队（车道内串行放行）
    #    _evt/_done 必须在入队【前】注册好（竞态见 v3 注释）。
    #    缩扩容竞态：车道可能缺失/退役 → 循环头补建 + 加盐重哈希。
    #    v4.3 并发容量探测触发（入队时预触发，worker 满载时为强制点）：
    #    该模型组的真实通信数达到钳制值且从未探测过 → 后台静默探测。
    if provider_key and _auto_cfg.get('provider_group'):
        try:
            with _gate_lock('_gate_acquire.py'):
                grp_running = sum(1 for i in _active.values()
                                  if i.get('state') == 'running'
                                  and i.get('provider') == provider_key)
                cap_now = get_max_parallel(provider_key)
                # v4.4：条件改为「探测结果不新鲜」→ 未探测/已过期/上次失败都能重测
                if grp_running >= cap_now and not is_probe_fresh(provider_key):
                    start_probe(provider_key)
        except Exception:
            pass
    for _attempt in range(3):
        _ensure_lanes()
        with _gate_lock('_gate_acquire.py'):
            q = _lane_queues.get(lane)
            if q is not None and _lane_gen.get(lane, -1) == 0:
                done_evt = threading.Event()
                info['_evt'] = done_evt      # worker 完成放行/放弃时 set
                info['_done'] = threading.Event()  # release() 归还许可时 set（worker 等）
                _active[ticket] = info
                _refresh_queue_positions(lane)
                q.put((ticket, lane))
                break
            # 车道失效 → 加盐重哈希到 1~lanes（保可用性优先：极端竞态下
            # 允许临时借道其它分组的车道，也绝不误拒请求）
            live = max(1, _lanes)
            lane = int(hashlib.md5(('%s#g%d' % (box_key, _attempt)
                                   ).encode('utf-8')).hexdigest(), 16) % live + 1
            info['lane'] = lane
    else:
        raise GateRejected('闸门车道调度异常，请重试', 503)

    # ③ 同步等待放行（HTTP 线程在此阻塞——车道内串行本体）
    # 【v4.7 抗挂死】等待上限 = 车道强制回收超时(_RUN_TIMEOUT) + 60s 缓冲。
    # 车道 worker 自身会在 _RUN_TIMEOUT 强制回收卡死票并放行；此处再加一道兜底：
    # 若 worker 线程已死等极端情况下票据永远无人放行，不让 HTTP 线程无限挂起
    # （此前表现为：锁/车道异常期间，创建面板的延迟测试与发消息请求永远转圈）。
    if not done_evt.wait(timeout=_RUN_TIMEOUT + 60):
        try:
            force_recover(ticket, reason='排队超时：车道异常未放行，闸门兜底回收')
        except Exception:
            pass
        raise GateRejected('排队等待超时（车道异常），请稍后重试', 503)
    with _gate_lock('_gate_acquire.py'):
        st = info['state']
    if st == 'rejected':
        raise GateRejected(info.get('error', '被闸门拒绝'), info.get('http_code', 503))
    return ticket


def force_recover(ticket, reason='主脑自动处置'):
    """v4.6 供主脑/面板强制回收一张卡死票（等效车道 worker 的超时强制回收路径）。
    返回 True=已回收；False=票不存在或已结束。"""
    with _gate_lock('_gate_acquire.py'):
        info = _active.pop(ticket, None)
        if info is None:
            return False
        info.pop('_evt', None)
        done_evt = info.pop('_done', None)
        info['ended'] = time.time()
        info['state'] = 'failed'
        info['error'] = str(reason)[:300]
        if info.get('started'):
            info['run_s'] = round(info['ended'] - info['started'], 2)
        _record(info, final=True)
        lane = info.get('lane')
        box = info.get('box')
    if done_evt:
        done_evt.set()   # 唤醒车道 worker 取下一张票 / HTTP 线程收到失败
    _note_result(lane, False, info.get('run_s'))
    print('[ChatGate][强制回收] %s（%s，box=%s）' % (ticket, reason, box))
    return True


def release(ticket, ok=True, error=''):
    """请求结束（上游响应已返回/出错），归还许可并落监控。必须与 acquire 配对。
    v4：同时向 AIMD 反馈本次结果（成败/耗时）驱动自适应松紧。"""
    with _gate_lock('_gate_acquire.py'):
        info = _active.pop(ticket, None)
        done_evt = info.pop('_done', None) if info else None
    if info is None:
        return
    info['ended'] = time.time()
    info['state'] = 'done' if ok else 'failed'
    if error:
        info['error'] = str(error)[:300]
    if info.get('started'):
        info['run_s'] = round(info['ended'] - info['started'], 2)
    # v4.2 报废车让道记账：网络级失败 → 该对话进入应急退避（下次请求休整让道）；
    # 成功 → 信用恢复清零。仅 auto 开启时启用（手动模式保持旧行为）。
    if _auto_cfg.get('enabled'):
        if not ok and _is_net_error(error):
            with _gate_lock('_gate_acquire.py'):
                rec = _box_net_fail.setdefault(info['box'], [0, 0.0])
                rec[0] += 1
                rec[1] = time.time()
                print('[ChatGate][让道] 「%s」网络级失败×%d，下次请求将休整 %.0fs 让道'
                      % (info['box'], rec[0], _net_backoff(rec[0])))
        elif ok:
            with _gate_lock('_gate_acquire.py'):
                if info['box'] in _box_net_fail:
                    _box_net_fail.pop(info['box'], None)
    # v4.5 档2让道保持：档2票跑完给该 provider 一小段独占保持期，
    # 防多轮 Agent 循环的下一次请求间隙被普通对话钻空抢跑。
    if (info.get('priority') or 0) >= 2:
        with _gate_lock('_gate_acquire.py'):
            _prio_hold_until[info.get('provider') or ''] = time.time() + _PRIO_GRACE
        print('[ChatGate][优先级] 「%s」档2跑完，同模型让道保持 %.0fs'
              % (info.get('box'), _PRIO_GRACE))
    _record(info, final=True)
    _note_result(info.get('lane'), ok, info.get('run_s'), error=info.get('error', ''))
    if done_evt:
        done_evt.set()


class GateRejected(Exception):
    """闸门拒绝。http_code: 403=对话被禁 503=全局暂停/调度异常"""
    def __init__(self, msg, http_code=503):
        super(GateRejected, self).__init__(msg)
        self.http_code = http_code


# ---------------------------------------------------------------------------
# 车道 worker：每车道一个，串行放行 + 车道独立间隔（v4 间隔自适应）
# ---------------------------------------------------------------------------

