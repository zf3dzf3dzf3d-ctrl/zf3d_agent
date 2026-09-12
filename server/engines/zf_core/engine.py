#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
zf_core.engine - 朱峰底层引擎（默认）

实现统一接口 run(messages, ctx, on_event)。
第一个版本：OpenAI 兼容直连转发（复用上游调用逻辑由 proxy 侧执行时，
本引擎负责「消息预处理 + 请求规范校验」，实际网络转发由 proxy mixin 完成）。

ctx 结构：
{
  'model_cfg':   dict,   # 模型配置 {endpoint, apiKey, model...}
  'payload':     dict,   # 原始请求体（OpenAI 兼容格式）
  'headers':     dict,   # 上游请求头
  'target_url':  str,    # 上游 URL
  'project_path': str,   # 对话关联项目路径
}

返回：处理后的 ctx（proxy 用处理后的 payload/headers/target_url 转发上游）。
流式转发等重量级逻辑仍留在 proxy mixin，本引擎保持轻量可替换。
"""

DEFAULTS = {
    'temperature': None,
}


def validate_messages(messages):
    """校验并规整 messages：确保是 list[dict]，每条含 role/content。"""
    if not isinstance(messages, list):
        raise ValueError('messages must be a list')
    out = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        role = str(m.get('role', '')).strip()
        if not role:
            continue
        entry = dict(m)
        entry['role'] = role
        if 'content' not in entry:
            entry['content'] = ''
        out.append(entry)
    return out


def run(messages, ctx, on_event=None):
    """朱峰底层引擎主入口：规整消息、补默认参数，返回更新后的 ctx。"""
    payload = dict(ctx.get('payload') or {})
    messages = validate_messages(messages or payload.get('messages') or [])
    payload['messages'] = messages

    # 补齐合理默认值（不覆盖调用方显式设置）
    if payload.get('temperature') is None and DEFAULTS['temperature'] is not None:
        payload['temperature'] = DEFAULTS['temperature']

    ctx['payload'] = payload
    return ctx
