# -*- coding: utf-8 -*-
"""Mixin: 灵感剪贴板（refboard 保存/读取/媒体），拆自 mixin_project.py"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinRefboard(MixinBase):
    def _refboard_path(self):
        """参考板文件路径：优先当前项目目录，否则应用 private/ 目录。"""
        try:
            root = getattr(self, '_get_project_root', None)
            proj = root() if callable(root) else None
        except Exception:
            proj = None
        if proj and os.path.isdir(proj):
            return os.path.join(proj, 'canvas-refboard.json')
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return os.path.join(base, 'private', 'canvas-refboard.json')

    def _handle_refboard_save(self):
        try:
            body = self._read_body()
        except Exception:
            body = {}
        content = str(body.get('content', '') or '')
        if not content:
            self._send_json({'ok': False, 'error': '缺少 content'}, 400)
            return
        try:
            path = self._refboard_path()
            os.makedirs(os.path.dirname(path), exist_ok=True)
            # 简单限流：≤5MB
            if len(content.encode('utf-8')) > 5 * 1024 * 1024:
                self._send_json({'ok': False, 'error': '内容过大'}, 413)
                return
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)
            self._send_json({'ok': True, 'path': path})
        except Exception as e:
            print(f'[POST /api/refboard-save] 500: {e}')
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_refboard_load(self):
        try:
            path = self._refboard_path()
            if not os.path.isfile(path):
                self._send_json({'ok': True, 'content': None})
                return
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            self._send_json({'ok': True, 'content': content, 'path': path})
        except Exception as e:
            print(f'[GET /api/refboard-load] 500: {e}')
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== 【画布参考图媒体】持久化存储（拖入/粘贴图片先上传换持久 URL） =====
    def _refboard_media_dir(self):
        try:
            root = getattr(self, '_get_project_root', None)
            proj = root() if callable(root) else None
        except Exception:
            proj = None
        if proj and os.path.isdir(proj):
            return os.path.join(proj, 'private', 'refboard-media')
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return os.path.join(base, 'private', 'refboard-media')

    def _handle_refboard_media_save(self):
        """POST /api/refboard-media-save  body: {name, dataBase64}
        dataBase64 可带 dataURL 前缀。返回 {ok, url}。"""
        try:
            body = self._read_body()
        except Exception:
            body = {}
        import base64 as _b64
        raw = str(body.get('dataBase64', '') or '')
        if not raw:
            self._send_json({'ok': False, 'error': '缺少 dataBase64'}, 400)
            return
        # 剥离 dataURL 前缀
        mime = 'image/png'
        if raw.startswith('data:'):
            try:
                head, raw = raw.split(',', 1)
                if 'image/' in head:
                    mime = head[5:head.index(';')] if ';' in head else head[5:]
            except Exception:
                pass
        try:
            data = _b64.b64decode(raw)
        except Exception as e:
            self._send_json({'ok': False, 'error': 'base64 解码失败: ' + str(e)}, 400)
            return
        if len(data) > 20 * 1024 * 1024:
            self._send_json({'ok': False, 'error': '文件过大'}, 413)
            return
        ext_map = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
                   'image/gif': '.gif', 'image/bmp': '.bmp', 'image/svg+xml': '.svg'}
        ext = ext_map.get(mime, '.png')
        try:
            import time as _time
            name = 'rb_' + str(int(_time.time() * 1000)) + '_' + str(__import__('random').randint(100, 999)) + ext
            d = self._refboard_media_dir()
            os.makedirs(d, exist_ok=True)
            path = os.path.join(d, name)
            with open(path, 'wb') as f:
                f.write(data)
            self._send_json({'ok': True, 'url': '/api/refboard-media/' + name})
        except Exception as e:
            print(f'[POST /api/refboard-media-save] 500: {e}')
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_refboard_media_get(self, filename):
        """GET /api/refboard-media/<filename>"""
        from urllib.parse import unquote
        filename = unquote(filename or '')
        if '..' in filename or '/' in filename or '\\' in filename or not filename:
            self._send_error('bad filename', 403)
            return
        path = os.path.join(self._refboard_media_dir(), filename)
        if not os.path.isfile(path):
            self._send_error('not found', 404)
            return
        ext = os.path.splitext(path)[1].lower()
        mime = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
                '.svg': 'image/svg+xml'}.get(ext, 'application/octet-stream')
        try:
            with open(path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'max-age=86400')
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self._send_error(str(e), 500)

