# -*- coding: utf-8 -*-
"""Mixin: POST 分发（自动拆分自 mixin_dispatch.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


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

            # 优先用 sys.executable（自带 python），本机装了 edge-tts 的解释器可在此配置
            py311 = sys.executable
            if not os.path.exists(py311):
                py311 = 'python'
            fd, tmp = tempfile.mkstemp(suffix='.mp3')
            os.close(fd)
            code = ("import asyncio,edge_tts,sys\n"
                    "async def m():\n"
                    "    c=edge_tts.Communicate(sys.argv[1],sys.argv[2])\n"
                    "    await c.save(sys.argv[3])\n"
                    "asyncio.run(m())\n")
            r = subprocess.run([py311, '-c', code, text[:500], voice, tmp],
                               capture_output=True, timeout=15,  # 【修复】30→15秒：实测正常合成<10秒，超时快速失败让前端尽早回退
                               creationflags=subprocess.CREATE_NO_WINDOW)
            if r.returncode != 0 or not os.path.exists(tmp) or os.path.getsize(tmp) < 100:
                try: os.remove(tmp)
                except OSError: pass
                _err = (r.stderr or b'').decode('utf8', 'ignore')[-300:]
                try:
                    import time as _time
                    with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server_stdout.log'), 'a', encoding='utf8') as _lf:
                        _lf.write('[/api/tts] 502 合成失败 timeout=15s: %s\n' % _err.replace('\n', ' | '))
                except Exception:
                    pass
                self._send_json({'ok': False, 'error': _err}, 502)
                return
            data = open(tmp, 'rb').read()
            try: os.remove(tmp)
            except OSError: pass
            # 写入缓存（最多 40 条，简单 FIFO 清理）
            try:
                with self.__class__._tts_cache_lock:
                    if len(self.__class__._tts_cache) > 40:
                        first_key = next(iter(self.__class__._tts_cache))
                        self.__class__._tts_cache.pop(first_key, None)
                    self.__class__._tts_cache[_cache_key] = data
            except Exception:
                pass
            self.send_response(200)
            self.send_header('Content-Type', 'audio/mpeg')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            try: self._send_json({'ok': False, 'error': str(e)}, 500)
            except Exception: pass


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

