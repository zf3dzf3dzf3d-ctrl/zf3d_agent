"""
录屏转码后处理 Mixin — 从 screen_recorder.py 拆出（方法体一字未改）
依赖 screen_recorder 模块级: _录屏状态, _写日志, _ffmpeg, subprocess, os, time
"""
import os
import time
import subprocess


class 录屏转码Mixin:
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

