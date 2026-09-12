#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
主脑（Main Brain）v1 —— 项目级常驻观察者 + 事件驱动总结器 + 独立对话会话

【设计红线（坑1/坑2 防线，改代码前必读）】
坑1 · 大模型调用成本与车道占用：
  - 60 秒一轮只做【本地采集】（读文件、拼快照），绝不每轮都调大模型；
  - 大模型总结是【事件驱动 + 节流】：仅当出现 warn/error 事件、或事件池积累满
    POOL_FLUSH_N 条、或距上次总结超过 IDLE_SUMMARY_MIN 分钟且有新事件时才触发；
  - 总结 prompt 强制小而短（事件摘要行，非原文），失败静默降级（只落盘不重试轰炸）；
  - 总结调用走独立 urllib 直连，【不占用】chat_gate 车道，不影响正常对话。
坑2 · 上下文污染：
  - 主脑的一切消息（自动播报/总结/人工对话）【独立落盘】private/brain/，
    【绝不写入】用户对话的 history / ChatBox / agent 上下文；
  - 人工对话上下文回放只带最近 BRAIN_CTX_TURNS 轮 + memory.md 摘要，超限截断防爆炸；
  - events.jsonl 按天滚动，summaries.jsonl 只保留尾部 BRAIN_KEEP 条。
【采集清单（零侵入：只读文件与已有状态，不 hook 业务代码）】
  - 垃圾箱记录        private/垃圾箱/notes（若存在）
  - 工具结果打回存档  private/tool_result_archive/*.json（新文件数）
  - 闸门车道状态      chat_gate.status_snapshot()（内存直读）
  - 服务端错误        server.log 尾部新增的 ERROR/Traceback 行（若存在）
  - 任务清单          private/agent_steps/*.json（活跃会话数，只数不改）
【对外接口（给 routes 层用）】
  start_brain_thread(base_dir)      随 server.py 启动 daemon 线程
  get_state()  -> dict              运行状态 + 最近消息流（ summaries+chats 合并）
  brain_chat(text) -> dict         人工对话（带 memory.md 上下文，独立会话）
  brain_control(paused=None, auto_report=None) -> dict
"""
import os
import re
import json
import time
import glob
import threading
import urllib.request

BRAIN_INTERVAL_DEFAULT = 60    # 采集周期默认值（秒）：1 分钟一轮，节省 token
POOL_FLUSH_N = 8               # 事件池积累 N 条触发一次总结
IDLE_SUMMARY_MIN = 30          # 无告警时最长 X 分钟必须总结一次（有新事件才算）
BRAIN_CTX_TURNS = 12           # 人工对话回放的最大消息条数
BRAIN_KEEP = 400               # summaries.jsonl 保留条数上限
MAX_EVENT_TEXT = 300           # 单条事件文本截断

_lock = threading.RLock()

# v4.6 主脑自动处置：卡死对话自动强制回收（True=开启）
_auto_recover = True
_recovered = {}   # ticket -> ts（防重复处置记录）
_started = False
_events = []                   # 事件池（未总结）
_history = []                  # 对话窗消息流 [{role, text, kind, ts}]  kind: auto/user/brain/summary
_memory = ''                   # 最近一次总结正文（memory.md）
_state = {
    'running': False, 'paused': False, 'auto_report': True, 'interval': BRAIN_INTERVAL_DEFAULT,
    'cycles': 0, 'last_cycle': 0, 'last_summary': 0,
    'llm_calls': 0, 'llm_errors': 0, 'events_total': 0,
}
_seen = {}                     # 去重表 {key: ts}

BRAIN_INTERVAL_MIN = 20        # 采集周期下限（秒），防止采集过密打爆 IO
BRAIN_INTERVAL_MAX = 600       # 采集周期上限（秒）
_interval = BRAIN_INTERVAL_DEFAULT   # 运行期实际采集周期（秒），可被 brain_control 修改


def _get_interval():
    return _interval


def _load_interval(base):
    """启动时从 private/brain/config.json 恢复采集周期。"""
    global _interval
    try:
        with open(os.path.join(_dir(base), 'config.json'), 'r', encoding='utf-8') as f:
            d = json.load(f)
        v = int(d.get('interval') or BRAIN_INTERVAL_DEFAULT)
        _interval = max(BRAIN_INTERVAL_MIN, min(BRAIN_INTERVAL_MAX, v))
    except Exception:
        _interval = BRAIN_INTERVAL_DEFAULT
    return _interval


def _save_interval(base):
    try:
        with open(os.path.join(_dir(base), 'config.json'), 'w', encoding='utf-8') as f:
            json.dump({'interval': _interval}, f, ensure_ascii=False)
    except Exception:
        pass

# ============================ 落盘 ============================

def _dir(base):
    d = os.path.join(base, 'private', 'brain')
    os.makedirs(d, exist_ok=True)
    return d


def _append_jsonl(path, obj, keep=None):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(obj, ensure_ascii=False) + '\n')
        if keep:
            try:
                with open(path, 'r', encoding='utf-8-sig') as f:
                    lines = f.readlines()[-keep:]
                tmp = path + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    f.writelines(lines)
                os.replace(tmp, path)
            except OSError:
                pass
    except OSError:
        pass


def _save_memory(base, text):
    try:
        with open(os.path.join(_dir(base), 'memory.md'), 'w', encoding='utf-8') as f:
            f.write('# 主脑记忆（最近一次总结）\n\n' + text + '\n')
    except OSError:
        pass


# ============================ 采集器 ============================

def _dedup_key(kind, text):
    return kind + '|' + re.sub(r'\d+', 'N', text)[:120]


def _push_event(kind, level, text, base):
    """level: info/warn/error。去重窗口 5 分钟。"""
    now = time.time()
    key = _dedup_key(kind, text)
    with _lock:
        if now - _seen.get(key, 0) < 300:
            return
        _seen[key] = now
        # 去重表防膨胀
        if len(_seen) > 400:
            for k in list(_seen)[:200]:
                if now - _seen[k] > 600:
                    _seen.pop(k, None)
        _events.append({'kind': kind, 'level': level, 'text': text[:MAX_EVENT_TEXT], 'ts': now})
        _state['events_total'] += 1
        _history.append({'role': 'event', 'kind': kind, 'level': level,
                         'text': text[:MAX_EVENT_TEXT], 'ts': now})
        if len(_history) > 300:
            del _history[:-300]
    _append_jsonl(os.path.join(_dir(base), 'events.jsonl'),
                  {'kind': kind, 'level': level, 'text': text[:MAX_EVENT_TEXT],
                   'ts': time.strftime('%Y-%m-%d %H:%M:%S')}, keep=2000)


def _collect(base):
    """零侵入采集一轮，返回本轮新增事件数。"""
    n0 = len(_events)
    # 1. 工具结果打回存档：1 分钟内的新文件
    try:
        arch = os.path.join(base, 'private', 'tool_result_archive')
        if os.path.isdir(arch):
            cutoff = time.time() - _get_interval() * 2
            news = [p for p in glob.glob(os.path.join(arch, '*.json'))
                    if os.path.getmtime(p) > cutoff]
            for p in news[:3]:
                try:
                    with open(p, 'r', encoding='utf-8-sig') as f:
                        d = json.load(f)
                    _push_event('tool_reject', 'warn',
                                '工具结果被打回存档：%s（%s）' % (
                                    d.get('tool') or os.path.basename(p),
                                    str(d.get('reason') or '')[:120]), base)
                except (OSError, ValueError):
                    pass
    except Exception:
        pass
    # 2. 垃圾箱 notes：1 分钟内追加的危险操作记录
    try:
        trash_notes = os.path.join(base, 'private', '垃圾箱')
        if os.path.isdir(trash_notes):
            cutoff = time.time() - _get_interval() * 2
            for p in glob.glob(os.path.join(trash_notes, '*')):
                if os.path.isfile(p) and os.path.getmtime(p) > cutoff:
                    _push_event('trash', 'warn', '垃圾箱新记录：%s' % os.path.basename(p), base)
    except Exception:
        pass
    # 3. 闸门车道状态（内存直读，不占车道）
    try:
        import sys as _sys
        gp = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        if gp not in _sys.path:
            _sys.path.insert(0, gp)
        from chat_gate import status_snapshot
        snap = status_snapshot() or {}
        lanes = snap.get('lanes_detail') or []
        queued = int(snap.get('queue_len') or 0)
        if queued >= 6:
            _push_event('gate', 'warn', '闸门排队积压：%d 个请求排队（%d 车道）' % (queued, len(lanes)), base)
    except Exception:
        pass
    # 5. 对话健康监控：卡死的对话 + 长时间挂起/排队的请求
    try:
        act = snap.get('active') or snap.get('active_list') or []
        for it in act:
            if not isinstance(it, dict):
                continue
            st = it.get('state')
            box = it.get('box') or it.get('model') or '?'
            key = 'act_%s_%s' % (it.get('ticket'), st)
            if st == 'running' and (it.get('run_now') or 0) > 300:
                _push_event('chat_health', 'warn',
                            '对话疑似卡死：%s 已运行 %d 秒无响应（>5 分钟）' % (box, int(it['run_now'])), base)
                # v4.6 自动处置：运行超 10 分钟直接强制回收（闸门有 30 分钟兜底，这里提前介入）
                tk = it.get('ticket')
                if _auto_recover and (it.get('run_now') or 0) > 600 and tk:
                    try:
                        from chat_gate import force_recover
                        if force_recover(tk, '主脑自动处置：运行超 10 分钟无响应'):
                            with _lock:
                                _recovered[tk] = time.time()
                            _push_event('chat_health', 'error',
                                        '已自动强制回收卡死请求：%s（ticket=%s）' % (box, tk), base)
                    except Exception:
                        pass
            elif st == 'queued' and (it.get('wait_now') or 0) > 120:
                _push_event('chat_health', 'warn',
                            '对话请求排队过久：%s 已等待 %d 秒' % (box, int(it['wait_now'])), base)
            elif st == 'holding' and (it.get('hold_left') or 0) > 240:
                _push_event('chat_health', 'warn',
                            '对话长时间挂起（holding）：%s 剩余 %d 秒' % (box, int(it['hold_left'])), base)
        # 模型失败统计（对话错误痕迹）：fail 计数在 boxes 每个对话框条目里
        fails = sum(int((b.get('fail') or 0)) for b in (snap.get('boxes') or [])
                    if isinstance(b, dict))
        try:
            fails = int(fails)
        except (TypeError, ValueError):
            fails = 0
        with _lock:
            last_fail = _state.get('_last_fail_count') or 0
        if fails > last_fail:
            _push_event('chat_health', 'error',
                        '检测到 %d 次新的对话请求失败（累计失败 %d）' % (fails - last_fail, fails), base)
            with _lock:
                _state['_last_fail_count'] = fails
    except Exception:
        pass
    # 6. 对话沉默检测：sessions 表有活跃会话但 chat_history 长时间无新消息且车道在忙
    try:
        import sqlite3 as _sq
        dbp = os.path.join(os.path.dirname(base), 'private', 'db', 'zf3d_canvas.db')
        if not os.path.isfile(dbp):
            dbp = os.path.join(base, 'private', 'db', 'zf3d_canvas.db')
        if os.path.isfile(dbp):
            with _sq.connect(dbp, timeout=2) as _c:
                row = _c.execute('SELECT MAX(created_at) FROM chat_history').fetchone()
            last_msg = (row[0] / 1000.0) if row and row[0] else 0  # 毫秒时间戳转秒
            running_n = sum(1 for i in (act or []) if isinstance(i, dict) and i.get('state') == 'running')
            with _lock:
                prev_running = _state.get('_prev_running') or 0
                _state['_prev_running'] = running_n
            # 上轮在跑、这轮停了、但最近 10 分钟对话没有任何新消息 => 对话可能死掉
            if prev_running > 0 and running_n == 0 and last_msg and time.time() - last_msg > 600:
                _push_event('chat_health', 'error',
                            '对话疑似死亡：请求结束但超过 %d 分钟无任何新消息落库'
                            % int((time.time() - last_msg) / 60), base)
    except Exception:
        pass
    # 4. server.log 尾部错误行（增量读取）
    try:
        logp = os.path.join(base, 'server.log')
        if os.path.isfile(logp):
            posf = os.path.join(_dir(base), '.logpos')
            pos = 0
            try:
                with open(posf, 'r') as f:
                    pos = int(f.read().strip() or 0)
            except (OSError, ValueError):
                pos = max(0, os.path.getsize(logp) - 200000)  # 首次只看尾部 200KB
            size = os.path.getsize(logp)
            if size > pos:
                with open(logp, 'rb') as f:
                    f.seek(pos)
                    chunk = f.read(min(size - pos, 500000)).decode('utf-8', errors='replace')
                try:
                    with open(posf, 'w') as f:
                        f.write(str(size))
                except OSError:
                    pass
                errs = [ln for ln in chunk.splitlines()
                        if ('Traceback' in ln or ' ERROR ' in ln or ln.startswith('ERROR'))]
                for ln in errs[-5:]:
                    _push_event('server_log', 'error', ln.strip()[:200], base)
    except Exception:
        pass
    return len(_events) - n0


# ============================ 大模型调用（独立直连，不占车道） ============================

def _load_model_cfg(base):
    try:
        cfgp = os.path.join(base, 'public', 'config', 'models.json')
        with open(cfgp, 'r', encoding='utf-8-sig') as f:
            data = json.load(f)
        models = [m for m in (data.get('models') or []) if m.get('enabled')]
        if not models:
            return None
        model = next((m for m in models if m.get('isDefault')), models[0])
        # key：private/api_keys.json 按 provider+尾号
        key = ''
        try:
            with open(os.path.join(base, 'private', 'api_keys.json'), 'r', encoding='utf-8-sig') as f:
                keys = json.load(f)
            if isinstance(keys, dict):
                items = keys.get('keys') or keys.get('items') or []
                if isinstance(items, list):
                    tail = str(model.get('keyTail') or model.get('apiKeyTail') or '')
                    for it in items:
                        if str(it.get('tail') or '') == tail or (not tail and it.get('provider') == model.get('provider')):
                            key = str(it.get('key') or '')
                            break
                    if not key and items:
                        key = str(items[0].get('key') or '')
                elif isinstance(items, dict):
                    # v3 格式：{提供方名称: key}，按 baseUrl 特征匹配提供方名称
                    url = str(model.get('endpoint') or model.get('baseUrl') or '').lower()
                    name_map = [('bigmodel', '智谱 GLM'), ('ark', '火山方舟'), ('volces', '火山方舟'),
                                ('deepseek', 'DeepSeek'), ('siliconflow', '硅基流动')]
                    for pat, name in name_map:
                        if pat in url and items.get(name):
                            key = str(items[name])
                            break
                    if not key:
                        for v in items.values():
                            if v:
                                key = str(v)
                                break
        except (OSError, ValueError):
            pass
        url = model.get('endpoint') or model.get('baseUrl') or ''
        return {'url': url, 'key': key, 'model': model.get('modelId') or model.get('name') or ''}
    except Exception:
        return None


def _call_llm(base, messages, max_tokens=600, temperature=0.4):
    """独立 urllib 直连 chat/completions，失败返回 None（静默降级）。"""
    cfg = _load_model_cfg(base)
    if not cfg or not cfg['url']:
        return None
    try:
        payload = json.dumps({'model': cfg['model'], 'messages': messages,
                              'stream': False, 'max_tokens': max_tokens,
                              'temperature': temperature}).encode('utf-8')
        req = urllib.request.Request(cfg['url'], data=payload, method='POST')
        req.add_header('Content-Type', 'application/json')
        if cfg['key']:
            req.add_header('Authorization', 'Bearer ' + cfg['key'])
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=45) as resp:
            data = json.loads(resp.read().decode('utf-8', errors='replace'))
        msg = ((data.get('choices') or [{}])[0]).get('message') or {}
        out = str(msg.get('content') or '').strip()
        if not out:
            # 推理模型：content 为空时回退 reasoning_content
            out = str(msg.get('reasoning_content') or '').strip()
        return out or None
    except Exception:
        with _lock:
            _state['llm_errors'] += 1
        return None


SUMMARY_PROMPT = (
    '你是本项目的「主脑」：一个持续观察项目运行状态的大模型助手。'
    '下面是最近采集到的系统事件摘要（可能为空表示一切平稳）。'
    '请用中文输出一段 200 字以内的状态总结：先一句话总评，再列出需要注意的点（如有 warn/error 逐条给出建议）。'
    '语气简洁专业，不要客套。'
)


def _do_summary(base, why=''):
    """事件驱动总结：取事件池 → 调 LLM → 落盘 summaries/memory → 播报。"""
    with _lock:
        batch = _events[:]
        _events[:] = []
    if not batch and why not in ('manual', '手动触发'):
        return
    lines = ['[%s][%s][%s] %s' % (
        time.strftime('%H:%M:%S', time.localtime(e['ts'])), e['level'], e['kind'], e['text'])
        for e in batch[-40:]]
    user_msg = ('触发原因：%s\n事件池：%d 条\n\n%s' % (why or '定时', len(batch),
                '\n'.join(lines) or '（无新事件，项目平稳运行）'))
    out = _call_llm(base, [{'role': 'system', 'content': SUMMARY_PROMPT},
                           {'role': 'user', 'content': user_msg[:6000]}])
    with _lock:
        _state['llm_calls'] += 1
        _state['last_summary'] = time.time()
    if not out:
        out = '（主脑：本次大模型总结调用失败，已静默降级。事件 %d 条已记录在 events.jsonl。%s）' % (len(batch), lines[-1] if lines else '')
    rec = {'ts': time.time(), 'time': time.strftime('%Y-%m-%d %H:%M:%S'),
           'why': why, 'events': len(batch), 'text': out}
    _append_jsonl(os.path.join(_dir(base), 'summaries.jsonl'), rec, keep=BRAIN_KEEP)
    _save_memory(base, '时间：%s\n触发：%s\n事件数：%d\n\n%s' % (rec['time'], why, len(batch), out))
    with _lock:
        _memory = out
        globals()['_memory'] = out
        _history.append({'role': 'brain', 'kind': 'summary', 'level': 'warn' if batch and
                         any(e['level'] in ('warn', 'error') for e in batch) else 'info',
                         'text': out, 'ts': rec['ts']})
        if len(_history) > 300:
            del _history[:-300]


# ============================ 人工对话（独立会话，不进用户上下文） ============================

CHAT_PROMPT = (
    '你是本项目的「主脑」，一个持续观察项目状态的助手。下面附上你最近的项目记忆与观察摘要。'
    '用中文简洁回答用户关于项目状态/错误/设计的问题；不知道就说不知道，不要编造。'
)


def brain_chat(base, text):
    text = str(text or '').strip()[:4000]
    if not text:
        return {'ok': False, 'error': 'empty'}
    with _lock:
        _history.append({'role': 'user', 'kind': 'user', 'text': text, 'ts': time.time()})
        recent = [m for m in _history[-BRAIN_CTX_TURNS:] if m.get('role') in ('user', 'brain')]
        mem = _memory
    sys_msg = CHAT_PROMPT + '\n\n[主脑记忆]\n' + (mem or '（暂无总结，项目刚被观察）')
    msgs = [{'role': 'system', 'content': sys_msg[:4000]}]
    for m in recent:
        msgs.append({'role': 'user' if m['role'] == 'user' else 'assistant',
                     'content': str(m.get('text') or '')[:2000]})
    out = _call_llm(base, msgs, max_tokens=900)
    if not out:
        out = '（主脑：大模型调用失败，请稍后重试或检查模型配置/网络。）'
    with _lock:
        _state['llm_calls'] += 1
        _history.append({'role': 'brain', 'kind': 'chat', 'level': 'info', 'text': out, 'ts': time.time()})
        if len(_history) > 300:
            del _history[:-300]
        h = _history[-150:]
    # 对话也落盘（独立文件，重启回放用）
    _append_jsonl(os.path.join(_dir(base), 'chats.jsonl'),
                  {'user': text, 'brain': out, 'ts': time.strftime('%Y-%m-%d %H:%M:%S')}, keep=1000)
    return {'ok': True, 'reply': out}


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
