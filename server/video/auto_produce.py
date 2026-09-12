# -*- coding: utf-8 -*-
"""
auto_produce.py — 文案成片流水线（MoneyPrinterTurbo 思路）
文案 → TTS 配音（edge-tts，微软神经网络音色）→ 素材片段（本地视频/图片）按时长裁切拼接
→ 混 BGM → 烧字幕 → 成片
用法：
  from auto_produce import produce
  produce(script=[{"text":"第一句","clip":"a.mp4"},{"text":"第二句","clip":"b.jpg"}],
          out="out.mp4", voice="zh-CN-XiaoxiaoNeural", bgm="bgm.mp3", burn_sub=True)
"""
import os, json, tempfile, subprocess, math
import edge_tts
import video_tools as vt

import asyncio


def _tts(text, out_mp3, voice="zh-CN-XiaoxiaoNeural", rate="+0%"):
    async def _go():
        c = edge_tts.Communicate(text, voice, rate=rate)
        await c.save(out_mp3)
    asyncio.run(_go())
    if not os.path.exists(out_mp3):
        raise vt.VideoError("TTS 生成失败: " + text[:30])
    return out_mp3


def _clip_to_video(clip, duration, out, size=(1080, 1920)):
    """素材（视频或图片）→ 统一尺寸、指定时长的 mp4。图片用 zoompan 动效"""
    w, h = size
    if clip.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
        vf = (f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
              f"zoompan=z='min(zoom+0.0008,1.15)':d={int(duration*25)}:s={w}x{h}:fps=25")
        cmd = [vt.FFMPEG, "-y", "-loop", "1", "-t", str(duration), "-i", clip,
               "-vf", vf, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", out]
        vt._run(cmd)
    else:
        vt.resize(clip, out, width=w, height=h)
        d = vt.probe(out)["duration"]
        if d > duration:
            vt.cut(out, out + ".c.mp4", 0, duration, copy=False)
            os.replace(out + ".c.mp4", out)
        elif d < duration - 0.3:
            # 视频太短：慢放到目标时长
            vt.change_speed(out, out + ".s.mp4", factor=d / duration)
            os.replace(out + ".s.mp4", out)
    return out


def produce(script, out, voice="zh-CN-XiaoxiaoNeural", bgm=None, bgm_volume=0.2,
            burn_sub=True, size=(1080, 1920), workdir=None, tts_rate="+0%"):
    """
    script: [{"text": "口播文案", "clip": "素材视频或图片路径"}, ...]
    每条文案生成配音，素材裁到配音时长，全部拼接 + 混BGM + 字幕成片
    """
    if not script:
        raise vt.VideoError("script 为空")
    tmp = workdir or tempfile.mkdtemp(prefix="autoprod_")
    os.makedirs(tmp, exist_ok=True)
    segments = []
    srt_lines = []
    t_cursor = 0.0
    video_parts = []
    audio_parts = []
    try:
        for i, item in enumerate(script):
            text = item["text"].strip()
            clip = item.get("clip")
            if not text:
                continue
            # 1. TTS
            mp3 = os.path.join(tmp, f"tts_{i}.mp3")
            _tts(text, mp3, voice=voice, rate=tts_rate)
            dur = vt.probe(mp3)["duration"] + 0.4  # 留一点气口
            # 2. 素材 → 统一视频
            seg = os.path.join(tmp, f"seg_{i}.mp4")
            if clip and os.path.exists(clip):
                _clip_to_video(clip, dur, seg, size=size)
            else:
                # 无素材：用纯色底
                w, h = size
                vt._run([vt.FFMPEG, "-y", "-f", "lavfi", "-i",
                         f"color=c=0x101820:s={w}x{h}:d={dur:.2f}:r=25",
                         "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", seg])
            video_parts.append(seg)
            audio_parts.append(mp3)
            # 3. SRT
            srt_lines.append(f"{len(srt_lines)+1}\n{vt._tstr(t_cursor).replace('.',',')} --> "
                             f"{vt._tstr(t_cursor+dur-0.3).replace('.',',')}\n{text}\n")
            t_cursor += dur
        # 4. 拼视频
        concat_v = os.path.join(tmp, "video_all.mp4")
        vt.concat(video_parts, concat_v, copy=False)
        # 5. 拼音频
        lst = os.path.join(tmp, "a.txt")
        with open(lst, "w", encoding="utf-8") as f:
            for a in audio_parts:
                f.write(f"file '{os.path.abspath(a)}'\n")
        concat_a = os.path.join(tmp, "audio_all.mp3")
        vt._run([vt.FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c:a", "libmp3lame", concat_a])
        # 合成
        merged = os.path.join(tmp, "merged.mp4")
        vt._run([vt.FFMPEG, "-y", "-i", concat_v, "-i", concat_a,
                 "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", merged])
        # 6. BGM
        if bgm and os.path.exists(bgm):
            merged2 = merged.replace("merged", "bgmed")
            vt.mix_audio(merged, bgm, merged2, bgm_volume=bgm_volume)
            merged = merged2
        # 7. 字幕
        final = os.path.abspath(out)
        if burn_sub:
            srt = os.path.join(tmp, "all.srt")
            with open(srt, "w", encoding="utf-8") as f:
                f.write("\n".join(srt_lines))
            vt.burn_subtitle(merged, final, srt, font_size=14)  # 1080 宽下 14 号较合适
        else:
            import shutil; shutil.copy(merged, final)
        return {"output": final, "duration": round(t_cursor, 2), "segments": len(video_parts)}
    finally:
        pass  # 保留 workdir 便于调试；用 tempfile 时系统会清


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--script", required=True, help="脚本 JSON 文件：[{text,clip},...]")
    ap.add_argument("--out", required=True)
    ap.add_argument("--voice", default="zh-CN-XiaoxiaoNeural")
    ap.add_argument("--bgm", default=None)
    ap.add_argument("--no-sub", action="store_true")
    a = ap.parse_args()
    with open(a.script, encoding="utf-8-sig") as f:
        sc = json.load(f)
    print(json.dumps(produce(sc, a.out, voice=a.voice, bgm=a.bgm, burn_sub=not a.no_sub),
                     ensure_ascii=False, indent=2))
