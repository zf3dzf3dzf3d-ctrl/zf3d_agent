# -*- coding: utf-8 -*-
"""
对话闸门 chat_gate v4 —— 模型分组多车道 + AIMD 自适应调度（所有大模型请求的唯一闸门）
================================================================
需求演进：
  v2：单车道真串行（"给大模型前面加高架桥，避免全部拥堵导致全部卡死"）
  v3：多车道 + 粘性哈希（"如何让 10 个对话同时更好地利用这些车道？"）
  v3.1：收口修复（车道编号 1 基统一、重哈希加盐、僵尸车道复活、整体持锁防双 worker）
  v4（2026-09-09）："网络响应好就更通畅，响应不好就收紧；按不同的大模型排列和排队"
    - ① 模型分组：按接口域名把活跃模型瓜分到互不相交的车道组（智谱/火山方舟
      各走各的车道，一家抽风只堵自己的组）；同对话在组内粘性，回复顺序不变。
    - ② AIMD 自适应（学 TCP 拥塞控制）：请求失败 → 该车道放行间隔指数退避
      （×2）；响应变慢（超该车道滚动中位数 slow_mult 倍）→ 轻度收紧（×1.5）；
      成功 → 间隔向基准回落（×0.75）。好→通畅，差→收紧，自动恢复。
    - ③ 车道数自适应：全局失败潮 → 车道数收缩到下限（断网风暴保护）；
      持续健康 → 回升到上限。冷却 60s 防振荡，仅内存生效不写盘。
    - ④ 兼容：provider 传空或 auto.provider_group=false 时退化为 v3.1 全池行为；
      旧 chat_gate.json 无 auto 段时用默认值。
  v4.5（2026-09-09）：对话优先级两档（作用域=同一个大模型，不同大模型不参与）：
    用户原话："第一档他加速其他减速，第二档他加速其他停止给他让道"
    - 档1 加速⚡：插队优先放行；同模型普通票放行间隔×3（减速）。
    - 档2 让道⚡：插队优先放行；同模型普通票完全让停（跑不出去），档2跑完后
      另有 20 秒独占保持期（防多轮 Agent 循环的请求间隙被普通对话钻空抢跑）。
    - 空闲 10 分钟自动降回普通（每次请求刷新保活）；仅内存生效（重启回普通）。
    - 控制入口：POST /api/gate/control {action:'set_priority', box, tier}；
      前端对话框头部 ⚡ 按钮循环切换。票面带 info['priority']，
      被让停的普通票带 info['held']=True（面板/小狗守卫可见）。

接入点（全项目仅两处，均经本闸门）：
  - routes/mixin_proxy.py        /api/proxy + /api/proxy_stream（gate 层统一入口）
面板：/gate-panel.html  控制 API：POST /api/gate/control
"""

import hashlib
import json
import os
import queue
import threading
import time

# ===== 持久化配置路径（server/private/chat_gate.json）=====
_GATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'private')
_GATE_CFG = os.path.join(_GATE_DIR, 'chat_gate.json')

_LOCK = threading.RLock()

# ===== 配置（持久化）=====
_enabled = True      # False = 闸门暂停：新请求直接 503 拒绝
_gap = 2.0           # 同车道相邻两次"连上游"的最小间隔基准（秒）
_lanes = 3           # 车道数（1~16）：每条车道独立串行，车道间并行
_cfg_mtime = 0.0

# ===== v4 自适应配置（持久化于 chat_gate.json 的 auto 段）=====
_AUTO_DEFAULTS = {
    'enabled': True,          # 总开关：False 时 gap/车道数全部固定（纯手动模式）
    'provider_group': True,   # 按接口域名分组瓜分车道（False = 全池 v3 行为）
    'min_lanes': 2,           # 车道数自适应下限
    'max_lanes': 6,           # 车道数自适应上限
    'max_gap_mult': 16.0,     # 单车道间隔退避上限倍数（gap×mult，16 → 0.2s 基准最长 3.2s）
    'slow_mult': 2.5,         # run_s 超过该车道滚动中位数 × slow_mult 视为"变慢"
}
_auto_cfg = dict(_AUTO_DEFAULTS)

# ===== 车道注册表 =====
_lane_workers = {}    # lane -> Thread
_lane_queues = {}     # lane -> queue.Queue
_lane_last_end = {}   # lane -> float（该车道上一个请求结束/强制回收的时刻）
_lane_gen = {}        # lane -> 代数；缩容时置 -1，worker 空闲且代数不符则退出
_lane_gap_mult = {}   # lane -> float（v4 AIMD 间隔倍数，1.0 = 不收紧）
_lane_run_hist = {}   # lane -> [run_s,...]（v4 最近 20 次运行时长，算慢速基线）

# 放行后超过该秒数仍未 release()，车道 worker 强制回收许可（防单请求挂死堵车道）
_RUN_TIMEOUT = 30 * 60

_seq = 0             # 全局请求序号（监控展示用）

# ===== v4 模型分组（按接口域名）=====
_provider_last_seen = {}   # 域名 -> 最后请求时刻（TTL 内视为活跃）
_PROVIDER_TTL = 600.0      # 10 分钟无请求的模型不再参与车道瓜分

# ===== v4 全局车道数自适应 =====
_global_hist = []          # 最近 40 次完成结果 [(ok, ts), ...]
_GLOBAL_HIST_MAX = 40
_last_lane_adjust = 0.0
_LANE_ADJUST_COOLDOWN = 60.0   # 车道数调节冷却（秒），防振荡；测试可临时调小

# ===== 每对话框策略：{box_id: {'allowed': bool, 'note': str}} =====
_box_rules = {}

# ===== v4.2 报废车让道：每对话网络级失败追踪 =====
# 用户需求原话："如果一个车报废了（网络异常），全局系统让他给其他对话让道先跑，
# 而不是堵在那里不断重试把其他对话堵死。"
_box_net_fail = {}          # {box: [连续失败次数 streak, 最近失败时刻 ts]}
_NET_BACKOFF_MAX = 60.0     # 应急休整退避上限（秒）
_NET_FAIL_TTL = 300.0       # 5 分钟前的失败不再触发让道（视为自然恢复）
_NET_ERR_PAT = ('urlopen error', 'urlerror', 'timed out', 'timeout',
                'connection', 'reset', 'refused', 'unreachable',
                'gaierror', 'getaddrinfo', 'ssl', 'broken pipe', 'eof')


def _is_net_error(err):
    """判定是否网络级失败（上游连不上/超时），与业务层错误（4xx/5xx 响应）区分。"""
    s = str(err or '').lower()
    return any(p in s for p in _NET_ERR_PAT)


def _net_backoff(streak):
    """应急休整时长：连续失败 2/4/8/16/32/60 秒指数退避（到点自然放行探一次）。"""
    return min(_NET_BACKOFF_MAX, 2.0 * (2 ** min(streak - 1, 5)))

# ===== v4.5 对话优先级（两档，作用域=同一个大模型）=====
# 用户需求原话："第一档他加速其他减速，第二档他加速其他停止给他让道；
# 同一个大模型；不同大模型不参与优先级。"
_PRIORITY_TTL = 600.0       # 优先级空闲保活：对话 10 分钟无请求自动降回普通
_PRIO_GRACE = 20.0          # 档2跑完后的让道保持期（秒），防多轮循环间隙被钻空
_PRIO_DECEL_MULT = 3.0      # 档1活动期间同模型普通票的放行间隔倍数（减速）
_box_priority = {}          # {box: 1/2} 对话优先级档位（仅内存，重启回普通）
_box_priority_ts = {}       # {box: 最近活跃时刻}（每次请求刷新，驱动 TTL 降回）
_prio_hold_until = {}       # {provider: 档2让道保持截止时刻}

# ===== 监控记录 =====
_MAX_HISTORY = 200
_history = []
_active = {}
_box_stats = {}


def _load_cfg():
    """启动时读配置；运行中每次请求比对 mtime 热更新（与项目惯例一致）。"""
    global _enabled, _gap, _lanes, _cfg_mtime, _box_rules, _auto_cfg
    try:
        mt = os.path.getmtime(_GATE_CFG)
    except OSError:
        return
    if mt == _cfg_mtime:
        return
    try:
        with open(_GATE_CFG, 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
        lanes_changed = False
        with _LOCK:
            _enabled = bool(cfg.get('enabled', True))
            try:
                _gap = max(0.0, float(cfg.get('gap', 2.0)))
            except (TypeError, ValueError):
                _gap = 2.0
            try:
                new_lanes = max(1, min(16, int(cfg.get('lanes', 3))))
            except (TypeError, ValueError):
                new_lanes = 3
            if new_lanes != _lanes:
                _lanes = new_lanes
                lanes_changed = True
            rules = cfg.get('box_rules', {})
            _box_rules = {str(k): {'allowed': bool(v.get('allowed', True)),
                                   'note': str(v.get('note', ''))}
                          for k, v in rules.items()} if isinstance(rules, dict) else {}
            # v4：auto 段（旧配置无此段 → 用默认值，字段级容错）
            auto = cfg.get('auto') if isinstance(cfg.get('auto'), dict) else {}
            new_auto = dict(_AUTO_DEFAULTS)
            for k in ('enabled', 'provider_group'):
                if k in auto:
                    new_auto[k] = bool(auto.get(k))
            for k in ('min_lanes', 'max_lanes'):
                if k in auto:
                    try:
                        new_auto[k] = max(1, min(16, int(auto.get(k))))
                    except (TypeError, ValueError):
                        pass
            for k in ('max_gap_mult', 'slow_mult'):
                if k in auto:
                    try:
                        new_auto[k] = float(auto.get(k))
                    except (TypeError, ValueError):
                        pass
            new_auto['max_gap_mult'] = max(1.0, min(1000.0, new_auto['max_gap_mult']))
            new_auto['slow_mult'] = max(1.2, min(50.0, new_auto['slow_mult']))
            if new_auto['min_lanes'] > new_auto['max_lanes']:
                new_auto['min_lanes'], new_auto['max_lanes'] = \
                    new_auto['max_lanes'], new_auto['min_lanes']
            _auto_cfg = new_auto
        if lanes_changed:
            _retire_overflow_lanes()   # 缩容：撤销多余车道
        _ensure_lanes()                # 扩容：补建缺失车道
        _cfg_mtime = mt
        print('[ChatGate] 配置已加载 enabled=%s gap=%.1fs lanes=%d rules=%d auto(组=%s|%s)'
              % (_enabled, _gap, _lanes, len(_box_rules),
                 _auto_cfg['provider_group'], _auto_cfg['enabled']))
    except Exception as e:
        print('[ChatGate] 配置加载失败(用默认值): %s' % e)


def save_cfg():
    """管理面板改动后落盘（下次重启保持）。"""
    with _LOCK:
        cfg = {'enabled': _enabled, 'gap': _gap, 'lanes': _lanes,
               'updated': time.strftime('%Y-%m-%d %H:%M:%S'),
               'box_rules': _box_rules,
               'auto': dict(_auto_cfg)}
    try:
        os.makedirs(_GATE_DIR, exist_ok=True)
        tmp = _GATE_CFG + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _GATE_CFG)
        global _cfg_mtime
        try:
            _cfg_mtime = os.path.getmtime(_GATE_CFG)
        except OSError:
            pass
        return True
    except Exception as e:
        print('[ChatGate] 配置保存失败: %s' % e)
        return False


# ---------------------------------------------------------------------------
# 车道管理：粘性哈希 + 模型分组 + worker 生命周期
# ---------------------------------------------------------------------------

def _lane_of(box_key):
    """全池粘性哈希 → 1~lanes 号车道（与 _ensure_lanes 编号一致）。"""
    h = hashlib.md5(box_key.encode('utf-8')).hexdigest()
    return int(h, 16) % max(1, _lanes) + 1


def _lane_for(box_key, provider_key):
    """v4 车道选择：provider 分组开启且有多家活跃模型时，组内粘性；否则全池。
    分组算法：活跃模型排序后 round-robin 瓜分车道（(lane-1) % n == idx），
    互不相交且均匀。同对话恒落同组同车道 → 回复顺序不变。"""
    with _LOCK:
        if provider_key and _auto_cfg.get('provider_group'):
            now = time.time()
            _provider_last_seen[provider_key] = now
            active = sorted([p for p, ts in _provider_last_seen.items()
                             if now - ts < _PROVIDER_TTL])
            n = len(active)
            if n > 1:
                idx = active.index(provider_key)
                lanes_of = [lane for lane in range(1, _lanes + 1)
                            if (lane - 1) % n == idx]
                h = int(hashlib.md5(box_key.encode('utf-8')).hexdigest(), 16)
                return lanes_of[h % len(lanes_of)]
        return _lane_of(box_key)


def _ensure_lanes():
    """确保 1~_lanes 号车道都有队列与 worker（扩容即时生效；僵尸车道复活）。
    整体持锁：防并发调用同一车道启动双 worker（会破坏车道内串行语义）。"""
    with _LOCK:
        for lane in range(1, _lanes + 1):
            if lane not in _lane_queues:
                _lane_queues[lane] = queue.Queue()
                _lane_last_end[lane] = 0.0
                _lane_gen[lane] = 0
                _lane_gap_mult[lane] = 1.0
                _lane_run_hist[lane] = []
            elif _lane_gen.get(lane, -1) == -1:
                _lane_gen[lane] = 0   # 复活缩容后快速扩容的僵尸车道
            if lane not in _lane_workers or not _lane_workers[lane].is_alive():
                t = threading.Thread(target=_lane_worker_loop, args=(lane,),
                                     name='ChatGateLane%d' % lane, daemon=True)
                _lane_workers[lane] = t
                t.start()
                print('[ChatGate] 车道 %d worker 已启动（车道内串行，车道间并行）' % lane)


def _retire_overflow_lanes():
    """缩容：lane > _lanes 的车道不再接收新票；worker 跑完队列残留后自行退出。"""
    with _LOCK:
        for lane in list(_lane_queues.keys()):
            if lane > _lanes:
                _lane_gen[lane] = -1   # worker 空闲时看到代数 -1 即退出
                print('[ChatGate] 车道 %d 进入退役（跑完残留队列后退出，不丢请求）' % lane)


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

    with _LOCK:
        _seq += 1
        ticket = 'g%d-%d' % (int(time.time()), _seq)

    box_key = str(box_id or '未知对话')
    provider_key = str(provider or '')[:80]
    with _LOCK:
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
    with _LOCK:
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
        with _LOCK:
            nf = _box_net_fail.get(box_key)
            if nf and time.time() - nf[1] > _NET_FAIL_TTL:
                _box_net_fail.pop(box_key, None)   # 旧失败已过期，视为恢复
                nf = None
            if nf and nf[0] > 0:
                hold_until = nf[1] + _net_backoff(nf[0])
        if hold_until > time.time():
            info['state'] = 'holding'
            info['hold_left'] = round(hold_until - time.time(), 1)
            with _LOCK:
                _active[ticket] = info   # 面板/小狗守卫可见"应急休整中"
            print('[ChatGate][让道] 「%s」网络级失败×%d，应急休整 %.1fs 让出车道'
                  % (box_key, nf[0], hold_until - time.time()))
            while True:
                time.sleep(0.5)
                now = time.time()
                with _LOCK:
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
                    with _LOCK:
                        _active.pop(ticket, None)
                    raise GateRejected(info['error'], info['http_code'])
                if now >= hold_until:
                    break
            # 休整结束：脱离 holding（重新走正常排队流程），排队等待从现在起算
            with _LOCK:
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
            with _LOCK:
                grp_running = sum(1 for i in _active.values()
                                  if i.get('state') == 'running'
                                  and i.get('provider') == provider_key)
                cap_now = get_max_parallel(provider_key)
            if grp_running >= cap_now and provider_key not in _provider_max_parallel:
                start_probe(provider_key)
        except Exception:
            pass
    for _attempt in range(3):
        _ensure_lanes()
        with _LOCK:
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
    done_evt.wait()
    with _LOCK:
        st = info['state']
    if st == 'rejected':
        raise GateRejected(info.get('error', '被闸门拒绝'), info.get('http_code', 503))
    return ticket


def force_recover(ticket, reason='主脑自动处置'):
    """v4.6 供主脑/面板强制回收一张卡死票（等效车道 worker 的超时强制回收路径）。
    返回 True=已回收；False=票不存在或已结束。"""
    with _LOCK:
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
    with _LOCK:
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
            with _LOCK:
                rec = _box_net_fail.setdefault(info['box'], [0, 0.0])
                rec[0] += 1
                rec[1] = time.time()
                print('[ChatGate][让道] 「%s」网络级失败×%d，下次请求将休整 %.0fs 让道'
                      % (info['box'], rec[0], _net_backoff(rec[0])))
        elif ok:
            with _LOCK:
                if info['box'] in _box_net_fail:
                    _box_net_fail.pop(info['box'], None)
    # v4.5 档2让道保持：档2票跑完给该 provider 一小段独占保持期，
    # 防多轮 Agent 循环的下一次请求间隙被普通对话钻空抢跑。
    if (info.get('priority') or 0) >= 2:
        with _LOCK:
            _prio_hold_until[info.get('provider') or ''] = time.time() + _PRIO_GRACE
        print('[ChatGate][优先级] 「%s」档2跑完，同模型让道保持 %.0fs'
              % (info.get('box'), _PRIO_GRACE))
    _record(info, final=True)
    _note_result(info.get('lane'), ok, info.get('run_s'))
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
            with _LOCK:
                _residual = any(i.get('state') == 'queued'
                                and i.get('lane') == lane
                                for i in _active.values())
            if _lane_gen.get(lane, -1) == -1 and not _residual:
                # 已退役且无残留 → 退出
                with _LOCK:
                    _lane_workers.pop(lane, None)
                    _lane_queues.pop(lane, None)
                    _lane_last_end.pop(lane, None)
                    _lane_gen.pop(lane, None)
                print('[ChatGate] 车道 %d worker 已退役退出' % lane)
                return
            # 注意：这里【不能 continue】——超时后必须落到底部重扫，
            # 否则滞留票（唤醒名额被优先票顶替）在物理队列空了之后永远没人捞。
        with _LOCK:
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
        with _LOCK:
            info = _active.get(ticket)
            if info is None:
                continue
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
                last_end = time.time()
                with _LOCK:
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
                    with _LOCK:
                        cap = get_max_parallel(_prov_of_ticket)
                        if cap <= 0:
                            break
                        grp_running = sum(1 for i in _active.values()
                                          if i.get('state') == 'running'
                                          and i.get('provider') == _prov_of_ticket)
                        if grp_running < cap:
                            info['state'] = 'running'   # 持锁占位（原子）
                            info['started'] = time.time()
                            break
                    # 满载：先触发一次性探测（未测过时），再让位等待
                    try:
                        if _prov_of_ticket not in _provider_max_parallel:
                            start_probe(_prov_of_ticket)
                    except Exception:
                        pass
                    time.sleep(0.3)
                    _waited += 0.3
                    if _waited > 120:
                        break   # 极端兜底：等了2分钟强制放行（宁可超限不饿死）
                    # 重新取票面信息（可能已被清理）
                    with _LOCK:
                        if _active.get(ticket) is None:
                            info = None
                            break
                if info is None:
                    continue
            # 放行成功后触发探测：组内【全部车道满载】即触发（未探测时）。
            # 触发条件必须取 min(容量, 组车道数)——分组模式下组车道数可能
            # 小于默认容量(4)，若只看容量则永远够不着（车道物理并行先到顶）。
            if _prov_of_ticket and info is not None:
                try:
                    with _LOCK:
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
        with _LOCK:
            _lane_last_end[lane] = last_end
        if not finished:
            # 超时强制回收：单个挂死请求不能堵死整条车道；同时向 AIMD 记失败
            with _LOCK:
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


def _note_result(lane, ok, run_s):
    """v4 核心：把每次请求结果反馈给自适应器（acquire/release 之外只读状态）。
    AIMD——失败×2 / 变慢×1.5 / 成功×0.75（下限 1.0 上限 max_gap_mult）。"""
    if lane is None:
        return
    with _LOCK:
        if _auto_cfg.get('enabled'):
            mult = _lane_gap_mult.get(lane, 1.0)
            slow = _slow_by_history(lane, run_s) if ok else False
            if not ok:
                mult = min(float(_auto_cfg.get('max_gap_mult', 16.0)), mult * 2.0)
            elif slow:
                mult = min(float(_auto_cfg.get('max_gap_mult', 16.0)), mult * 1.5)
            else:
                mult = max(1.0, mult * 0.75)
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
    with _LOCK:
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
    with _LOCK:
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
    with _LOCK:
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
            elif info['state'] == 'rejected':
                st['rejected'] += 1
            st['last'] = time.time()


# ---------------------------------------------------------------------------
# 管理 API 支持（被 routes/mixin_gate.py 调用）
# ---------------------------------------------------------------------------

def status_snapshot():
    """面板轮询：全局状态 + 模型分组 + 各车道状态（含自适应收紧）+ 历史与统计。"""
    _load_cfg()
    now = time.time()
    with _LOCK:
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
    with _LOCK:
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
    with _LOCK:
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


def set_enabled(on):
    """全局开关。False=暂停（新请求 503），True=恢复。"""
    global _enabled
    with _LOCK:
        _enabled = bool(on)
    return save_cfg()


def set_gap(seconds):
    global _gap
    try:
        g = float(seconds)
    except (TypeError, ValueError):
        return False
    with _LOCK:
        _gap = max(0.0, min(600.0, g))  # 上限 10 分钟防误操作
    return save_cfg()


def set_lanes(n):
    """手动设置车道数（面板）。auto 开启时把上下限拉宽以包含手动值（用户意图优先）。"""
    global _lanes, _last_lane_adjust
    try:
        n = int(n)
    except (TypeError, ValueError):
        return False
    n = max(1, min(16, n))
    with _LOCK:
        if n == _lanes:
            return True
        _lanes = n
        if _auto_cfg.get('enabled'):
            if n < int(_auto_cfg.get('min_lanes', 2)):
                _auto_cfg['min_lanes'] = n
            if n > int(_auto_cfg.get('max_lanes', 6)):
                _auto_cfg['max_lanes'] = n
    _last_lane_adjust = 0.0   # 手动后立即放开冷却
    _retire_overflow_lanes()
    _ensure_lanes()
    return save_cfg()


def set_auto(params):
    """v4：面板设置自适应参数（部分更新，未知字段忽略）。"""
    global _last_lane_adjust
    if not isinstance(params, dict):
        return False
    target = None
    with _LOCK:
        for k in ('enabled', 'provider_group'):
            if k in params:
                _auto_cfg[k] = bool(params[k])
        for k in ('min_lanes', 'max_lanes'):
            if k in params:
                try:
                    _auto_cfg[k] = max(1, min(16, int(params[k])))
                except (TypeError, ValueError):
                    pass
        for k in ('max_gap_mult', 'slow_mult'):
            if k in params:
                try:
                    _auto_cfg[k] = float(params[k])
                except (TypeError, ValueError):
                    pass
        _auto_cfg['max_gap_mult'] = max(1.0, min(1000.0, _auto_cfg['max_gap_mult']))
        _auto_cfg['slow_mult'] = max(1.2, min(50.0, _auto_cfg['slow_mult']))
        if _auto_cfg['min_lanes'] > _auto_cfg['max_lanes']:
            _auto_cfg['min_lanes'], _auto_cfg['max_lanes'] = \
                _auto_cfg['max_lanes'], _auto_cfg['min_lanes']
        # 关闭 auto 时收紧倍数即刻复位（回到纯手动节奏）
        if not _auto_cfg.get('enabled'):
            for l in _lane_gap_mult:
                _lane_gap_mult[l] = 1.0
        # 开启 auto 且当前 lanes 超出新范围 → 拉回（内存即刻生效）
        if _auto_cfg.get('enabled'):
            target = max(_auto_cfg['min_lanes'],
                         min(_auto_cfg['max_lanes'], _lanes))
            if target == _lanes:
                target = None
    _last_lane_adjust = 0.0
    if target is not None:
        _set_lanes_inmem(target)
    return save_cfg()


def set_box_allowed(box_id, allowed, note=''):
    """每对话框策略：allowed=False 时该对话后续请求 403 拒绝。"""
    key = str(box_id or '').strip()
    if not key:
        return False
    with _LOCK:
        if allowed:
            if note:
                _box_rules[key] = {'allowed': True, 'note': str(note)}
            else:
                _box_rules.pop(key, None)
        else:
            _box_rules[key] = {'allowed': False, 'note': str(note or '管理员禁用')}
    return save_cfg()


def _prio_of(box_key):
    """v4.5 该对话当前优先级档位（0=普通 1=加速 2=让道）。
    空闲超过 _PRIORITY_TTL（10分钟无任何请求）自动降回普通并清理。"""
    now = time.time()
    with _LOCK:
        tier = _box_priority.get(box_key, 0)
        if tier:
            ts = _box_priority_ts.get(box_key, 0)
            if ts and now - ts > _PRIORITY_TTL:
                _box_priority.pop(box_key, None)
                _box_priority_ts.pop(box_key, None)
                print('[ChatGate][优先级] 「%s」空闲超10分钟，自动降回普通' % box_key)
                return 0
        return tier


def set_box_priority(box_id, tier):
    """v4.5 对话优先级（用户需求："第一档他加速其他减速，第二档他加速其他停止
    给他让道；同一个大模型；不同大模型不参与优先级"）：
      0=普通  1=加速（插队优先放行 + 同模型普通票放行间隔×3）
      2=让道（插队优先放行 + 同模型普通票完全让停，跑完后另有20s保持期）
    仅内存生效（重启回普通），对话空闲10分钟自动降回（每次请求刷新保活）。
    返回 (ok, msg)。"""
    key = str(box_id or '').strip()
    if not key:
        return False, '缺少 box'
    try:
        t = int(tier)
    except (TypeError, ValueError):
        return False, 'tier 非法（0/1/2）'
    t = max(0, min(2, t))
    names = {0: '普通', 1: '加速（同模型其他对话减速）',
             2: '让道（同模型其他对话让停）'}
    with _LOCK:
        if t == 0:
            _box_priority.pop(key, None)
            _box_priority_ts.pop(key, None)
        else:
            _box_priority[key] = t
            _box_priority_ts[key] = time.time()
    print('[ChatGate][优先级] 「%s」→ %s' % (key, names[t]))
    return True, '已设为【%s】' % names[t]


def priorities_view(now):
    """v4.5 优先级视图 {box: {tier, left}}（left=距空闲自动降回的秒数，过期即隐藏）。"""
    with _LOCK:
        out = {}
        for b, t in list(_box_priority.items()):
            ts = _box_priority_ts.get(b, 0)
            left = int(_PRIORITY_TTL - (now - ts)) if ts else 0
            if left <= 0:
                continue
            out[b] = {'tier': int(t), 'left': left}
        return out


def clear_history():
    with _LOCK:
        del _history[:]
    return True


# ---------------------------------------------------------------------------
# v4.3 大模型并发容量预探测（用户需求："新建对话时后台提前测出该大模型
# 最大并行是多少，之后调度保证不超过该值"）
# ---------------------------------------------------------------------------

_PROBE_CFG = os.path.join(_GATE_DIR, 'gate_probe.json')
_PROBE_MAX_N = 12          # 探测阶梯上限（服务商实际限流基本 ≤12）
_PROBE_OK_RATE = 0.9       # 单轮成功率 ≥90% 视为该并发数可用
_PROBE_UNKNOWN = 4         # 未探测 provider 的保守钳制默认值
_provider_max_parallel = {}   # provider -> {max_parallel, tested_at, detail}
_probe_running = {}           # provider -> Thread（防重复探测）
_probe_status = {}            # provider -> 'probing' | 'done' | 'failed'（面板展示）


def _load_probe_cfg():
    """启动时读 private/gate_probe.json。"""
    try:
        with open(_PROBE_CFG, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
        if isinstance(data, dict):
            with _LOCK:
                for k, v in data.items():
                    if isinstance(v, dict) and v.get('max_parallel'):
                        _provider_max_parallel[str(k)] = v
    except Exception:
        pass


def _save_probe_cfg():
    try:
        os.makedirs(_GATE_DIR, exist_ok=True)
        tmp = _PROBE_CFG + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(_provider_max_parallel, f, ensure_ascii=False, indent=2)
        os.replace(tmp, _PROBE_CFG)
        return True
    except Exception as e:
        print('[ChatGate][probe] 保存失败: %s' % e)
        return False


def get_max_parallel(provider_key):
    """某大模型的并发容量钳制值：探测结果 > 保守默认。无分组（空）不钳制。"""
    if not provider_key:
        return 0
    rec = _provider_max_parallel.get(provider_key)
    if rec and rec.get('max_parallel'):
        return int(rec['max_parallel'])
    return _PROBE_UNKNOWN


def _resolve_model_for(provider_key):
    """按域名在 public/config/models.json 找一个启用的模型 + 真实 key。
    key 解析链：model.key/apiKey → api_keys.json(by name)。"""
    try:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        models_file = os.path.join(base, 'public', 'config', 'models.json')
        # utf-8-sig：兼容 PowerShell 写入的带 BOM JSON，否则 json.load 失败探测静默退化
        with open(models_file, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
        models = data.get('models') if isinstance(data, dict) else []
        for m in (models or []):
            if not isinstance(m, dict) or not m.get('enabled', True):
                continue
            endpoint = str(m.get('endpoint') or m.get('baseUrl') or '')
            if provider_key not in endpoint:
                continue
            key = str(m.get('key') or m.get('apiKey') or '')
            if not key or '•' in key:
                try:
                    from model_config import _load_keys_map
                    key = str((_load_keys_map() or {}).get(str(m.get('name') or '')) or '')
                except Exception:
                    key = ''
            return {'endpoint': endpoint,
                    'model': str(m.get('modelId') or m.get('model') or ''),
                    'key': key}
    except Exception:
        pass
    return None


def _probe_one(model, timeout=25):
    """发一个极小真实请求（max_tokens=1）。返回 (ok, is_rate_limit, err)。"""
    import urllib.request
    import urllib.error
    payload = json.dumps({
        'model': model['model'], 'max_tokens': 1, 'temperature': 0.1,
        'messages': [{'role': 'user', 'content': 'hi'}],
    }).encode('utf-8')
    req = urllib.request.Request(model['endpoint'], data=payload, method='POST',
                                 headers={'Content-Type': 'application/json'})
    if model.get('key'):
        req.add_header('Authorization', 'Bearer ' + model['key'])
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode() == 200, False, ''
    except urllib.error.HTTPError as e:
        body = ''
        try:
            body = e.read().decode('utf-8', errors='replace')[:200]
        except Exception:
            pass
        return False, e.code in (429, 503), 'HTTP %d %s' % (e.code, body[:120])
    except Exception as e:
        return False, False, str(e)[:120]


def _probe_round(model, n):
    """一轮探测：n 个极小请求同时打。返回 (ok_count, rate_limited, first_err, 耗时s)。"""
    results = [None] * n

    def _w(i):
        results[i] = _probe_one(model)

    ths = [threading.Thread(target=_w, args=(i,)) for i in range(n)]
    t0 = time.time()
    for t in ths:
        t.start()
    for t in ths:
        t.join(timeout=40)
    ok = sum(1 for r in results if r and r[0])
    rl = any(r and r[1] for r in results)
    err = next((r[2] for r in results if r and not r[0]), '')
    return ok, rl, err, round(time.time() - t0, 1)


def _probe_worker(provider_key):
    """探测主流程：阶梯上升 2→3→4→6→8→10→12，找最大可用并发。
    停止：成功率<90% / 触发429限流 / 延迟劣化×3。结果落盘 gate_probe.json。"""
    _probe_status[provider_key] = 'probing'
    print('[ChatGate][probe] 开始探测「%s」并发容量...' % provider_key)
    model = _resolve_model_for(provider_key)
    if not model or not model.get('endpoint'):
        _probe_status[provider_key] = 'failed'
        print('[ChatGate][probe] 「%s」未找到可用模型配置，跳过' % provider_key)
        return
    base_time = None
    last_ok_n = 0
    detail = []
    for n in (2, 3, 4, 6, 8, 10, 12):
        if n > _PROBE_MAX_N:
            break
        ok, rl, err, dur = _probe_round(model, n)
        detail.append('N=%d ok=%d/%d %.1fs%s' % (n, ok, n, dur,
                                                 (' ' + err[:60]) if err else ''))
        print('[ChatGate][probe] 「%s」 N=%d → %d/%d 成功 %.1fs' % (provider_key, n, ok, n, dur))
        if base_time is None:
            base_time = dur
        if rl:
            detail.append('N=%d 触发限流429，定格' % n)
            break
        if ok < n * _PROBE_OK_RATE:
            break
        if dur > base_time * 3 and n > 2:
            detail.append('N=%d 延迟劣化×3，定格' % n)
            break
        last_ok_n = n
    result = max(2, last_ok_n)
    with _LOCK:
        _provider_max_parallel[provider_key] = {
            'max_parallel': result,
            'tested_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'model': model.get('model') or '',
            'detail': detail,
        }
    _save_probe_cfg()
    _probe_status[provider_key] = 'done'
    print('[ChatGate][probe] 「%s」最大并发容量 = %d（已钳制调度）'
          % (provider_key, result))


def start_probe(provider_key, force=False):
    """启动后台探测线程（幂等：已在跑/已测过且非 force 则跳过）。"""
    if not provider_key:
        return False, 'missing provider'
    with _LOCK:
        if provider_key in _probe_running and _probe_running[provider_key].is_alive():
            return False, '探测进行中'
        if not force and _provider_max_parallel.get(provider_key):
            return True, '已有探测结果（max_parallel=%d，force 可重测）' \
                % _provider_max_parallel[provider_key]['max_parallel']
        t = threading.Thread(target=_probe_worker, args=(provider_key,),
                             name='GateProbe-%s' % provider_key[:20], daemon=True)
        _probe_running[provider_key] = t
    t.start()
    return True, '探测已启动（后台静默进行，不阻塞对话）'


def probe_snapshot():
    """面板/概览：各 provider 的并发容量与探测状态。"""
    with _LOCK:
        out = {}
        for p in set(list(_provider_max_parallel.keys()) + list(_probe_status.keys())):
            rec = _provider_max_parallel.get(p) or {}
            out[p] = {'max_parallel': rec.get('max_parallel') or get_max_parallel(p),
                      'tested_at': rec.get('tested_at', ''),
                      'status': _probe_status.get(p, 'unknown'),
                      'detail': rec.get('detail', [])}
        return out


_load_probe_cfg()   # 启动即加载历史探测结果
