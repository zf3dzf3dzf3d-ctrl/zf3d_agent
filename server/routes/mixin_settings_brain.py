# -*- coding: utf-8 -*-
"""Mixin: 主脑（Main Brain）（由 mixin_settings.py 拆出，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinSettingsBrain(MixinBase):
    # ==================== 主脑（Main Brain） ====================
    def _handle_brain_state(self):
        """GET /api/brain/state — 运行状态 + 消息流"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.main_brain import get_state
            self._send_json(get_state(BASE_DIR))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_brain_chat(self):
        """POST /api/brain/chat {text} — 与主脑对话（独立会话）"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.main_brain import brain_chat
            body = self._read_body()
            self._send_json(brain_chat(BASE_DIR, body.get('text')))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_brain_control(self):
        """POST /api/brain/control {paused, auto_report}"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.main_brain import brain_control
            body = self._read_body()
            self._send_json(brain_control(BASE_DIR,
                           body.get('paused'), body.get('auto_report'),
                           body.get('interval')))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_brain_summary(self):
        """POST /api/brain/summary — 手动触发一次总结"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            from brain.main_brain import request_manual_summary
            self._send_json(request_manual_summary(BASE_DIR))
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_brain_report(self):
        """GET /api/brain/report — 最近一次主脑总结报告（供一键复制）"""
        try:
            import sys as _sys, json as _json
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server'))
            # 优先内存态，其次读 summaries.jsonl 尾部
            try:
                from brain.main_brain import get_memory_report
                self._send_json(get_memory_report(BASE_DIR))
                return
            except ImportError:
                pass
            path = os.path.join(BASE_DIR, 'private', 'brain', 'summaries.jsonl')
            if os.path.exists(path):
                last = None
                with open(path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            try: last = _json.loads(line)
                            except Exception: pass
                if last:
                    self._send_json({'ok': True, 'time': last.get('time', ''),
                                     'text': last.get('text', ''), 'why': last.get('why', '')})
                    return
            self._send_json({'ok': True, 'text': '', 'time': ''})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
