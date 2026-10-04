# -*- coding: utf-8 -*-
# 拆分分段模块：由原 dispatch_swarm.py 按行段【无改动】切分，由同名门面加载合并。
def _run_subtask(batch_id, task_id, goal, context, model_name, track='auto', allowed_tools=None, trace_id=None):
    """线程池 worker：跑一个子任务并写回结果。任何异常都不能让线程崩掉。"""
    _allow = set(str(n) for n in allowed_tools) if allowed_tools else None  # 局部变量，线程安全
    t0 = time.time()
    _hb = _Heartbeat(batch_id, task_id)   # 心跳/取消：running 状态写状态文件，可被 cancel 置位
    # D1 轻量链路追踪：子任务写一条 span（start/end 带同一 trace_id，可按 trace_id 串起全批链路）
    _span = None
    try:
        import trace_core as _tc
        _t = _tc.Trace(trace_id or _tc.new_trace_id('sw'))
        _span = _t.span('subtask', name='%s/%s' % (batch_id, task_id))
    except Exception:
        _span = None
    messages = []
    result = {'status': 'failed', 'output': '未知错误', 'model': model_name or '',
              'elapsed': round(time.time() - t0, 1)}
    try:
        # 赛道选模：未显式指定模型时按 track 分配（strong/fast/auto）
        if not model_name:
            model_name = _pick_model_by_track(track, goal)
        model = _resolve_model(model_name)
        messages = [
            {'role': 'system', 'content':
                '你是蜂巢（蜂群）子智能体，被主控派发执行子任务。你可以使用主控的全部工具'
                '（文件读写、代码运行、搜索、浏览器等，见工具列表），工作目录=项目根目录，路径用相对路径。'
                '规则：1) 先做再问，不要反问、不要寒暄；2) 一轮内尽量并行发出多个独立工具调用；'
                '3) 结论/产出为主，输出精炼；4) 读完文件必须在最终回复列出关键内容；'
                '5) 目标达成后立即停止调用工具、直接给出最终结论。'
                '6) 动手前先在心里把【子任务】目标复述一遍：要做的是什么、产出给谁用；'
                '如果目标里有验收标准(accept)，把它当作唯一的完成判据，结束时逐条对照，不满足就继续做或如实说明差距；'
                '不要做目标之外的事、不要改与目标无关的文件。'
                '双路验证协议：涉及删除/覆盖/加密/改配置等不可逆或关键操作时，必须先独立推理两次'
                '（两次都基于事实重新推导，不抄第一次结论），两次结论一致才执行；不一致时不要自作主张二选一，'
                '在最终回复开头标注【双路不一致】并分别列出两条结论及分歧点，交由主控裁决。'},
            {'role': 'user', 'content':
                '【子任务】\n' + goal +
                ('\n\n【上下文（主控提供，含项目背景与已完成产出，供直接使用）】\n' + context if context else '')}
        ]
        try:
            import requests as _rq
            # 朱峰底层全工具：schema 来自主控注册表，注册表失败则回退极简工具
            # 工具 schema 直接用对话框定义（单一事实源）；拿不到再回落 codex 注册表/蜂巢极简集
            dialog_tools = _load_dialog_tool_defs()
            if dialog_tools:
                tools = list(dialog_tools.values())
            else:
                full_tools, full_reg = _get_full_tools()
                tools = full_tools if full_tools else SWARM_MINI_TOOLS
            # 工具白名单继承：allowed_tools 非空时只暴露白名单内工具
            if allowed_tools:
                _allow = set(str(n) for n in allowed_tools)
                tools = [t for t in tools if (t.get('function', {}).get('name') or t.get('name')) in _allow]
            content = ''
            for _round in range(_MAX_TOOL_ROUNDS):
                _hb.tick()
                if _hb.cancelled:
                    result = {'status': 'cancelled', 'output': '子任务被主控取消',
                              'model': model_name or '', 'elapsed': round(time.time() - t0, 1)}
                    return result
                payload = {'model': model['model_id'], 'messages': messages,
                           'temperature': 0.3, 'max_tokens': 16384,
                           'tools': tools}
                # [抗网络抖动] 超时/连接中断/5xx/429 指数退避重试，绝不一次抖动就判死
                _last_net_err = None
                r = None
                for _net_try in range(4):
                    try:
                        r = _rq.post(model['base'] + '/chat/completions',
                                     json=payload,
                                     headers={'Authorization': 'Bearer ' + model['key']},
                                     timeout=TASK_TIMEOUT)
                        if r.status_code in (429, 500, 502, 503, 504) and _net_try < 3:
                            _last_net_err = RuntimeError('HTTP %s' % r.status_code)
                            time.sleep(2 * (2 ** _net_try))
                            continue
                        break
                    except (_rq.exceptions.Timeout, _rq.exceptions.ConnectionError,
                            _rq.exceptions.ChunkedEncodingError) as _ne:
                        _last_net_err = _ne
                        if _net_try < 3:
                            time.sleep(2 * (2 ** _net_try))
                            continue
                        raise
                if _last_net_err is not None and r is None:
                    raise _last_net_err
                r.raise_for_status()
                msg = r.json()['choices'][0]['message']
                content = msg.get('content') or ''
                tool_calls = msg.get('tool_calls') or []
                if not tool_calls:
                    break
                messages = messages + [msg]
                for tc in tool_calls:
                    fn = (tc.get('function') or {}).get('name') or ''
                    try:
                        args = __import__('json').loads((tc.get('function') or {}).get('arguments') or '{}')
                    except Exception:
                        args = {}
                    if _allow and fn not in _allow:
                        ok, out = False, '工具 %s 不在本批次白名单内，已拒绝执行' % fn
                    else:
                        ok, out = _exec_dialog_tool(fn, args)
                        if not ok and not _load_dialog_tool_defs():
                            # 对话框注册表不可用时回落内置极简实现
                            ok, out = _exec_tool(fn, args)
                    out = ('ok: ' if ok else 'error: ') + str(out)[:_MAX_OUTPUT_CHARS]
                    messages.append({'role': 'tool',
                                     'tool_call_id': tc.get('id') or '',
                                     'content': out[:_MAX_OUTPUT_CHARS]})
                content = ''  # 还有工具轮，最终以无工具调用那轮为准
            if not content.strip():
                # 兜底：不带工具、禁思考再要一次纯文本总结
                try:
                    content = _chat(model, messages[-2:] + [{'role': 'user', 'content': '请直接给出你的最终结论，不要调用任何工具。'}])
                except Exception:
                    content = ''
            if not content.strip():
                # 最终兜底：从工具结果里提取关键信息拼成产出
                tool_lines = [m2['content'][:200] for m2 in messages if m2.get('role') == 'tool']
                if tool_lines:
                    content = '[工具结果汇总]\n' + '\n---\n'.join(tool_lines[-3:])
            result = {'status': 'done', 'output': content,
                      'model': model['name'], 'elapsed': round(time.time() - t0, 1)}
        except Exception as e:
            result = {'status': 'failed', 'output': str(e)[:500],
                      'model': model_name or '', 'elapsed': round(time.time() - t0, 1)}
            # 条件触发仲裁：失败且开启开关时，自动换备用模型重跑一次
            try:
                if os.environ.get('ZF_SWARM_ARBITRATE', '1').strip() in ('1', 'true', 'yes'):
                    cur_name = (locals().get('model') or {}).get('name') or (model_name or '')
                    for fb in _fallback_models(cur_name):
                        try:
                            fb_model = _resolve_model(fb)
                            content = _chat(fb_model, messages)
                            result = {'status': 'done', 'output': content,
                                      'model': fb_model['name'] + '(仲裁重跑)',
                                      'elapsed': round(time.time() - t0, 1)}
                            break
                        except Exception:
                            continue
            except Exception as e2:
                result = {'status': 'failed', 'output': (str(e) + ' | 仲裁失败: ' + str(e2))[:500],
                          'model': model_name or '', 'elapsed': round(time.time() - t0, 1)}
    except Exception as e:
        # 模型解析等前置失败也必须有结果，不能让线程崩掉
        result = {'status': 'failed', 'output': str(e)[:500],
                  'model': model_name or '', 'elapsed': round(time.time() - t0, 1)}
    finally:
        # D1: 结束子任务 span（观测永不影响主流程）
        if _span is not None:
            try:
                _span.end(status=result.get('status') or 'failed',
                          model=result.get('model'), elapsed=result.get('elapsed'))
            except Exception:
                pass
        # 无论成功失败，必须把结果写回批次表并唤醒 collect，绝不留挂死任务
        try:
            with _COND:
                b = _BATCHES.get(batch_id)
                if b:
                    for t in b['tasks']:
                        if t['id'] == task_id:
                            t.update(result)
                            t['ended_at'] = time.time()
                            break
                    b['done_count'] = sum(1 for t in b['tasks']
                                          if t['status'] in ('done', 'failed'))
                    if b['done_count'] >= len(b['tasks']):
                        b['status'] = 'done'
                    _COND.notify_all()
        except Exception:
            pass


# ---------- 对外接口 ----------

def submit(tasks, model_name=None, shared_context='', allowed_tools=None):
    """提交一批子任务并立刻并发启动。
    tasks: [{goal: str, context: str(可选)}]
    allowed_tools: 工具白名单(list[str])，非空时子任务只暴露这些工具（继承对话框配置）。
                   None/空 = 不过滤，用对话框全量工具定义（兼容旧行为）。
    返回 batch_id + 每个子任务 id。"""
    if not tasks or not isinstance(tasks, list):
        raise ValueError('tasks 不能为空')
    tasks = tasks[:20]  # 单批上限
    batch_id = 'sw-' + uuid.uuid4().hex[:10]
    now = time.time()
    # D1: 每批生成 trace_id，批次事件落 trace JSONL，子任务继承同一 trace_id
    _trace_id = None
    try:
        import trace_core as _tc
        _trace_id = _tc.new_trace_id('sw')
        _tc.Trace(_trace_id).event('swarm', name='batch/%s' % batch_id,
                                   status='running', tasks=len(tasks))
    except Exception:
        _trace_id = None
    batch = {'id': batch_id, 'status': 'running', 'created_at': now,
             'done_count': 0, 'tasks': [], 'trace_id': _trace_id}
    for i, tk in enumerate(tasks):
        goal = str((tk or {}).get('goal') or '').strip()
        if not goal:
            continue
        tid = 'st-%d-%s' % (i + 1, uuid.uuid4().hex[:6])
        task = {'id': tid, 'goal': goal[:20000], 'status': 'running',
                'context': str((tk or {}).get('context') or '')[:60000],
                'track': str((tk or {}).get('track') or 'auto').lower(),
                'output': '', 'started_at': now, 'ended_at': None}
        batch['tasks'].append(task)
        _EXECUTOR.submit(_run_subtask, batch_id, tid,
                         task['goal'], task['context'], model_name,
                         task.get('track') or 'auto',
                         allowed_tools, _trace_id)
    with _LOCK:
        _BATCHES[batch_id] = batch
        # GC：只留最近 MAX_BATCHES 批
        if len(_BATCHES) > MAX_BATCHES:
            for k in sorted(_BATCHES, key=lambda k: _BATCHES[k]['created_at'])[:-MAX_BATCHES]:
                b = _BATCHES[k]
                if b['status'] == 'done':
                    del _BATCHES[k]
    return batch_id


def status(batch_id):
    """查批次进度。"""
    with _LOCK:
        b = _BATCHES.get(batch_id)
        if not b:
            return None
        return {'id': b['id'], 'status': b['status'],
                'total': len(b['tasks']), 'done': b['done_count'],
                'tasks': [{'id': t['id'], 'goal': t['goal'][:60],
                           'status': t['status'],
                           'output': t.get('output', ''),
                           'elapsed': t.get('elapsed')}
                          for t in b['tasks']]}


def collect(batch_id, wait_sec=0):
    """回收结果。wait_sec>0 时最多等这么久直到批次完成。"""
    deadline = time.time() + max(0, wait_sec if wait_sec else 0)
    # [2026-09-30] 应用户要求改为"不成功绝不返回"：无上限等待直到批次全部收口。
    # 原逻辑 min(wait_sec, 600) 的 600 秒硬上限已移除——批次有任务没完成就一直挂起等待。
    with _COND:
        b = _BATCHES.get(batch_id)
        if not b:
            return None
        b['collected'] = b.get('collected', 0) + 1  # 回收计数（可观测性）
        # 回收即落盘：把每个小弟的完整产出持久化到文件，
        # 即使主控上下文被压缩/指针化，也能从文件找回，不丢失小弟成果。
        if b['status'] == 'done' and b.get('collected', 0) == 1:
            try:
                import io as _io
                _dir = os.path.join(_SWARM_WORKDIR, '蜂群回收')
                os.makedirs(_dir, exist_ok=True)
                _fp = os.path.join(_dir, '%s.md' % b['id'])
                with _io.open(_fp, 'w', encoding='utf-8') as _f:
                    _f.write('# 蜂群批次 %s 回收记录\n\n' % b['id'])
                    for _t in b['tasks']:
                        _f.write('## 小弟 %s（%s，%s，耗时%ss）\n目标: %s\n\n产出:\n%s\n\n---\n' % (
                            _t['id'], _t.get('status'), _t.get('model', ''),
                            _t.get('elapsed'), _t['goal'], _t.get('output', '')))
                b['saved_to'] = _fp
            except Exception:
                pass  # 落盘失败不影响回收
            # D1: 批次回收时落一条批次级结束事件（带 trace_id + 各子任务状态）
            if b.get('trace_id'):
                try:
                    import trace_core as _tc
                    _tc.Trace(b['trace_id']).event(
                        'swarm', name='batch/%s' % b['id'],
                        status='done', collected=len(b['tasks']),
                        ok=sum(1 for _t in b['tasks'] if _t.get('status') == 'done'))
                except Exception:
                    pass
        while b['status'] != 'done' and time.time() < deadline:
            _COND.wait(timeout=1)
        return {'id': b['id'], 'status': b['status'],
                'total': len(b['tasks']), 'done': b['done_count'],
                'tasks': [{'id': t['id'], 'goal': t['goal'], 'status': t['status'],
                           'output': t.get('output', ''), 'model': t.get('model', ''),
                           'elapsed': t.get('elapsed')}
                          for t in b['tasks']]}


def poll_notifications():
    """非阻塞轮询：返回自上次轮询以来新完成的批次（小弟给主脑发的消息）。
    主脑 agent loop 每轮调用一次，把'小弟完成'作为消息注入对话，主脑不用阻塞等待。"""
    msgs = []
    with _LOCK:
        for b in _BATCHES.values():
            if b['status'] == 'done' and not b.get('notified'):
                b['notified'] = True
                b['collected'] = b.get('collected', 0)
                if not b.get('saved_to'):
                    # 首次通知时也落盘（即使主脑不主动 collect，成果也不丢）
                    try:
                        import io as _io
                        _dir = os.path.join(_SWARM_WORKDIR, '蜂群回收')
                        os.makedirs(_dir, exist_ok=True)
                        _fp = os.path.join(_dir, '%s.md' % b['id'])
                        with _io.open(_fp, 'w', encoding='utf-8') as _f:
                            _f.write('# 蜂群批次 %s 回收记录\n\n' % b['id'])
                            for _t in b['tasks']:
                                _f.write('## 小弟 %s（%s，%s，耗时%ss）\n目标: %s\n\n产出:\n%s\n\n---\n' % (
                                    _t['id'], _t.get('status'), _t.get('model', ''),
                                    _t.get('elapsed'), _t['goal'], _t.get('output', '')))
                        b['saved_to'] = _fp
                    except Exception:
                        pass
                fails = [t for t in b['tasks'] if t['status'] == 'failed']
                msgs.append({
                    'batch_id': b['id'],
                    'done': b['done_count'], 'total': len(b['tasks']),
                    'failed': len(fails),
                    'saved_to': b.get('saved_to'),
                    'failed_ids': [t['id'] for t in fails],
                })
    return msgs


def list_batches():
    with _LOCK:
        return [{'id': b['id'], 'status': b['status'],
                 'total': len(b['tasks']), 'done': b['done_count'],
                 'created_at': b['created_at']}
                for b in _BATCHES.values()]


def mermaid(batch_id):
    """生成某批次的 mermaid 状态流程图文本（可直接贴进对话渲染）。"""
    with _LOCK:
        b = _BATCHES.get(batch_id)
        if not b:
            return None
        tasks = [(t['id'], t['goal'][:30], t['status'], t.get('elapsed'),
                  t.get('output', '') or '')
                 for t in b['tasks']]
        bstat, bdone, btotal = b['status'], b['done_count'], len(b['tasks'])
        bcol = b.get('collected', 0)
    head = b['id']
    if bstat == 'done' and bcol > 0:
        rec = '已回收(第%d次)' % bcol
    elif bstat == 'done':
        rec = '待回收'
    else:
        rec = '回收: 等待完成'
    lines = ['flowchart TD',
             '  D0["蜂群批次 %s<br/>状态: %s<br/>完成 %d/%d<br/>🔁 %s"]' % (
                 head[:20], bstat, bdone, btotal, rec)]
    for tid, goal, st, el, out in tasks:
        label = '%s<br/>%s' % (tid[:14], goal.replace('"', "'"))
        dropped = ('[已丢弃' in out) or ('[已截断' in out) or ('已丢弃' in out[-80:])
        if st == 'done':
            if dropped:
                node = '  %s["⚠️ %s%s<br/>结果已丢弃→get_tool_result查回"]:::warn' % (
                    tid, label, ('<br/>%.1fs' % el) if el else '')
            else:
                node = '  %s["✅ %s%s"]:::ok' % (tid, label, ('<br/>%.1fs' % el) if el else '')
        elif st == 'failed':
            node = '  %s["❌ %s"]:::bad' % (tid, label)
        else:
            node = '  %s["⏳ %s<br/>运行中"]:::run' % (tid, label)
        lines.append(node)
        lines.append('  D0 --> %s' % tid)
    lines.append('  classDef ok fill:#1a4d2e,stroke:#4caf50,color:#fff;')
    lines.append('  classDef bad fill:#5c1a1a,stroke:#f44336,color:#fff;')
    lines.append('  classDef run fill:#4d3a1a,stroke:#ffc107,color:#fff;')
    lines.append('  classDef warn fill:#5c3a1a,stroke:#ff9800,color:#fff;')
    return '\n'.join(lines)
