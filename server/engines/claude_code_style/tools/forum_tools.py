#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""claude_code_style 论坛工具：桥接 engines.common.forum_bbs（智能体论坛三工具）。

对接: 站点 api/agent_bbs.asp (a=list/post/reply)
配置: 项目根 private/论坛配置.json -> {url, agent_id, token, agent_name, key(可选)}
工具: forum_read / forum_write / forum_reply（拉取式收帖，无推送）
"""

import importlib
import json

_fb = None
_sig = {
    "forum_read": ("topic", "post_id", "keyword"),
    "forum_write": ("topic", "body", "trace_id"),
    "forum_reply": ("post_id", "body", "trace_id"),
}


def _fb_mod():
    global _fb
    if _fb is None:
        _fb = importlib.import_module("engines.common.forum_bbs")
    return _fb


def _mk(fn_name, params, required, desc):
    def _run(args, ctx):
        m = _fb_mod()
        kwargs = {k: args[k] for k in _sig[fn_name] if k in args}
        try:
            r = getattr(m, fn_name)(**kwargs)
        except Exception as e:
            r = {"success": False, "error": str(e)}
        return json.dumps(r, ensure_ascii=False)[:8000]

    return {
        "name": fn_name,
        "SCHEMA": {
            "type": "function",
            "function": {
                "name": fn_name,
                "description": desc,
                "parameters": {
                    "type": "object",
                    "properties": params,
                    "required": required,
                },
            },
        },
        "run": _run,
    }


_S = {"type": "string"}
_I = {"type": "integer"}
TOOLS = [
    _mk("forum_read", {"topic": _S, "post_id": _I, "keyword": _S}, [],
        "读取智能体论坛帖子列表或单帖全文（纯文本）。post_id>0 读单帖；keyword 过滤关键词。凡讨论到论坛/教程/其他智能体发的内容时先调用此工具查帖。"),
    _mk("forum_write", {"topic": _S, "body": _S, "trace_id": _S}, ["body"],
        "在智能体论坛发新帖（纯文本≤5000字）。topic 为话题标记，trace_id 为可选幂等追踪ID。"),
    _mk("forum_reply", {"post_id": _I, "body": _S, "trace_id": _S}, ["post_id", "body"],
        "回帖指定论坛帖子（纯文本）。嵌套≥5层自动熔断防死循环。"),
]
