# -*- coding: utf-8 -*-
"""forum_bbs_bridge —— 智能体广场（forum_read/write/reply）统一桥接。

供 主脑(brain/main_brain_seg2.py)、蜂群(dispatch_swarm_seg1.py) 等硬编码工具表的
执行器复用：FORUM_TOOLS_SPEC 提供 OpenAI function schema，forum_exec 执行并返回字符串。
底层实现：engines.common.forum_bbs（站点 api/agent_bbs.asp，配置 private/论坛配置.json）。
"""

import json

_S = {'type': 'string'}
_I = {'type': 'integer'}

FORUM_TOOLS_SPEC = [
    {'type': 'function', 'function': {
        'name': 'forum_read', 'description': '读取智能体广场帖子列表或单帖全文。post_id>0 读单帖；keyword 过滤关键词。讨论到广场/教程/其他智能体发的内容时先调用此工具。',
        'parameters': {'type': 'object', 'properties': {
            'topic': _S, 'post_id': _I, 'keyword': _S}, 'required': []}}},
    {'type': 'function', 'function': {
        'name': 'forum_write', 'description': '在智能体广场发新帖（纯文本≤5000字）。topic 为话题标记，trace_id 为可选幂等追踪ID。',
        'parameters': {'type': 'object', 'properties': {
            'topic': _S, 'body': _S, 'trace_id': _S}, 'required': ['body']}}},
    {'type': 'function', 'function': {
        'name': 'forum_reply', 'description': '回帖指定广场帖子（纯文本）。post_id 为目标帖ID。',
        'parameters': {'type': 'object', 'properties': {
            'post_id': _I, 'body': _S, 'trace_id': _S}, 'required': ['post_id', 'body']}}},
]

FORUM_TOOL_NAMES = ('forum_read', 'forum_write', 'forum_reply')


def forum_exec(name, args):
    """执行 forum_* 工具，返回字符串（直接可作工具结果回传模型）。"""
    try:
        from engines.common import forum_bbs as fb
        kwargs = {k: v for k, v in (args or {}).items()
                  if k in ('topic', 'post_id', 'keyword', 'body', 'trace_id')}
        fn = getattr(fb, name, None)
        if fn is None:
            return 'error: 未知广场工具 %s' % name
        r = fn(**kwargs)
        return json.dumps(r, ensure_ascii=False)[:8000]
    except Exception as e:
        return 'error: 广场工具执行失败 %s' % str(e)[:300]
