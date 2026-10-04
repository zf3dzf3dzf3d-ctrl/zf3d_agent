# -*- coding: utf-8 -*-
# 拆分分段模块：由原 agent_loop.py 按行段【无改动】切分，由同名门面加载合并。
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
common/agent_loop.py - 通用服务端 agent 循环内核（引擎无关，可插拔）

设计（从 codex-cli turn.rs 取精髓重写，不照搬）：
- 循环内核只负责「调模型 -> 有工具调用就交给引擎执行 -> 结果回填 -> 再调模型」
- 每轮工具调用全部交给引擎自己的 execute_tool_calls 处理：
  * codex_style 有单步纪律（一轮只放行1个）+ 三档审批 -> 内核不感知
  * pi_style / deepseek_direct 可有自己的节奏
- MAX_TURNS 防失控；每轮消息由引擎钩子（compact_messages）压缩（可选）
- 上游 HTTP 调用复用 ctx['target_url'] / ctx['headers']（proxy 已还原密钥）

接口：
    run_agent_loop(engine_id, engine_mod, messages, ctx, on_event=None)
        -> OpenAI 兼容响应 dict（choices[0].message.content 为最终文本）

引擎钩子（全部可选，通过 hasattr 探测）：
    validate_messages(messages) -> messages
    compact_messages(messages)  -> messages
    get_tool_schemas()          -> list[dict]
    execute_tool_calls(tool_calls, ctx) -> list[{tool_call_id, role:'tool', content, _ok}]
"""

import os
import json
import time
import urllib.request
import urllib.error

MAX_TURNS = 50               # 循环上限，防失控
try:
    MAX_TURNS = max(10, int(os.environ.get('ZF_MAX_TURNS', '') or MAX_TURNS))  # 可用 ZF_MAX_TURNS 环境变量覆盖
except ValueError:
    pass
# 【A1 预算硬上限】ZF_MAX_ROUNDS 为 MAX_TURNS 的别名（更低者生效），两开关互为兼容
try:
    MAX_TURNS = min(MAX_TURNS, max(3, int(os.environ.get('ZF_MAX_ROUNDS', '') or MAX_TURNS)))
except ValueError:
    pass


# ===================== A1 Token 预算硬上限（v5.4.7）=====================
# 开关：ZF_TOKEN_BUDGET（本轮循环累计 token 预算，0/缺省=不启用）
# 每轮上游返回后从 usage 累加；超预算 → 落收口快照（JSON，含完整 messages，
# 可直接作为后续 messages 续跑），并像 MAX_TURNS 一样强制收口总结。
# 顺序保障：预算在每轮请求发出前检查（先于折叠/请求），不会出现"折叠先烧预算"的次序问题。
def _budget_check():
    """返回本轮循环的 token 预算（0=不启用）。"""
    try:
        return max(0, int(os.environ.get('ZF_TOKEN_BUDGET', '') or 0))
    except ValueError:
        return 0


def _budget_usage(resp):
    """从上游响应提取 usage 累计值；缺 usage 时按消息字符数粗估兜底（1 token≈2字符中文/4字符英文，取 2.5 折中）。"""
    try:
        u = (resp or {}).get('usage') or {}
        t = int(u.get('total_tokens') or (u.get('prompt_tokens', 0) + u.get('completion_tokens', 0)))
        if t > 0:
            return t
    except Exception:
        pass
    # 兜底：按 choices 里 message 文本长度估算（含工具调用参数），宁高勿低
    try:
        chars = 0
        for ch in (resp or {}).get('choices') or []:
            m = ch.get('message') or {}
            chars += len(m.get('content') or '')
            for tc in m.get('tool_calls') or []:
                chars += len(tc.get('function', {}).get('arguments') or '')
        return int(chars / 2.5) + 64 if chars else 64  # 64 兜底：连文本都没有也按一次最小请求计
    except Exception:
        return 64


def _budget_snapshot_save(engine_id, messages, spent, budget):
    """超预算收口快照：落盘 JSON，返回文件路径（失败返回 ''）。"""
    try:
        d = os.path.join(_DIR, '_budget_snapshots')
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, 'budget_%s_%s.json' % (engine_id or 'agent', time.strftime('%Y%m%d_%H%M%S')))
        with open(p, 'w', encoding='utf-8') as f:
            json.dump({'engine_id': engine_id, 'spent_tokens': spent,
                       'budget': budget, 'saved_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                       'resume_hint': 'Resume by passing resume_messages as request messages',
                       'resume_messages': messages}, f, ensure_ascii=False)
        return p
    except Exception as e:
        _log('[WARN] budget snapshot save failed: %s' % e)
        return ''
# =================== A1 Token 预算硬上限结束 ===================
UPSTREAM_TIMEOUT = 300      # 单次上游调用超时（秒）

# ===== 超速模式（turbo）：剥离一切外围，只保留做题主链路 =====
# 开启方式：ctx['turbo']=True 或环境变量 ZF_TURBO=1
# 关闭项：断点落盘 / 消息持久化(_persist) / app_logs 工具日志 / _loop.log 装饰日志
# 收紧项：工具结果打回阈值 40000 -> 12000（上下文更瘦，单轮更快）
def _is_turbo(ctx):
    if (ctx or {}).get('turbo'):
        return True
    return os.environ.get('ZF_TURBO', '').strip() in ('1', 'true', 'yes')

TURBO_REJECT_MAX_CHARS = 24000   # 打回线：超过才整条丢档（6000~24000 之间走首尾截断）
TURBO_HEAD_TAIL_KEEP = 6000      # turbo 下超长结果先做首尾保留截断，不到打回线不整条丢

_DIR = os.path.dirname(os.path.abspath(__file__))
loop_LOG = os.path.join(_DIR, '_loop.log')

# ===== 工具结果打回（reject）参数：超长/失败结果不进上下文，原文落盘存档，回填短通知让模型换方法 =====
REJECT_DEFAULTS = {
    'enabled': True,
    'max_chars': 40000,          # 结果超过该长度 → 打回
    'reject_failed': True,       # _ok=False 的失败结果 → 打回（仅当长度超过 min_fail_len）
    'min_fail_len': 2000,        # 失败结果打回的最小长度：短失败通知原文放行（保留引擎语义，如 codex DEFERRED）
    'archive_dir': os.path.normpath(os.path.join(_DIR, '..', '..', '..', 'private', 'tool_result_archive')),
    'notice': ('[工具结果已被打回存档（原因: {reason}，原始长度 {n} 字符），该结果未进入上下文。'
               '如确需原文，用 run_code 对存档文件 {path} 分片读取（每次 4000 字符）；'
               '否则请换方法或缩小范围重新执行。]'),
}


def _log(msg):
    try:
        with open(loop_LOG, 'a', encoding='utf-8') as f:
            f.write(time.strftime('%m-%d %H:%M:%S ') + str(msg) + '\n')
    except OSError:
        pass


def _sanitize_headers(headers):
    """修复 latin-1 编码失败的请求头（典型：掩码密钥 'Bearer ••••xxxx' 未被还原）。
    对不能 latin-1 编码的值：若是 Authorization，按尾4位从 api_keys.json 还原真实密钥；
    还原不了则该头丢弃并记日志，保证循环内上游调用不会 3 连败。"""
    import re as _re
    out = {}
    for k, v in (headers or {}).items():
        sv = str(v)
        try:
            sv.encode('latin-1')
            out[k] = sv
            continue
        except UnicodeEncodeError:
            pass
        if k.lower() == 'authorization':
            try:
                from model_config import find_key_by_tail
                m = _re.search(r'([0-9A-Za-z]{2,8})$', sv)
                tail = m.group(1) if m else sv[-4:]
                real = find_key_by_tail(tail)
                if real:
                    _log('sanitized masked Authorization header (tail=%s)' % tail)
                    sv = 'Bearer ' + real
            except Exception as _e:
                _log('auth header restore failed: %s' % _e)
        try:
            sv.encode('latin-1')
            out[k] = sv
        except UnicodeEncodeError:
            _log('dropped non-latin1 header: %s (len=%d)' % (k, len(sv)))
    return out


def _call_upstream(ctx, payload):
    """调用上游模型 API（非流式），返回响应 dict。异常时抛 RuntimeError。

    v2：接入双协议适配层（dual_protocol）。
    - 自动探测上游支持 Responses API 还是 Chat Completions（缓存 60s）
    - 支持上下文保留挡位：truncate 截断 / minimal 极简保留（带思考摘要）/ full 全保留
    - 双协议层异常时回退到内置 chat/completions 直连逻辑，保证可用性
    """
    try:
        from common.dual_protocol import call_upstream as _dual_call
        return _dual_call(ctx, payload)
    except Exception as e:   # noqa: BLE001 适配层任何异常都回退直连，不影响主流程
        _log('dual_protocol fallback -> builtin chat: %r' % e)

    url = ctx.get('target_url')

    # 【v5.1.3】Anthropic 协议直连兜底（dual_protocol 异常时仍可走）
    try:
        from common.anthropic_adapter import is_anthropic_endpoint as _al_is_anth
        if _al_is_anth(url):
            from common.anthropic_adapter import (
                to_anthropic_request as _al_to_anth, from_anthropic_response as _al_from_anth,
                anthropic_headers as _al_hdrs)
            _mk = ctx.get('model_cfg') or {}
            _k = _mk.get('apiKey') or _mk.get('key') or ctx.get('api_key') or ''
            _base = str(url or '').rstrip('/')
            _u = _base if _base.endswith('/v1/messages') or _base.endswith('/messages') else (_base + '/v1/messages')
            _p2 = dict(payload)
            _p2['stream'] = False
            _p2.pop('api_format', None)
            _ap2 = _al_to_anth(_p2)
            _hd2 = _al_hdrs(_k)
            if str(_k).startswith('eyJ'):
                _hd2['Authorization'] = 'Bearer ' + str(_k)
            _d2 = json.dumps(_ap2, ensure_ascii=True).encode('utf-8')
            _rq2 = urllib.request.Request(_u, data=_d2, method='POST')
            for _hk2, _hv2 in _hd2.items():
                try:
                    _rq2.add_header(_hk2, str(_hv2))
                except Exception as _he:  # 【修复 2026-09-22】关键路径：头设置失败会导致上游 401/400，必须留痕
                    _log('[WARN] retry add_header %s failed: %r' % (_hk2, _he))
            _op2 = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with _op2.open(_rq2, timeout=UPSTREAM_TIMEOUT) as _rp2:
                _b2 = _rp2.read().decode('utf-8', errors='replace')
            _log('anthropic fallback ok')
            return _al_from_anth(json.loads(_b2), _ap2.get('model') or '')
    except urllib.error.HTTPError as _ah:
        _ab2 = ''
        try:
            _ab2 = _ah.read().decode('utf-8', errors='replace')[:300]
        except Exception:
            pass
        raise RuntimeError('anthropic upstream HTTP %s: %s' % (_ah.code, _ab2)) from _ah
    except Exception as _ae2:
        _log('anthropic fallback skip: %r' % _ae2)

    headers = _sanitize_headers(ctx.get('headers') or {})
    # 循环内必须非流式，避免 SSE 处理复杂化
    payload = dict(payload)
    payload['stream'] = False
    data = json.dumps(payload, ensure_ascii=True).encode('utf-8')
    last_err = None
    for attempt in range(3):
        req = urllib.request.Request(url, data=data, method='POST')
        for k, v in headers.items():
            try:
                req.add_header(k, str(v))
            except Exception as _he:  # 【修复 2026-09-22】关键路径：头设置失败会导致上游 401/400，必须留痕
                _log('[WARN] add_header %s failed: %r' % (k, _he))
        try:
            # 直连，不使用环境代理（loopback/内网及 API 直连都更可靠）
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req, timeout=UPSTREAM_TIMEOUT) as resp:
                body = resp.read().decode('utf-8', errors='replace')
            return json.loads(body)
        except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError) as e:
            # HTTPError 是上游明确返回错误（如 4xx/5xx）
            if isinstance(e, urllib.error.HTTPError):
                _body = ''
                try:
                    _body = e.read().decode('utf-8', errors='replace')[:800]
                except Exception:
                    pass
                _low = _body.lower()
                _risk = e.code in (400, 401, 403, 422, 429) and (
                    'high risk' in _low or 'considered high' in _low
                    or 'rejected because' in _low or 'risk control' in _low)
                # 【风控自愈】MiMo 等上游风控拒绝（high risk）：不抛错杀循环，
                # 降载重试——去掉 tools + 截短历史，让模型直接收口作答
                if _risk and attempt < 2:
                    _log('upstream high-risk rejection (attempt %d), mitigate & retry: %s'
                         % (attempt + 1, _body[:200]))
                    try:
                        _p2 = dict(payload)
                        _p2.pop('tools', None)
                        _ms = list(_p2.get('messages') or [])
                        _sys = [m for m in _ms if isinstance(m, dict) and m.get('role') == 'system']
                        _rest = [m for m in _ms if not (isinstance(m, dict) and m.get('role') == 'system')]
                        _p2['messages'] = _sys + _rest[-12:]
                        data = json.dumps(_p2, ensure_ascii=True).encode('utf-8')
                    except Exception as _me:
                        _log('risk mitigation build failed: %r' % _me)
                    time.sleep(0.5 * (attempt + 1))
                    continue
                raise RuntimeError('agent_loop upstream HTTP %s: %s' % (e.code, _body or e.reason)) from e
            last_err = e
            if attempt < 2:
                _log('upstream transient error (attempt %d): %s, retrying' % (attempt + 1, e))
                time.sleep(0.4 * (attempt + 1))
    raise RuntimeError('agent_loop upstream call failed after retries: %s' % last_err)


def _extract_message(resp):
    """从 OpenAI 兼容响应中取 message dict；取不到返回 None。"""
    if not isinstance(resp, dict):
        return None
    choices = resp.get('choices') or []
    if not choices:
        return None
    return (choices[0] or {}).get('message') or None


def _tc_name(tc):
    """取工具调用名（兼容标准格式与简化格式）"""
    if not isinstance(tc, dict):
        return ''
    fn = tc.get('function') or {}
    return fn.get('name') or tc.get('name') or ''


def _extract_tool_calls(message):
    """提取工具调用，返回【OpenAI 标准完整格式】（type:'function' + function:{name,arguments}）。

    【修复】之前返回简化格式 {id,name,arguments}，直接塞进下一轮 messages 后被
    上游 API 400 拒绝（tool_calls 必须是 function 类型对象）。
    下游 execute_tool_calls 同时兼容两种格式。
    """
    tcs = message.get('tool_calls') if isinstance(message, dict) else None
    if not isinstance(tcs, list):
        return []
    out = []
    for tc in tcs:
        if not isinstance(tc, dict):
            continue
        fn = tc.get('function') or {}
        out.append({
            'id': tc.get('id') or '',
            'type': 'function',
            'function': {'name': fn.get('name') or '', 'arguments': fn.get('arguments') or '{}'},
        })
    return out


def _engine_preferred_model(engine_id):
    """读取引擎 manifest 的 preferred_model（模型偏好配置，可为空）。"""
    try:
        mpath = os.path.join(os.path.dirname(_DIR), engine_id, 'manifest.json')
        with open(mpath, 'r', encoding='utf-8-sig') as f:
            m = json.load(f)
        pm = str(m.get('preferred_model') or '').strip()
        return pm or None
    except Exception:
        return None


_reject_seq = 0


def _reject_tool_results(results, cfg=None):
    """【工具结果打回】超大/失败的结果不进上下文，原文落盘存档，替换为短通知。
    好处：上下文立刻干净，不带错误的工具结果继续跑浪费 token；模型按通知换方法或分片查回原文。"""
    _cfg = dict(REJECT_DEFAULTS, **(cfg or {}))
    if not _cfg.get('enabled'):
        return results
    try:
        os.makedirs(_cfg['archive_dir'], exist_ok=True)
    except Exception as _ae:  # 【修复 2026-09-22】归档目录建失败 → 超大工具结果无处落盘，必须留痕
        _log('[WARN] reject_tool_results makedirs %s failed: %r'
             % (_cfg.get('archive_dir'), _ae))
    out = []
    _keep = int(_cfg.get('head_tail_keep') or 0)   # >0 时启用首尾保留截断（如 turbo=6000）
    for i, r in enumerate(results or []):
        if not isinstance(r, dict) or r.get('role') != 'tool':
            out.append(r)
            continue
        content = str(r.get('content') or '')
        # 轻量截断：超长但未到打回线 → 保留头尾+提示省略，省一轮"查档"来回
        if _keep and len(content) > _keep and len(content) <= int(_cfg.get('max_chars') or 20000):
            head = content[: _keep * 2 // 3]
            tail = content[-(_keep // 3):]
            cut = len(content) - len(head) - len(tail)
            out.append({'role': 'tool', 'tool_call_id': r.get('tool_call_id') or r.get('id') or '',
                        'content': '%s\n\n[...中间省略 %d 字符，如需完整内容用工具缩小范围重查...]' % (head, cut),
                        '_ok': r.get('_ok')})
            continue
        failed = (r.get('_ok') is False)
        _max = int(_cfg.get('max_chars') or 20000)
        too_long = len(content) > _max
        # 失败打回仅针对长失败内容；短失败通知（如 codex DEFERRED/REJECTED）原文放行，保留指令语义
        _fail_big = failed and _cfg.get('reject_failed') and len(content) > int(_cfg.get('min_fail_len') or 0)
        if not (too_long or _fail_big):
            out.append(r)
            continue
        reason = ('执行失败+超长(%d字符>上限%d)' % (len(content), _max) if (too_long and _fail_big)
                  else '超长(%d字符>上限%d)' % (len(content), _max) if too_long else '执行失败')
        # 原文落盘存档（JSON，含摘要），供模型按需分片查回
        arc_path = ''
        try:
            stamp = time.strftime('%Y%m%d_%H%M%S')
            global _reject_seq
            _reject_seq += 1
            safe_name = ''.join(ch if ch.isalnum() else '_' for ch in str(r.get('tool_name') or ''))[:40]
            arc_path = os.path.join(_cfg['archive_dir'], 'reject_%s_%d_%s_%d.json' % (stamp, i, safe_name or 'tool', _reject_seq))
            with open(arc_path, 'w', encoding='utf-8') as f:
                json.dump({'tool_name': r.get('tool_name') or '',
                           'tool_call_id': r.get('tool_call_id') or r.get('id') or '',
                           'ok': not failed, 'reason': reason, 'len': len(content),
                           'archived_at': time.strftime('%Y-%m-%d %H:%M:%S'), 'content': content},
                          f, ensure_ascii=False, indent=1)
        except Exception as e:
            _log('reject archive failed: %s' % e)
            arc_path = ''
        notice = str(_cfg.get('notice') or '').format(
            reason=reason, n=len(content), path=arc_path or '(存档写入失败，原文已丢弃)')
        _log('tool result rejected (%s), archived -> %s' % (reason, arc_path or 'N/A'))
        out.append({'role': 'tool', 'tool_call_id': r.get('tool_call_id') or r.get('id') or '',
                    'content': notice, '_ok': not failed})
    return out

# ===================== 轮次折叠（v5.4.6）=====================
# 上下文超窗口阈值时，把最早N轮 tool_call/result 成对替换为摘要，末2轮保护、
# 只在完整轮边界折叠（不产生 orphan tool_result）。开关 ZF_FOLD_HISTORY=0 关闭。
def _fold_history(messages):
    if os.environ.get('ZF_FOLD_HISTORY', '1').strip() == '0':
        return messages
    try:
        _win = int(os.environ.get('ZF_CTX_WINDOW_CHARS', '240000'))
        _thr = float(os.environ.get('ZF_FOLD_THRESHOLD', '0.7'))
    except ValueError:
        _win, _thr = 240000, 0.7
    msgs = [m for m in (messages or []) if isinstance(m, dict)]
    _total = sum(len(str(m.get('content', ''))) + len(str(m.get('tool_calls', ''))) for m in msgs)
    if _total <= _win * _thr:
        return messages
    _PROTECT = 6  # 末2轮永不折叠
    _sys = [m for m in msgs if m.get('role') == 'system']
    _rest = [m for m in msgs if m.get('role') != 'system']
    _cut = len(_rest) - _PROTECT
    if _cut <= 4:
        return messages
    # 回退到最近的 user 边界，保证 tool_call/result 成对折叠
    while _cut > 0 and _rest[_cut].get('role') != 'user':
        _cut -= 1
    if _cut <= 0:
        return messages
    _old, _new = _rest[:_cut], _rest[_cut:]
    _tools_used = []
    for m in _old:
        if m.get('role') == 'assistant' and isinstance(m.get('tool_calls'), list):
            for tc in m['tool_calls']:
                _tools_used.append(str((tc.get('function') or {}).get('name') or '?'))
    _sum = (u'[上下文折叠] 早期 %d 条消息已折叠为摘要，执行过的工具: %s。'
            % (len(_old), u','.join(dict.fromkeys(_tools_used)) or u'无'))
    _sum += u' 关键结论请写入 project_record 兜底；被折叠的详情如有需要请重新执行工具获取。'
    return _sys + [{'role': 'user', 'content': _sum}] + _new
# =================== 轮次折叠结束 ===================
