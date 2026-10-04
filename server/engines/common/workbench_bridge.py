# -*- coding: utf-8 -*-
"""workbench_bridge —— 图片工作台 AI 工具桥（wb_list / wb_apply）。

仿 forum_bbs_bridge：供 主脑(brain/main_brain_seg2.py)、蜂群(dispatch_swarm_seg1.py)
等硬编码工具表的执行器复用。
- WB_TOOLS_SPEC: OpenAI function schema（wb_list / wb_apply 两个动作）
- workbench_exec(name, args): 执行并返回字符串（直接可作工具结果回传模型）

底层实现：直接 import server/routes/mixin_workbench.py 的 TOOLS 注册表与执行逻辑
（单源不复制）；结果图落 public/data/workbench/，前端抽屉轮询 /data/workbench/
最新文件自动回贴为新图层。
"""

import os
import sys
import io
import re
import json
import time
import base64

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _BASE not in sys.path:
    sys.path.insert(0, _BASE)

_OUT_DIR = os.path.join(_BASE, 'public', 'data', 'workbench')
os.makedirs(_OUT_DIR, exist_ok=True)

# 前端轮询游标文件：记录最后一次 AI 产出的结果文件，前端读到新文件名即自动回贴图层
_CURSOR = os.path.join(_OUT_DIR, '.ai_latest.json')

# 种子空游标：前端抽屉每 3s 轮询该静态路径，文件缺失会在控制台刷 404。
# url 为空字符串 = 无新结果，前端读到后直接跳过。
if not os.path.isfile(_CURSOR):
    try:
        with open(_CURSOR, 'w', encoding='utf-8') as _cf:
            _cf.write('{"url": ""}')
    except Exception:
        pass

_S = {'type': 'string'}
_O = {'type': 'object'}

WB_TOOLS_SPEC = [
    {'type': 'function', 'function': {
        'name': 'wb_list', 'description': '列出图片工作台可用工具（裁剪/缩放/放大/去背/换色/水印/加边等12个核心工具及参数说明）。调用 wb_apply 前先查此表。',
        'parameters': {'type': 'object', 'properties': {}}, 'required': []}},
    {'type': 'function', 'function': {
        'name': 'wb_apply', 'description': '对图片执行工作台工具并返回结果图 URL（本机服务 API 端口开头）。image 传 dataURL（对话附图/工作台画面）或本地文件路径；结果自动回贴到用户工作台画布新图层。典型：放大用 scale_up，白底转透明用 remove_bg_color(color=[255,255,255])。',
        'parameters': {'type': 'object', 'properties': {
            'tool': _S, 'image': _S, 'params': _O},
            'required': ['tool', 'image']}},
    },
]

WB_TOOL_NAMES = ('wb_list', 'wb_apply')


def _load_image_from_arg(image_arg):
    """支持 dataURL / 本地文件路径 / http(s) URL(仅本机 public 下路径)。返回 PIL.Image。"""
    from PIL import Image
    s = str(image_arg or '').strip()
    if s.startswith('data:'):
        m = s.find('base64,')
        if m < 0:
            raise ValueError('dataURL 缺少 base64 段')
        raw = base64.b64decode(s[m + 7:])
        return Image.open(io.BytesIO(raw))
    if s.startswith('http://') or s.startswith('https://'):
        # 只允许本机服务地址，防 SSRF
        import urllib.request
        req = urllib.request.Request(s, headers={'User-Agent': 'wb-bridge'})
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read()
        return Image.open(io.BytesIO(raw))
    p = s.replace('/', os.sep)
    if not os.path.isabs(p):
        p = os.path.join(_BASE, p)
    p = os.path.normpath(p)
    if not os.path.isfile(p):
        raise ValueError('图片不存在: %s（支持 dataURL / 本地路径 / URL）' % s)
    return Image.open(p)


def workbench_exec(name, args):
    """执行 wb_list / wb_apply，返回字符串（直接可作工具结果回传模型）。"""
    try:
        if name == 'wb_list':
            from routes.mixin_workbench import TOOLS
            tools = [{'name': k, 'desc': v['desc'], 'params': v['params']}
                     for k, v in TOOLS.items() if v.get('core')]
            return json.dumps({'ok': True, 'count': len(tools), 'tools': tools},
                              ensure_ascii=False)
        if name == 'wb_apply':
            from routes import mixin_workbench as mw
            from PIL import Image as _PILImage
            tool = str((args or {}).get('tool', '')).strip()
            if tool not in mw.TOOLS:
                return 'error: 未知工具 %s，先调 wb_list 查表' % tool
            img = _load_image_from_arg((args or {}).get('image'))
            params = (args or {}).get('params') or {}
            out, meta = mw.TOOLS[tool]['fn'](img, params)
            buf = io.BytesIO()
            out.save(buf, 'PNG')
            fname = 'wb_ai_%s_%d.png' % (tool, int(time.time() * 1000))
            with open(os.path.join(_OUT_DIR, fname), 'wb') as f:
                f.write(buf.getvalue())
            try:
                from server import config as _cfg
                _port = _cfg.PORT
            except Exception:
                _port = 8505
            result_url = 'http://127.0.0.1:%d/data/workbench/' % _port + fname
            # 写游标：前端抽屉轮询此文件，发现新结果自动 addImage 回贴图层
            try:
                with open(_CURSOR, 'w', encoding='utf-8') as f:
                    json.dump({'url': result_url, 'path': '/data/workbench/' + fname,
                               'tool': tool, 'meta': meta, 'ts': time.time()}, f, ensure_ascii=False)
            except Exception:
                pass
            return json.dumps({
                'ok': True, 'tool': tool, 'meta': meta, 'resultUrl': result_url,
                'width': out.width, 'height': out.height,
                'note': '结果图已生成并回贴到用户图片工作台（新图层）',
            }, ensure_ascii=False)
        return 'error: 未知工作台工具 %s' % name
    except Exception as e:
        return 'error: 工作台工具执行失败 %s' % str(e)[:300]
