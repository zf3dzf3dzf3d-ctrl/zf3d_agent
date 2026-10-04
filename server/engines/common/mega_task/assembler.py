# -*- coding: utf-8 -*-
"""assembler.py —— 按前缀缓存分层组装 messages

分层（从最稳定到最易变，缓存断点打在稳定段尾部）：
  L0 system          稳定，不变
  L1 工具定义         稳定（archive_search / archive_load）
  L2 索引块          只增不改；折叠只动老块，是全链路唯一可控抖动点
  L3 最近 N 轮原文    随轮滚动
  L4 当前轮          每次都变

优化点（沿用 2026-09-20 的缓存命中优化思路）：
  1. 剥离所有易变行（生成时间/动态状态等），前缀逐字节稳定
  2. 索引只 append 不重写，命中率不随轮次衰减
  3. cache_control 断点显式标注在 L2 尾部（上游支持时才加）
"""
from . import config
from . import index as index_mod


def _strip_volatile_text(t):
    for pat in config.VOLATILE_PATTERNS:
        import re
        t = re.sub(pat, '', t)
    return t


def _clean_messages(messages):
    """复制并剥易变行，不动原对象。"""
    out = []
    for m in messages or []:
        if not isinstance(m, dict):
            continue
        nm = dict(m)
        c = nm.get('content')
        if isinstance(c, str):
            nm['content'] = _strip_volatile_text(c)
        elif isinstance(c, list):
            segs = []
            for s in c:
                if isinstance(s, dict):
                    s2 = dict(s)
                    if isinstance(s2.get('text'), str):
                        s2['text'] = _strip_volatile_text(s2['text'])
                    segs.append(s2)
                else:
                    segs.append(s)
            nm['content'] = segs
        out.append(nm)
    return out


def _split_roles(messages):
    """分出 system 与对话体。"""
    sys_msgs = [m for m in messages if str(m.get('role') or '') == 'system']
    body = [m for m in messages if str(m.get('role') or '') != 'system']
    return sys_msgs, body


def build(session_id, messages, tools_desc):
    """组装最终 messages 列表。

    messages: 上游传来的原始 messages（已含 system 与当前轮）
    tools_desc: mega 两个工具的文字说明（注入到 L1）
    返回 (messages_out, meta)
    """
    msgs = _clean_messages(messages)
    sys_msgs, body = _split_roles(msgs)

    # L3 最近 N 轮原文（按 user/assistant 成对取尾段）
    tail = body[-(config.RECENT_RAW_TURNS * 2):] if body else []

    # L2 索引
    idx_text = index_mod.render(session_id)

    out = []
    # L0 + L1：system 里带上工具说明（保持只有 system/user/assistant 三角色）
    sys_text = '\n\n'.join(
        str(m.get('content') or '') for m in sys_msgs if isinstance(m.get('content'), str)
    )
    if tools_desc:
        sys_text = (sys_text + '\n\n' + tools_desc).strip()

    # L2：索引作为独立 user 消息，紧跟 system（稳定位置）
    if idx_text:
        out.append({
            'role': 'system',
            'content': '【超长任务归档索引】以下是本会话历史的压缩索引。'
                       '需要某轮原文时调用 %s / %s 取回，不要凭索引臆造细节。\n\n%s'
                       % (config.TOOL_SEARCH, config.TOOL_LOAD, idx_text),
        })

    if sys_text:
        out.append({'role': 'system', 'content': sys_text})

    # L2b 关键结论：紧跟 system，独立成条（每 10 轮追加，不重写旧内容）
    cp_text = index_mod.render_checkpoints(session_id)
    if cp_text:
        out.append({'role': 'system', 'content': cp_text})

    out.extend(tail)

    # L4 当前轮：若 tail 未覆盖到（如 body 很短），补上全部
    if len(tail) < len(body):
        out.extend(body[:len(body) - len(tail)])

    return out, {
        'raw_body_turns': len(body),
        'raw_sent': len(tail),
        'index_chars': len(idx_text),
    }


def cache_breakpoints(out_messages):
    """在 L2 尾部打 cache_control 断点（上游支持才有效，不支持时无害）。

    返回新列表，不改原对象。断点位置：最后一条 system（索引）之后。
    """
    if not out_messages:
        return out_messages
    msgs = [dict(m) for m in out_messages]
    # 找到最后一条 role==system 的下标
    idx = -1
    for i, m in enumerate(msgs):
        if str(m.get('role') or '') == 'system':
            idx = i
    if idx < 0:
        return msgs
    c = msgs[idx].get('content')
    if isinstance(c, str):
        msgs[idx]['content'] = [
            {'type': 'text', 'text': c, 'cache_control': {'type': 'ephemeral'}}
        ]
    elif isinstance(c, list) and c and isinstance(c[-1], dict):
        last = dict(c[-1])
        last['cache_control'] = {'type': 'ephemeral'}
        c[-1] = last
        msgs[idx]['content'] = c
    return msgs
