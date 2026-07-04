"""
录屏器 — 使用 ffmpeg gdigrab 抓取屏幕 + dshow/soundcard 抓取音频
输出 MP4 (H.264 + AAC)
停止录制分两步：1.立即杀ffmpeg返回 2.后台线程转码
全流程写入SQLite录屏日志表，便于排查问题
"""
import os
import time
import threading
import subprocess
import sys
from pathlib import Path
from datetime import datetime

import shutil as _shutil
_ffmpeg = _shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"

# ==================== SQLite日志 ====================
_存储引擎 = None
_会话ID = ""

def _获取存储引擎():
    global _存储引擎
    if _存储引擎 is not None:
        return _存储引擎
    try:
        项目根 = Path(__file__).parent.parent.parent
        db路径 = str(项目根 / "隐私区" / "我的数据" / "智能体.db")
        from 存储引擎 import 获取存储引擎
        _存储引擎 = 获取存储引擎(db路径)
    except Exception as e:
        print(f"[录屏] 存储引擎初始化失败: {e}")
        _存储引擎 = None
    return _存储引擎

def _写日志(步骤, 状态, 详情="", ffmpeg输出=""):
    """写一条录屏日志到SQLite"""
    引擎 = _获取存储引擎()
    if 引擎 is None:
        print(f"[录屏日志] {步骤} | {状态} | {详情}")
        return
    try:
        引擎.写录屏日志(_会话ID, 步骤, 状态, 详情, ffmpeg输出)
    except Exception as e:
        print(f"[录屏日志写入失败] {e}")

def _启动新会话():
    """开始新的录屏会话，生成会话ID"""
    global _会话ID
    _会话ID = datetime.now().strftime("%Y%m%d_%H%M%S_") + str(int(time.time() * 1000) % 100000)

_录屏状态 = {
    "录制中": False,
    "正在停止": False,
    "开始时间": 0,
    "保存目录": "",
    "输出路径": "",
    "最终路径": "",
    "帧率": 30,
    "音频模式": "mic",
    "麦克风音量": 1.0,
    "麦克风静音": False,
    "系统音量": 1.0,
    "系统静音": False,
    "进程": None,
    "stderr数据": b"",
    "系统音频wav": "",
    "系统音频线程": None,
    "系统音频recorder": None,
    "区域": None,
    "点击效果进程": None,
    # 转码状态
    "转码中": False,
    "转码完成": False,
    "转码结果": None,
}

_锁 = threading.Lock()


class 录屏器:

    @staticmethod
    def 列出dshow设备() -> dict:
        try:
            proc = subprocess.run(
                [_ffmpeg, "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
                capture_output=True, timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            )
            输出 = proc.stderr.decode("utf-8", errors="replace")
            设备列表 = []

            # 兼容两种ffmpeg输出格式：
            # 旧版: 有 "DirectShow audio devices" 标题行 + "设备名" (audio)
            # 新版(8.0+): 直接 [dshow @ xxx] "设备名" (audio)
            在音频段 = False
            for line in 输出.split("\n"):
                if "DirectShow audio devices" in line:
                    在音频段 = True
                    continue
                if "DirectShow video devices" in line:
                    在音频段 = False
                    continue

                # 新版ffmpeg: [dshow @ xxx] "设备名" (audio)
                if '(audio)' in line and '"' in line:
                    名称 = line.split('"')[1] if '"' in line else ""
                    if 名称:
                        设备列表.append({"名称": 名称})
                # 旧版ffmpeg: 在音频段内的 "设备名"
                elif 在音频段 and '"' in line and '(audio)' not in line and 'Alternative name' not in line:
                    名称 = line.split('"')[1] if '"' in line else ""
                    if 名称:
                        设备列表.append({"名称": 名称})

            _写日志("列出dshow设备", "信息", f"找到{len(设备列表)}个设备: {[d['名称'] for d in 设备列表]}")
            return {"成功": True, "设备列表": 设备列表}
        except Exception as e:
            _写日志("列出dshow设备", "失败", f"异常: {e}")
            return {"成功": False, "错误": str(e)}

    @staticmethod
    def 开始录制(保存目录: str = "", x: int = 0, y: int = 0, w: int = 0, h: int = 0,
                  帧率: int = 30, 音频模式: str = "mic", dshow设备名: str = "",
                  麦克风音量: float = 1.0, 麦克风静音: bool = False,
                  系统音量: float = 1.0, 系统静音: bool = False,
                  点击效果: bool = False, 点击音效: bool = False,
                  音效音量: int = 50) -> dict:
        _启动新会话()

        with _锁:
            if _录屏状态["录制中"]:
                _写日志("开始录制", "失败", "已在录制中")
                return {"成功": False, "错误": "已在录制中"}

            if not os.path.exists(_ffmpeg):
                _写日志("检查ffmpeg", "失败", f"ffmpeg路径不存在: {_ffmpeg}")
                return {"成功": False, "错误": "未找到 ffmpeg"}

            _写日志("检查ffmpeg", "成功", f"路径: {_ffmpeg}")

            if w == 0 or h == 0:
                try:
                    import ctypes
                    user32 = ctypes.windll.user32
                    w = user32.GetSystemMetrics(0)
                    h = user32.GetSystemMetrics(1)
                except Exception:
                    w, h = 1280, 720
                x, y = 0, 0

            保存目录 = 保存目录 or str(Path.home() / "Desktop")
            os.makedirs(保存目录, exist_ok=True)

            时间戳 = datetime.now().strftime("%Y%m%d_%H%M%S")
            mkv路径 = os.path.join(保存目录, f"屏幕录制_{时间戳}.mkv")
            mp4路径 = os.path.join(保存目录, f"屏幕录制_{时间戳}.mp4")

            cmd = [_ffmpeg, "-y",
                   "-f", "gdigrab",
                   "-framerate", str(帧率)]

            if x != 0 or y != 0:
                cmd += ["-offset_x", str(x), "-offset_y", str(y)]
            cmd += ["-video_size", f"{w}x{h}", "-i", "desktop"]

            有音频 = False
            if 音频模式 in ("mic", "both") and dshow设备名:
                cmd += ["-f", "dshow", "-i", f'audio={dshow设备名}']
                有音频 = True

            cmd += ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                    "-pix_fmt", "yuv420p", "-flush_packets", "1"]

            if 有音频:
                cmd += ["-c:a", "pcm_s16le"]
            else:
                cmd += ["-an"]

            cmd += [mkv路径]

            _写日志("构建ffmpeg命令", "信息",
                    f"音频模式={音频模式} dshow设备='{dshow设备名}' 有音频={有音频} "
                    f"区域={w}x{h}@({x},{y}) 帧率={帧率} "
                    f"麦克风音量={麦克风音量} 麦克风静音={麦克风静音} "
                    f"系统音量={系统音量} 系统静音={系统静音} "
                    f"MKV={mkv路径} MP4={mp4路径}")

            _录屏状态["输出路径"] = mkv路径
            _录屏状态["最终路径"] = mp4路径
            _录屏状态["保存目录"] = 保存目录
            _录屏状态["帧率"] = 帧率
            _录屏状态["音频模式"] = 音频模式
            _录屏状态["麦克风音量"] = 麦克风音量
            _录屏状态["麦克风静音"] = 麦克风静音
            _录屏状态["系统音量"] = 系统音量
            _录屏状态["系统静音"] = 系统静音
            _录屏状态["区域"] = (x, y, w, h)
            _录屏状态["stderr数据"] = b""
            _录屏状态["转码中"] = False
            _录屏状态["转码完成"] = False
            _录屏状态["转码结果"] = None

            # 先设置录制中=True，再启动系统音频录制线程
            # 否则录音线程检查录制中=False 会立即退出
            _录屏状态["录制中"] = True
            _录屏状态["正在停止"] = False
            _录屏状态["开始时间"] = time.time()

            if 音频模式 in ("system", "both"):
                系统wav = os.path.join(保存目录, f"_sysaudio_{时间戳}.wav")
                _录屏状态["系统音频wav"] = 系统wav
                _写日志("启动系统音频", "信息", f"目标WAV: {系统wav} 录制中={_录屏状态['录制中']}")
                录屏器._启动系统音频录制(系统wav, 44100)
            else:
                _写日志("跳过系统音频", "信息", f"音频模式={音频模式}，不启动系统音频录制")

            try:
                proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
                )
                _录屏状态["进程"] = proc
                _写日志("启动ffmpeg", "成功", f"PID={proc.pid}")
            except Exception as e:
                _录屏状态["录制中"] = False
                _写日志("启动ffmpeg", "失败", f"异常: {e}")
                return {"成功": False, "错误": f"启动 ffmpeg 失败: {e}"}

            time.sleep(0.8)
            if proc.poll() is not None:
                try:
                    stderr = proc.stderr.read().decode("utf-8", errors="replace")
                except Exception:
                    stderr = ""
                _录屏状态["进程"] = None
                错误信息 = "ffmpeg 启动失败"
                for line in stderr.split("\n"):
                    if "Error" in line or "error" in line or "Invalid" in line:
                        错误信息 = line.strip()
                        break
                _写日志("ffmpeg启动检查", "失败", f"进程已退出 错误信息={错误信息}", stderr[-2000:])
                return {"成功": False, "错误": f"{错误信息}"}

            _写日志("录制开始", "成功", f"PID={proc.pid} MKV={mkv路径}")

            if 点击效果 or 点击音效:
                try:
                    效果脚本 = str(Path(__file__).parent / "点击效果.py")
                    效果进程 = subprocess.Popen(
                        [sys.executable, 效果脚本,
                         str(音效音量),
                         "1" if 点击效果 else "0",
                         "1" if 点击音效 else "0"],
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
                    )
                    _录屏状态["点击效果进程"] = 效果进程
                    _写日志("点击效果", "成功", f"PID={效果进程.pid}")
                except Exception as e:
                    _写日志("点击效果", "失败", f"异常: {e}")

            区域描述 = f"{w}×{h}" if (x == 0 and y == 0) else f"{w}×{h}@({x},{y})"
            return {
                "成功": True,
                "消息": f"录屏已开始: {区域描述} {帧率}fps",
                "区域": 区域描述,
                "帧率": 帧率,
                "音频模式": 音频模式
            }

    @staticmethod
    def _启动系统音频录制(wav路径, 采样率=44100):
        try:
            import soundcard as sc
            import numpy as np

            speaker = sc.default_speaker()
            mic = sc.get_microphone(id=str(speaker.name), include_loopback=True)
            recorder = mic.recorder(samplerate=采样率, channels=speaker.channels)
            _录屏状态["系统音频recorder"] = recorder
            _写日志("系统音频初始化", "成功",
                    f"speaker={speaker.name} channels={speaker.channels} 采样率={采样率}")

            def 录音线程():
                import wave
                try:
                    recorder.__enter__()
                    块列表 = []
                    while _录屏状态["录制中"]:
                        data = recorder.record(numframes=采样率)
                        if _录屏状态["录制中"]:
                            块列表.append(data)
                    _写日志("系统音频录制循环结束", "信息",
                            f"录制中={_录屏状态['录制中']} 数据块数={len(块列表)}")
                    if 块列表:
                        音频 = np.concatenate(块列表, axis=0)
                        音频 = np.clip(音频, -1.0, 1.0)
                        音频int16 = (音频 * 32767).astype(np.int16)
                        声道数 = 音频int16.shape[1] if 音频int16.ndim > 1 else 1
                        with wave.open(wav路径, 'wb') as wf:
                            wf.setnchannels(声道数)
                            wf.setsampwidth(2)
                            wf.setframerate(采样率)
                            wf.writeframes(音频int16.tobytes())
                        文件大小 = os.path.getsize(wav路径)
                        _写日志("系统音频WAV写入", "成功",
                                f"路径={wav路径} 大小={文件大小}字节 声道={声道数} 采样率={采样率} 数据块数={len(块列表)}")
                    else:
                        _写日志("系统音频WAV写入", "警告", "无数据块，未生成WAV")
                except Exception as e:
                    _写日志("系统音频录制异常", "失败", f"异常: {e}")
                finally:
                    try:
                        recorder.__exit__(None, None, None)
                    except Exception:
                        pass

            t = threading.Thread(target=录音线程, daemon=True)
            _录屏状态["系统音频线程"] = t
            t.start()
            _写日志("系统音频线程启动", "成功", "")
        except ImportError:
            _写日志("系统音频初始化", "失败", "soundcard 未安装")

    @staticmethod
    def 停止录制() -> dict:
        """立即杀 ffmpeg + 点击效果，后台等待+转码"""
        with _锁:
            if _录屏状态["正在停止"]:
                _写日志("停止录制", "拒绝", "正在停止中")
                return {"成功": False, "错误": "正在停止中..."}
            if not _录屏状态["录制中"]:
                if _录屏状态.get("转码中"):
                    _写日志("停止录制", "拒绝", "正在转码中")
                    return {"成功": False, "错误": "正在转码中，请等待..."}
                _写日志("停止录制", "拒绝", "没有正在进行的录屏")
                return {"成功": False, "错误": "没有正在进行的录屏"}

            _录屏状态["正在停止"] = True
            _录屏状态["录制中"] = False

            # 立即杀点击效果子进程（不等wait）
            效果进程 = _录屏状态.get("点击效果进程")
            if 效果进程:
                try:
                    效果进程.kill()
                    _写日志("杀点击效果进程", "成功", f"PID={效果进程.pid}")
                except Exception as e:
                    _写日志("杀点击效果进程", "失败", f"异常: {e}")
                _录屏状态["点击效果进程"] = None

            # 立即杀 ffmpeg（先尝试q优雅关闭2秒，再kill）
            # 2秒给ffmpeg足够时间写完MKV文件头和刷新缓冲区
            proc = _录屏状态.get("进程")
            if proc:
                try:
                    proc.stdin.write(b'q')
                    proc.stdin.flush()
                    proc.stdin.close()
                    try:
                        proc.wait(timeout=2)
                        _写日志("停止ffmpeg", "成功", "q键优雅退出")
                    except Exception:
                        proc.kill()
                        _写日志("停止ffmpeg", "警告", "q键超时，已强制kill")
                except Exception:
                    try:
                        proc.kill()
                        _写日志("停止ffmpeg", "警告", "stdin写入失败，已强制kill")
                    except Exception as e:
                        _写日志("停止ffmpeg", "失败", f"kill也失败: {e}")

            mkv路径 = _录屏状态["输出路径"]
            mp4路径 = _录屏状态["最终路径"]
            时长 = time.time() - _录屏状态["开始时间"]
            时长秒 = round(时长, 1)

            # 检查MKV文件
            if os.path.exists(mkv路径):
                mkv大小 = os.path.getsize(mkv路径)
                _写日志("检查MKV文件", "信息", f"路径={mkv路径} 大小={mkv大小}字节")
            else:
                _写日志("检查MKV文件", "警告", f"MKV不存在: {mkv路径}")

            # 后台线程：等系统音频 + 检查MKV + 转码
            _录屏状态["转码中"] = True
            _录屏状态["转码完成"] = False
            _录屏状态["转码结果"] = None

            t = threading.Thread(target=录屏器._停止后处理, args=(mkv路径, mp4路径, 时长秒), daemon=True)
            t.start()

            return {
                "成功": True,
                "转码中": True,
                "时长秒": 时长秒,
                "消息": f"录屏已停止({时长秒}秒)，正在生成视频..."
            }

    @staticmethod
    def _停止后处理(mkv路径, mp4路径, 时长秒):
        """后台线程：等系统音频线程结束 + 检查MKV + 转码"""
        try:
            # 等系统音频线程完成（写WAV文件）
            系统线程 = _录屏状态.get("系统音频线程")
            if 系统线程:
                _写日志("等待系统音频线程", "信息", "join timeout=10s")
                系统线程.join(timeout=10)
                if 系统线程.is_alive():
                    _写日志("等待系统音频线程", "警告", "10秒后仍在运行，放弃等待")
                else:
                    _写日志("等待系统音频线程", "成功", "线程已结束")
            else:
                _写日志("等待系统音频线程", "信息", "无系统音频线程")

            # 检查系统音频WAV
            系统wav = _录屏状态.get("系统音频wav", "")
            if 系统wav:
                if os.path.exists(系统wav):
                    wav大小 = os.path.getsize(系统wav)
                    _写日志("检查系统WAV", "信息", f"路径={系统wav} 大小={wav大小}字节")
                else:
                    _写日志("检查系统WAV", "警告", f"WAV不存在: {系统wav}")

            # 检查 mkv
            if not os.path.exists(mkv路径) or os.path.getsize(mkv路径) < 100:
                _写日志("检查MKV", "失败", f"MKV不存在或太小: {mkv路径}")
                _录屏状态["正在停止"] = False
                _录屏状态["转码中"] = False
                _录屏状态["转码完成"] = True
                _录屏状态["转码结果"] = {"成功": False, "错误": "录屏文件生成失败"}
                _写日志("录屏流程结束", "失败", "MKV文件生成失败")
                return

            mkv大小 = os.path.getsize(mkv路径)
            _写日志("检查MKV", "成功", f"大小={mkv大小}字节")

            录屏器._后台转码(mkv路径, mp4路径, 时长秒)
        except Exception as e:
            _写日志("_停止后处理异常", "失败", f"异常: {e}")
            _录屏状态["正在停止"] = False
            _录屏状态["转码中"] = False
            _录屏状态["转码完成"] = True
            _录屏状态["转码结果"] = {"成功": False, "错误": f"停止处理异常: {e}"}

    @staticmethod
    def _运行ffmpeg转码(cmd, 步骤名, 转码超时):
        """运行一条ffmpeg转码命令，写日志，返回(ran成功, stderr)"""
        try:
            cmd_display = " ".join(str(c) for c in cmd)
            _写日志(f"转码:{步骤名}", "信息", f"命令: {cmd_display[:300]}")
            r = subprocess.run(
                cmd,
                capture_output=True, timeout=转码超时,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
            )
            stderr = r.stderr.decode("utf-8", errors="replace") if r.stderr else ""
            if r.returncode == 0:
                _写日志(f"转码:{步骤名}", "成功",
                        f"returncode=0", stderr[-1500:])
            else:
                _写日志(f"转码:{步骤名}", "失败",
                        f"returncode={r.returncode}", stderr[-1500:])
            return r.returncode == 0, stderr
        except subprocess.TimeoutExpired:
            _写日志(f"转码:{步骤名}", "失败", f"超时({转码超时}s)", "")
            return False, "TIMEOUT"
        except Exception as e:
            _写日志(f"转码:{步骤名}", "失败", f"异常: {e}", "")
            return False, str(e)

    @staticmethod
    def _后台转码(mkv路径, mp4路径, 时长秒):
        """后台线程：mkv → mp4 转码"""
        系统wav = _录屏状态.get("系统音频wav", "")
        音频模式 = _录屏状态.get("音频模式", "mic")
        麦克风音量 = _录屏状态.get("麦克风音量", 1.0)
        麦克风静音 = _录屏状态.get("麦克风静音", False)
        系统音量 = _录屏状态.get("系统音量", 1.0)
        系统静音 = _录屏状态.get("系统静音", False)
        转码超时 = max(120, int(时长秒 * 0.5))
        有系统音频 = bool(系统wav and os.path.exists(系统wav) and os.path.getsize(系统wav) > 100)
        无flag = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

        _写日志("转码开始", "信息",
                f"音频模式={音频模式} 有系统音频={有系统音频} "
                f"麦克风音量={麦克风音量} 麦克风静音={麦克风静音} "
                f"系统音量={系统音量} 系统静音={系统静音} "
                f"MKV={mkv路径} MP4={mp4路径} 系统WAV={系统wav} 超时={转码超时}s")

        try:
            if 音频模式 == "none":
                成功, _ = 录屏器._运行ffmpeg转码(
                    [_ffmpeg, "-y", "-i", mkv路径, "-c:v", "copy", "-an",
                     "-movflags", "+faststart", mp4路径],
                    "none模式", 转码超时)

            elif 音频模式 == "both" and 有系统音频:
                # both模式：混合麦克风(0:a) + 系统音频(1:a)，各自独立音量
                # 构建filter_complex：[0:a]volume=X[a0];[1:a]volume=Y[a1];[a0][a1]amix[a]
                mic_v = "0" if 麦克风静音 else str(麦克风音量)
                sys_v = "0" if 系统静音 else str(系统音量)
                滤镜 = f"[0:a]volume={mic_v}[a0];[1:a]volume={sys_v}[a1];[a0][a1]amix=inputs=2:duration=first[a]"
                成功, _ = 录屏器._运行ffmpeg转码(
                    [_ffmpeg, "-y", "-i", mkv路径, "-i", 系统wav,
                     "-filter_complex", 滤镜,
                     "-map", "0:v", "-map", "[a]",
                     "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                     "-shortest", "-movflags", "+faststart", mp4路径],
                    "both-amix混合", 转码超时)

                # amix失败，回退为只用系统音频
                if not os.path.exists(mp4路径) or os.path.getsize(mp4路径) < 100:
                    _写日志("转码:both回退1", "信息", "amix失败，回退为只用系统音频")
                    成功, _ = 录屏器._运行ffmpeg转码(
                        [_ffmpeg, "-y", "-i", mkv路径, "-i", 系统wav,
                         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                         "-map", "0:v", "-map", "1:a",
                         "-shortest", "-movflags", "+faststart", mp4路径],
                        "both-回退系统音频", 转码超时)

                # 仍失败，回退为只用MKV音频（麦克风）
                if not os.path.exists(mp4路径) or os.path.getsize(mp4路径) < 100:
                    _写日志("转码:both回退2", "信息", "回退1失败，回退为只用MKV音频")
                    成功, _ = 录屏器._运行ffmpeg转码(
                        [_ffmpeg, "-y", "-i", mkv路径,
                         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                         "-movflags", "+faststart", mp4路径],
                        "both-回退MKV音频", 转码超时)

            elif 有系统音频 and 音频模式 in ("system", "both"):
                # system模式 / both模式无MKV音频：视频 + 系统音频（带音量）
                sys_v = "0" if 系统静音 else str(系统音量)
                成功, _ = 录屏器._运行ffmpeg转码(
                    [_ffmpeg, "-y", "-i", mkv路径, "-i", 系统wav,
                     "-af", f"volume={sys_v}",
                     "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                     "-map", "0:v", "-map", "1:a",
                     "-shortest", "-movflags", "+faststart", mp4路径],
                    "system模式", 转码超时)

            else:
                # mic模式 / both无系统音频：MKV（含PCM音频）→ mp4（带麦克风音量）
                mic_v = "0" if 麦克风静音 else str(麦克风音量)
                成功, _ = 录屏器._运行ffmpeg转码(
                    [_ffmpeg, "-y", "-i", mkv路径,
                     "-af", f"volume={mic_v}",
                     "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
                     "-movflags", "+faststart", mp4路径],
                    "mic模式", 转码超时)

            # 检查转码输出
            if os.path.exists(mp4路径) and os.path.getsize(mp4路径) > 100:
                mp4大小 = os.path.getsize(mp4路径)
                _写日志("转码输出检查", "成功", f"MP4大小={mp4大小}字节")
            else:
                _写日志("转码输出检查", "失败", f"MP4不存在或太小: {mp4路径}")

        except Exception as e:
            _写日志("转码异常", "失败", f"异常: {e}")
            if os.path.exists(mkv路径) and not os.path.exists(mp4路径):
                mp4路径 = mkv路径
                _写日志("转码异常回退", "警告", f"使用MKV作为输出: {mp4路径}")

        # 清理临时文件
        try:
            if 系统wav and os.path.exists(系统wav):
                os.remove(系统wav)
                _写日志("清理系统WAV", "成功", "")
        except Exception as e:
            _写日志("清理系统WAV", "失败", f"异常: {e}")
        if mp4路径 != mkv路径 and os.path.exists(mkv路径):
            try:
                os.remove(mkv路径)
                _写日志("清理MKV", "成功", "")
            except Exception as e:
                _写日志("清理MKV", "失败", f"异常: {e}")

        # 记录结果
        if os.path.exists(mp4路径) and os.path.getsize(mp4路径) > 100:
            文件大小MB = round(os.path.getsize(mp4路径) / 1024 / 1024, 2)
            _录屏状态["转码结果"] = {
                "成功": True,
                "保存路径": mp4路径,
                "文件名": os.path.basename(mp4路径),
                "时长秒": 时长秒,
                "大小MB": 文件大小MB,
                "消息": f"录屏完成: {时长秒}秒, {文件大小MB}MB"
            }
            _写日志("录屏流程结束", "成功",
                    f"MP4={mp4路径} 大小={文件大小MB}MB 时长={时长秒}秒")
        else:
            _录屏状态["转码结果"] = {
                "成功": False,
                "错误": "视频转换失败"
            }
            _写日志("录屏流程结束", "失败", "MP4文件不存在或太小")

        _录屏状态["转码完成"] = True
        _录屏状态["转码中"] = False
        _录屏状态["正在停止"] = False
        _录屏状态["进程"] = None
        _录屏状态["系统音频线程"] = None
        _录屏状态["系统音频recorder"] = None
        _录屏状态["系统音频wav"] = ""

    @staticmethod
    def 停止并等待完成(超时秒=60) -> dict:
        """停止录制并同步等待转码完成，返回最终结果"""
        结果 = 录屏器.停止录制()
        if not 结果.get("成功"):
            return 结果
        if not 结果.get("转码中"):
            return 结果

        # 动态超时：录制时长×3 + 60秒缓冲（转码速度约12倍速，留足余量）
        时长秒 = 结果.get("时长秒", 60)
        超时秒 = max(超时秒, int(时长秒 * 3) + 60)

        # 等待转码完成
        开始 = time.time()
        while time.time() - 开始 < 超时秒:
            状态 = 录屏器.查询状态()
            if 状态.get("转码完成"):
                return 状态.get("结果", {"成功": False, "错误": "转码结果为空"})
            time.sleep(0.5)

        _写日志("停止并等待完成", "失败", f"等待{超时秒}秒超时")
        return {"成功": False, "错误": f"转码超时({超时秒}秒)"}

    @staticmethod
    def 查询状态() -> dict:
        if _录屏状态["录制中"]:
            时长 = round(time.time() - _录屏状态["开始时间"], 1)
            return {"录制中": True, "时长秒": 时长}
        if _录屏状态.get("转码中"):
            return {"录制中": False, "转码中": True}
        if _录屏状态.get("转码完成"):
            return {"录制中": False, "转码中": False, "转码完成": True, "结果": _录屏状态.get("转码结果")}
        return {"录制中": False, "转码中": False, "转码完成": False}

    @staticmethod
    def 查询录屏日志(会话ID: str = None, limit: int = 500) -> dict:
        """查询录屏日志"""
        引擎 = _获取存储引擎()
        if 引擎 is None:
            return {"成功": False, "错误": "存储引擎未初始化"}
        if not 会话ID:
            会话ID = 引擎.查询最新录屏会话()
            if not 会话ID:
                return {"成功": True, "日志列表": [], "消息": "无录屏日志"}
        日志 = 引擎.查询录屏日志(会话ID, limit)
        return {"成功": True, "会话ID": 会话ID, "日志列表": 日志}
