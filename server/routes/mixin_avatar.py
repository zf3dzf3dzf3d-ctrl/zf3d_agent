# -*- coding: utf-8 -*-
"""Mixin: 画布玩偶（Avatar）API
POST /api/avatar/tts  -> 文本转语音，返回音频 url
  body: {"text": "要说的话", "voice": "可选，edge-tts 音色"}
  优先走 server/tts_engine.py 的字节 doubao TTS；失败自动回退 edge-tts。
GET  /api/avatar/tts?text=xxx  -> 同上（GET 便捷形式）
"""
import os, json, time, urllib.parse
from routes._shared import *
from routes.mixin_base import MixinBase

_AV_AUDIO_DIR = os.path.normpath(os.path.join(BASE_DIR, 'public', 'audio'))
os.makedirs(_AV_AUDIO_DIR, exist_ok=True)

# edge-tts 回退时用的默认音色（可换：zh-CN-XiaoxiaoNeural 等）
_EDGE_VOICE = 'zh-CN-XiaoyiNeural'


class MixinAvatar(MixinBase):

    def _avatar_tts_edge(self, text, voice=None):
        """edge-tts 回退：合成 mp3 到 public/audio/，返回 url"""
        try:
            import asyncio
            import edge_tts
            if not hasattr(edge_tts, 'Communicate'):
                import importlib as _il
                edge_tts = _il.reload(edge_tts)
            fname = 'edge_%s.mp3' % time.strftime('%Y%m%d_%H%M%S')
            fpath = os.path.join(_AV_AUDIO_DIR, fname)
            async def _run():
                com = edge_tts.Communicate(text, voice or _EDGE_VOICE)
                await com.save(fpath)
            asyncio.run(_run())
            if os.path.isfile(fpath) and os.path.getsize(fpath) > 100:
                return '/audio/' + fname
        except Exception as e:
            print(f'[avatar/tts edge fallback error] {e}')
        return None

    def _avatar_tts_bytedance(self, text):
        """优先：字节 doubao TTS（复用 server/tts_engine.py）"""
        try:
            import sys as _sys
            srv_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            if srv_dir not in _sys.path:
                _sys.path.insert(0, srv_dir)
            from tts_engine import synth_to_file, get_api_key
            key = get_api_key()
            if not key:
                return None
            r = synth_to_file(text, key)
            if r and r.get('url'):
                return r['url']
        except Exception as e:
            print(f'[avatar/tts bytedance error] {e}')
        return None

    def _handle_avatar_tts(self, qs=None, body=None):
        try:
            text = ''
            voice = None
            if body and isinstance(body, dict):
                text = str(body.get('text') or '').strip()
                voice = body.get('voice') or None
            if not text and qs:
                text = urllib.parse.unquote((qs.get('text') or [''])[0]).strip()
                voice = voice or (qs.get('voice') or [None])[0]
            if not text:
                self._send_json({'ok': False, 'err': '缺少 text 参数'}, 400)
                return
            # 限制长度，防滥用
            text = text[:500]

            url = self._avatar_tts_bytedance(text)
            engine = 'bytedance'
            if not url:
                url = self._avatar_tts_edge(text, voice)
                engine = 'edge-tts'
            if not url:
                self._send_json({'ok': False, 'err': 'TTS 合成失败（字节与 edge-tts 均失败）'}, 500)
                return
            self._send_json({'ok': True, 'url': url, 'engine': engine})
        except Exception as e:
            print(f'[avatar/tts] 500: {e}')
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass
