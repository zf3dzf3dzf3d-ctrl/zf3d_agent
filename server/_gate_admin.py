# -*- coding: utf-8 -*-
# chat_gate 拆分分段模块：由原 chat_gate.py 按行段【无改动】切分，
# 由 chat_gate.py 门面加载后合并进同一命名空间（分段之间为隐式互相引用）。
def set_enabled(on):
    """全局开关。False=暂停（新请求 503），True=恢复。"""
    global _enabled
    with _gate_lock('_gate_admin.py'):
        _enabled = bool(on)
    return save_cfg()


def set_gap(seconds):
    global _gap
    try:
        g = float(seconds)
    except (TypeError, ValueError):
        return False
    with _gate_lock('_gate_admin.py'):
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
    with _gate_lock('_gate_admin.py'):
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
    with _gate_lock('_gate_admin.py'):
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
    with _gate_lock('_gate_admin.py'):
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
    with _gate_lock('_gate_admin.py'):
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
    with _gate_lock('_gate_admin.py'):
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
    with _gate_lock('_gate_admin.py'):
        out = {}
        for b, t in list(_box_priority.items()):
            ts = _box_priority_ts.get(b, 0)
            left = int(_PRIORITY_TTL - (now - ts)) if ts else 0
            if left <= 0:
                continue
            out[b] = {'tier': int(t), 'left': left}
        return out


def clear_history():
    with _gate_lock('_gate_admin.py'):
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
_PROBE_TTL = 7 * 24 * 3600 # 探测结果保鲜期 7 天；过期视为未探测，会自动重测
_provider_max_parallel = {}   # provider -> {max_parallel, tested_at, detail}
_probe_running = {}           # provider -> Thread（防重复探测）
_probe_status = {}            # provider -> 'probing' | 'done' | 'failed'（面板展示）


def _load_probe_cfg():
    """启动时读 private/gate_probe.json。"""
    try:
        with open(_PROBE_CFG, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
        if isinstance(data, dict):
            with _gate_lock('_gate_admin.py'):
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
    """某大模型的并发容量钳制值：探测结果 > 保守默认。无分组（空）不钳制。
    v4.4：探测结果超过保鲜期（_PROBE_TTL）视为未探测，返回保守默认，
    防止多年前/失效前探测的坏值永久钳制线路。"""
    if not provider_key:
        return 0
    rec = _provider_max_parallel.get(provider_key)
    if rec and rec.get('max_parallel'):
        ts = rec.get('tested_ts') or 0
        if not ts or (time.time() - ts) > _PROBE_TTL:
            return _PROBE_UNKNOWN   # 无时间戳的旧坏值 / 过期 → 保守默认（调度层会触发重测）
        return int(rec['max_parallel'])
    return _PROBE_UNKNOWN


def is_probe_fresh(provider_key):
    """探测结果是否存在且未过期（供调度层决定是否触发重测）。"""
    rec = _provider_max_parallel.get(provider_key)
    if not rec or not rec.get('max_parallel'):
        return False
    ts = rec.get('tested_ts') or 0
    if not ts:
        return False   # 旧格式无时间戳 → 视为不新鲜，触发重测补上时间戳（旧坏值自愈）
    return (time.time() - ts) <= _PROBE_TTL


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
    # v4.4 彻底修复：探测全失败（如后台服务未启动、网络不通）时，
    # 绝不把钳制值降级为 2 并落盘——那会把好结果永久污染成坏结果。
    # 正确做法：保留旧探测值（若有），标记 failed，等下次触发重测。
    if last_ok_n == 0:
        with _gate_lock('_gate_admin.py'):
            keep = _provider_max_parallel.get(provider_key)
        _probe_status[provider_key] = 'failed'
        if keep:
            print('[ChatGate][probe] 「%s」本轮探测全部失败（疑似上游不可用），'
                  '保留原钳制值 %d 不降级' % (provider_key, keep['max_parallel']))
        else:
            print('[ChatGate][probe] 「%s」本轮探测全部失败，未写入任何钳制值'
                  '（调度用保守默认 %d，后续会自动重测）' % (provider_key, _PROBE_UNKNOWN))
        return
    result = max(2, last_ok_n)
    with _gate_lock('_gate_admin.py'):
        _provider_max_parallel[provider_key] = {
            'max_parallel': result,
            'tested_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'tested_ts': time.time(),
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
    with _gate_lock('_gate_admin.py'):
        if provider_key in _probe_running and _probe_running[provider_key].is_alive():
            return False, '探测进行中'
        if not force and is_probe_fresh(provider_key):
            return True, '已有新鲜探测结果（max_parallel=%d，force 可重测）' \
                % _provider_max_parallel[provider_key]['max_parallel']
        t = threading.Thread(target=_probe_worker, args=(provider_key,),
                             name='GateProbe-%s' % provider_key[:20], daemon=True)
        _probe_running[provider_key] = t
    t.start()
    return True, '探测已启动（后台静默进行，不阻塞对话）'


def probe_snapshot():
    """面板/概览：各 provider 的并发容量与探测状态。"""
    with _gate_lock('_gate_admin.py'):
        out = {}
        for p in set(list(_provider_max_parallel.keys()) + list(_probe_status.keys())):
            rec = _provider_max_parallel.get(p) or {}
            out[p] = {'max_parallel': rec.get('max_parallel') or get_max_parallel(p),
                      'tested_at': rec.get('tested_at', ''),
                      'status': _probe_status.get(p, 'unknown'),
                      'detail': rec.get('detail', [])}
        return out


_load_probe_cfg()   # 启动即加载历史探测结果
