# -*- coding: utf-8 -*-
# 拆分分段模块：由原 screen_recorder.py 按行段【无改动】切分，由同名门面加载合并。
class 录屏器(录屏转码Mixin):

    @staticmethod
    def 列出dshow设备() -> dict:
        import sys as _sys
        if _sys.platform == "darwin":
            # macOS: avfoundation 列出采集设备
            try:
                proc = subprocess.run(
                    [_ffmpeg, "-list_devices", "true", "-f", "avfoundation", "-i", "\"\""],
                    capture_output=True, timeout=10)
                输出 = proc.stderr.decode("utf-8", errors="replace")
                设备列表 = []
                在音频段 = False
                for line in 输出.split("\n"):
                    if "audio devices" in line.lower():
                        在音频段 = True
                        continue
                    if "video devices" in line.lower():
                        在音频段 = False
                        continue
                    if 在音频段 and line.strip().startswith("["):
                        parts = line.split("]")
                        if len(parts) > 1 and parts[-1].strip():
                            设备列表.append({"名称": parts[-1].strip()})
                return {"成功": True, "设备列表": 设备列表}
            except Exception as e:
                return {"成功": False, "错误": str(e)}
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
                # 【修复】僵尸状态检测：状态是"录制中"但 ffmpeg 进程已不存在
                # （上次启动中途失败/进程被杀），自动复位而不是永久拒绝新录制
                僵尸进程 = _录屏状态.get("进程")
                if 僵尸进程 is None or 僵尸进程.poll() is not None:
                    _录屏状态["录制中"] = False
                    _录屏状态["正在停止"] = False
                    _录屏状态["进程"] = None
                    _录屏状态["转码中"] = False
                    _写日志("开始录制", "信息", "检测到僵尸录制状态（ffmpeg进程已消失），已自动复位")
                else:
                    _写日志("开始录制", "失败", "已在录制中")
                    return {"成功": False, "错误": "已在录制中"}

            if not os.path.exists(_ffmpeg):
                _写日志("检查ffmpeg", "失败", f"ffmpeg路径不存在: {_ffmpeg}")
                return {"成功": False, "错误": "未找到 ffmpeg"}

            _写日志("检查ffmpeg", "成功", f"路径: {_ffmpeg}")

            if w == 0 or h == 0:
                try:
                    from platform_compat import screen_size
                    w, h = screen_size()
                except Exception:
                    w, h = 1280, 720
                x, y = 0, 0
            else:
                # 【修复】区域选择遮罩可能返回超出实际屏幕的尺寸（DPI缩放等原因），
                # gdigrab 报 "Capture area extends outside window area" 导致录屏失败。
                # 这里把区域夹紧到实际屏幕范围内，超界部分自动裁掉。
                try:
                    from platform_compat import screen_size
                    sw, sh = screen_size()
                except Exception:
                    sw, sh = 0, 0
                if sw > 0 and sh > 0 and (w > sw or h > sh or x < 0 or y < 0):
                    x = max(0, min(x, sw - 1))
                    y = max(0, min(y, sh - 1))
                    w = min(w, sw - x)
                    h = min(h, sh - y)
                    if w <= 0 or h <= 0:
                        x, y, w, h = 0, 0, sw, sh

            保存目录 = 保存目录 or str(Path.home() / "Desktop")
            os.makedirs(保存目录, exist_ok=True)

            时间戳 = datetime.now().strftime("%Y%m%d_%H%M%S")
            mkv路径 = os.path.join(保存目录, f"屏幕录制_{时间戳}.mkv")
            mp4路径 = os.path.join(保存目录, f"屏幕录制_{时间戳}.mp4")

            cmd = [_ffmpeg, "-y"]
            import sys as _sys
            if _sys.platform == "darwin":
                # macOS: avfoundation 屏幕采集（设备索引 "1:none" 常见为主屏，音量/麦克风需系统授权）
                cmd += ["-f", "avfoundation", "-framerate", str(帧率),
                        "-capture_cursor", "1",
                        "-i", "1:none"]
            elif _sys.platform == "win32":
                cmd += ["-f", "gdigrab", "-framerate", str(帧率)]
                if x != 0 or y != 0:
                    cmd += ["-offset_x", str(x), "-offset_y", str(y)]
                cmd += ["-video_size", f"{w}x{h}", "-i", "desktop"]
            else:
                # Linux: x11grab
                disp = os.environ.get("DISPLAY", ":0")
                cmd += ["-f", "x11grab", "-framerate", str(帧率),
                        "-video_size", f"{w}x{h}", "-i", disp]

            有音频 = False
            if 音频模式 in ("mic", "both"):
                # 【修复】dshow设备名为空时自动探测第一个可用麦克风设备，
                # 否则前端即使选了麦克风模式，MKV里也不会有麦克风音轨
                if not dshow设备名:
                    try:
                        探测 = 录屏器.列出dshow设备()
                        设备列表 = 探测.get("设备列表") or []
                        if 探测.get("成功") and 设备列表:
                            dshow设备名 = 设备列表[0]["名称"]
                            _写日志("自动选择麦克风", "信息", f"dshow设备名为空，自动使用第一个设备: {dshow设备名}")
                        else:
                            _写日志("自动选择麦克风", "失败", f"未探测到可用音频设备: {探测.get('错误', '列表为空')}")
                    except Exception as _e:
                        _写日志("自动选择麦克风", "失败", f"异常: {_e}")
                if dshow设备名:
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

            # 【修复】从"设置录制中=True"到最终成功返回之间，任何一步异常
            # 都必须复位状态并停掉系统音频线程，否则会卡死在"已在录制中"
            try:
                return 录屏器._继续启动录制(
                    保存目录, x, y, w, h, 帧率, 音频模式, dshow设备名,
                    麦克风音量, 麦克风静音, 系统音量, 系统静音,
                    点击效果, 点击音效, 音效音量, 时间戳, cmd)
            except Exception as e:
                _录屏状态["录制中"] = False
                _录屏状态["正在停止"] = False
                _录屏状态["进程"] = None
                _录屏状态["系统音频线程"] = None
                _录屏状态["系统音频recorder"] = None
                _写日志("开始录制", "失败", f"启动流程异常，已复位录制状态: {e}")
                return {"成功": False, "错误": f"启动录制失败: {e}"}

    @staticmethod
    def _继续启动录制(保存目录, x, y, w, h, 帧率, 音频模式, dshow设备名,
                     麦克风音量, 麦克风静音, 系统音量, 系统静音,
                     点击效果, 点击音效, 音效音量, 时间戳, cmd) -> dict:
        """开始录制的后半段（已持锁、录制中=True），由 开始录制 调用"""
        if True:
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

            _写日志("录制开始", "成功", f"PID={proc.pid} MKV={_录屏状态.get('输出路径', '')}")

            if 点击效果 or 点击音效:
                try:
                    效果脚本 = str(Path(__file__).parent / "click_effect.py")
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
            else:
                # 【保险】未开启效果时不启动子进程；click_effect.py 默认参数已改为
                # "不传参=关闭"，即使万一有遗留进程也不会画圈/响声
                _录屏状态["点击效果进程"] = None

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
        # 【防御】系统音频属于"锦上添花"：初始化失败只降级为无声视频，
        # 绝不允许异常向上抛、把整个"开始录制"流程炸掉（历史 bug：0x800401f0）
        try:
            录屏器._启动系统音频录制_内部(wav路径, 采样率)
        except Exception as e:
            _写日志("系统音频初始化", "失败", f"系统音频启动失败（已降级为无声录制，不影响录屏）: {e}")
            _录屏状态["系统音频线程"] = None
            _录屏状态["系统音频recorder"] = None

    @staticmethod
    def _启动系统音频录制_内部(wav路径, 采样率=44100):
        # 【修复】COM 初始化必须放在 import soundcard 之前：
        # soundcard(mediafoundation 后端) 首次 import 时就通过 comtypes 访问 COM，
        # 若本线程未初始化 COM，会在 import 阶段直接抛 0x800401f0 (CO_E_NOTINITIALIZED)，
        # 导致整个"开始录制"流程失败。原代码把 CoInitializeEx 放在 import 之后，顺序反了。
        _com已初始化 = False
        try:
            import ctypes
            _hr = ctypes.windll.ole32.CoInitializeEx(None, 0x2)
            _com已初始化 = _hr in (0, 1)
            _写日志("系统音频COM初始化", "成功" if _com已初始化 else "跳过",
                    f"启动线程 CoInitializeEx(APARTMENTTHREADED) 返回 hr={_hr:#x}")
        except Exception as _com_e:
            _写日志("系统音频COM初始化", "失败", f"启动线程异常: {_com_e}")

        try:
            from soundcard_loader import load_soundcard
            sc = load_soundcard()
            import numpy as np

            # 【修复·静音根因】recorder 必须在录音线程内创建+进入：
            # soundcard mediafoundation 后端在创建 recorder 时即绑定当前线程的
            # WASAPI/COM 单元。之前在"启动线程"创建、在"录音线程" __enter__，
            # 跨线程后 loopback 捕获的全是静音。与可用诊断脚本（创建与进入同线程、
            # 录到有效信号）对比确认此差异。
            speaker = None
            mic = None
            recorder = None
            _录屏状态["系统音频recorder"] = None
            _写日志("系统音频初始化", "成功",
                    "recorder 延迟到录音线程内创建（避免跨线程COM绑定导致静音）")

            def 录音线程():
                import wave
                nonlocal speaker, mic, recorder
                # WASAPI 依赖 COM，必须先在本线程初始化（否则报 0x800401f0 CO_E_NOTINITIALIZED）
                _com已初始化 = False
                try:
                    import ctypes
                    # COINIT_APARTMENTTHREADED = 0x2
                    _hr = ctypes.windll.ole32.CoInitializeEx(None, 0x2)
                    _com已初始化 = _hr in (0, 1)  # S_OK / S_FALSE 均视为可用
                    if _com已初始化:
                        _写日志("系统音频COM初始化", "成功", "CoInitializeEx(APARTMENTTHREADED)")
                except Exception as _com_e:
                    _写日志("系统音频COM初始化", "失败", f"异常: {_com_e}")
                try:
                    # 在本线程内创建 recorder（与 __enter__ 同线程，保证 loopback 有效）
                    try:
                        speaker = sc.default_speaker()
                        mic = sc.get_microphone(id=str(speaker.name), include_loopback=True)
                        recorder = mic.recorder(samplerate=采样率, channels=speaker.channels)
                    except Exception as _spk_e:
                        raise RuntimeError(f"获取扬声器/录音器失败: {_spk_e}")
                    _录屏状态["系统音频recorder"] = recorder
                    _写日志("系统音频初始化", "成功",
                            f"speaker={speaker.name} channels={speaker.channels} 采样率={采样率}")
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
                    if _com已初始化:
                        try:
                            import ctypes
                            ctypes.windll.ole32.CoUninitialize()
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

            # 先让 ffmpeg 通过交互命令完整写出容器尾；管道模式需要换行提交命令。
            proc = _录屏状态.get("进程")
            if proc:
                try:
                    proc.stdin.write(b'q\n')
                    proc.stdin.flush()
                    proc.stdin.close()
                    try:
                        proc.wait(timeout=5)
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
        """查询录屏日志（从 JSONL 读取，最新的在前）"""
        limit = max(1, min(1000, int(limit or 500)))
        if not _日志路径.exists():
            return {"成功": True, "会话ID": 会话ID or "", "日志列表": []}
        try:
            with open(_日志路径, "r", encoding="utf-8-sig") as f:
                行列表 = f.readlines()[-limit:]
            日志 = []
            for 行 in reversed(行列表):
                行 = 行.strip()
                if not 行:
                    continue
                try:
                    记录 = json.loads(行)
                except Exception:
                    continue
                if 会话ID and 记录.get("会话ID") != 会话ID:
                    continue
                日志.append(记录)
            return {"成功": True, "会话ID": 会话ID or "", "日志列表": 日志}
        except Exception as e:
            return {"成功": False, "错误": str(e)}


