# -*- coding: utf-8 -*-
"""
auto_producer.py — AI 能力三：文案成片一键流水线
输入：文案（多段）+ 素材视频列表 + 可选BGM
流程：edge-tts 逐段配音 → 按配音时长切素材/拼接 → SRT 字幕 → 烧录 → BGM 混音 → 成片
对标 MoneyPrinterTurbo 的核心链路
"""
import os, sys, json, asyncio, tempfile, subprocess
import video_tools as vt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import edge_tts


def tts(text, dst, voice="zh-CN-XiaoxiaoNeural"):
    async def _go():
        c = edge_tts.Communicate(text, voice)
        await c.save(dst)
    asyncio.run(_go())
    return dst


def _audio_dur(path):
    meta = vt.probe(path)
    return meta.get("duration", 0)


def _srt_from_segments(segs):
    lines = []
    t = 0.0
    def fmt(s):
        h = int(s // 3600); m = int(s % 3600 // 60); sec = s % 60
        return f"{h:02d}:{m:02d}:{sec:06.3f}".replace(".", ",")
    for i, sg in enumerate(segs, 1):
        lines.append(f"{i}\n{fmt(t)} --> {fmt(t + sg['dur'])}\n{sg['text']}\n")
        t += sg["dur"]
    return "\n".join(lines)


def complete_video_task(text, materials=None, dst=None, voice="zh-CN-XiaoxiaoNeural",
                        bgm=None, bgm_volume=0.2, subtitles=True, width=1280, height=720,
                        font_size=28, workdir=None):
    """一键成片。
    text: 文案，可用换行分段，每段一段配音
    materials: 素材视频路径列表（可空，空则用渐变背景）
    dst: 输出路径
    """
    if workdir is None:
        workdir = tempfile.mkdtemp(prefix="producer_")
    segs = [s.strip() for s in text.split("\n") if s.strip()]
    if not segs:
        raise ValueError("文案为空")

    # 1. 每段配音
    voice_parts = []
    for i, s in enumerate(segs):
        vp = os.path.join(workdir, f"voice{i}.mp3")
        tts(s, vp, voice=voice)
        voice_parts.append({"text": s, "audio": vp, "dur": _audio_dur(vp)})

    total = sum(v["dur"] for v in voice_parts)

    # 2. 视频轨：素材循环/均匀切分到配音总时长
    vid_track = os.path.join(workdir, "video_track.mp4")
    if materials:
        durs = [_audio_dur(m) for m in materials]
        pool = os.path.join(workdir, "pool")
        os.makedirs(pool, exist_ok=True)
        parts = []
        need = total
        mi = 0
        while need > 0.5:
            m = materials[mi % len(materials)]
            p = os.path.join(pool, f"m{len(parts)}.mp4")
            take = min(durs[mi % len(durs)], need)
            vt.cut(m, p, 0, take, copy=True)
            parts.append(p)
            need -= take
            mi += 1
        vt.concat(parts, vid_track)
    else:
        # 无素材：用 testsrc 渐变彩条占位
        subprocess.run(["ffmpeg", "-y", "-f", "lavfi",
                        "-i", f"gradients=size={width}x{height}:duration={total:.2f}:rate=25",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", vid_track], capture_output=True)

    # 3. 音频轨：逐段配音 concat
    audio_track = os.path.join(workdir, "audio_track.mp3")
    vt.concat([v["audio"] for v in voice_parts], audio_track)

    # 4. 合成
    merged = os.path.join(workdir, "merged.mp4")
    subprocess.run(["ffmpeg", "-y", "-i", vid_track, "-i", audio_track,
                    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
                    "-shortest", merged], capture_output=True)

    # 5. 字幕烧录
    cur = merged
    if subtitles:
        srt = os.path.join(workdir, "subs.srt")
        with open(srt, "w", encoding="utf-8") as f:
            f.write(_srt_from_segments(voice_parts))
        cur = os.path.join(workdir, "subbed.mp4")
        vt.burn_subtitle(merged, cur, srt, font_size=font_size)

    # 6. BGM 混音
    if bgm and os.path.exists(bgm):
        final = dst or os.path.join(workdir, "final.mp4")
        vt.mix_audio(cur, bgm, final, bgm_volume=bgm_volume)
    else:
        final = dst or os.path.join(workdir, "final.mp4")
        if cur != final:
            subprocess.run(["ffmpeg", "-y", "-i", cur, "-c", "copy", final], capture_output=True)

    return {"output": final, "duration": _audio_dur(final), "segments": len(segs),
            "total_voice": round(total, 2), "exists": os.path.exists(final)}
