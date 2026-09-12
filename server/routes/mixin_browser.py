# -*- coding: utf-8 -*-
"""Mixin: 内置浏览器（/api/browser）—— 薄适配层。

实际逻辑全部在 server/browser_plugin/ 独立插件包里（engine.py）：
  * 动作注册表：内置 goto/click/fill/screenshot/... 均可被外部覆盖/扩展
  * 多会话：POST 带 "session" 字段即用独立登录态会话
  * 本文件只做 HTTP <-> 引擎 的转换，不含任何浏览器逻辑

接口：
  POST /api/browser  {action, ...params}
  GET  /api/browser?action=...
特殊：action=shot 直接回 PNG（画布节点 <img> 用）
"""
import os
import sys
import json

_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

from browser_plugin import engine  # noqa: E402

_SHOT_LATEST = os.path.join(engine._PLUGIN_DIR, 'data', 'shots', 'default', 'latest.png')


def _browser_action(action, params):
    """执行浏览器动作，全部委托给插件引擎。"""
    if not action:
        action = 'status'
    return engine.dispatch(action, params)


class MixinBrowser:
    def _send_png(self, path):
        try:
            raw = open(path, 'rb').read()
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(raw)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== GET /api/browser?action=... =====
    def _handle_browser_get(self, query):
        from urllib.parse import parse_qs
        qs = parse_qs(query or '')
        action = (qs.get('action') or ['status'])[0]
        params = {k: v[0] for k, v in qs.items() if k != 'action'}
        if action == 'shot':
            # 直接回 PNG（画布节点 <img> 用，避免 base64 JSON 过大）
            p = params.get('session') and \
                os.path.join(engine._PLUGIN_DIR, 'data', 'shots', params['session'], 'latest.png') \
                or _SHOT_LATEST
            if not os.path.exists(p):
                # 兜底：还没截图时现拍一张（画布节点初次打开不至于空白）
                try:
                    _browser_action('screenshot', {'session': params.get('session') or 'default'})
                except Exception:
                    pass
            if not os.path.exists(p):
                self._send_json({'ok': False, 'error': '还没有截图，先 POST action=screenshot'})
                return
            self._send_png(p)
            return
        self._send_json(_browser_action(action, params))

    # ===== POST /api/browser {action, ...} =====
    def _handle_browser_post(self, body):
        try:
            # _read_body() 可能返回 dict（已解析）或原始 bytes
            if isinstance(body, dict):
                data = body
            else:
                data = json.loads(body or b'{}')
        except Exception:
            data = {}
        action = data.get('action')
        r = _browser_action(action, data)
        self._send_json(r)
