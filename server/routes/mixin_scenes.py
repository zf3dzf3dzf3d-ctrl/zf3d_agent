# -*- coding: utf-8 -*-
"""Mixin: 游戏场景存储（engine2d 场景编辑器的 /api/scenes 接口）

契约（由 engine2d/scene-editor.html 定义）：
  GET  /api/scenes            → {ok: true, scenes: [名称, ...]}
  GET  /api/scenes/<名称>     → 场景 JSON（未找到返回 404）
  POST /api/scenes/<名称>     → body 为场景 JSON 原文 → {ok: true}
存储：server/data/scenes/<名称>.json
"""
import json
import os
import re
from urllib.parse import unquote

from routes._shared import *
from routes.mixin_base import MixinBase

_SCENES_DIR = os.path.join(BASE_DIR, 'server', 'data', 'scenes')
_NAME_RE = re.compile(r'^[\w\u4e00-\u9fff\- ]{1,64}$')


def _scenes_dir():
    try:
        os.makedirs(_SCENES_DIR, exist_ok=True)
    except Exception:
        pass
    return _SCENES_DIR


def _scene_file(name):
    """校验场景名并返回文件路径；非法名（空/过长/路径穿越字符）返回 None。"""
    name = str(name or '').strip()
    if not name or len(name) > 64 or not _NAME_RE.match(name):
        return None
    return os.path.join(_scenes_dir(), name + '.json')


class MixinScenes(MixinBase):

    def _handle_scenes_get(self, path):
        rest = unquote(path[len('/api/scenes'):].strip('/'))
        if not rest:
            try:
                d = _scenes_dir()
                names = sorted(f[:-5] for f in os.listdir(d) if f.endswith('.json'))
            except Exception:
                names = []
            self._send_json({'ok': True, 'scenes': names})
            return
        fp = _scene_file(rest)
        if not fp or not os.path.isfile(fp):
            self._send_error('scene not found: ' + rest, 404)
            return
        try:
            with open(fp, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            self._send_json(data)
        except Exception as e:
            self._send_error('scene load failed: ' + str(e), 500)

    def _handle_scenes_post(self, path):
        name = unquote(path[len('/api/scenes'):].strip('/'))
        fp = _scene_file(name)
        if not fp:
            self._send_json({'ok': False, 'error': '场景名非法（限 64 字内字母/数字/中文/空格/连字符）'}, 400)
            return
        try:
            body = self._read_body()
        except Exception as e:
            self._send_json({'ok': False, 'error': '请求体不是有效 JSON: ' + str(e)}, 400)
            return
        try:
            if not isinstance(body, dict) or not isinstance(body.get('entities'), list):
                self._send_json({'ok': False, 'error': '场景格式错误：缺少 entities 数组'}, 400)
                return
            with open(fp, 'w', encoding='utf-8') as f:
                json.dump(body, f, ensure_ascii=False, indent=2)
            self._send_json({'ok': True, 'name': name})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
