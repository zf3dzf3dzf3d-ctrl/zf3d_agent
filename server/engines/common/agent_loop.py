# -*- coding: utf-8 -*-
"""Agent循环 —— 由 seg1+seg2 合并还原为单文件（语义与原 exec 拼接版一致）"""

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

# 【v5.5.5 不中断改造】到达 MAX_TURNS 时任务未完成可延长循环，延长段数上限（默认 5，即最多 MAX_TURNS*(1+5) 轮）
def _max_extensions():
    try:
        return max(0, int(os.environ.get('ZF_MAX_EXTENSIONS', '') or 5))
    except ValueError:
        return 5


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
        from common.gateway import call_upstream as _dual_call
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
            _r2 = _al_from_anth(json.loads(_b2), _ap2.get('model') or '')
            try:
                _m2 = ((_r2 or {}).get('choices') or [{}])[0].get('message') or {}
                _rc2 = str(_m2.get('reasoning_content') or '').strip()
                if _rc2:
                    _m2['_reasoning_hint'] = _rc2[:2000]
            except Exception:
                pass
            return _r2
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
_fold_seq = 0  # 轮次折叠原文存档计数（v5.5.5 L2）


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
    # ---- L1 截断保壳：为被折叠消息保留原文头部片段，事实/数值不再全蒸发 ----
    _FRAG_LEN = int(os.environ.get('ZF_FOLD_FRAG_LEN', '180'))
    _FRAG_BUDGET = int(os.environ.get('ZF_FOLD_FRAG_BUDGET', '3600'))
    _frags, _fb = [], 0
    for m in _old:
        c = m.get('content')
        c = c if isinstance(c, str) else (json.dumps(c, ensure_ascii=False) if c else '')
        c = c.strip().replace('\n', ' ')
        if not c:
            continue
        role = m.get('role') or '?'
        frag = c[:_FRAG_LEN] + ('…' if len(c) > _FRAG_LEN else '')
        _cost = len(role) + len(frag) + 4
        if _fb + _cost > _FRAG_BUDGET:
            break
        _frags.append('[%s] %s' % (role, frag))
        _fb += _cost
    # ---- L2 折叠原文落盘：原文写入 tool_result_archive，可用 search_archive 关键词找回 ----
    _arc_tip = ''
    _arch_on = os.environ.get('ZF_FOLD_ARCHIVE', '1').strip() != '0'
    if _arch_on:
        # fold 原文目录必须 == search_archive 检索目录，否则「关键词找回折叠原文」闭环断裂。
        # 单一真源优先取 search_archive.ARCHIVE_DIR（包路径优先，兼容裸名 import）；
        # 两者都失败时用与 search_archive 完全相同的算法兜底，
        # 绝不复用 REJECT_DEFAULTS['archive_dir']（那是项目根路径，与检索目录不同源）。
        _ad = ''
        for _imp in ('engines.common.search_archive', 'search_archive'):
            try:
                _ad = getattr(__import__(_imp, fromlist=['ARCHIVE_DIR']), 'ARCHIVE_DIR')
                break
            except Exception:
                continue
        if not _ad:
            _ad = os.path.normpath(os.path.join(_DIR, '..', '..', 'private', 'tool_result_archive'))
        try:
            os.makedirs(_ad, exist_ok=True)
            global _fold_seq
            _fold_seq += 1
            stamp = time.strftime('%Y%m%d_%H%M%S')
            dump = []
            for m in _old:
                c = m.get('content')
                c = c if isinstance(c, str) else (json.dumps(c, ensure_ascii=False) if c else '')
                dump.append({'role': m.get('role') or '?', 'content': c,
                             'tool_calls': m.get('tool_calls') or []})
            arc_path = os.path.join(_ad, 'fold_%s_%d.json' % (stamp, _fold_seq))
            with open(arc_path, 'w', encoding='utf-8') as f:
                json.dump({'tool': '_fold_history', 'reason': 'context_folded',
                           'archived_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                           'len': sum(len(d['content']) for d in dump),
                           'content': json.dumps(dump, ensure_ascii=False),
                           'turns': dump},
                          f, ensure_ascii=False)
            _arc_tip = ('被折叠轮次的【完整原文】已存档（%s）；'
                        '如需精确细节，用 search_archive 按关键词检索存档原文，'
                        '或用 read_file 对该路径分片读取。' % arc_path)
        except Exception as _fe:
            _log('fold archive failed: %r' % _fe)
            _arc_tip = ''
    _sum = (u'[上下文折叠] 早期 %d 条消息已折叠，执行过的工具: %s。'
            % (len(_old), u','.join(dict.fromkeys(_tools_used)) or u'无'))
    if _frags:
        _sum += (u' 以下为被折叠内容的【头部片段】（仅供回忆，非完整）：'
                 + u' ǀ '.join(_frags))
    _sum += (u' ' + _arc_tip) if _arc_tip else u' 关键结论请写入 project_record 兜底。'
    return _sys + [{'role': 'user', 'content': _sum}] + _new
# =================== 轮次折叠结束 ===================


# -*- coding: utf-8 -*-
# 拆分分段模块：由原 agent_loop.py 按行段【无改动】切分，由同名门面加载合并。
def run_agent_loop(engine_id, engine_mod, messages, ctx, on_event=None):
    """通用 agent 循环。返回 OpenAI 兼容响应 dict。"""
    # 每轮工具调用写入 app_logs（便于在日志面板排查引擎工具链问题）
    _log_box_id = ''
    try:
        # 【勿删】此 import 非装饰性：_dbw 在 _loop_db_log 中被实际调用（含 progress 中途文字落库链路的日志），误删会静默破坏落库
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

    # 【自评+接棒指令注入】主对话走 agent_loop 路径，此前从未注入【自评】【接棒】
    # 输出指令，导致 AI 不知道要输出该格式 → 解析/前端接棒按钮全链路空转。
    # 这里复用 score_parser.inject_instruction（幂等），并跳过蜂群/接力任务（防套娃）。
    try:
        import score_parser as _sp
        _first_user = next((str((m or {}).get('content') or '')
                            for m in (messages or [])
                            if isinstance(m, dict) and m.get('role') == 'user'), '')
        if '【接力任务·勿再派发】' not in _first_user:
            _sp.inject_instruction(messages)
    except Exception as _se:
        _loop_db_log('warn', 'selfeval-inject-failed', repr(_se))

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

    # ===== 系统感知+操控工具注入（智能体OS·阶段A/C）：sys_* 工具所有引擎通用 =====
    _sys_names = set()
    _sys_exec_map = {}
    try:
        from engines.common.sys_tools import get_schemas as _sys_schemas
        from engines.common.sys_tools import execute as _sys_exec_a
        _sys_exec_map.update({n: _sys_exec_a for n in
                              ('sys_overview', 'sys_process_list', 'sys_disk', 'sys_net')})
    except Exception as _sys_e:
        _log('[loop] sys_tools load failed: %s' % _sys_e)
    try:
        from engines.common.sys_ui import get_schemas as _sysu_schemas
        from engines.common.sys_ui import execute as _sys_exec_u
        _sys_exec_map.update({n: _sys_exec_u for n in
                              ('sys_ui_foreground', 'sys_ui_windows', 'sys_ui_screen')})
    except Exception as _sysu_e:
        _log('[loop] sys_ui load failed: %s' % _sysu_e)
    try:
        from engines.common.sys_control import get_schemas as _sysc_schemas
        from engines.common.sys_control import execute as _sys_exec_c
        _sys_exec_map.update({n: _sys_exec_c for n in
                              ('sys_proc_kill', 'sys_service_control', 'sys_task_schedule', 'sys_reg')})
    except Exception as _sysc_e:
        _log('[loop] sys_control load failed: %s' % _sysc_e)
    try:
        from engines.common.sys_input import get_schemas as _sysi_schemas
        from engines.common.sys_input import execute as _sys_exec_i
        _sys_exec_map.update({n: _sys_exec_i for n in
                              ('sys_input_click', 'sys_input_type', 'sys_input_key', 'sys_input_scroll')})
    except Exception as _sysi_e:
        _log('[loop] sys_input load failed: %s' % _sysi_e)
    try:
        from engines.common.sys_hotkey import get_schemas as _sysh_schemas
        from engines.common.sys_hotkey import execute as _sys_exec_h
        _sys_exec_map.update({n: _sys_exec_h for n in
                              ('sys_hotkey_register', 'sys_hotkey_list', 'sys_hotkey_unregister')})
    except Exception as _sysh_e:
        _log('[loop] sys_hotkey load failed: %s' % _sysh_e)
    try:
        from engines.common.sys_macro import get_schemas as _sysm_schemas
        from engines.common.sys_macro import execute as _sys_exec_m
        _sys_exec_map.update({n: _sys_exec_m for n in
                              ('sys_macro_ctrl', 'sys_macro_add', 'sys_macro_list', 'sys_macro_run')})
    except Exception as _sysm_e:
        _log('[loop] sys_macro load failed: %s' % _sysm_e)
    try:
        from engines.common.sys_factory import get_schemas as _sysf_schemas
        from engines.common.sys_factory import execute as _sys_exec_f
        from engines.common.sys_factory import get_generated_schemas as _sysf_gen
        from engines.common.sys_factory import run_generated as _sys_exec_fg
        _sys_exec_map.update({n: _sys_exec_f for n in
                              ('sys_factory_make', 'sys_factory_list',
                               'sys_factory_toggle', 'sys_factory_delete')})
        # 工厂生成工具（fct_*）schema+执行器动态接入
        try:
            for _gs in _sysf_gen():
                _n = _gs.get('function', {}).get('name')
                if _n and _n not in _sys_exec_map:
                    _sys_exec_map[_n] = _sys_exec_fg
        except Exception:
            pass
    except Exception as _sysf_e:
        _log('[loop] sys_factory load failed: %s' % _sysf_e)
    try:
        from engines.common.sys_upgrade import get_schemas as _sysup_schemas
        from engines.common.sys_upgrade import execute as _sys_exec_up
        _sys_exec_map.update({n: _sys_exec_up for n in
                              ('sys_upgrade_status', 'sys_upgrade_apply',
                               'sys_upgrade_rollback')})
    except Exception as _sysup_e:
        _log('[loop] sys_upgrade load failed: %s' % _sysup_e)
    try:
        _have_sys = {s.get('function', {}).get('name') for s in (tool_schemas or []) if isinstance(s, dict)}
        _sys_extra = []
        for _mod_get in (_sys_schemas, _sysc_schemas, _sysu_schemas, _sysi_schemas,
                         _sysh_schemas, _sysm_schemas, _sysf_schemas,
                         _sysup_schemas, _sysf_gen):
            try:
                _sys_extra += [s for s in _mod_get()
                               if s.get('function', {}).get('name') not in _have_sys
                               and s.get('function', {}).get('name') not in
                               {x.get('function', {}).get('name') for x in _sys_extra}]
            except NameError:
                pass  # 某模块加载失败只跳过自己，不影响其余 sys_* 注入
            except Exception:
                pass
        if _sys_extra:
            tool_schemas = list(tool_schemas or []) + _sys_extra
            _sys_names = {s['function']['name'] for s in _sys_extra}
    except Exception as _sys_e:
        _log('[loop] sys_* schema inject failed: %s' % _sys_e)

    # ===== 系统感知/操控执行分发：sys_* 走统一通道（阶段A只读 + 阶段C dangerous）=====
    _mcp_orig_exec = _mcp_exec_wrap
    def _sys_exec_wrap(tool_calls, _ctx):
        _sys_tcs = [tc for tc in tool_calls if _tc_name(tc) in _sys_names]
        _rest = [tc for tc in tool_calls if _tc_name(tc) not in _sys_names]
        _out = list(_mcp_orig_exec(_rest, _ctx) or []) if _rest else []
        if _sys_tcs:
            for tc in _sys_tcs:
                tc_id = tc.get('id') or ''
                _a = tc.get('arguments') or tc.get('function', {}).get('arguments') or {}
                if isinstance(_a, str):
                    try:
                        _a = json.loads(_a)
                    except Exception:
                        _a = {}
                try:
                    _exec = _sys_exec_map.get(_tc_name(tc))
                    ok, result = _exec(_tc_name(tc), _a, _ctx) if _exec else (False, 'no sys executor')
                except Exception as e:
                    ok, result = False, 'sys_tools error: %s' % e
                _out.append({'tool_call_id': tc_id, 'role': 'tool', 'content': result, '_ok': ok})
        return _out
    # 重绑定调用点：下游 while 循环统一调 _mcp_exec_wrap，此处让其落到最外层包装
    _mcp_exec_wrap = _sys_exec_wrap

    final_response = None
    # 【A1】预算硬上限：本轮循环可用 token 预算（0=不启用），_spent 累计
    _budget = _budget_check()
    _spent = 0
    # 【v5.5.5 不中断改造】for→while：MAX_TURNS 到达且任务未完成时可延长轮数继续跑
    turn = 0
    while turn < MAX_TURNS:
        turn += 1
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

        # ===== 中途进度文字落库（手机峰控同步）=====
        # 有工具调用的轮次里，AI 附带的说明文字（content）就是电脑端 SSE 实时显示的
        # 「中途进度段落」。写入 chat_history（role='progress'），供手机端 chat_pull 增量拉取；
        # 落库失败静默忽略，不影响主流程。
        _mid_text = str(message.get('content') or '').strip()
        if _mid_text:
            try:
                import sqlite3 as _sq
                from config import DB_PATH as _dbp
                _conn2 = _sq.connect(_dbp, timeout=5)
                _conn2.execute(
                    'INSERT INTO chat_history (session_id, role, content, created_at) VALUES (?,?,?,?)',
                    (_turn_session, 'progress', _mid_text[:500], int(time.time() * 1000)))
                _conn2.commit()
                _conn2.close()
            except Exception:
                pass

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
            _sv_alerts = _sv.inspect(tool_calls, turn, engine_id, on_event, results=results) or []
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
            # 【v5.5.5 不中断改造】到达上限不再直接强制收口，而是让模型自评任务是否完成：
            #  - 模型确认完成 → 正常总结收口
            #  - 模型回答继续 → 追加 MAX_TURNS 轮预算继续跑（最多 MAX_EXTENSIONS 次，防真失控）
            import json as _json
            messages.append({'role': 'user', 'content':
                '[agent_loop] 已运行 %d 轮。请自评当前任务状态，只回答一个词：'
                '完成（任务已达成，给出最终总结）或 继续（任务未完成，说明还差什么，然后继续调用工具执行）。'
                % MAX_TURNS})
            payload = dict(ctx.get('payload') or {})
            payload['messages'] = messages
            payload.pop('tools', None)
            _verdict_resp = _call_upstream(ctx, payload)
            _verdict = ''
            try:
                _verdict = str((((_verdict_resp or {}).get('choices') or [{}])[0].get('message') or {}).get('content') or '')
            except Exception:
                pass
            if '继续' in _verdict and '完成' not in _verdict[:20]:
                _ext = getattr(run, '_extensions', 0)
                _max_ext = _max_extensions()
                if _ext < _max_ext:
                    run._extensions = _ext + 1
                    # 撤销自评消息，恢复工具，追加延长提示继续循环
                    messages.pop()
                    messages.append({'role': 'user', 'content':
                        '[agent_loop] 任务未完成，已追加 %d/%d 轮预算。请继续执行直到任务完成；'
                        '不要重复已做过的调查，直接推进剩余步骤。' % (MAX_TURNS, _max_ext)})
                    _persist('user', messages[-1]['content'])
                    _log('[%s] turn %d: task incomplete, extended (+%d/%d extensions)'
                         % (engine_id, turn, run._extensions, _max_ext))
                    turn = 0  # 重置轮次计数，进入新一轮 MAX_TURNS 预算
                    continue
            _log('[%s] max turns reached, forced summary' % engine_id)
            return _verdict_resp

    # 理论上不会到这里
    return final_response or {'choices': [{'message': {'role': 'assistant', 'content': ''}}]}
