# -*- coding: utf-8 -*-
"""媒体录制路由 Mixin：录音（系统音频/麦克风）+ 录屏（ffmpeg gdigrab → MP4）。

路由（与 3.x 老版本接口保持一致）：
  POST /api/record-devices           列出录音设备
  POST /api/record-start             开始录音 {保存目录, 设备索引}
  POST /api/record-stop              停止录音 {音量倍数}
  POST /api/record-status            录音状态
  POST /api/record-logs              录音诊断日志
  POST /api/screenrecord-devices     列出 dshow 音频设备
  POST /api/screenrecord-select-area 弹出区域选择遮罩
  POST /api/screenrecord-start       开始录屏
  POST /api/screenrecord-stop        停止录屏（同步等转码）
  POST /api/screenrecord-status      录屏状态
  POST /api/screenrecord-logs        录屏日志
"""
import os
import sys
import json
import time
import threading

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if SERVER_DIR not in sys.path:
    sys.path.insert(0, SERVER_DIR)

from routes.mixin_base import MixinBase


class MixinMedia(MixinBase):

    # 供录音/录屏默认保存到当前浏览目录（由文件树前端传入；后端兜底桌面）
    _最后打开的文件夹 = ""
    _录屏设置 = {}

    def _media_save_dir(self, body_save_dir):
        保存目录 = str(body_save_dir or '').strip()
        if not 保存目录:
            保存目录 = MixinMedia._最后打开的文件夹 or os.path.join(os.path.expanduser('~'), 'Desktop')
        return 保存目录

    # ==================== 录音 ====================
    def _handle_record_devices(self):
        try:
            from 录音器 import 录音器
            self._send_json(录音器.列出设备())
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    def _handle_record_start(self):
        try:
            body = self._read_json()
        except Exception:
            body = {}
        保存目录 = self._media_save_dir(body.get('保存目录'))
        设备索引 = body.get('设备索引')
        try:
            from 录音器 import 录音器, _写诊断日志
            结果 = 录音器.开始录制(保存目录, 设备索引)
            _写诊断日志('开始录音', {'成功': bool(结果.get('成功')), '设备': 结果.get('设备', ''),
                              '引擎': 结果.get('引擎', ''), '错误': 结果.get('错误', '')})
            self._send_json(结果)
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    def _handle_record_stop(self):
        try:
            body = self._read_json()
        except Exception:
            body = {}
        try:
            from 录音器 import 录音器, _写诊断日志
            音量倍数 = body.get('音量倍数', 1.0)
            结果 = 录音器.停止录制(音量倍数)
            _写诊断日志('停止录音', {'成功': bool(结果.get('成功')), '音量倍数': 音量倍数,
                              '静音': bool(结果.get('静音')), '保存路径': 结果.get('保存路径', ''),
                              '时长秒': 结果.get('时长秒', 0), '错误': 结果.get('错误', '')})
            self._send_json(结果)
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    def _handle_record_status(self):
        try:
            from 录音器 import 录音器
            self._send_json(录音器.查询状态())
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    def _handle_record_logs(self):
        try:
            body = self._read_json()
        except Exception:
            body = {}
        try:
            from 录音器 import 查询诊断日志
            self._send_json({'成功': True, '日志列表': 查询诊断日志(body.get('限制', 100))})
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    # ==================== 录屏 ====================
    def _handle_screenrecord_settings(self):
        """前端启动录屏前读取默认设置（音频模式/帧率/音量等）"""
        try:
            设置 = dict(MixinMedia._录屏设置 or {})
            # 缺省值与前端 _srStart 的兜底保持一致
            设置.setdefault('音频模式', 'mic')
            设置.setdefault('帧率', 30)
            设置.setdefault('麦克风音量', 1.0)
            设置.setdefault('麦克风静音', False)
            设置.setdefault('系统音量', 1.0)
            设置.setdefault('系统静音', False)
            设置.setdefault('dshow设备名', '')
            self._send_json({'成功': True, '设置': 设置})
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    def _handle_screenrecord_devices(self):
        try:
            from 录屏器 import 录屏器
            self._send_json(录屏器.列出dshow设备())
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    def _handle_screenrecord_select_area(self):
        """弹出全屏遮罩框选录制区域（tkinter，阻塞直到选完/取消）"""
        try:
            import tkinter as tk
            from 区域选择 import 区域选择
            root = tk.Tk()
            root.withdraw()
            选择器 = 区域选择(root)
            结果 = 选择器.弹出()
            root.destroy()
            if 结果:
                self._send_json({'成功': True, '区域': 结果})
            else:
                self._send_json({'成功': False, '错误': '用户取消了区域选择'})
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    def _handle_screenrecord_start(self):
        try:
            body = self._read_json()
        except Exception:
            body = {}
        保存目录 = self._media_save_dir(body.get('保存目录'))
        x = body.get('x', 0); y = body.get('y', 0)
        w = body.get('w', 0); h = body.get('h', 0)
        帧率 = body.get('帧率', 30)
        音频模式 = body.get('音频模式', 'mic')
        dshow设备名 = body.get('dshow设备名', '')
        麦克风音量 = body.get('麦克风音量', 1.0)
        麦克风静音 = body.get('麦克风静音', False)
        系统音量 = body.get('系统音量', 1.0)
        系统静音 = body.get('系统静音', False)
        点击效果 = body.get('点击效果', False)
        点击音效 = body.get('点击音效', False)
        音效音量 = body.get('音效音量', 50)

        # 前端用百分比(0~200)；兼容 0~1 倍率
        def _规范音量(值, 默认值):
            try:
                数值 = float(值)
                if 数值 > 2:
                    数值 /= 100.0
                return max(0.0, min(2.0, 数值))
            except (TypeError, ValueError):
                return 默认值
        麦克风音量 = _规范音量(麦克风音量, 1.0)
        系统音量 = _规范音量(系统音量, 1.0)

        MixinMedia._录屏设置.update({
            '帧率': 帧率, '音频模式': 音频模式, 'dshow设备名': dshow设备名,
            '麦克风音量': 麦克风音量, '麦克风静音': 麦克风静音,
            '系统音量': 系统音量, '系统静音': 系统静音,
            '点击效果': 点击效果, '点击音效': 点击音效, '音效音量': 音效音量,
        })
        try:
            from 录屏器 import 录屏器
            结果 = 录屏器.开始录制(保存目录, x, y, w, h, 帧率, 音频模式, dshow设备名,
                               麦克风音量, 麦克风静音, 系统音量, 系统静音,
                               点击效果, 点击音效, 音效音量)
            self._send_json(结果)
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    # ==================== 对话拖拽出浏览器 → 无缝弹出独立窗口 ====================
    @staticmethod
    def _find_pythonw():
        """优先项目自带 python/pythonw.exe，其次当前解释器。"""
        cand = os.path.join(SERVER_DIR, '..', 'python', 'pythonw.exe')
        if os.path.exists(cand):
            return cand
        return sys.executable

    def _handle_chatbox_pop(self):
        """接收前端拖拽生成 .pyw 代码，用 pythonw 直接运行（不落盘到固定位置，
        写入 %TEMP%，窗口自身会 GetCursorPos 弹在鼠标松手位置 → 无缝衔接）。"""
        try:
            import subprocess, tempfile
            try:
                body = self._read_json()
            except Exception:
                body = {}
            py = str(body.get('py') or '')
            if not py or 'tkinter' not in py:
                self._send_json({'成功': False, '错误': 'py 内容无效'})
                return
            d = tempfile.mkdtemp(prefix='zfchat_')
            path = os.path.join(d, '独立窗口.pyw')
            with open(path, 'w', encoding='utf-8') as f:
                f.write(py)
            flags = 0
            if hasattr(subprocess, 'DETACHED_PROCESS'):
                flags |= subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW
            subprocess.Popen([self._find_pythonw(), path],
                             cwd=d, close_fds=True,
                             creationflags=flags if os.name == 'nt' else 0)
            self._send_json({'成功': True, '路径': path})
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    def _handle_screenrecord_stop(self):
        try:
            from 录屏器 import 录屏器, _写日志
            _写日志('API:screenrecord-stop', '信息', '前端调用停止录屏API')
            结果 = 录屏器.停止并等待完成(超时秒=300)
            _写日志('API:screenrecord-stop响应', '信息',
                    f"成功={结果.get('成功')} 保存路径={结果.get('保存路径', '')}")
            self._send_json(结果)
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    def _handle_screenrecord_status(self):
        try:
            from 录屏器 import 录屏器
            self._send_json(录屏器.查询状态())
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})

    def _handle_screenrecord_logs(self):
        try:
            body = self._read_json()
        except Exception:
            body = {}
        try:
            from 录屏器 import 录屏器
            会话ID = body.get('会话ID', '')
            self._send_json(录屏器.查询录屏日志(会话ID if 会话ID else None))
        except Exception as e:
            self._send_json({'成功': False, '错误': str(e)})
