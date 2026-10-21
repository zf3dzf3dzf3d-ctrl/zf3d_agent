#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
loop_s.py - 循环内核化·阶段B：内核最小循环 Loop-S（服务端宿主）

定位（策划案《循环内核化胖内核瘦终端》阶段B）：
- 与浏览器循环 agent-02-loop-core.js 平行的一条最小 ReAct 循环，
  跑在 Python 进程内；浏览器只通过 SSE 订阅事件（阶段B不切默认）。
- 复用 agent_loop.py 的协议约定：OpenAI 兼容响应、
  engine_mod.execute_tool_calls 钩子、MAX_TURNS 防失控、on_event 事件回调。
- 模型调用抽成 model_call(messages, ctx) -> OpenAI 兼容 resp dict：
  * 生产路径（阶段C接线）：POST ctx['_target_url']
  * 测试路径（dry_run）：注入假模型，无外呼即可端到端验证
- 事件流：每 run 一个内存环形缓冲（seq 单调递增），SSE 带 cursor 断点续读；
  浏览器断开不影响循环（与 chat_pool 同一设计约束）。
"""

import os
import json
import time
import threading
import urllib.request
import urllib.error

try:
    MAX_TURNS = max(3, int(os.environ.get('ZF_LOOP_S_MAX_TURNS', '') or 50))
except ValueError:
    MAX_TURNS = 50

# ---------------- 事件流（每 run 一份，进程内） ----------------
_RUNS = {}          # run_id -> dict(events=[...], state=..., result=..., lock, model, ts...)
_RUNS_SEQ = [0]
_RUNS_LOCK = threading.Lock()
_EVENTS_CAP = 5000  # 单 run 事件缓冲上限（环形丢弃最旧）


def _new_run_id():
    with _RUNS_LOCK:
        _RUNS_SEQ[0] += 1
        return 'loop_s_%d_%d' % (_RUNS_SEQ[0], int(time.time() * 1000) % 100000)


def _emit(run, kind, data):
    with run['lock']:
        run['seq'] += 1
        run['events'].append({'seq': run['seq'], 'kind': kind, 'data': data, 'ts': time.time()})
        if len(run['events']) > _EVENTS_CAP:
            del run['events'][: len(run['events']) - _EVENTS_CAP]


def get_run(run_id):
    with _RUNS_LOCK:
        return _RUNS.get(str(run_id or ''))


def events_since(run_id, cursor):
    """返回 seq > cursor 的事件列表；run 不存在返回 None。"""
    run = get_run(run_id)
    if run is None:
        return None
    with run['lock']:
        return [e for e in run['events'] if e['seq'] > int(cursor or 0)]


# ---------------- 模型调用（生产默认路径） ----------------
def default_model_call(messages, ctx):
    """OpenAI 兼容 chat/completions 调用。ctx: {_target_url, _headers, model, ...}"""
    url = str(ctx.get('_target_url') or '').rstrip('/')
    payload = {
        'model': ctx.get('model') or 'default',
        'messages': messages,
    }
    if ctx.get('temperature') is not None:
        payload['temperature'] = ctx['temperature']
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    for k, v in (ctx.get('_headers') or {}).items():
        req.add_header(k, v)
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req, timeout=int(ctx.get('_timeout') or 300)) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def _extract_tool_calls(resp):
    """从 OpenAI 兼容响应取 tool_calls（无则 []）。"""
    try:
        msg = resp['choices'][0]['message']
        return msg.get('tool_calls') or []
    except Exception:
        return []


def _extract_text(resp):
    try:
        return resp['choices'][0]['message'].get('content') or ''
    except Exception:
        return ''


# ---------------- 最小循环内核 ----------------
# ---- D2：A类行为对等补齐（对照 D1 清单 A1/A3/A4/A5/A6/A9/A10/A12/A16） ----
_RESULT_EXIT_LIMIT = 12000   # A6 工具结果出口限额（超长截断+事件留痕）
_LOOP_WARN = 8               # A1 循环检测：同签名 >=8 次警告
_LOOP_FATAL = 16             # A1 循环检测：>=16 次判死循环终止
_STOP_TOOLS = ('task_complete',)  # A5兜底5/A9：终止型工具


def _sanitize_msg(m):
    """A16：移除 reasoning_content 等非标字段（对齐前端 L733）。"""
    if not isinstance(m, dict):
        return m
    return {k: v for k, v in m.items() if k not in ('reasoning_content', 'reasoning', 'thought')}


def _repair_json_args(s):
    """A5兜底1：通用截断 JSON 修复（对齐前端 L1294：补齐缺失的引号/括号）。"""
    s = (s or '').strip()
    if not s:
        return {}
    try:
        return json.loads(s)
    except Exception:
        pass
    for tail in ('"', '}', '"}', "'}", '}}', '}]', '"}]'):
        try:
            return json.loads(s + tail)
        except Exception:
            continue
    return None  # 修复失败，交模型重发


def run_loop_s(engine_mod, messages, ctx, model_call=None, run_id=None):
    """
    阻塞执行：调模型 -> 有 tool_calls 交给 engine_mod.execute_tool_calls -> 回填 -> 再调。
    D2 已对等项：A1 循环检测签名 / A3 每10步软提醒 / A4 截断轮作废 / A5 定向兜底
    （终止型 task_complete 拦截 + arguments JSON 自动修复；write_file 超长、
    run_code codes 批量、task_list 兜底由生产引擎 codex_style 层承接）/ A6 出口限额 /
    A9 task_complete 拦截终局 / A10 stop_flag 停止通道 / A12 网络退避重试+402 终局 /
    A16 消息清洗。A11（每轮重读线路）由 ctx.model 每轮可变承接，A7/A13/A17 属灰度后置。
    返回 run dict（state: done/stopped/max_turns/error）。
    """
    model_call = model_call or default_model_call
    run_id = run_id or _new_run_id()
    run = {'run_id': run_id, 'seq': 0, 'events': [], 'lock': threading.Lock(),
           'state': 'running', 'result': None, 'ts': time.time(),
           'stop_flag': False, 'sigs': {}, 'trunc_streak': 0}
    with _RUNS_LOCK:
        _RUNS[run_id] = run
    ctx = dict(ctx or {})
    ctx['_run_id'] = run_id
    msgs = [_sanitize_msg(m) for m in (messages or []) if isinstance(m, dict)]

    def _call_with_retry(ms):
        """A12：网络异常指数退避重试 3 次；402 余额耗尽直接终局；400/401 上抛。"""
        last = None
        for i in range(3):
            try:
                return model_call(ms, ctx)
            except urllib.error.HTTPError as e:
                if e.code == 402:
                    raise RuntimeError('402 余额耗尽，run 终止')
                last = e
                if e.code in (400, 401):
                    raise
            except RuntimeError:
                raise
            except Exception as e:
                last = e
            time.sleep(2 ** i)
        raise last

    try:
        for turn in range(1, MAX_TURNS + 1):
            if run.get('stop_flag'):  # A10：停止通道
                run['state'] = 'stopped'
                _emit(run, 'stopped', {'turn': turn})
                return run
            _emit(run, 'turn_start', {'turn': turn, 'n_messages': len(msgs)})
            if turn % 10 == 0:  # A3：每 10 步软提醒（对齐前端 L143/L202）
                msgs.append({'role': 'system',
                             'content': '【提醒】已进行 %d 轮，请评估进度避免低效徘徊；若已完成请调用 task_complete 收尾。' % turn})
            try:
                resp = _call_with_retry(msgs)
            except RuntimeError as e:
                run['state'] = 'error'
                run['result'] = str(e)
                _emit(run, 'error', {'err': str(e)})
                return run
            choice = (resp.get('choices') or [{}])[0]
            msg = choice.get('message') or {}
            tool_calls = msg.get('tool_calls') or []
            finish = choice.get('finish_reason') or ''
            _emit(run, 'model_reply', {'turn': turn, 'tool_calls': len(tool_calls),
                                       'text_len': len(_extract_text(resp)), 'finish': finish})
            # A4：截断保护 —— finish=length 且无 tool_calls：整轮作废，最多重试 2 次
            if finish == 'length' and not tool_calls:
                run['trunc_streak'] += 1
                _emit(run, 'loop_warning', {'turn': turn, 'why': 'truncated_reply_discarded',
                                            'streak': run['trunc_streak']})
                if run['trunc_streak'] <= 2:
                    msgs.append({'role': 'user',
                                 'content': '[系统] 上一轮回复因长度截断已作废，请精简后重答；若已完成直接调用 task_complete。'})
                    continue
                run['state'] = 'error'
                run['result'] = '连续截断（truncation loop）'
                _emit(run, 'error', {'err': run['result']})
                return run
            run['trunc_streak'] = 0
            if not tool_calls:
                run['state'] = 'done'
                run['result'] = _extract_text(resp)
                _emit(run, 'done', {'turn': turn, 'result': run['result']})
                return run
            # A1：循环检测 —— 同签名（工具名+参数前200字）重复计数
            sig = json.dumps([[(tc.get('function') or {}).get('name'),
                               str((tc.get('function') or {}).get('arguments'))[:200]]
                              for tc in tool_calls])
            run['sigs'][sig] = run['sigs'].get(sig, 0) + 1
            c = run['sigs'][sig]
            if c >= _LOOP_FATAL:
                run['state'] = 'error'
                run['result'] = '检测到死循环（同签名重复 %d 次）' % c
                _emit(run, 'loop_fatal', {'turn': turn, 'sig_count': c})
                return run
            if c >= _LOOP_WARN:
                _emit(run, 'loop_warning', {'turn': turn, 'sig_count': c})
                msgs.append({'role': 'user', 'content': '[系统] 检测到重复工具调用签名，请改变策略。'})
            # A5兜底5/A9：终止型工具 task_complete 拦截并终局（不等引擎）
            final = None
            for tc in tool_calls:
                name = ((tc.get('function') or {}).get('name') or '').strip()
                if name in _STOP_TOOLS:
                    parsed = _repair_json_args((tc.get('function') or {}).get('arguments') or '{}') or {}
                    final = str(parsed.get('text') or parsed.get('message')
                                or parsed.get('result') or '')[:4000] or '(task_complete 无正文)'
                    break
            if final is not None:
                run['state'] = 'done'
                run['result'] = final
                _emit(run, 'done', {'turn': turn, 'result': final, 'via': 'task_complete'})
                return run
            # A5兜底1：arguments JSON 修复；修复失败回错误给模型重发
            fixed_calls = []
            for tc in tool_calls:
                fn = tc.get('function') or {}
                if isinstance(fn.get('arguments'), str):
                    repaired = _repair_json_args(fn['arguments'])
                    if repaired is None:
                        _emit(run, 'tool_result', {'turn': turn, 'tool_call_id': tc.get('id'), 'ok': False})
                        msgs.append({'role': 'tool', 'tool_call_id': tc.get('id'),
                                     'content': '[参数 JSON 解析失败且自动修复无效，请重新以合法 JSON 发起该工具调用]'})
                        continue
                    if repaired != fn['arguments']:
                        tc = dict(tc)
                        tc['function'] = dict(fn)
                        tc['function']['arguments'] = json.dumps(repaired, ensure_ascii=False)
                        _emit(run, 'tool_repaired', {'turn': turn, 'tool_call_id': tc.get('id')})
                fixed_calls.append(tc)
            if not fixed_calls:
                continue
            # 工具执行（引擎钩子，与 agent_loop.py 同约定）
            results = []
            if hasattr(engine_mod, 'execute_tool_calls'):
                results = engine_mod.execute_tool_calls(fixed_calls, ctx) or []
            for r in results:
                content = r.get('content', '') if isinstance(r, dict) else str(r)
                if len(content) > _RESULT_EXIT_LIMIT:  # A6：出口限额+事件留痕（对齐前端 L1788）
                    _emit(run, 'tool_result_truncated',
                          {'tool_call_id': r.get('tool_call_id'), 'orig_len': len(content)})
                    content = content[:_RESULT_EXIT_LIMIT] + '\n[已截断，原文已存档可找回]'
                    r = dict(r)
                    r['content'] = content
                _emit(run, 'tool_result', {'turn': turn,
                                           'tool_call_id': r.get('tool_call_id'),
                                           'ok': bool(r.get('_ok', True)), 'len': len(content)})
                msgs.append({'role': 'tool', 'tool_call_id': r.get('tool_call_id'),
                             'content': content})
            # 保守补齐：模型消息本身要回填（含 tool_calls 字段），同步清洗非标字段
            msgs.append(_sanitize_msg(msg))
        run['state'] = 'max_turns'
        run['result'] = ''
        _emit(run, 'max_turns', {'max_turns': MAX_TURNS})
    except Exception as e:
        run['state'] = 'error'
        run['result'] = str(e)
        _emit(run, 'error', {'err': str(e)})
    return run


def request_stop(run_id):
    """A10：停止通道 —— 置 stop_flag，循环下一轮检查后终止（对齐前端 L79）。"""
    run = get_run(run_id)
    if run is None:
        return False
    run['stop_flag'] = True
    _emit(run, 'stop_requested', {'run_id': run_id})
    return True


def start_async(engine_mod, messages, ctx, model_call=None):
    """后台线程跑，立即返回 run_id（供 HTTP 端点用）。
    D3: ctx._dry_gate=True 时（dry 通道联调）给引擎包审批闸门。"""
    if (ctx or {}).get('_dry_gate') and (ctx or {}).get('_run_id') is None:
        engine_mod = _approval_engine(engine_mod)
        ctx.setdefault('_approval_whitelist',
                       ['read_file', 'search_in_files', 'find_files', 'file_info',
                        'tree_dir', 'read_lines', 'list_dir'])
    rid = _new_run_id()
    t = threading.Thread(target=run_loop_s,
                         args=(engine_mod, messages, ctx, model_call, rid),
                         daemon=True, name='loop_s_' + rid)
    t.start()
    return rid


# ---------------- 审批状态机（阶段C） ----------------
# pending -> approved / rejected；超时 -> queued（继续等待）；硬超时 -> auto_reject
try:
    APPROVAL_TIMEOUT = max(5, int(os.environ.get('ZF_APPROVAL_TIMEOUT', '') or 120))
except ValueError:
    APPROVAL_TIMEOUT = 120
try:
    APPROVAL_HARD_TIMEOUT = max(APPROVAL_TIMEOUT, int(os.environ.get('ZF_APPROVAL_HARD_TIMEOUT', '') or 3600))
except ValueError:
    APPROVAL_HARD_TIMEOUT = 3600

_APPROVALS = {}            # req_id -> {req_id, run_id, tool, args, status, reason, ts, resolved_ts}
_APPROVAL_SEQ = [0]
_APPROVAL_LOCK = threading.Lock()


def _approval_of(req_id):
    with _APPROVAL_LOCK:
        return _APPROVALS.get(str(req_id or ''))


def resolve_approval(req_id, action, reason=''):
    """审批回调：action in {approve, reject}。返回 (ok, approval_or_None)。"""
    a = _approval_of(req_id)
    if a is None:
        return False, None
    with a['cond']:
        if a['status'] in ('approved', 'rejected', 'auto_rejected'):
            return False, a  # 幂等：已决不再改
        a['status'] = 'approved' if action == 'approve' else 'rejected'
        a['reason'] = reason or a['reason']
        a['resolved_ts'] = time.time()
        a['cond'].notify_all()
    run = get_run(a['run_id'])
    if run:
        _emit(run, 'approval_resolved', {'req_id': req_id, 'action': a['status'],
                                         'tool': a['tool'], 'reason': a['reason']})
    return True, a


def list_approvals(status=None):
    with _APPROVAL_LOCK:
        items = [dict(v) for v in _APPROVALS.values()]
    if status:
        items = [a for a in items if a['status'] == status]
    items.sort(key=lambda a: -a['ts'])
    for a in items:
        a.pop('cond', None)
    return items


def request_approval(run, tool_call, ctx):
    """阻塞等待单条工具调用的审批。返回 'approved' | 'rejected'。
    超过 APPROVAL_TIMEOUT 转 queued（继续等并通知前端），硬超时自动拒绝。"""
    name = (tool_call.get('function') or {}).get('name') or ''
    args = (tool_call.get('function') or {}).get('arguments') or ''
    with _APPROVAL_LOCK:
        _APPROVAL_SEQ[0] += 1
        req_id = 'apr_%d_%d' % (_APPROVAL_SEQ[0], int(time.time() * 1000) % 100000)
        a = {'req_id': req_id, 'run_id': run['run_id'], 'tool': name,
             'args': str(args)[:2000], 'status': 'pending', 'reason': '',
             'ts': time.time(), 'resolved_ts': None, 'cond': threading.Condition()}
        _APPROVALS[req_id] = a
    _emit(run, 'approval_request', {'req_id': req_id, 'tool': name,
                                    'args': a['args']})
    start = time.time()
    queued = False
    with a['cond']:
        while a['status'] == 'pending':
            waited = time.time() - start
            if waited >= APPROVAL_HARD_TIMEOUT:
                a['status'] = 'auto_rejected'
                a['reason'] = 'hard timeout %ss' % APPROVAL_HARD_TIMEOUT
                a['resolved_ts'] = time.time()
                break
            if not queued and waited >= APPROVAL_TIMEOUT:
                queued = True
                a['status'] = 'queued'
                a['cond'].notify_all()
                break  # 跳出条件等待，转轮询阶段（cond 不再被 notify 唤醒之外的场景阻塞）
            a['cond'].wait(timeout=1.0)
        # queued 状态：继续轮询等待人工决议（不再限时转别的状态，硬超时兜底）
        if a['status'] == 'queued':
            while a['status'] == 'queued':
                if time.time() - start >= APPROVAL_HARD_TIMEOUT:
                    a['status'] = 'auto_rejected'
                    a['reason'] = 'hard timeout %ss' % APPROVAL_HARD_TIMEOUT
                    a['resolved_ts'] = time.time()
                    break
                a['cond'].wait(timeout=1.0)
    final = a['status']
    if final in ('auto_rejected',):
        _emit(run, 'approval_resolved', {'req_id': req_id, 'action': final,
                                         'tool': name, 'reason': a['reason']})
    _emit(run, 'approval_gate', {'req_id': req_id, 'tool': name, 'decision': final})
    return 'approved' if final in ('approved',) else 'rejected'


def _approval_engine(base_engine_mod):
    """给生产引擎包一层审批闸门：白名单工具直接放行，其余逐条 request_approval。
    被拒/自动拒的工具不送底层引擎，由包装层回填拒绝性 tool 结果。"""
    class _Gated:
        @staticmethod
        def execute_tool_calls(tool_calls, ctx, **kw):
            calls = list(tool_calls or [])
            run = get_run((ctx or {}).get('_run_id'))
            whitelist = set((ctx or {}).get('_approval_whitelist') or [])
            allowed, denied = [], []
            for tc in calls:
                name = (tc.get('function') or {}).get('name') or ''
                if name in whitelist:
                    allowed.append(tc)
                    continue
                if run is not None:
                    dec = request_approval(run, tc, ctx)
                else:
                    dec = 'rejected'  # 无 run 上下文（不可能路径），保守拒绝
                (allowed if dec == 'approved' else denied).append(tc)
            results = []
            if allowed:
                try:
                    results = base_engine_mod.execute_tool_calls(allowed, ctx, **kw) or []
                except TypeError:
                    results = base_engine_mod.execute_tool_calls(allowed, ctx) or []
            by_id = {r.get('tool_call_id'): r for r in results if isinstance(r, dict)}
            for tc in denied:
                results.append({'tool_call_id': tc.get('id'), '_ok': False,
                                'content': '[审批拒绝] 该工具调用未获批准（approval gate）'})
            # 保序回原顺序
            out = []
            for tc in calls:
                out.append(by_id.get(tc.get('id')) or
                           {'tool_call_id': tc.get('id'), '_ok': False,
                            'content': '[审批拒绝] 该工具调用未获批准（approval gate）'})
            return out
    return _Gated


def get_production_engine():
    """阶段C生产引擎：codex_style 引擎 + 审批闸门。导入失败退拒绝性占位。"""
    try:
        from engines.codex_style import engine as base
        return _approval_engine(base)
    except Exception:
        class _Placeholder:
            @staticmethod
            def execute_tool_calls(tool_calls, ctx):
                return [{'tool_call_id': tc.get('id'), '_ok': False,
                         'content': 'loop_s: 生产引擎导入失败，调用被拒绝'}]
        return _Placeholder


def _dry_engine():
    class _E:
        calls = []
        @staticmethod
        def execute_tool_calls(tool_calls, ctx):
            _E.calls.append(tool_calls)
            return [{'tool_call_id': tc.get('id'), 'content': 'TOOL_OK', '_ok': True}
                    for tc in tool_calls]
    return _E


def dry_model_call_factory(script):
    """script: 逐轮响应列表，用尽后返回纯文本终态。"""
    it = {'i': 0}

    def _call(messages, ctx):
        i = it['i']; it['i'] += 1
        if i < len(script):
            return script[i]
        return {'choices': [{'message': {'role': 'assistant',
                                         'content': 'DRY_RUN_FINAL'}}]}
    return _call
