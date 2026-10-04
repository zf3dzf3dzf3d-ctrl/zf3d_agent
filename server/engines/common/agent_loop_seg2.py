# -*- coding: utf-8 -*-
# 拆分分段模块：由原 agent_loop.py 按行段【无改动】切分，由同名门面加载合并。
def run_agent_loop(engine_id, engine_mod, messages, ctx, on_event=None):
    """通用 agent 循环。返回 OpenAI 兼容响应 dict。"""
    # 每轮工具调用写入 app_logs（便于在日志面板排查引擎工具链问题）
    _log_box_id = ''
    try:
        from routes.mixin_base import db_write_log as _dbw
        _log_box_id = str((ctx.get('payload') or {}).get('_box_id') or '')

        def _loop_db_log(level, action, detail):
            try:
                _dbw(level, _log_box_id, action, '[%s] %s' % (engine_id, detail))
            except Exception:
                pass
    except Exception:
        def _loop_db_log(level, action, detail):
            pass
    _loop_db_log('info', 'engine-loop-start', 'agent循环启动 | messages=%d' % len(messages or []))

    # 超速模式：剥离外围，只保留主链路
    _turbo = _is_turbo(ctx)

    # ===== 全量落库（方案A）：agent 循环每条消息实时写入 agent_turns 表 =====
    _turn_session = '' if _turbo else str(ctx.get('_session_id')
                        or ctx.get('_box_id')
                        or (ctx.get('payload') or {}).get('session_id') or '')
    _turn_turnno = int(time.time())  # 用启动时间戳作为本轮循环的批次号
    _turn_idx = 0

    def _persist(role, content):
        """把循环内产生的每条消息（assistant 工具调用 / tool 结果）实时落库。"""
        nonlocal _turn_idx
        _turn_idx += 1
        if not _turn_session:
            return
        try:
            from db import write_agent_turn as _wat
            _wat(_turn_session, _turn_turnno, role, str(content or ''), _log_box_id)
        except Exception as _pe:  # 【修复 2026-09-22】关键路径：消息落库失败必须留痕（否则对话历史无声丢失）
            _log('[WARN] persist agent_turn failed (session=%s role=%s): %r'
                 % (_turn_session, role, _pe))

    # 循环开始前，把用户最后的问题也落库（role=user）
    try:
        _last_user = next((m for m in reversed(messages or [])
                           if isinstance(m, dict) and m.get('role') == 'user'), None)
        if _last_user is not None:
            _persist('user', _last_user.get('content') or '')
    except Exception as _ue:  # 【修复 2026-09-22】用户消息提取失败留痕
        _log('[WARN] extract last user message failed: %r' % (_ue,))

    if hasattr(engine_mod, 'validate_messages'):
        messages = engine_mod.validate_messages(messages or [])
    messages = list(messages or [])

    hooks = {
        'compact': getattr(engine_mod, 'compact_messages', None),
        'schemas': getattr(engine_mod, 'get_tool_schemas', None),
        'exec': getattr(engine_mod, 'execute_tool_calls', None),
    }
    tool_schemas = hooks['schemas']() if hooks['schemas'] else None

    # ===== 蜂群工具内核级注入：所有引擎通用（此前只挂在 codex_style，其他引擎看不到该工具）=====
    _swarm_names = ('swarm_dispatch', 'swarm_collect', 'swarm_status')
    try:
        from engines.common.swarm_tools import get_schemas as _swarm_schemas
        _have = {s.get('function', {}).get('name') for s in (tool_schemas or []) if isinstance(s, dict)}
        _extra = [s for s in _swarm_schemas() if s.get('function', {}).get('name') not in _have]
        if _extra:
            tool_schemas = list(tool_schemas or []) + _extra
    except Exception as _sw_e:
        _log('[loop] swarm schema inject failed: %s' % _sw_e)

    # ===== 蜂巢使用指引内核级注入：所有引擎通用（提示词引导不再只写 codex_style）=====
    try:
        _swarm_hint = ("\n[蜂巢/蜂群并行] 当任务包含 3 个以上独立子任务（多文件分析、多个问题、"
                       "批量检查、并行草稿等），你必须优先调用 swarm_dispatch 把子任务并发派发"
                       "给后台蜂群，再用 swarm_collect(batch_id) 收集结果，而不是自己逐个完成。"
                       "蜂巢在后台用多个 LLM 并发跑子任务，更快更省。主动使用。\n")
        _first_sys = next((m for m in messages if isinstance(m, dict) and m.get('role') == 'system'), None)
        if _first_sys is not None and 'swarm_dispatch' not in str(_first_sys.get('content') or ''):
            _first_sys['content'] = str(_first_sys.get('content') or '') + _swarm_hint
        elif _first_sys is None and messages:
            messages.insert(0, {'role': 'system', 'content': _swarm_hint.strip()})
    except Exception as _sw_e2:
        _log('[loop] swarm hint inject failed: %s' % _sw_e2)

    def _swarm_exec_wrap(tool_calls, _ctx):
        # 蜂群工具拦截执行；其余工具透传给引擎原执行器（并行工具也保留）
        swarm_tcs = [tc for tc in tool_calls if _tc_name(tc) in _swarm_names]
        rest = [tc for tc in tool_calls if _tc_name(tc) not in _swarm_names]
        out = []
        if rest:
            out.extend(hooks['exec'](rest, _ctx) or [])
        if swarm_tcs:
            from engines.common.swarm_tools import execute as _swarm_exec
            for tc in swarm_tcs:
                tc_id = tc.get('id') or ''
                args = tc.get('arguments') or tc.get('function', {}).get('arguments') or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except Exception:
                        args = {}
                try:
                    ok, result = _swarm_exec(_tc_name(tc), args, _ctx)
                except Exception as e:
                    ok, result = False, 'swarm error: %s' % e
                out.append({'tool_call_id': tc_id, 'role': 'tool', 'content': result, '_ok': ok})
        return out
    # ===== MCP 工具 schema 注入 + 名称集合（供 _mcp_exec_wrap 分发）=====
    _mcp_names = set()
    try:
        from extensions import mcp as _mcp_mod
        _have_mcp = {s.get('function', {}).get('name') for s in (tool_schemas or []) if isinstance(s, dict)}
        _mcp_extra = [s for s in _mcp_mod.get_agent_tools()
                      if s.get('function', {}).get('name') not in _have_mcp]
        if _mcp_extra:
            tool_schemas = list(tool_schemas or []) + _mcp_extra
            _mcp_names = {s['function']['name'] for s in _mcp_extra}
            _log('[loop] mcp schema inject: %d tools' % len(_mcp_extra))
    except Exception as _mcp_e:
        _log('[loop] mcp schema inject failed: %s' % _mcp_e)

    # ===== MCP 执行分发（对齐大厂规格）：mcp_* 工具走 MCP 长连接通道 =====
    _swarm_orig_exec = _swarm_exec_wrap
    def _mcp_exec_wrap(tool_calls, _ctx):
        _mcp_tcs = [tc for tc in tool_calls if _tc_name(tc) in _mcp_names]
        _rest = [tc for tc in tool_calls if _tc_name(tc) not in _mcp_names]
        _out = list(_swarm_orig_exec(_rest, _ctx) or []) if _rest else []
        if _mcp_tcs:
            from extensions import mcp as _mcp_mod2
            for tc in _mcp_tcs:
                tc_id = tc.get('id') or ''
                _a = tc.get('arguments') or tc.get('function', {}).get('arguments') or {}
                if isinstance(_a, str):
                    try:
                        _a = json.loads(_a)
                    except Exception:
                        _a = {}
                try:
                    _r = _mcp_mod2.call_mcp_tool(_tc_name(tc), _a)
                    _ok, _c = True, json.dumps(_r, ensure_ascii=False)[:20000]
                except Exception as e:
                    _ok, _c = False, 'mcp error: %s' % e
                _out.append({'tool_call_id': tc_id, 'role': 'tool', 'content': _c, '_ok': _ok})
        return _out

    final_response = None
    # 【A1】预算硬上限：本轮循环可用 token 预算（0=不启用），_spent 累计
    _budget = _budget_check()
    _spent = 0
    for turn in range(1, MAX_TURNS + 1):
        # 【A1】请求发出前先查预算：超限 → 收口快照 + 强制总结，不再调上游工具
        if _budget > 0 and _spent >= _budget:
            _snap = _budget_snapshot_save(engine_id, messages, _spent, _budget)
            _log('[%s] turn %d: token budget %d exhausted (spent %d), snapshot -> %s'
                 % (engine_id, turn, _budget, _spent, _snap or 'FAILED'))
            try:
                if on_event:
                    on_event({'type': 'budget_exhausted', 'turn': turn,
                              'spent': _spent, 'budget': _budget, 'snapshot': _snap})
            except Exception:
                pass
            messages.append({'role': 'user', 'content':
                '[agent_loop] TOKEN_BUDGET (%d) reached (spent %d). Tool calls are now disabled. '
                'Summarize what was done and answer directly.%s'
                % (_budget, _spent, (' 快照已落盘: %s' % _snap) if _snap else '')})
            payload = dict(ctx.get('payload') or {})
            payload['messages'] = messages
            payload.pop('tools', None)
            final_response = _call_upstream(ctx, payload)
            return final_response
        # 【断点策略已改】save 移到本轮工具执行+结果回填之后（见下方 save_ckpt_after_tools）：
        # 断点状态恒为"本轮工具已执行完"，重启续跑只重发上游请求，不会重复执行工具副作用。
        if hooks['compact']:
            send_messages = hooks['compact']([dict(m) for m in messages])
        else:
            send_messages = messages
        # ===== 轮次折叠（v5.4.6）：上下文超 70% 窗口时把早期轮次折叠为摘要，末2轮保护 =====
        try:
            send_messages = _fold_history(send_messages)
        except Exception as _fold_e:
            _log('[loop] fold_history failed: %r' % _fold_e)

        payload = dict(ctx.get('payload') or {})
        payload['messages'] = send_messages
        if tool_schemas:
            payload['tools'] = tool_schemas
        # 引擎模型偏好：manifest.preferred_model 优先于上层 payload 里的 model
        _m = _engine_preferred_model(engine_id)
        if _m:
            payload['model'] = _m

        if on_event:
            try:
                on_event({'type': 'loop_turn', 'turn': turn})
            except Exception:
                pass
        _log('[%s] turn %d: %d messages -> upstream' % (engine_id, turn, len(send_messages)))

        resp = _call_upstream(ctx, payload)
        # 【A1】累计本轮 usage
        _spent += _budget_usage(resp)
        message = _extract_message(resp)
        if message is None:
            # 上游没有合法 choices：原样返回，让上层报错
            _log('[%s] turn %d: invalid upstream response' % (engine_id, turn))
            return resp

        tool_calls = _extract_tool_calls(message)

        # ===== 批量工具调用防护（v5.4.7）=====
        # 案例：glm-5.3-flash 曾在单条响应里输出 632 个 run_code（echo p1..p632 探测刷屏），
        # 循环照单全收导致刷屏失控。加两道闸：
        #  ① 单轮 tool_calls 数量上限（默认 16，超出截断并提示）
        #  ② 探测式刷屏熔断：先对【原始完整批次】做去重判定（先检测后截断），
        #     同名工具+参数去数字后高度雷同（如 echo p1..p632）→ 单轮判定即整批作废熔断
        _deferred_clamp_note = None
        if tool_calls:
            # 探测式刷屏检测：必须在截断【之前】用原始完整批次判定（v5.4.7b），
            # 否则截断后的前 16 个签名互不相同，uniq_ratio=1.0 永远不触发熔断。
            # 签名规则：同名工具 + 参数去掉数字后的"形状"，echo p1/p2/p3... 归为同类。
            import re as _re
            def _probe_sig(tc):
                _args = tc.get('arguments') or ''
                _shape = _re.sub(r'\d+', '#', _args)[:40]
                return (tc.get('name') or '', _shape)
            _total_calls = len(tool_calls)
            _sigs = [_probe_sig(tc) for tc in tool_calls]
            _uniq_ratio = (len(set(_sigs)) / float(len(_sigs))) if _sigs else 1.0
            _short_probe = all(len(tc.get('arguments') or '') <= 24 for tc in tool_calls)
            # 探测刷屏：数量多(>=8)、参数全部超短、去掉数字后高度雷同 → 整批作废熔断
            if _total_calls >= 8 and _short_probe and _uniq_ratio < 0.5:
                _log('[%s] turn %d: probe-spam detected (%d similar short tool_calls), circuit-break'
                     % (engine_id, turn, _total_calls))
                try:
                    on_event({'type': 'loop_probe_spam', 'turn': turn, 'count': _total_calls})
                except Exception:
                    pass
                messages.append({'role': 'user', 'content':
                    ('[系统提示] 检测到你一次性发起了 %d 个高度相似的工具调用（疑似循环探测）。'
                     '这类调用已全部作废、不会执行。请停止重复调用工具，'
                     '改用一条能获取所需信息的完整命令（或直接读取文件/目录），'
                     '然后基于结果给出最终回答。') % _total_calls})
                _persist('user', messages[-1]['content'])
                continue
            # 数量截断：超限部分丢弃执行，assistant 消息只保留前 N 个 tool_call，
            # 并注入提示告知模型有调用被丢弃（避免模型基于缺失结果继续推理）
            _MAX_BATCH = 16
            if _total_calls > _MAX_BATCH:
                _dropped = _total_calls - _MAX_BATCH
                _log('[%s] turn %d: %d tool_calls exceed batch limit %d, keep first %d, drop %d'
                     % (engine_id, turn, _total_calls, _MAX_BATCH, _MAX_BATCH, _dropped))
                tool_calls = tool_calls[:_MAX_BATCH]
                try:
                    on_event({'type': 'loop_batch_clamped', 'turn': turn,
                              'total': _total_calls, 'kept': _MAX_BATCH, 'dropped': _dropped})
                except Exception:
                    pass
                messages.append({'role': 'user', 'content':
                    ('[系统提示] 你本轮发起了 %d 个工具调用，超出单轮上限 %d 个。'
                     '其中后 %d 个已被丢弃、不会执行（工具结果也不会返回）。'
                     '请只针对已执行的前 %d 个调用的结果继续推理；'
                     '若还有其他操作必须做，请在后续轮次逐批发起，不要一次打包过多调用。')
                    % (_total_calls, _MAX_BATCH, _dropped, _MAX_BATCH)})
                _persist('user', messages[-1]['content'])
                # 延迟注入：user 提示等 assistant(tool_calls) 入历史之后再 append，
                # 报文顺序变为 assistant(16个tool_calls) → user提示 → tool结果，语义更顺；
                # assistant 消息内 tool_calls 与截断后列表一致（严格上游不报 400）。
                _deferred_clamp_note = messages.pop()

        # ===== 截断保护：finish_reason=length 时本批 tool_call 可能是半截 JSON =====
        # 不执行、不回填（半截 arguments 执行会出错，回填会让下一轮请求被上游 400 拒绝）。
        # 改为作废本批工具调用，注入继续提示让模型从中断处续写。
        _finish_reason = ((resp.get('choices') or [{}])[0] or {}).get('finish_reason')
        if tool_calls and _finish_reason == 'length':
            _log('[%s] turn %d: response truncated (finish_reason=length) with %d tool_calls, discard and continue'
                 % (engine_id, turn, len(tool_calls)))
            try:
                on_event({'type': 'loop_truncated', 'turn': turn,
                          'detail': '输出被截断，含未完成工具调用，已作废并请求续写'})
            except Exception:
                pass
            messages.append({
                'role': 'user',
                'content': ('[系统提示] 你的上一条回复因达到最大输出长度被截断，其中包含未完成的工具调用，已全部作废（不会执行）。'
                            '请从中断处继续：重新发起完整、合法的工具调用；若已无必要调用工具，则直接给出最终回答。'),
            })
            _persist('user', messages[-1]['content'])
            continue

        if not tool_calls:
            # 最终回答，循环结束
            _log('[%s] turn %d: final answer (%d chars)' % (
                engine_id, turn, len(str(message.get('content') or ''))))
            _persist('assistant', message.get('content') or '')
            return resp

        # 有工具调用：先把 assistant 消息（含 tool_calls）入历史
        # 【修复 400】必须用 OpenAI 标准格式（type:'function' + function:{name,arguments}），
        # 之前直接放简化后的 tool_calls 列表，第二轮请求被上游 400 拒绝，
        # 导致 mixin_proxy 回退透传、前端执行 codex_* 工具报"未知工具"。
        messages.append({
            'role': 'assistant',
            'content': message.get('content') or '',
            'tool_calls': [
                {
                    'id': tc.get('id') or '',
                    'type': 'function',
                    'function': {'name': tc.get('name') or '', 'arguments': tc.get('arguments') or '{}'},
                }
                for tc in tool_calls if isinstance(tc, dict)
            ],
        })
        _persist('assistant', json.dumps(messages[-1], ensure_ascii=False))

        # 截断分支的 user 提示延迟到此处注入（在 assistant 之后、tool 结果之前）
        if _deferred_clamp_note is not None:
            messages.append(_deferred_clamp_note)
            _deferred_clamp_note = None

        # 交给引擎自己的执行器（审批/单步纪律由引擎决定）
        if not hooks['exec']:
            # 引擎没有执行器却返回了工具调用：直接终止，避免死循环
            _log('[%s] engine has no execute_tool_calls, abort at turn %d' % (engine_id, turn))
            return resp
        results = _mcp_exec_wrap(tool_calls, ctx) or []
        # ===== 监督师 post-hook：开关开启时静态规则检查；警报延迟到 tool 结果注入完之后再追加 =====
        # （OpenAI 协议要求 assistant(tool_calls) 后必须紧跟全部 tool 消息，中间不能夹 user 消息）
        _sv_alerts = []
        try:
            import supervisor as _sv
            # 轨迹记录（每轮，摘要级）：模型说的话摘要 + 调用的工具名，不含工具结果
            try:
                _sv_say = str(message.get('content') or '').strip()[:120]
                if _sv_say:
                    _sv.record_trajectory(turn, '说: %s' % _sv_say)
                for _tc in tool_calls:
                    _sv_name = str((_tc.get('function') or {}).get('name') or _tc.get('name') or '?')
                    _sv.record_trajectory(turn, '调用工具: %s' % _sv_name)
            except Exception:
                pass
            _sv_alerts = _sv.inspect(tool_calls, turn, engine_id, on_event) or []
        except Exception as _sv_e:
            try:
                print('[loop] supervisor hook failed (ignored): %s' % _sv_e)
            except Exception:
                pass
        # 每轮工具调用写入 app_logs：工具名+参数摘要+结果摘要，便于排查
        # turbo 下跳过详细日志，但保留一行轮次痕迹（否则 turbo 慢时无法定位轮数失控）
        if _turbo:
            try:
                _loop_db_log('info', 'engine-tool-call',
                             'turbo turn %d tools=%s' % (turn, ','.join(
                                 str(((tc.get('function') or {}).get('name')) or tc.get('name') or '?')
                                 for tc in tool_calls)))
            except Exception:
                pass
        if not _turbo:
            for _tc, _r in zip(tool_calls, results):
                try:
                    _ok = bool(_r.get('_ok', True)) if isinstance(_r, dict) else True
                    _loop_db_log('info' if _ok else 'error', 'engine-tool-call',
                                 'turn %d 工具 %s(%s) -> %s | 结果: %s' % (
                                     turn, _tc.get('name', '?'), str(_tc.get('arguments', ''))[:150],
                                     'OK' if _ok else 'ERR',
                                     str((_r or {}).get('content', ''))[:200] if isinstance(_r, dict) else '?'))
                except Exception:
                    pass
        # 工具执行期间引擎累积的事件（audit/proposal 等）实时转发给前端
        _pending_events = ctx.pop('_tool_events', None) or []
        for ev in _pending_events:
            if on_event:
                try:
                    on_event({'type': 'tool_event', 'turn': turn, 'kind': ev.get('kind'), 'data': ev.get('data')})
                except Exception:
                    pass
        # 工具名透传给打回器（存档文件名可读）；超大/失败结果打回：落盘存档+回填短通知
        for _tc, _r in zip(tool_calls, results):
            if isinstance(_r, dict) and isinstance(_tc, dict):
                _r.setdefault('tool_name', (_tc.get('function') or {}).get('name') or _tc.get('name') or '')
        results = _reject_tool_results(results, {'max_chars': TURBO_REJECT_MAX_CHARS, 'head_tail_keep': TURBO_HEAD_TAIL_KEEP} if _turbo else None)
        for r in results:
            if isinstance(r, dict) and r.get('role') == 'tool':
                entry = {'role': 'tool', 'tool_call_id': r.get('tool_call_id') or r.get('id') or '',
                         'content': str(r.get('content') or '')}
                messages.append(entry)
                _persist('tool', json.dumps(entry, ensure_ascii=False))
                if on_event:
                    try:
                        on_event({'type': 'tool_result', 'turn': turn,
                                  'tool_call_id': entry['tool_call_id'],
                                  'ok': bool(r.get('_ok', True)),
                                  'preview': entry['content'][:200]})
                    except Exception:
                        pass

        # ===== 监督师 LLM 巡检：每 10 轮把轻量轨迹交给 LLM 判定（同步、失败静默），警报同样延迟注入 =====
        try:
            import supervisor as _sv2
            _sv_task = str(ctx.get('_original_task') or '')
            if not _sv_task:
                # 退化：取 messages 里第一条 user 消息当任务目标
                for _m in messages:
                    if isinstance(_m, dict) and _m.get('role') == 'user' and str(_m.get('content') or '').strip():
                        _sv_task = str(_m.get('content'))[:500]
                        break
            for _ltxt in _sv2.llm_watch(_sv_task, turn, engine_id, on_event):
                _sv_alerts.append(_ltxt)
        except Exception as _sv2_e:
            try:
                print('[loop] supervisor llm_watch failed (ignored): %s' % _sv2_e)
            except Exception:
                pass

        # ===== 监督师警报注入：在全部 tool 消息追加完之后，避免违反消息顺序协议 =====
        for _alert_txt in _sv_alerts:
            try:
                messages.append({'role': 'user', 'content': _alert_txt})
                _persist('user', _alert_txt)
            except Exception:
                pass

        # ===== 蜂群来信注入：不阻塞主脑，每轮检查小弟是否完成，完成后作为消息"送达" =====
        try:
            import dispatch_swarm as _dsw
            _mails = _dsw.poll_notifications()
            for _m in _mails:
                _txt = ('[蜂群来信] 批次 %s 已全部完成（成功 %d/%d，失败 %d）。'
                        '完整产出已落盘: %s 。请尽快调用 swarm_collect("%s", wait_sec=0) '
                        '读取小弟产出并纳入你的工作。' % (
                            _m['batch_id'], _m['done'] - _m['failed'], _m['total'],
                            _m['failed'], _m.get('saved_to') or '(落盘失败)', _m['batch_id']))
                if _m.get('failed_ids'):
                    _txt += ' 失败小弟: %s（可用 swarm_status 查看失败原因）。' % ','.join(_m['failed_ids'])
                messages.append({'role': 'user', 'content': _txt})
                if on_event:
                    try:
                        on_event({'type': 'tool_event', 'turn': turn, 'kind': 'swarm_mail',
                                  'data': {'batch_id': _m['batch_id'], 'done': _m['done'], 'total': _m['total']}})
                    except Exception:
                        pass
        except Exception as _swm_e:
            _log('[loop] swarm mail poll failed: %s' % _swm_e)

        if turn == MAX_TURNS:
            # 到达上限：注入提示让模型总结，不再执行工具
            messages.append({'role': 'user', 'content':
                '[agent_loop] MAX_TURNS (%d) reached. Tool calls are now disabled. '
                'Summarize what was done and answer directly.' % MAX_TURNS})
            payload = dict(ctx.get('payload') or {})
            payload['messages'] = messages
            payload.pop('tools', None)
            final_response = _call_upstream(ctx, payload)
            _log('[%s] max turns reached, forced summary' % engine_id)
            return final_response

    # 理论上不会到这里
    return final_response or {'choices': [{'message': {'role': 'assistant', 'content': ''}}]}
