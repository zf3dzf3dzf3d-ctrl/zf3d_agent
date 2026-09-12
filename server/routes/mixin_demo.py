# -*- coding: utf-8 -*-
"""Mixin: HTML 演示工作台 API
GET  /api/demo/list            -> 列出所有演示（读 演示/index.json）
GET  /api/demo/get?file=xx     -> 读单个 .pres.json 全文（含 outline/animations）
POST /api/demo/save            -> 保存 .pres.json（body: {file, data}，整文件原子写，自动 .bak）
安全：file 只取 basename，限制在 演示/slides/ 内；自动备份旧文件。
"""
import os, json, shutil, time
from routes._shared import *
from routes.mixin_base import MixinBase

_DEMO_DIR = os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '演示'))
_SLIDES_DIR = os.path.join(_DEMO_DIR, 'slides')


class MixinDemo(MixinBase):
    def _demo_safe_path(self, name):
        """防目录穿越：只允许 slides/ 下的 .pres.json"""
        name = os.path.basename(str(name or '').strip())
        if not name:
            return None
        if not name.endswith('.pres.json'):
            name += '.pres.json'
        p = os.path.normpath(os.path.join(_SLIDES_DIR, name))
        if not p.startswith(_SLIDES_DIR):
            return None
        return p

    def _handle_demo_list(self):
        try:
            idx_path = os.path.join(_DEMO_DIR, 'index.json')
            items = []
            if os.path.isfile(idx_path):
                with open(idx_path, 'r', encoding='utf-8-sig') as f:
                    raw = json.load(f)
                # index.json 兼容多种形态：数组 / {files:[...]} / {list:[...]}
                if isinstance(raw, list):
                    items = raw
                elif isinstance(raw, dict):
                    items = raw.get('files') or raw.get('list') or raw.get('items') or []
            self._send_json({'ok': True, 'items': items})
        except Exception as e:
            print(f'[GET /api/demo/list] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_demo_get(self, qs):
        try:
            name = (qs.get('file') or [''])[0]
            p = self._demo_safe_path(name)
            if not p or not os.path.isfile(p):
                self._send_json({'ok': False, 'err': '演示文件不存在: ' + name}, 404)
                return
            with open(p, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            # 兼容：无 outline/animations 的旧文件返回空默认值
            data.setdefault('outline', [])
            data.setdefault('animations', {})
            self._send_json({'ok': True, 'file': os.path.basename(p), 'data': data})
        except Exception as e:
            print(f'[GET /api/demo/get] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_demo_save(self):
        try:
            body = self._read_body()
            name = body.get('file', '')
            data = body.get('data')
            p = self._demo_safe_path(name)
            if not p or not isinstance(data, dict):
                self._send_json({'ok': False, 'err': '参数错误：需要 file 和 data(对象)'})
                return
            # 校验基本结构
            if not isinstance(data.get('slides'), list):
                self._send_json({'ok': False, 'err': 'data.slides 必须是数组'})
                return
            os.makedirs(_SLIDES_DIR, exist_ok=True)
            # 自动备份旧文件（沙箱保护风格）
            if os.path.isfile(p):
                from datetime import datetime
                bak = p + '.bak.' + datetime.now().strftime('%Y%m%d_%H%M%S_%f')
                try: shutil.copy2(p, bak)
                except Exception: pass
            tmp = p + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, p)
            self._send_json({'ok': True, 'file': os.path.basename(p), 'slides': len(data['slides'])})
        except Exception as e:
            print(f'[POST /api/demo/save] 500: {e}')
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass
