"""
录音器 — 录制系统音频（WASAPI Loopback + sounddevice 兼容）
优先使用 soundcard 库的 WASAPI loopback 捕获系统输出音频；
如果未安装 soundcard，回退到 sounddevice（立体声混音/麦克风）。
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
    "设备名": "",
    "引擎": None,  # "soundcard" 或 "sounddevice"
}

_锁 = threading.Lock()


def _检测引擎():
    """检测可用的录音引擎，优先 soundcard（WASAPI loopback）"""
    try:
        import soundcard as sc
        return "soundcard"
    except ImportError:
        pass
    try:
        import sounddevice
        return "sounddevice"
    except ImportError:
        pass
    return None


class 录音器:

    @staticmethod
    def 列出设备() -> dict:
        """列出所有可用音频输入设备（跨引擎）"""
        引擎 = _检测引擎()
        if 引擎 is None:
            return {"成功": False, "错误": "未安装 soundcard 或 sounddevice，请运行: pip install soundcard"}

        设备列表 = []

        if 引擎 == "soundcard":
            try:
                import soundcard as sc
                # 添加 loopback 设备（系统音频输出）
                for spk in sc.all_speakers():
                    设备列表.append({
                        "索引": len(设备列表),
                        "名称": f"🔊 {spk.name}（系统声音）",
                        "输入声道": spk.channels,
                        "引擎": "loopback",
                        "设备ID": str(spk.name),
                    })
                # 添加麦克风设备
                for mic in sc.all_microphones():
                    设备列表.append({
                        "索引": len(设备列表),
                        "名称": f"🎤 {mic.name}",
                        "输入声道": getattr(mic, 'channels', 1),
                        "引擎": "mic",
                        "设备ID": str(mic.name),
                    })
            except Exception as e:
                return {"成功": False, "错误": f"枚举设备失败: {e}"}

        elif 引擎 == "sounddevice":
            try:
                import sounddevice as sd
                devs = sd.query_devices()
                for i, dev in enumerate(devs):
                    输入声道 = dev.get('max_input_channels', 0)
                    if 输入声道 > 0:
                        名称 = dev.get('name', f'设备{i}')
                        小写名 = 名称.lower()
                        推荐标记 = ""
                        if any(k in 小写名 for k in ['stereo', 'mix']) or '混音' in 名称 or '立体声' in 名称:
                            推荐标记 = "★ "
                        设备列表.append({
                            "索引": i,
                            "名称": 推荐标记 + 名称,
                            "输入声道": 输入声道,
                            "引擎": "sounddevice",
                            "设备ID": str(i),
                        })
            except Exception as e:
                return {"成功": False, "错误": f"枚举设备失败: {e}"}

        return {"成功": True, "设备列表": 设备列表, "引擎": 引擎}

    @staticmethod
    def 开始录制(保存目录: str = "", 设备索引: int = None) -> dict:
        with _锁:
            if _录音状态["录制中"]:
                return {"成功": False, "错误": "已在录制中"}

            引擎 = _检测引擎()
            if 引擎 is None:
                return {"成功": False, "错误": "未安装 soundcard 或 sounddevice，请运行: pip install soundcard"}

            # 获取设备列表以查找选中的设备
            设备列表结果 = 录音器.列出设备()
            if not 设备列表结果["成功"]:
                return {"成功": False, "错误": 设备列表结果["错误"]}

            所有设备 = 设备列表结果["设备列表"]
            if not 所有设备:
                return {"成功": False, "错误": "未找到可用的录音设备"}

            # 选择设备
            选中设备 = None
            if 设备索引 is not None:
                for d in 所有设备:
                    if d["索引"] == 设备索引:
                        选中设备 = d
                        break
            if 选中设备 is None:
                # 默认选择第一个 loopback 设备，否则第一个设备
                for d in 所有设备:
                    if d.get("引擎") == "loopback":
                        选中设备 = d
                        break
                if 选中设备 is None:
                    选中设备 = 所有设备[0]

            采样率 = _录音状态["采样率"]
            声道数 = _录音状态["声道数"]

            _录音状态["数据块"] = []
            _录音状态["保存目录"] = 保存目录
            _录音状态["设备索引"] = 选中设备["索引"]
            _录音状态["设备名"] = 选中设备["名称"]
            _录音状态["引擎"] = 选中设备.get("引擎", 引擎)

            try:
                if 选中设备.get("引擎") == "loopback":
                    return 录音器._开始soundcard录制(选中设备, 采样率, 声道数)
                elif 选中设备.get("引擎") == "mic":
                    return 录音器._开始soundcard麦克风(选中设备, 采样率)
                else:
                    return 录音器._开始sounddevice录制(选中设备, 采样率, 声道数)
            except Exception as e:
                _录音状态["录制中"] = False
                return {"成功": False, "错误": f"打开录音设备失败: {e}"}

    @staticmethod
    def _开始soundcard录制(设备, 采样率, 声道数):
        """使用 soundcard WASAPI loopback 录制系统音频"""
        import soundcard as sc
        import numpy as np

        # 找到对应的 speaker
        设备ID = 设备["设备ID"]
        speaker = None
        for spk in sc.all_speakers():
            if str(spk.name) == 设备ID:
                speaker = spk
                break
        if speaker is None:
            speaker = sc.default_speaker()

        mic = sc.get_microphone(id=str(speaker.name), include_loopback=True)
        recorder = mic.recorder(samplerate=采样率, channels=speaker.channels)

        def 录音线程():
            import numpy as np
            try:
                recorder.__enter__()
                while _录音状态["录制中"]:
                    data = recorder.record(numframes=采样率)  # 每次录1秒
                    if _录音状态["录制中"]:
                        _录音状态["数据块"].append(data)
            except Exception as e:
                print(f"录音线程异常: {e}")
            finally:
                try:
                    recorder.__exit__(None, None, None)
                except Exception:
                    pass

        _录音状态["_recorder"] = recorder
        _录音状态["录制中"] = True
        _录音状态["开始时间"] = time.time()

        t = threading.Thread(target=录音线程, daemon=True)
        t.start()
        _录音状态["_线程"] = t

        return {"成功": True, "消息": "录音已开始", "设备": 设备["名称"], "引擎": "soundcard-loopback"}

    @staticmethod
    def _开始soundcard麦克风(设备, 采样率):
        """使用 soundcard 录制麦克风"""
        import soundcard as sc
        import numpy as np

        设备ID = 设备["设备ID"]
        mic = None
        for m in sc.all_microphones():
            if str(m.name) == 设备ID:
                mic = m
                break
        if mic is None:
            mics = sc.all_microphones()
            if mics:
                mic = mics[0]
            else:
                return {"成功": False, "错误": "未找到麦克风设备"}

        ch = getattr(mic, 'channels', 1) or 1
        recorder = mic.recorder(samplerate=采样率, channels=ch)

        def 录音线程():
            import numpy as np
            try:
                recorder.__enter__()
                while _录音状态["录制中"]:
                    data = recorder.record(numframes=采样率)
                    if _录音状态["录制中"]:
                        _录音状态["数据块"].append(data)
            except Exception as e:
                print(f"录音线程异常: {e}")
            finally:
                try:
                    recorder.__exit__(None, None, None)
                except Exception:
                    pass

        _录音状态["_recorder"] = recorder
        _录音状态["录制中"] = True
        _录音状态["开始时间"] = time.time()

        t = threading.Thread(target=录音线程, daemon=True)
        t.start()
        _录音状态["_线程"] = t

        return {"成功": True, "消息": "录音已开始", "设备": 设备["名称"], "引擎": "soundcard-mic"}

    @staticmethod
    def _开始sounddevice录制(设备, 采样率, 声道数):
        """使用 sounddevice 录制（兼容旧方式）"""
        import sounddevice as sd
        import numpy as np

        设备索引 = int(设备["设备ID"])

        def 回调(数据, 帧数, 时间信息, 状态):
            if _录音状态["录制中"]:
                _录音状态["数据块"].append(数据.copy())

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
        _录音状态["录制中"] = True
        _录音状态["开始时间"] = time.time()

        return {"成功": True, "消息": "录音已开始", "设备": 设备["名称"], "引擎": "sounddevice"}

    @staticmethod
    def 停止录制(音量倍数: float = 1.0) -> dict:
        with _锁:
            if not _录音状态["录制中"]:
                return {"成功": False, "错误": "没有正在进行的录音"}

            _录音状态["录制中"] = False

            # 等待录音线程结束
            线程 = _录音状态.get("_线程")
            if 线程:
                线程.join(timeout=3)

            # 停止 sounddevice 流
            try:
                _流 = _录音状态.get("_流")
                if _流:
                    _流.stop()
                    _流.close()
                    _录音状态["_流"] = None
            except Exception:
                pass

            # 停止 soundcard recorder（只停一次，录音线程的finally可能已经停了）
            try:
                recorder = _录音状态.get("_recorder")
                if recorder:
                    recorder.__exit__(None, None, None)
                    _录音状态["_recorder"] = None
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

            # 统一转为 float32 处理
            if 音频数据.dtype == np.int16:
                音频数据 = 音频数据.astype(np.float32) / 32768.0

            # 检测静音（放大前）
            peak = float(np.abs(音频数据).max())
            is_silent = peak < 0.001

            # 音量放大
            if 音量倍数 and 音量倍数 != 1.0:
                音频数据 = 音频数据 * float(音量倍数)

            # 归一化：将峰值拉到 0.95，让整体音量最大化
            当前峰值 = float(np.abs(音频数据).max())
            if 当前峰值 > 0.0001:
                音频数据 = 音频数据 * (0.95 / 当前峰值)

            # 转 int16，clip 防溢出
            音频数据 = np.clip(音频数据, -1.0, 1.0)
            音频数据 = (音频数据 * 32767).astype(np.int16)

            声道数 = 音频数据.shape[1] if 音频数据.ndim > 1 else 1

            保存目录 = _录音状态["保存目录"] or str(Path.home() / "Desktop")
            os.makedirs(保存目录, exist_ok=True)

            时间戳 = datetime.now().strftime("%Y%m%d_%H%M%S")
            wav路径 = os.path.join(保存目录, f"录音_{时间戳}.wav")
            mp3路径 = os.path.join(保存目录, f"录音_{时间戳}.mp3")

            # 写WAV
            try:
                with wave.open(wav路径, 'wb') as wf:
                    wf.setnchannels(声道数)
                    wf.setsampwidth(2)
                    wf.setframerate(_录音状态["采样率"])
                    wf.writeframes(音频数据.tobytes())
            except Exception as e:
                return {"成功": False, "错误": f"保存WAV失败: {e}"}

            # 转MP3（加 loudnorm 响度正规化，确保音量足够大）
            最终路径 = wav路径
            if os.path.exists(_ffmpeg):
                try:
                    subprocess.run(
                        [_ffmpeg, "-y", "-i", wav路径,
                         "-af", "loudnorm=I=-14:TP=-1:LRA=11",
                         "-codec:a", "libmp3lame", "-b:a", "192k", mp3路径],
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
            _录音状态["_recorder"] = None
            _录音状态["_线程"] = None

            消息 = f"录音完成: {时长秒}秒, {文件大小MB}MB"
            if is_silent:
                消息 += " ⚠️ 录音内容为静音，请检查：1.系统是否有声音播放 2.选择的设备是否正确"

            return {
                "成功": True,
                "保存路径": 最终路径,
                "文件名": os.path.basename(最终路径),
                "时长秒": 时长秒,
                "大小MB": 文件大小MB,
                "静音": is_silent,
                "消息": 消息
            }

    @staticmethod
    def 查询状态() -> dict:
        if _录音状态["录制中"]:
            时长 = round(time.time() - _录音状态["开始时间"], 1)
            return {"录制中": True, "时长秒": 时长, "设备": _录音状态.get("设备名", "")}
        return {"录制中": False}
