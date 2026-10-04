# -*- coding: utf-8 -*-
"""router.py —— mega 模式唯一入口

dual_protocol._call_upstream_impl() 在这里早退，
所以现有三档的裁剪 / Responses 转换 / previous_response_id / Anthropic 适配
全部不会执行——这是"独立线路"的实现方式。

强制 Chat Completions 协议：Responses 的 previous_response_id 是上游记忆，
与本地归档是两套记忆，混用会双份存储还对不上。
"""
import json
import os
import time
import threading
import urllib.request

from . import config
from . import archive
from . import index as index_mod
from . import assembler
from . import tools as tools_mod

# 上一轮 assistant 回复（用于下一轮才把该轮结论写进索引，避免改写已发送前缀）
_last_assistant = {}
_LAST_LOCK = threading.Lock()


def _log(msg):
    try:
        from engines.common import dual_protocol as dp
        dp._log('[mega] ' + str(msg))
    except Exception:
        pass


def _session_of(ctx, payload):
    """取会话标识：优先 ctx，其次 payload。"""
    for k in ('session_id', 'sid', 'conversation_id', 'box_id', 'chat_id'):
        v = ctx.get(k)
        if v:
            return str(v)
    for k in ('session_id', 'sid', 'conversation_id'):
        v = (payload or {}).get(k)
        if v:
            return str(v)
    return 'default'


def _post_chat(ctx, payload):
    """Chat Completions 原生 POST（不复用 dual_protocol 的 _post，避免被三挡逻辑污染）。"""
    headers = dict(ctx.get('headers') or {})
    url = ctx.get('target_url') or ctx.get('url') or ''
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    for k, v in headers.items():
        try:
            req.add_header(k, str(v))
        except Exception:
            pass
    with urllib.request.urlopen(req, timeout=int(ctx.get('timeout') or 600)) as resp:
        raw = resp.read().decode('utf-8', 'replace')
    try:
        return json.loads(raw)
    except Exception:
        return {'_raw': raw}


def handle(ctx, payload):
    """mega 主流程。返回与 dual_protocol.call_upstream 同构的结果。"""
    ctx = dict(ctx or {})
    payload = dict(payload or {})
    sid = _session_of(ctx, payload)

    # 0. 非流式（mega 下工具回灌由上层循环驱动，这里保持单发）
    payload['stream'] = False

    # 1. 组装（含剥离易变行 / 索引注入 / 最近原文）
    out_msgs, meta = assembler.build(
        sid, payload.get('messages') or [], tools_mod.desc_text()
    )

    # 2. 缓存断点（上游支持 cache_control 才有意义，不支持时字段被忽略）
    out_msgs = assembler.cache_breakpoints(out_msgs)

    # 3. 注入 mega 工具
    payload['messages'] = out_msgs
    payload['tools'] = tools_mod.schemas()
    payload.pop('previous_response_id', None)
    payload.pop('api_format', None)

    # 4. 落盘归档（发送前的完整快照，一字不删）
    turn_no = archive.count_turns(sid) + 1
    arc = archive.append_turn(sid, turn_no, out_msgs,
                              meta={'phase': 'request', 'mode': config.CTX_MODE})

    # 5. 索引登记（用最后一条 user 与上一条 assistant 作为该轮摘要源）
    _index_this_turn(sid, turn_no, out_msgs)

    # 6. 是否要求 checkpoint
    if index_mod.need_checkpoint(sid, turn_no):
        _inject_checkpoint_hint(payload, turn_no)

    # 7. 转发
    t0 = time.time()
    try:
        result = _post_chat(ctx, payload)
    except Exception as e:
        _log('post fail | sid=%s turn=%s err=%s' % (sid, turn_no, e))
        raise
    cost = round(time.time() - t0, 3)

    # 8. 归一化输出 + 抽 checkpoint + 回填 assistant 原文
    text = _extract_text(result)
    text, cp = tools_mod.extract_checkpoint(text)
    if cp:
        index_mod.add_checkpoint(sid, cp, turn_no)
    _set_last_assistant(sid, text)
    result['_mega'] = {
        'session': sid, 'turn': turn_no, 'archive_sha': arc.get('sha256'),
        'seconds': cost, 'meta': meta, 'checkpoint': bool(cp),
    }
    if isinstance(result.get('choices'), list) and result['choices']:
        ch = result['choices'][0]
        msg = ch.get('message') or {}
        if isinstance(msg, dict):
            msg['content'] = text
            ch['message'] = msg
    _log('ok | sid=%s turn=%s raw=%s sent=%s idx=%s %.2fs%s'
         % (sid, turn_no, meta.get('raw_body_turns'), meta.get('raw_sent'),
            meta.get('index_chars'), cost, ' cp' if cp else ''))
    return result


def _index_this_turn(sid, turn_no, msgs):
    """登记本轮到索引。

    assistant 侧用的是**上一轮**的回复：第 N 轮的结论写进第 N+1 轮发送的索引里，
    此时该 entry 第一次出现，之后永不改写 —— 这是前缀缓存不抖动的关键。
    """
    user_text = ''
    for m in reversed(msgs or []):
        if isinstance(m, dict) and str(m.get('role') or '') == 'user':
            c = m.get('content')
            user_text = c if isinstance(c, str) else json.dumps(c, ensure_ascii=False)
            break
    with _LAST_LOCK:
        prev_a = _last_assistant.get(sid, '')
    index_mod.add_turn(sid, turn_no, user_text, prev_a)


def _set_last_assistant(sid, text):
    with _LAST_LOCK:
        _last_assistant[sid] = text or ''


def backfill_assistant(sid, turn_no, text):
    """兼容保留：assistant 回复只进内存缓存，不再写索引。

    写索引会让已发送过的前缀变动、缓存全丢，所以结论改由下一轮
    _index_this_turn 时带入（那时该 entry 才第一次出现）。
    若进程重启导致内存丢失，索引里该轮 concl 为空 —— 可接受，
    原文仍在归档中，可用 archive_load 取回。
    """
    _set_last_assistant(sid, text)


def _inject_checkpoint_hint(payload, turn_no):
    """在第 7 步前，给本轮 user 末尾追加 checkpoint 要求（轻量，不占角色）。"""
    msgs = payload.get('messages') or []
    for i in range(len(msgs) - 1, -1, -1):
        m = msgs[i]
        if isinstance(m, dict) and str(m.get('role') or '') == 'user':
            c = m.get('content')
            hint = ('\n\n[系统] 本任务已进行到第 %s 轮。请用一行总结当前最关键的'
                    '结论与未决事项，格式严格为：CHECKPOINT: <内容>' % turn_no)
            if isinstance(c, str):
                m['content'] = c + hint
            elif isinstance(c, list):
                c.append({'type': 'text', 'text': hint})
                m['content'] = c
            break


def _extract_text(result):
    """从 Chat Completions 响应抽正文。"""
    try:
        return result['choices'][0]['message']['content'] or ''
    except Exception:
        pass
    if isinstance(result, dict):
        if isinstance(result.get('_raw'), str):
            return result['_raw']
        if isinstance(result.get('output_text'), str):
            return result['output_text']
    return ''


def status(session_id):
    """供管理入口/调试：归档与索引概况。"""
    v = archive.verify(session_id)
    return {
        'session': session_id,
        'turns': v.get('turns'),
        'archive_ok': v.get('ok'),
        'bad': v.get('bad'),
        'bytes': archive.dir_size(session_id),
        'index_chars': len(index_mod.render(session_id)),
    }


def list_all():
    return archive.list_sessions()


def purge(session_id):
    return archive.delete_session(session_id)
