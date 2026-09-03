#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""image_gen - AI文生图"""

import os
import re
import json
import time
import urllib.parse
import urllib.request
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'image_gen'


def _parse_size(size_str):
    """解析尺寸字符串为 width, height"""
    try:
        parts = size_str.lower().split('x')
        w = int(parts[0])
        h = int(parts[1])
        return w, h
    except Exception:
        return 1024, 1024


# ===== 图片修改（多图编辑）辅助 =====
def _api_keys_map():
    """读取 private/api_keys.json -> {名称/id: key}"""
    result = {}
    try:
        import sys
        for p in ('server', '.'):
            if p not in sys.path:
                sys.path.insert(0, p)
        from model_config import API_KEYS_FILE
        with open(API_KEYS_FILE, encoding='utf-8') as f:
            result = (json.load(f) or {}).get('keys', {}) or {}
    except Exception:
        pass
    return result


def _chat_models_from_config():
    """从 models.json 取可用对话系模型列表（供图片编辑多模态通道使用）"""
    models = []
    try:
        import sys
        for p in ('server', '.'):
            if p not in sys.path:
                sys.path.insert(0, p)
        from model_config import load_models_config
        cfg = load_models_config(include_key=True)
        raw = (cfg or {}).get('list', []) if isinstance(cfg, dict) else (cfg or [])
        keys = _api_keys_map()
        for m in raw:
            if not isinstance(m, dict):
                continue
            mid = str(m.get('modelId') or m.get('id') or '').strip()
            ep = str(m.get('endpoint') or m.get('baseUrl') or '').strip()
            if not mid or not ep:
                continue
            if '/images/' in ep or ep.endswith('/images/generations'):
                continue  # 生图专用端点不支持多模态消息格式
            key = m.get('apiKey') or m.get('key') or ''
            if not key:
                key = keys.get(m.get('name', '')) or keys.get(m.get('id', '')) or ''
            models.append({
                'modelId': mid,
                'endpoint': ep,
                'key': key,
                'name': m.get('name') or mid,
                'visionInput': bool(m.get('visionInput')),
                'enabled': m.get('enabled', True),
                'visible': m.get('visible', True),
                'imageGen': bool(m.get('imageGen')),
            })
    except Exception:
        pass
    return models


def _match_chat_model(model_id=None):
    """按 modelId 匹配编辑通道模型；未指定时回退到第一个启用且支持视觉输入的模型"""
    models = [m for m in _chat_models_from_config() if m.get('enabled')]
    if not models:
        return None
    if model_id:
        want = str(model_id).strip().lower()
        for m in models:
            if m['modelId'].lower() == want:
                return m
    for m in models:
        if m.get('visionInput'):
            return m
    return models[0]


def _extract_image_from_text(text):
    """从模型回复文本里提取图片：优先 dataURL，其次 markdown/裸 URL"""
    if not text:
        return ''
    text = str(text)
    m = re.search(r'data:image/[a-zA-Z]+;base64,[A-Za-z0-9+/=\s]+', text)
    if m:
        return m.group(0).strip()
    m = re.search(r'!\[[^\]]*\]\((https?://[^)\s]+)\)', text)
    if m:
        return m.group(1).strip()
    m = re.search(r'(https?://[^\s"\'<>]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"\'<>]*)?)', text, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return ''


def _multimodal_image_edit(prompt, size, model_id, image_urls):
    """通过 OpenAI 兼容 chat/completions 多模态接口做多图编辑。
    image_urls 顺序即导入顺序（前端已按 上→下、左→右 编号），prompt 中 @图片N 对应第 N 张。
    """
    info = _match_chat_model(model_id)
    if not info:
        return {'error': '未找到可用于图片编辑的对话模型（请在模型配置中添加并填好 API Key）'}
    if not info.get('key'):
        return {'error': '图片编辑模型缺少 API Key（请在模型配置中设置: ' + info['modelId'] + '）'}
    n = len(image_urls)
    full_prompt = (
        '你是专业的图片编辑引擎。用户提供了 %d 张参考图，按传入顺序依次编号为：'
        % n + ('、'.join('图片%d' % (i + 1) for i in range(n))) +
        '。提示词中的 @图片N 即对应第 N 张参考图。\n'
        '请严格按要求编辑/合成图片，直接输出一张结果图片（不要只输出文字说明）：\n' + prompt
    )
    content = [{'type': 'text', 'text': full_prompt}]
    for u in image_urls:
        content.append({'type': 'image_url', 'image_url': {'url': u}})
    w, h = _parse_size(size)
    payload = {
        'model': info['modelId'],
        'messages': [{'role': 'user', 'content': content}],
        'max_tokens': 4096,
    }
    req = urllib.request.Request(
        info['endpoint'], data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + info['key']})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        msg = ((data.get('choices') or [{}])[0].get('message') or {})
        # 部分 OpenAI 兼容网关会把图片放到 message.images
        img_url = ''
        for it in (msg.get('images') or []):
            u = it.get('image_url', {}).get('url', '') if isinstance(it, dict) else ''
            if u:
                img_url = u
                break
        if not img_url:
            img_url = _extract_image_from_text(msg.get('content'))
        if not img_url:
            brief = str(msg.get('content') or '')[:200]
            return {'error': '图片编辑模型未返回图片：' + (brief or json.dumps(data, ensure_ascii=False)[:200])}
        return {'ok': True, 'url': img_url, 'provider': 'chat-multimodal',
                'model': info['modelId'], 'size': '%dx%d' % (w, h)}
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode('utf-8', 'ignore')[:300]
        except Exception:
            detail = ''
        return {'error': '图片编辑请求失败 HTTP %s: %s' % (e.code, detail)}
    except Exception as e:
        return {'error': '图片编辑异常: ' + str(e)}


# ===== 火山方舟视觉模型（如 Seedream 5.0 Lite / doubao-seedream-*）=====
# 与模型配置(models.json)联动：通过 modelId 匹配 imageGen 模型，取其 endpoint + apiKey
def _ark_image_models():
    """返回 {modelId: {'endpoint':..., 'key':..., 'name':...}} 来自模型配置"""
    result = {}
    try:
        import sys
        for p in ('server', '.'):
            if p not in sys.path:
                sys.path.insert(0, p)
        from model_config import load_models_config
        cfg = load_models_config(include_key=True)
        models = (cfg or {}).get('list', []) if isinstance(cfg, dict) else (cfg or [])
        for m in models:
            if not m.get('imageGen'):
                continue
            mid = m.get('modelId') or m.get('id') or ''
            if not mid:
                continue
            key = m.get('apiKey') or m.get('key') or ''
            if not key:
                # 从 api_keys.json 取（keyRef/名称映射）
                try:
                    from model_config import API_KEYS_FILE
                    keys = json.load(open(API_KEYS_FILE, encoding='utf-8')).get('keys', {})
                    key = keys.get(m.get('name', '')) or keys.get(m.get('id', '')) or ''
                except Exception:
                    key = ''
            result[mid] = {'endpoint': m.get('endpoint') or m.get('baseUrl') or '',
                           'key': key, 'name': m.get('name') or mid}
    except Exception:
        pass
    return result


def _ark_generate(prompt, size, model_id, image_url=None):
    """调用火山方舟 /images/generations 接口，返回 {'url':...} 或 {'error':...}"""
    info = _ark_image_models().get(model_id)
    if not info:
        return {'error': '未找到视觉模型配置: ' + model_id}
    endpoint = info['endpoint']
    key = info['key']
    if not endpoint or not key:
        return {'error': '视觉模型缺少 endpoint 或 API Key（请在模型配置中设置）'}
    w, h = _parse_size(size)
    # Seedream 5.0 Lite 要求总像素至少 3686400（约 2048x1800）；小于则等比放大到最小像素
    # （仅对 doubao-seedream 系列生效；其他渠道如智谱 CogView 分辨率上限低，不能强制放大）
    if str(model_id).startswith('doubao-seedream') and w * h < 3686400:
        scale = (3686400.0 / (w * h)) ** 0.5
        w = max(1, int(w * scale + 0.5)); h = max(1, int(h * scale + 0.5))
    payload = {'model': model_id, 'prompt': prompt, 'size': str(w) + 'x' + str(h),
               'response_format': 'url', 'watermark': False}
    if image_url:
        payload['image'] = image_url  # 图生图（Seedream 支持 image 参数）
    req = urllib.request.Request(endpoint, data=json.dumps(payload).encode('utf-8'),
                                 headers={'Content-Type': 'application/json',
                                          'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        url = ''
        d = data.get('data') or {}
        if isinstance(d, dict):
            items = d.get('images') or d.get('data') or []
            if items and isinstance(items[0], dict):
                url = items[0].get('url') or items[0].get('image_url') or ''
        elif isinstance(d, list) and d and isinstance(d[0], dict):
            url = d[0].get('url') or ''
        if not url:
            return {'error': '火山方舟视觉模型未返回图片: ' + json.dumps(data, ensure_ascii=False)[:300]}
        return {'ok': True, 'url': url, 'provider': 'ark', 'model': model_id, 'size': str(w) + 'x' + str(h)}
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode('utf-8', 'ignore')[:300]
        except Exception:
            detail = ''
        return {'error': '火山方舟生图失败 HTTP %s: %s' % (e.code, detail)}
    except Exception as e:
        return {'error': '火山方舟生图异常: ' + str(e)}


def handle(body, ctx):
    """处理工具请求"""
    try:
        action = body.get('action', 'generate')
        prompt = body.get('prompt', '')
        size = body.get('size', '1024x1024')
        model = body.get('model')
        image_url = body.get('image_url')

        # ===== 图片修改（多图编辑）：image_urls 顺序即前端导入顺序（上→下、左→右 编号图片1..N）=====
        image_urls = [str(u) for u in (body.get('image_urls') or []) if str(u or '').strip()]
        if action == 'edit_multi' or len(image_urls) >= 2:
            if not prompt:
                ctx.send_json({'ok': False, 'error': '请输入修改要求（可用 @图片N 引用第 N 张参考图）'})
                return
            r = _multimodal_image_edit(prompt, size, model, image_urls)
            ctx.send_json(r)
            return

        # action=status 时返回各渠道状态
        if action == 'status':
            providers = {'pollinations': True, 'siliconflow': True, 'zhipu': True}
            try:
                ark = _ark_image_models()
                for mid, info in ark.items():
                    providers[info['name'] or mid] = bool(info.get('key'))
            except Exception:
                pass
            ctx.send_json({'ok': True, 'providers': providers})
            return

        if not prompt:
            ctx.send_json({'ok': False, 'error': '需要提供 prompt 参数'})
            return

        # ===== 视觉模型联动：model 匹配 models.json 里的 imageGen 模型（如 doubao-seedream-5.0-lite）→ 走火山方舟 =====
        ark_models = _ark_image_models()
        if model and (model in ark_models or str(model).startswith('doubao-seedream') or str(model).startswith('doubao-seed') or str(model).startswith('cogview')):
            r = _ark_generate(prompt, size, model, image_url)
            ctx.send_json(r)
            return

        # 先尝试导入项目内的 image_gen 模块
        try:
            import image_gen as _img
            if image_url:
                # 图生图模式
                r = _img.generate_image(prompt, size=size, model=model, image_url=image_url)
            else:
                r = _img.generate_image(prompt, size=size, model=model)
            if isinstance(r, dict) and r.get('url'):
                r.setdefault('ok', True)
                ctx.send_json(r)
            elif isinstance(r, dict):
                r.setdefault('ok', True)
                ctx.send_json(r)
            else:
                ctx.send_json({'ok': True, 'url': str(r), 'provider': 'project_module'})
            return
        except ImportError:
            pass  # 回退到 pollinations
        except Exception as e:
            # 项目模块导入成功但执行出错，尝试回退
            pass

        # 回退: pollinations 免费API
        w, h = _parse_size(size)
        encoded = urllib.parse.quote(prompt, safe='')
        poll_url = f'https://image.pollinations.ai/prompt/{encoded}?width={w}&height={h}&nologo=true'

        # 如果有 image_url，作为参考传入（pollinations 不支持图生图，但URL仍可用）
        if image_url:
            encoded_ref = urllib.parse.quote(image_url, safe='')
            poll_url += f'&image={encoded_ref}'

        ctx.send_json({
            'ok': True,
            'url': poll_url,
            'provider': 'pollinations',
            'prompt': prompt,
            'size': f'{w}x{h}'
        })
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
