"""
录音器 — 录制系统音频（立体声混音）
依赖 sounddevice + numpy（可选，未安装时返回友好错误）
"""
import os
import wave
import time
import threading
import subprocess
import sys
from pathlib import Path
from datetime import datetime

import shutil as _shutil
_ffmpeg = _shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"

_录音状态 = {
    "录制中": False,
    "开始时间": 0,
    "保存目录": "",
    "数据块": [],
    "采样率": 44100,
    "声道数": 2,
    "设备索引": None,
}

_锁 = threading.Lock()


class 录音器:

    @staticmethod
    def _查找录音设备():
        """查找立体声混音设备"""
        try:
            import sounddevice as sd
        except ImportError:
            return None, "未安装 sounddevice，无法录音。请运行: pip install sounddevice numpy"

        设备列表 = sd.query_devices()
        # 优先找包含 stereo/mix/立体声/混音 的输入设备
        for i, dev in enumerate(设备列表):
            名称 = dev.get('name', '')
            输入声道 = dev.get('max_input_channels', 0)
            if 输入声道 >= 2:
                小写名 = 名称.lower()
                if any(k in 小写名 for k in ['stereo', 'mix']) or '混音' in 名称 or '立体声' in 名称:
                    return i, None
        # 回退到设备0
        for i, dev in enumerate(设备列表):
            if dev.get('max_input_channels', 0) >= 2:
                return i, None
        return None, "未找到可用的录音设备（请在Windows声音设置中启用'立体声混音'）"

    @staticmethod
    def 开始录制(保存目录: str = "") -> dict:
        with _锁:
            if _录音状态["录制中"]:
                return {"成功": False, "错误": "已在录制中"}

            设备索引, 错误 = 录音器._查找录音设备()
            if 设备索引 is None:
                return {"成功": False, "错误": 错误}

            try:
                import sounddevice as sd
                import numpy as np
            except ImportError:
                return {"成功": False, "错误": "未安装 sounddevice/numpy，请运行: pip install sounddevice numpy"}

            采样率 = _录音状态["采样率"]
            声道数 = _录音状态["声道数"]

            _录音状态["数据块"] = []
            _录音状态["保存目录"] = 保存目录
            _录音状态["设备索引"] = 设备索引

            def 回调(数据, 帧数, 时间信息, 状态):
                if _录音状态["录制中"]:
                    _录音状态["数据块"].append(数据.copy())

            try:
                _流 = sd.InputStream(
                    device=设备索引,
                    channels=声道数,
                    samplerate=采样率,
                    dtype='int16',
                    callback=回调,
                    blocksize=1024,
                )
                _流.start()
                _录音状态["_流"] = _流
            except Exception as e:
                return {"成功": False, "错误": f"打开录音设备失败: {e}"}

            _录音状态["录制中"] = True
            _录音状态["开始时间"] = time.time()

            return {"成功": True, "消息": "录音已开始", "设备": 录音器._获取设备名(设备索引)}

    @staticmethod
    def _获取设备名(索引):
        try:
            import sounddevice as sd
            设备列表 = sd.query_devices()
            if 索引 < len(设备列表):
                return 设备列表[索引].get('name', '')
        except Exception:
            pass
        return ''

    @staticmethod
    def 停止录制() -> dict:
        with _锁:
            if not _录音状态["录制中"]:
                return {"成功": False, "错误": "没有正在进行的录音"}

            _录音状态["录制中"] = False

            # 停止流
            try:
                _流 = _录音状态.get("_流")
                if _流:
                    _流.stop()
                    _流.close()
            except Exception:
                pass

            时长 = time.time() - _录音状态["开始时间"]
            数据块 = _录音状态["数据块"]

            if not 数据块:
                return {"成功": False, "错误": "没有录制到数据"}

            try:
                import numpy as np
                音频数据 = np.concatenate(数据块, axis=0)
            except Exception as e:
                return {"成功": False, "错误": f"合并音频数据失败: {e}"}

            保存目录 = _录音状态["保存目录"] or str(Path.home() / "Desktop")
            os.makedirs(保存目录, exist_ok=True)

            时间戳 = datetime.now().strftime("%Y%m%d_%H%M%S")
            wav路径 = os.path.join(保存目录, f"录音_{时间戳}.wav")
            mp3路径 = os.path.join(保存目录, f"录音_{时间戳}.mp3")

            # 写WAV
            try:
                with wave.open(wav路径, 'wb') as wf:
                    wf.setnchannels(_录音状态["声道数"])
                    wf.setsampwidth(2)
                    wf.setframerate(_录音状态["采样率"])
                    wf.writeframes(音频数据.tobytes())
            except Exception as e:
                return {"成功": False, "错误": f"保存WAV失败: {e}"}

            # 转MP3
            最终路径 = wav路径
            if os.path.exists(_ffmpeg):
                try:
                    subprocess.run(
                        [_ffmpeg, "-y", "-i", wav路径, "-codec:a", "libmp3lame", "-b:a", "192k", mp3路径],
                        capture_output=True, timeout=60,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
                    )
                    if os.path.exists(mp3路径) and os.path.getsize(mp3路径) > 0:
                        os.remove(wav路径)
                        最终路径 = mp3路径
                except Exception:
                    pass

            文件大小MB = round(os.path.getsize(最终路径) / 1024 / 1024, 2)
            时长秒 = round(时长, 1)

            # 清理状态
            _录音状态["数据块"] = []
            _录音状态["_流"] = None

            return {
                "成功": True,
                "保存路径": 最终路径,
                "文件名": os.path.basename(最终路径),
                "时长秒": 时长秒,
                "大小MB": 文件大小MB,
                "消息": f"录音完成: {时长秒}秒, {文件大小MB}MB"
            }

    @staticmethod
    def 查询状态() -> dict:
        if _录音状态["录制中"]:
            时长 = round(time.time() - _录音状态["开始时间"], 1)
            return {"录制中": True, "时长秒": 时长}
        return {"录制中": False}
