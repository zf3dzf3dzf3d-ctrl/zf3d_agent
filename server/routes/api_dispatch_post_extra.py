# -*- coding: utf-8 -*-
"""Mixin: POST 分发（自动拆分自 mixin_dispatch.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase
import logging

# =====【优化】TTS 进程内合成：线程池 + asyncio 跑 edge-tts，替代每次新起子进程 =====
import threading as _tts_thr
_tts_pool = None
_tts_pool_lock = _tts_thr.Lock()


def _tts_get_pool():
    """惰性创建 TTS 合成线程池（进程内合成，消除子进程冷启动与超时脆弱性）。"""
    global _tts_pool
    if _tts_pool is None:
        with _tts_pool_lock:
            if _tts_pool is None:
                from concurrent.futures import ThreadPoolExecutor
                _tts_pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix='tts')
    return _tts_pool


def _tts_synthesize(text, voice, timeout=18):
    """在线程池线程内用 asyncio 调 edge-tts，返回 mp3 bytes；内部 wait_for 超时保证线程可回收。"""
    import asyncio, edge_tts
    if not hasattr(edge_tts, 'Communicate'):
        # 旧版本模块残留在 sys.modules（如升级 edge-tts 后未重启），强制重载自愈
        try:
            import importlib as _il
            edge_tts = _il.reload(edge_tts)
        except Exception as _re_err:
            print(f'[tts] edge_tts reload 失败: {_re_err}')

    async def _run():
        _c = edge_tts.Communicate(text, voice)
        _buf = bytearray()
        async for _ch in _c.stream():
            if _ch.get('type') == 'audio':
                _buf.extend(_ch.get('data') or b'')
        return bytes(_buf)

    return asyncio.run(asyncio.wait_for(_run(), timeout))



# ==== 以下方法体原样搬移（无改动），仅按职责拆分文件 ====


class MixinDispatchPostExtra:
    def _handle_tts(self):
        try:
            import json as _json, subprocess, sys, tempfile, base64, hashlib, threading
            body = self._read_body()
            text = str(body.get('text', '')).strip()
            voice = str(body.get('voice', 'zh-CN-XiaoxiaoNeural')).strip()
            if not text:
                self._send_json({'ok': False, 'error': 'empty text'}, 400)
                return
            # 去掉标点/符号/空白后无任何实际内容（如 "！？。"）：edge-tts 无法合成，直接告诉前端"没有可读内容"
            import re as _re
            if not _re.search(r'[\w\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]', text[:500]):
                self._send_json({'ok': False, 'error': 'no speakable content'}, 400)
                return
            # 只允许合法音色名，防止任意参数
            if not (voice.replace('-', '').isalnum()):
                voice = 'zh-CN-XiaoxiaoNeural'

            # =====【2026 修复】合成结果内存缓存 + 预热 =====
            # 原版每次都现场起 Python 子进程跑 edge-tts（冷启动 ~2-4.5 秒），导致任务完成后"很久才有声音"。
            # 同一段任务结论经常重复朗读（重试/验证轮），命中缓存后 <10ms 即返回。
            if not hasattr(self.__class__, '_tts_cache'):
                self.__class__._tts_cache = {}      # key -> bytes
                self.__class__._tts_cache_lock = threading.Lock()
            _cache_key = hashlib.md5((voice + '|' + text[:500]).encode('utf8')).hexdigest()
            with self.__class__._tts_cache_lock:
                _hit = self.__class__._tts_cache.get(_cache_key)
            if _hit:
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Content-Length', str(len(_hit)))
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(_hit)
                return

            # =====【优化】进程内线程池合成，替代每次新起子进程 =====
            # 原版每次新起 Python 子进程跑 edge-tts（冷启动 + 15s 超时），网络抖动/
            # 微软服务慢时频繁 TimeoutExpired 导致 502。改为进程内 asyncio 合成：
            # 无子进程冷启动、内部超时可控、线程池隔离不阻塞主请求线程。
            _err = 'unknown error'
            data = None
            for _attempt in range(3):
                try:
                    _fut = _tts_get_pool().submit(_tts_synthesize, text[:500], voice)
                    data = _fut.result(timeout=20)
                    if data and len(data) >= 100:
                        break
                    _err = 'empty audio'
                    data = None
                except Exception as _e:
                    _err = ('%s: %s' % (type(_e).__name__, _e))[-300:]
                    data = None
                if _attempt < 2:
                    import time as _slp
                    _slp.sleep(0.6)
            if not data:
                try:
                    with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server_stdout.log'), 'a', encoding='utf8') as _lf:
                        _lf.write('[/api/tts] 502 合成失败(已重试2次) : %s\n' % str(_err).replace('\n', ' | '))
                except Exception:
                    logging.debug("swallow", exc_info=True)
                self._send_json({'ok': False, 'error': _err}, 502)
                return
            # 写入缓存（最多 40 条，简单 FIFO 清理）
            try:
                with self.__class__._tts_cache_lock:
                    if len(self.__class__._tts_cache) > 40:
                        first_key = next(iter(self.__class__._tts_cache))
                        self.__class__._tts_cache.pop(first_key, None)
                    self.__class__._tts_cache[_cache_key] = data
            except Exception: logging.debug("swallow", exc_info=True)
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            try:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            except Exception:
                logging.debug("swallow", exc_info=True)
    def _handle_plugin_install(self):
        try:
            插件目录, py = self._plugin_paths()
            if not self._plugin_source_ok():
                self._send_json({'ok': False, 'error': '插件包不存在（plugins/audio-video-plugin）'}, 404)
                return
            import shutil
            copied = 0
            for src, dst in self._plugin_targets():
                s = os.path.join(插件目录, src)
                d = os.path.join(py, dst)
                if not os.path.exists(s):
                    continue
                os.makedirs(os.path.dirname(d), exist_ok=True)
                if os.path.exists(d):
                    shutil.rmtree(d, ignore_errors=True) if os.path.isdir(d) else os.remove(d)
                shutil.move(s, d)
                copied += 1
            self._send_json({'ok': True, 'copied': copied, 'installed': self._plugin_installed()})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== 在线朗读（edge-tts 代理）：POST /api/tts {text, voice} -> mp3 =====
    def _handle_plugin_status(self):
        self._send_json({
            'ok': True,
            'installed': self._plugin_installed(),
            'sourceAvailable': self._plugin_source_ok(),
        })

    def _plugin_targets(self):
        """定义插件文件: (插件包内相对路径, python 目录下目标路径)"""
        return [
            ('soundcard',        r'Lib\site-packages\soundcard'),
            ('numpy',            r'Lib\site-packages\numpy'),
            ('numpy.libs',       r'Lib\site-packages\numpy.libs'),
            ('cffi',             r'Lib\site-packages\cffi'),
            ('pycparser',        r'Lib\site-packages\pycparser'),
            ('_cffi_backend.cp311-win_amd64.pyd', r'Lib\site-packages\_cffi_backend.cp311-win_amd64.pyd'),
            ('tcl',              r'tcl'),
            ('tcl86t.dll',       r'DLLs\tcl86t.dll'),
            ('tk86t.dll',        r'DLLs\tk86t.dll'),
            ('_tkinter.pyd',     r'DLLs\_tkinter.pyd'),
        ]

    def _plugin_installed(self):
        插件目录, py = self._plugin_paths()
        if not os.path.isdir(插件目录):
            return False
        for src, dst in self._plugin_targets():
            if not os.path.exists(os.path.join(py, dst)):
                return False
        return True

    def _plugin_paths(self):
        """返回 (插件目录, python目录)"""
        根 = BASE_DIR  # 项目根目录
        return (
            os.path.join(根, 'plugins', 'audio-video-plugin'),
            os.path.join(根, 'python'),
        )

    def _plugin_source_ok(self):
        插件目录, _ = self._plugin_paths()
        return os.path.isdir(插件目录)

