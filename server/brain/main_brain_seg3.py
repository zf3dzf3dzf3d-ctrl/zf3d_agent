# -*- coding: utf-8 -*-
# 拆分分段模块：由原 main_brain.py 按行段【无改动】切分，由同名门面加载合并。
# ============================ 状态/控制 ============================

def get_state(base, limit=80):
    with _lock:
        st = dict(_state)
        h = _history[-limit:]
    # 补回放：历史为空时从磁盘回放（重启后）
    if not h:
        h = _replay(base, limit)
    return {'ok': True, 'state': st, 'history': h}


def _replay(base, limit):
    out = []
    try:
        sp = os.path.join(_dir(base), 'summaries.jsonl')
        if os.path.isfile(sp):
            with open(sp, 'r', encoding='utf-8-sig') as f:
                lines = f.readlines()[-20:]
            for ln in lines:
                try:
                    d = json.loads(ln)
                    out.append({'role': 'brain', 'kind': 'summary',
                                'level': 'info', 'text': d.get('text'), 'ts': d.get('ts') or 0})
                except ValueError:
                    pass
        cp = os.path.join(_dir(base), 'chats.jsonl')
        if os.path.isfile(cp):
            with open(cp, 'r', encoding='utf-8-sig') as f:
                lines = f.readlines()[-20:]
            for ln in lines:
                try:
                    d = json.loads(ln)
                    out.append({'role': 'user', 'kind': 'user', 'text': d.get('user'),
                                'ts': d.get('ts') or 0})
                    out.append({'role': 'brain', 'kind': 'chat', 'level': 'info',
                                'text': d.get('brain'), 'ts': d.get('ts') or 0})
                except ValueError:
                    pass
        out.sort(key=lambda m: str(m.get('ts') or 0))
        try:
            mem = open(os.path.join(_dir(base), 'memory.md'), 'r', encoding='utf-8-sig').read()
            globals()['_memory'] = mem.split('\n\n', 1)[-1]
        except OSError:
            pass
    except Exception:
        pass
    return out[-limit:]


def get_memory_report(base):
    """返回最近一次总结报告（供 /api/brain/report 一键复制）。"""
    with _lock:
        if _memory:
            ts = _state.get('last_summary') or 0
            return {'ok': True, 'time': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(ts)) if ts else '',
                    'text': _memory}
    # 内存为空则读 summaries.jsonl 尾部
    path = os.path.join(_dir(base), 'summaries.jsonl')
    last = None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    last = json.loads(line)
                except Exception:
                    pass
    except OSError:
        pass
    if last:
        return {'ok': True, 'time': last.get('time', ''), 'text': last.get('text', ''),
                'why': last.get('why', '')}
    return {'ok': True, 'text': '', 'time': ''}


def brain_control(base, paused=None, auto_report=None, interval=None):
    global _interval
    with _lock:
        if interval is not None:
            try:
                v = max(BRAIN_INTERVAL_MIN, min(BRAIN_INTERVAL_MAX, int(interval)))
                if v != _interval:
                    _state['interval'] = v
                    _interval = v
                    _save_interval(base)
                    _push_event('brain', 'info',
                                '采集周期已调整为每 %d 秒一次（范围 %d~%d 秒，主脑面板可设置）。'
                                % (v, BRAIN_INTERVAL_MIN, BRAIN_INTERVAL_MAX), base)
            except (TypeError, ValueError):
                pass
        if paused is not None:
            _state['paused'] = bool(paused)
            if _state['paused']:
                _push_event('brain', 'info', '观察已暂停（用户操作），30 分钟后自动恢复', base)
                _state['_pause_until'] = time.time() + 1800
            else:
                _state['_pause_until'] = 0
        if auto_report is not None:
            _state['auto_report'] = bool(auto_report)
        st = dict(_state)
    st.pop('_pause_until', None)
    return {'ok': True, 'state': st}


def request_manual_summary(base):
    with _lock:
        _state['paused'] = False
        _state['_pause_until'] = 0
    threading.Thread(target=_do_summary, args=(base, '手动触发'), daemon=True).start()
    return {'ok': True}


# ============================ 主循环 ============================

def _loop(base):
    _state['running'] = True
    with _lock:
        _history.append({'role': 'brain', 'kind': 'summary', 'level': 'info',
                         'text': '主脑已启动：每 %d 秒观察一次项目（零侵入只读采集，事件驱动总结，不占对话车道）。'
                                 % _interval, 'ts': time.time()})
    while True:
        try:
            time.sleep(_get_interval())
            with _lock:
                paused = _state.get('paused')
                until = _state.get('_pause_until') or 0
                if paused and until and time.time() > until:
                    _state['paused'] = False
                    paused = False
                auto = _state.get('auto_report')
            if not paused:
                n = _collect(base)
                with _lock:
                    _state['cycles'] += 1
                    _state['last_cycle'] = time.time()
                if auto:
                    with _lock:
                        has_bad = any(e['level'] in ('warn', 'error') for e in _events)
                        n_pool = len(_events)
                        last = _state.get('last_summary') or 0
                    if has_bad or n_pool >= POOL_FLUSH_N or \
                       (n_pool > 0 and time.time() - last > IDLE_SUMMARY_MIN * 60):
                        _do_summary(base, 'warn/error 事件' if has_bad else
                                    ('事件池满 %d 条' % n_pool if n_pool >= POOL_FLUSH_N else '定时巡检'))
        except Exception:
            try:
                time.sleep(5)
            except Exception:
                pass


def start_brain_thread(base_dir):
    _load_interval(base_dir)
    _state['interval'] = _interval
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, args=(base_dir,), daemon=True, name='main-brain').start()
