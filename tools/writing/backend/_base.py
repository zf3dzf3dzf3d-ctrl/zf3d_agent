#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""写作工具共享处理器。
所有写作工具的 handle 逻辑完全相同：读文本→构造提示词→调AI模型→返回结果。
各工具文件只需定义 TOOL_NAME、SYS_PROMPT、TEMPERATURE、build_prompt，
然后调用本模块的 handle_writing(body, ctx, config) 即可。
"""
import os
import json
import urllib.request
import urllib.error
from tools.coding.backend.base import ToolContext


def handle_writing(body, ctx, tool_name, sys_prompt, temperature, build_prompt):
    """写作工具统一处理逻辑。"""
    # 1. 获取文本
    text = body.get('text', '')
    if not text and body.get('path'):
        try:
            with open(body['path'], 'r', encoding='utf-8', errors='replace') as f:
                text = f.read(50000)
        except Exception as e:
            ctx.send_json({'ok': False, 'error': '读取文件失败: ' + str(e), 'tool': tool_name})
            return

    if not text or len(text.strip()) < 2:
        ctx.send_json({'ok': False, 'error': '未提供文本内容', 'tool': tool_name})
        return

    # 2. 构造提示词
    user_msg = build_prompt(body, text)

    # 3. 获取模型配置
    model_id = body.get('model_id', '')
    endpoint = body.get('endpoint', '')
    api_key = body.get('api_key', '')

    if not endpoint or not api_key:
        ctx.send_json({'ok': False, 'error': '未配置模型（缺少 endpoint 或 api_key）', 'tool': tool_name})
        return

    # 4. 调用AI模型API
    payload = {
        'model': model_id,
        'messages': [
            {'role': 'system', 'content': sys_prompt},
            {'role': 'user', 'content': user_msg}
        ],
        'temperature': temperature,
        'stream': False
    }

    try:
        data = json.dumps(payload).encode('utf-8')
        req = urllib.request.Request(endpoint, data=data, method='POST')
        req.add_header('Content-Type', 'application/json')
        req.add_header('Authorization', 'Bearer ' + api_key)

        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read().decode('utf-8'))

        reply = ''
        if result.get('choices') and result['choices'][0].get('message'):
            reply = result['choices'][0]['message'].get('content', '')

        reply = (reply or '').strip()
        if not reply:
            ctx.send_json({'ok': False, 'error': '模型返回空内容', 'tool': tool_name})
        else:
            ctx.send_json({'ok': True, 'content': reply, 'tool': tool_name})
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')
        ctx.send_json({'ok': False, 'error': '模型调用失败(HTTP %d): %s' % (e.code, err_body[:500]), 'tool': tool_name})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': '请求失败: ' + str(e), 'tool': tool_name})
