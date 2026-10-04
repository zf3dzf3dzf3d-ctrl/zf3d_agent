# -*- coding: utf-8 -*-
# chat_gate 拆分分段模块：由原 chat_gate.py 按行段【无改动】切分，
# 由 chat_gate.py 门面加载后合并进同一命名空间（分段之间为隐式互相引用）。
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
        with _gate_lock('_gate_cfg_io.py'):
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
    with _gate_lock('_gate_cfg_io.py'):
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
    """v4.7 车道选择：provider 分组开启且有多家活跃模型时，组内负载均衡；否则全池。
    分组算法：活跃模型排序后 round-robin 瓜分车道（(lane-1) % n == idx），互不相交。
    组内选道：不再纯粘性哈希，而是「最短队列优先」——新任务优先去组内空闲车道；
    都在忙时选负载最小（排队数+运行中数最少）的车道，避免多条道闲置、
    任务却全堆在一条道上。同车道内仍 FIFO，保序语义不变。"""
    with _gate_lock('_gate_cfg_io.py'):
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
                # v4.7 组内最短队列优先：负载 = 本车道排队数 + 运行中数
                def _load(ln):
                    cnt = 0
                    for i in _active.values():
                        if i.get('lane') == ln and i.get('state') in (
                                'queued', 'gapped', 'running'):
                            cnt += 1
                    return cnt
                loads = {ln: _load(ln) for ln in lanes_of}
                best = min(loads.values())
                if best == 0:
                    # 有完全空闲的道 → 随机挑一条空道（避免同时入队扎堆同一条）
                    empty = [ln for ln, c in loads.items() if c == 0]
                    h = int(hashlib.md5(box_key.encode('utf-8')).hexdigest(), 16)
                    return empty[h % len(empty)]
                # 都在忙 → 选负载最小的道（并列取编号小的，稳定）
                return min(ln for ln, c in loads.items() if c == best)
        return _lane_of(box_key)


def _ensure_lanes():
    """确保 1~_lanes 号车道都有队列与 worker（扩容即时生效；僵尸车道复活）。
    整体持锁：防并发调用同一车道启动双 worker（会破坏车道内串行语义）。"""
    with _gate_lock('_gate_cfg_io.py'):
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
    with _gate_lock('_gate_cfg_io.py'):
        for lane in list(_lane_queues.keys()):
            if lane > _lanes:
                _lane_gen[lane] = -1   # worker 空闲时看到代数 -1 即退出
                print('[ChatGate] 车道 %d 进入退役（跑完残留队列后退出，不丢请求）' % lane)

