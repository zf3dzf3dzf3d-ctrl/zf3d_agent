# -*- coding: utf-8 -*-
# 拆分分段模块：由原 main_brain.py 按行段【无改动】切分，由同名门面加载合并。
# 注：本分段模块被门面加载时依赖门面已导入的 os/json/re 等；为支持隔离加载，
#     此处显式补 import re（_strip_cot 依赖）。
import re  # noqa: F401  (_strip_cot 使用)
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
        # v3 dpapi 加密 key 解密（secure_store.decrypt_value，明文原样返回）
        try:
            import sys as _sys, os as _os
            _sd = _os.path.dirname(_os.path.abspath(__file__))
            if _sd not in _sys.path:
                _sys.path.insert(0, _sd)
            from secure_store import decrypt_value as _dv
            key = _dv(key)
        except Exception:
            if str(key).startswith('dpapi:'):
                key = ''  # 解密失败宁缺勿泄
        url = model.get('endpoint') or model.get('baseUrl') or ''
        return {'url': url, 'key': key, 'model': model.get('modelId') or model.get('name') or ''}
    except Exception:
        return None


def _call_llm(base, messages, max_tokens=600, temperature=0.4, tools=None):
    """独立 urllib 直连 chat/completions，失败返回 None（静默降级）。
    v4.8 带 tools 时返回原始 message dict（含 tool_calls），否则返回纯文本。"""
    cfg = _load_model_cfg(base)
    if not cfg or not cfg['url']:
        with _lock:
            _state['llm_errors'] += 1
            if not cfg:
                _state['llm_last_error'] = '未取到模型配置（模型未选择或 models.json 不可读）'
            elif not cfg['url']:
                _state['llm_last_error'] = '模型配置缺少 endpoint/baseUrl（url 为空）'
        return None
    try:
        payload = {'model': cfg['model'], 'messages': messages,
                   'stream': False, 'max_tokens': max_tokens,
                   'temperature': temperature}
        if tools:
            payload['tools'] = tools
        req = urllib.request.Request(cfg['url'], data=json.dumps(payload).encode('utf-8'), method='POST')
        req.add_header('Content-Type', 'application/json')
        if cfg['key']:
            req.add_header('Authorization', 'Bearer ' + cfg['key'])
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=60) as resp:
            data = json.loads(resp.read().decode('utf-8', errors='replace'))
        msg = ((data.get('choices') or [{}])[0]).get('message') or {}
        if tools:
            return msg or None
        out = str(msg.get('content') or '').strip()
        if not out:
            # 推理模型：content 为空时回退 reasoning_content
            out = str(msg.get('reasoning_content') or '').strip()
        return out or None
    except urllib.error.HTTPError as e:
        _err_body = ''
        try:
            _err_body = e.read().decode('utf-8', errors='replace')[:300]
        except Exception:
            pass
        with _lock:
            _state['llm_errors'] += 1
            _state['llm_last_error'] = 'HTTP %s %s: %s' % (e.code, e.reason, _err_body)
        return None
    except Exception as e:
        with _lock:
            _state['llm_errors'] += 1
            _state['llm_last_error'] = '%s: %s' % (type(e).__name__, str(e)[:300])
        return None


# ============================ 极简工具集（v4.8 主脑就地修复能力） ============================
import subprocess

_FJ = {'type': 'string', 'description': '相对项目根目录的路径'}
BRAIN_TOOLS_SPEC = [
    {'type': 'function', 'function': {'name': 'read_file', 'description': '读取项目内文本文件（最多 8000 字符）',
        'parameters': {'type': 'object', 'properties': {'path': _FJ}, 'required': ['path']}}},
    {'type': 'function', 'function': {'name': 'write_file', 'description': '写入/覆盖项目内文本文件（原文件自动备份 .bak）',
        'parameters': {'type': 'object', 'properties': {'path': _FJ, 'content': {'type': 'string', 'description': '完整文件内容'}}, 'required': ['path', 'content']}}},
    {'type': 'function', 'function': {'name': 'run_code', 'description': '在项目根目录执行 shell 命令（限时 30 秒，输出截断 4000 字符），用于诊断与修复验证',
        'parameters': {'type': 'object', 'properties': {'code': {'type': 'string', 'description': 'shell 命令'}}, 'required': ['code']}}},
    {'type': 'function', 'function': {'name': 'search_in_files', 'description': '在项目目录内按关键词搜索文件内容（返回匹配行）',
        'parameters': {'type': 'object', 'properties': {'keyword': {'type': 'string'}, 'path': {'type': 'string', 'description': '搜索根目录，默认 server'}}, 'required': ['keyword']}}},
]


def _safe_path(base, p):
    """路径收敛到项目根目录内，防越界。返回绝对路径或 None。"""
    p = str(p or '').strip()
    if not p:
        return None
    root = os.path.abspath(base)
    ap = os.path.abspath(os.path.join(root, p))
    if ap != root and not ap.startswith(root + os.sep):
        return None
    return ap


def _brain_tool_exec(base, name, args):
    """执行主脑工具，返回字符串结果（直接给回模型）。"""
    try:
        if name == 'read_file':
            ap = _safe_path(base, args.get('path'))
            if not ap or not os.path.isfile(ap):
                return '错误：文件不存在或路径越界：%s' % args.get('path')
            with io.open(ap, 'r', encoding='utf-8', errors='replace') as f:
                return f.read(8000)
        if name == 'write_file':
            ap = _safe_path(base, args.get('path'))
            if not ap:
                return '错误：路径越界或为空'
            # 黑板写前检查：防多智能体并发写同一文件冲突
            try:
                from engines.common import project_blackboard as _pbb
                if _pbb.bb_enabled():
                    _owner = 'main-brain:%s' % uuid.uuid4().hex[:8]
                _r = _pbb.bb_acquire('brain', [ap], _owner, role='brain:write_file', hint='')
                if not _r.get('ok'):
                    _cs = _r.get('conflicts') or []
                    _who = '、'.join(str(c.get('owner') or '?') for c in _cs)
                    return '⛔ 黑板占用冲突：%s 正在被 %s 开发，请稍后再试或提醒用户裁决。' % (os.path.basename(ap), _who)
                try:
                    _pbb.bb_release('brain', [ap], _owner)
                except Exception:
                    pass
            except Exception:
                pass
            os.makedirs(os.path.dirname(ap) or base, exist_ok=True)
            if os.path.isfile(ap):
                shutil.copy2(ap, ap + '.bak')
            with io.open(ap, 'w', encoding='utf-8') as f:
                f.write(str(args.get('content') or ''))
            return 'OK：已写入 %s（%d 字符，原文件备份为 .bak）' % (args.get('path'), len(str(args.get('content') or '')))
        if name == 'run_code':
            code = str(args.get('code') or '').strip()
            if not code:
                return '错误：命令为空'
            try:
                from engines.common.shell_exec import _inject_git_c
                code = _inject_git_c(code, base)
                # P0 沙箱：统一走 Job Object 资源围栏（off/非 Windows/导入失败时直通）
                _sandbox_hit = False
                try:
                    from engines.common.sandbox import sandbox_mode as _sm, run_isolated as _ri
                    if _sm() == 'job':
                        r = _ri(code, timeout=30, cwd=base, shell=True)
                        _sandbox_hit = True
                except ImportError:
                    pass
                if not _sandbox_hit:
                    r = subprocess.run(code, shell=True, cwd=base, capture_output=True,
                                       timeout=30)
                out = r.stdout.decode('utf-8', errors='replace')[:3000]
                err = r.stderr.decode('utf-8', errors='replace')[:1000]
                return 'exit=%d\nstdout:\n%s\nstderr:\n%s' % (r.returncode, out or '（空）', err or '（空）')
            except subprocess.TimeoutExpired:
                return '错误：命令超时（30 秒上限）'
        if name == 'search_in_files':
            kw = str(args.get('keyword') or '')
            root = _safe_path(base, args.get('path') or 'server') or base
            hits = []
            for dp, dns, fns in os.walk(root):
                dns[:] = [d for d in dns if d not in ('.git', 'node_modules', '__pycache__', 'private')]
                for fn in fns:
                    if len(hits) >= 20:
                        break
                    if not fn.endswith(('.py', '.js', '.json', '.html', '.css', '.md', '.txt', '.log')):
                        continue
                    fp = os.path.join(dp, fn)
                    try:
                        with io.open(fp, 'r', encoding='utf-8', errors='replace') as f:
                            for i, ln in enumerate(f, 1):
                                if kw in ln:
                                    hits.append('%s:%d: %s' % (os.path.relpath(fp, base), i, ln.strip()[:200]))
                                    if len(hits) >= 20:
                                        break
                    except OSError:
                        pass
            return '\n'.join(hits) if hits else '无匹配（或超过 20 条截断）'
        # 【2026-10-01 修复】智能体广场三工具接入（发帖失败"未知工具"）
        if name in ('forum_read', 'forum_write', 'forum_reply'):
            try:
                from engines.common.forum_bbs_bridge import forum_exec as _fx
                return _fx(name, args)
            except Exception as _fe:
                return '错误：广场工具加载失败 %s' % _fe
        # 【2026-10-02】图片工作台 AI 工具接入（wb_list/wb_apply，识图修图一句话完成）
        if name in ('wb_list', 'wb_apply'):
            try:
                from engines.common.workbench_bridge import workbench_exec as _wx
                return _wx(name, args)
            except Exception as _we:
                return '错误：工作台工具加载失败 %s' % _we
        return '错误：未知工具 %s' % name
    except Exception as e:
        return '工具执行异常：%s' % e


BRAIN_MAX_TOOL_ROUNDS = 8   # 单次人工对话最多工具往返轮数



SUMMARY_PROMPT = (
    '你是本项目的「主脑」：一个持续观察项目运行状态的大模型助手。'
    '下面是最近采集到的系统事件摘要（可能为空表示一切平稳）。'
    '请用中文输出一段 200 字以内的状态总结：先一句话总评，再列出需要注意的点（如有 warn/error 逐条给出建议）。'
    '语气简洁专业，不要客套。'
)


_COT_MARKERS = ('Let me analyze', 'Let me think', '<think>', '</think>',
                'First,', 'Okay,', "I'll ", "I'm going to", 'Alright,',
                'The user wants', 'I need to output', 'Let me', 'I should')


def _strip_cot(text):
    """剥离主脑输出中混入的英文思维链/推理草稿，只保留最终中文结论。

    v3 策略（修复 v2 两个 bug：取最后一个结论行会吃掉总评段；截断后不复检）：
    ① 剔除 <think>...</think>；
    ② 起点取【第一个】中文结论前缀行（保住"总评+注意点"两段式的第一段）；
    ③ 终点：从起点向后找第一个含 CoT 标记的行，截断到它之前（用标记定终点）；
    ④ 脏输出校验：中文占比过低 / 中文字数过少视为脏输出，返回 None；
    ⑤ 长度保护：超 500 字截断，末行无结尾标点视为被截断的半句，剔除；
    ⑥ 截断/剔除后【复跑】④ 校验，内容太少同样返回 None（防退化成孤行残条）。
    返回干净结论文本；判定为脏输出时返回 None（由调用方决定重试/丢弃）。
    """
    _COT_MARKERS_LOCAL = _COT_MARKERS + ('Also', 'Note:', 'Actually', 'Draft')
    def _validate(s):
        if not s:
            return None
        cjk = len(re.findall(r'[\u4e00-\u9fff]', s))
        if cjk < 15 or cjk * 10 < len(s) * 3:
            return None
        return s
    if not text:
        return None
    _CONC_PREFIX = ('总结', '总评', '结论', '注意', '问题', '建议', '状态', '本次', '当前', '项目', '系统', '无新', '无报错', '无异常')
    def _is_conclusion(s):
        if not s or not any(s.startswith(p) for p in _CONC_PREFIX):
            return False
        cjk = len(re.findall(r'[\u4e00-\u9fff]', s))
        return cjk * 10 > len(s) * 3  # 该行中文占比 > 30%
    # ① 剔除 <think>...</think>
    text = re.sub(r'<think>[\s\S]*?(</think>|$)', '', text).strip()
    if not text:
        return None
    lines = text.splitlines()
    # ② 找第一个结论行起点
    start = -1
    for i, ln in enumerate(lines):
        if _is_conclusion(ln.strip()):
            start = i
            break
    if start < 0:
        # 无任何结论前缀行：若整体中文占优且长度合理，视为干净直出
        cjk = len(re.findall(r'[\u4e00-\u9fff]', text))
        if cjk * 2 > len(text) and len(text) <= 400:
            return text
        return None
    # ③ 从起点向后找第一个含 CoT 标记的行，截断到它之前
    end = len(lines)
    for i in range(start, len(lines)):
        s = lines[i].strip()
        if s and any(m in s for m in _COT_MARKERS_LOCAL):
            end = i
            break
    out = '\n'.join(lines[start:end]).strip()
    # ④ 脏输出校验
    out = _validate(out)
    if not out:
        return None
    # ⑤ 长度保护 + 末尾半句剔除
    out = out[:500]
    last = out.rstrip().splitlines()[-1].rstrip()
    if last and not last.endswith(('。', '！', '？', '；', '：', '.', '!', '?', ';', ':', '）', ')', '"', '」')):
        out = '\n'.join(out.rstrip().splitlines()[:-1]).rstrip()
    # ⑥ 截断/剔除后复跑校验，防退化成孤行残条
    return _validate(out)


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
        with _lock:
            _llm_err = _state.get('llm_last_error') or '未知原因（可能未配置模型）'
        out = ('（主脑：本次大模型总结调用失败，已静默降级。事件 %d 条已记录在 events.jsonl。'
               '[失败原因] %s。%s）' % (len(batch), _llm_err, lines[-1] if lines else ''))
        out = _strip_cot(out) or ('（主脑：本次总结输出为脏数据（思维链草稿），已丢弃。事件 %d 条见 events.jsonl。）' % len(batch))
    else:
        cleaned = _strip_cot(out)
        if not cleaned:
            # 脏输出：整段思维链/英文草稿 → 重试一次（禁思考、强调纯中文直接输出）
            retry = _call_llm(base, [
                {'role': 'system', 'content': SUMMARY_PROMPT + '\n【重要】直接输出最终中文总结正文，禁止任何思考过程、英文或草稿。'},
                {'role': 'user', 'content': user_msg[:6000]}])
            with _lock:
                _state['llm_calls'] += 1
            cleaned = _strip_cot(retry) if retry else None
        out = cleaned if cleaned else ('（主脑：本次总结输出为脏数据（思维链草稿），已丢弃。事件 %d 条见 events.jsonl。）' % len(batch))
    rec = {'ts': time.time(), 'time': time.strftime('%Y-%m-%d %H:%M:%S'),
           'why': why, 'events': len(batch), 'text': out}
    _append_jsonl(os.path.join(_dir(base), 'summaries.jsonl'), rec, keep=BRAIN_KEEP)
    # 脏输出（重试后仍为思维链草稿）不覆盖 memory.md，保留上一版干净记忆
    if not out.startswith('（主脑：本次总结输出为脏数据'):
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
    '你拥有极简工具集（read_file / write_file / run_code / search_in_files），'
    '发现系统问题（如对话请求失败、服务报错）时应主动用工具定位并就地修复，而不是只给建议：'
    '先 read_file / search_in_files 定位，再 write_file / run_code 修复与验证，修完汇报改了什么。'
    '工具只允许操作本项目目录内的文件；不确定的事就如实说，不要编造。'
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
    # v4.8 工具循环：模型可多轮调用极简工具就地定位并修复问题
    tool_log = []
    for _round in range(BRAIN_MAX_TOOL_ROUNDS):
        msg = _call_llm(base, msgs, max_tokens=1200, tools=BRAIN_TOOLS_SPEC)
        if not msg:
            with _lock:
                _le = str(_state.get('llm_last_error') or '未知错误（可能未配置模型或网络不通）')
            out = '（主脑：大模型调用失败。最近错误：%s）' % _le[:300]
            break
        tcs = msg.get('tool_calls') or []
        content = str(msg.get('content') or '').strip()
        if not tcs:
            if not content:
                rc = str(msg.get('reasoning_content') or '').strip()
                out = rc or '（主脑：模型返回为空。）'
            else:
                out = content
            break
        # 回放 assistant 消息（含 tool_calls），再逐个执行工具
        msgs.append({'role': 'assistant', 'content': content,
                     'tool_calls': tcs})
        for tc in tcs:
            fn = ((tc.get('function') or {}).get('name')) or ''
            try:
                fargs = json.loads((tc.get('function') or {}).get('arguments') or '{}')
                if not isinstance(fargs, dict):
                    fargs = {}
            except Exception:
                fargs = {}
            result = _brain_tool_exec(base, fn, fargs)
            tool_log.append('%s(%s) -> %s' % (fn, json.dumps(fargs, ensure_ascii=False)[:200],
                                              str(result)[:200]))
            msgs.append({'role': 'tool', 'tool_call_id': tc.get('id') or '',
                         'content': str(result)[:4000]})
    else:
        out = (out if 'out' in dir() else '') or '（主脑：已达工具轮数上限，已中止。已完成操作：' + '；'.join(tool_log[-5:]) + '）'
    if tool_log:
        out = out + '\n\n[本次工具操作]\n' + '\n'.join(tool_log)
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


