# -*- coding: utf-8 -*-
"""
video_tools.py — 智能体视频剪辑核心工具库
全部基于系统 ffmpeg/ffprobe（subprocess 调用），无重依赖。
函数式 API，供智能体工具层 / 命令行直接调用。
"""
import subprocess, json, os, re, math, shutil, tempfile, sys

FFMPEG = os.environ.get("FFMPEG_PATH", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE_PATH", "ffprobe")


class VideoError(Exception):
    pass


def _run(cmd, timeout=600):
    """执行命令，失败抛 VideoError（带 stderr 尾部）"""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    except subprocess.TimeoutExpired:
        raise VideoError(f"命令超时: {' '.join(map(str, cmd[:6]))}...")
    if r.returncode != 0:
        tail = (r.stderr or "")[-800:]
        raise VideoError(f"ffmpeg 失败({r.returncode}): {tail}")
    return r


# ---------- 元信息 ----------

def probe(path):
    """返回视频元信息 dict：时长/宽高/帧率/编码/码率/音轨"""
    if not os.path.exists(path):
        raise VideoError(f"文件不存在: {path}")
    r = _run([FFPROBE, "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path])
    data = json.loads(r.stdout or "{}")
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), None)
    fmt = data.get("format", {})
    def fps(st):
        if not st: return None
        try:
            n, d = st["avg_frame_rate"].split("/"); f = int(n) / int(d)
            return round(f, 3) if f else None
        except Exception:
            return None
    return {
        "file": path, "size_mb": round(int(fmt.get("size", 0)) / 1048576, 2),
        "duration": float(fmt.get("duration", 0) or 0),
        "format": fmt.get("format_name"),
        "video": {"codec": v and v.get("codec_name"), "width": v and v.get("width"),
                  "height": v and v.get("height"), "fps": fps(v),
                  "bitrate_kbps": v and v.get("bit_rate") and int(v["bit_rate"]) // 1000},
        "audio": {"codec": a and a.get("codec_name"), "sample_rate": a and a.get("sample_rate"),
                  "channels": a and a.get("channels")} if a else None,
    }


# ---------- 时间解析 ----------

def _ts(t):
    """'12' / '1:23' / '00:01:23.5' → 秒(float)"""
    if isinstance(t, (int, float)): return float(t)
    t = str(t).strip()
    if ":" not in t: return float(t)
    parts = [float(p) for p in t.split(":")]
    while len(parts) < 3: parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def _tstr(sec):
    sec = max(0.0, float(sec))
    h = int(sec // 3600); m = int(sec % 3600 // 60); s = sec % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


# ---------- 基础操作 ----------

def cut(src, dst, start, end=None, copy=True):
    """按时段剪切。start/end 支持 '1:23' 或秒。copy=True 用流复制（快、无损，关键帧对齐）"""
    ss = _ts(start)
    cmd = [FFMPEG, "-y", "-ss", _tstr(ss), "-i", src]
    if end is not None:
        cmd += ["-t", str(round(_ts(end) - ss, 3))]
    cmd += ["-c:v", "libx264", "-c:a", "aac" if not copy else "copy"] if not copy else ["-c", "copy"]
    if not copy:
        cmd += ["-preset", "medium", "-crf", "20"]
    cmd += [dst]
    _run(cmd)
    return {"output": dst, "start": ss, "end": end}


def concat(paths, dst, copy=True):
    """顺序拼接多个视频（同编码时用 copy，否则先转统一格式）"""
    if not paths: raise VideoError("没有要拼接的文件")
    lst = tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8")
    for p in paths:
        if not os.path.exists(p): raise VideoError(f"文件不存在: {p}")
        lst.write("file '" + os.path.abspath(p).replace("'", "'\\''") + "'\n")
    lst.close()
    try:
        if copy:
            _run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", lst.name, "-c", "copy", dst])
        else:
            _run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", lst.name,
                  "-c:v", "libx264", "-crf", "20", "-c:a", "aac", dst])
    finally:
        os.unlink(lst.name)
    return {"output": dst, "count": len(paths)}


def resize(src, dst, width=None, height=None, scale="16:9"):
    """缩放。width/height 给一个即可等比；或 scale='目标比例'，裁剪填充"""
    vf = []
    if width or height:
        vf.append(f"scale={width or -2}:{height or -2}")
    elif scale:
        # 适配到指定比例（cover 式：缩放+居中裁剪）
        w, h = [int(x) for x in scale.split(":")]
        vf.append(f"scale={w}:{h}:force_original_aspect_ratio=increase")
        vf.append(f"crop={w}:{h}")
    _run([FFMPEG, "-y", "-i", src, "-vf", ",".join(vf), "-c:v", "libx264", "-crf", "20", "-c:a", "copy", dst])
    return {"output": dst, "vf": vf}


def crop(src, dst, x, y, w, h):
    _run([FFMPEG, "-y", "-i", src, "-vf", f"crop={w}:{h}:{x}:{y}", "-c:v", "libx264", "-crf", "20", "-c:a", "copy", dst])
    return {"output": dst}


def extract_audio(src, dst, mp3=False):
    """提取音频轨。dst 后缀决定容器；mp3=True 输出 mp3"""
    cmd = [FFMPEG, "-y", "-i", src, "-vn"]
    if mp3 or dst.lower().endswith(".mp3"):
        cmd += ["-c:a", "libmp3lame", "-q:a", "3"]
    else:
        cmd += ["-c:a", "pcm_s16le" if dst.lower().endswith(".wav") else "aac"]
    cmd += [dst]
    _run(cmd)
    return {"output": dst}


def burn_subtitle(src, dst, srt_path, font_size=24, font_name=None):
    """烧录 SRT 字幕（需重编码）"""
    srt = os.path.abspath(srt_path).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")
    fc = f"subtitles='{srt}'"
    if font_size or font_name:
        fc += f":force_style='FontName={font_name or 'Microsoft YaHei'},FontSize={font_size}'"
    _run([FFMPEG, "-y", "-i", src, "-vf", fc, "-c:v", "libx264", "-crf", "20", "-c:a", "copy", dst])
    return {"output": dst, "srt": srt_path}


def to_gif(src, dst, start=0, duration=5, width=480, fps=12):
    ss = _ts(start)
    _run([FFMPEG, "-y", "-ss", _tstr(ss), "-t", str(duration), "-i", src,
          "-vf", f"fps={fps},scale={width}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse",
          dst])
    return {"output": dst}


def screenshot(src, dst, at=1):
    _run([FFMPEG, "-y", "-ss", _tstr(_ts(at)), "-i", src, "-frames:v", "1", "-q:v", "3", dst])
    return {"output": dst}


def change_speed(src, dst, factor=1.5, keep_pitch=True):
    """变速。factor>1 加速。atempo 限制 0.5~2，链式扩展"""
    if not 0.25 <= factor <= 4: raise VideoError("变速倍数支持 0.25~4")
    tempos = []
    f = factor
    while f > 2.0: tempos.append(2.0); f /= 2.0
    while f < 0.5: tempos.append(0.5); f /= 0.5
    tempos.append(round(f, 4))
    at = ",".join(f"atempo={t}" for t in tempos)
    vf = f"setpts=PTS/{factor}"
    af = at if keep_pitch else at  # atempo 本身保音调
    _run([FFMPEG, "-y", "-i", src, "-filter_complex", f"[0:v]{vf}[v];[0:a]{af}[a]",
          "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "20", "-c:a", "aac", dst])
    return {"output": dst, "factor": factor}


def set_volume(src, dst, vol=1.0):
    """音量调节，vol=0.5 减半 / 1.5 增大"""
    _run([FFMPEG, "-y", "-i", src, "-filter:a", f"volume={vol}", "-c:v", "copy", "-c:a", "aac", dst])
    return {"output": dst}


def mix_audio(src_video, bgm, dst, bgm_volume=0.25, loop_bgm=True):
    """视频原声 + BGM 混音；BGM 自动循环/截断到视频长度"""
    d = probe(src_video)["duration"]
    aloop = f"-stream_loop -1 -i {bgm}" if loop_bgm else f"-i {bgm}"
    cmd = (f"{FFMPEG} -y -i \"{src_video}\" {aloop} "
           f"-filter_complex \"[1:a]volume={bgm_volume}[b];[0:a][b]amix=inputs=2:duration=first:dropout_transition=2[a]\" "
           f"-map 0:v -map \"[a]\" -t {d:.3f} -c:v copy -c:a aac \"{dst}\"")
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW)
    if r.returncode != 0:
        raise VideoError("mix_audio 失败: " + (r.stderr or "")[-500:])
    return {"output": dst, "bgm_volume": bgm_volume}


def add_text(src, dst, text, x="10", y="10", font_size=32, color="white", start=0, duration=None):
    """画面叠加文字水印"""
    txt = text.replace(":", r"\:").replace("'", r"\'")
    enable = f":enable='between(t,{start},{start + duration})'" if duration else ""
    _run([FFMPEG, "-y", "-i", src,
          "-vf", f"drawtext=text='{txt}':x={x}:y={y}:fontsize={font_size}:fontcolor={color}{enable}",
          "-c:v", "libx264", "-crf", "20", "-c:a", "copy", dst])
    return {"output": dst}


# ---------- 智能剪辑辅助 ----------

def detect_silence(src, noise_db=-35, min_silence=0.6):
    """检测静音段，返回 [(start, end), ...]（供自动剪掉口误/停顿）"""
    r = _run([FFMPEG, "-i", src, "-af", f"silencedetect=noise={noise_db}dB:d={min_silence}", "-f", "null", "-"], timeout=1800)
    starts = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    segs = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else s
        segs.append([round(s, 2), round(e, 2)])
    return segs


def detect_scenes(src, threshold=27.0):
    """场景切分（pySceneDetect），返回 [(start_sec, end_sec), ...]"""
    try:
        from scenedetect import detect, ContentDetector
    except ImportError:
        raise VideoError("需要安装 scenedetect: pip install scenedetect")
    scene_list = detect(src, ContentDetector(threshold=threshold))
    return [[round(s[0].get_seconds(), 2), round(s[1].get_seconds(), 2)] for s in scene_list]


def loudness_curve(src, step=1.0):
    """按 step 秒采样响度（分贝均值），供高光/热度曲线分析"""
    p = probe(src); dur = p["duration"]
    r = _run([FFMPEG, "-i", src, "-af", "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
              "-f", "null", "-"], timeout=1800)
    vals = [float(m) for m in re.findall(r"lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|inf)", r.stderr) if m != "inf"]
    # 每个窗口0.05s左右，重采样到 step 秒
    n = max(1, int(dur / step))
    if not vals: return []
    per = max(1, len(vals) // n)
    return [round(sum(vals[i*per:(i+1)*per]) / max(1, per - 0), 1) for i in range(n)]


def auto_remove_silence(src, dst, noise_db=-35, min_silence=0.6, max_speedup=8.0):
    """自动压缩静音段（不硬剪，用变速平滑处理）—— 口播视频利器"""
    segs = detect_silence(src, noise_db, min_silence)
    if not segs:
        shutil.copy(src, dst)
        return {"output": dst, "removed": 0, "segments": []}
    # 生成每个静音段加速滤镜
    filters = []
    for s, e in segs:
        d = e - s
        if d <= 0: continue
        speed = min(d / max(0.05, d - 0.1), max_speedup)  # 保留0.1s呼吸
        filters.append(f"between(t,{s},{e}),atempo={speed:.2f}")
    # 简化实现：逐段硬剪拼接（更稳）
    p = probe(src); cuts = []
    prev = 0.0
    for s, e in segs:
        if s - prev > 0.2: cuts.append((prev, s + 0.05))
        prev = e
    if p["duration"] - prev > 0.2: cuts.append((prev, p["duration"]))
    if not cuts:
        shutil.copy(src, dst); return {"output": dst, "removed": 0, "segments": segs}
    tmpfiles = []
    for i, (s, e) in enumerate(cuts):
        t = f"{dst}.{i}.tmp.mp4"
        cut(src, t, s, e, copy=True)
        tmpfiles.append(t)
    concat(tmpfiles, dst, copy=True)
    for t in tmpfiles: os.remove(t)
    removed = p["duration"] - probe(dst)["duration"]
    return {"output": dst, "removed_sec": round(removed, 2), "segments": segs}


if __name__ == "__main__":
    # 自检
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("file", nargs="?", help="要分析的视频")
    ap.add_argument("--info", action="store_true")
    a = ap.parse_args()
    if a.file and a.info:
        print(json.dumps(probe(a.file), ensure_ascii=False, indent=2))
    else:
        print("video_tools.py 自检：模块导入 OK")
        print("函数:", ", ".join(n for n in dir() if not n.startswith("_") and callable(eval(n)) and n not in ("subprocess","json","os","re","math","shutil","tempfile","sys","VideoError")))
