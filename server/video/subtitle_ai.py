# -*- coding: utf-8 -*-
"""
subtitle_ai.py — Whisper 语音转写 + SRT 字幕生成 + 一键烧录
基于 faster-whisper（CPU 可跑，小模型 tiny/base，中文推荐 small 以上）
"""
import os
from faster_whisper import WhisperModel
import video_tools as vt

MODELS = {}  # 模型缓存


def _get_model(size="small", device="auto"):
    key = f"{size}@{device}"
    if key not in MODELS:
        MODELS[key] = WhisperModel(size, device=device, compute_type="auto")
    return MODELS[key]


def _fmt_ts(sec):
    sec = max(0.0, sec)
    h = int(sec // 3600); m = int(sec % 3600 // 60); s = sec % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}".replace(".", ",")


def transcribe(video_or_audio, size="small", language=None, srt_out=None):
    """转写 → SRT。language=None 自动检测；中文建议 'zh'"""
    if srt_out is None:
        base = os.path.splitext(video_or_audio)[0]
        srt_out = base + ".srt"
    model = _get_model(size)
    segments, info = model.transcribe(video_or_audio, language=language, vad_filter=True, vad_parameters={"min_silence_duration_ms": 300})
    lines = []
    texts = []
    for i, seg in enumerate(segments, 1):
        text = seg.text.strip()
        if not text:
            continue
        lines.append(f"{i}\n{_fmt_ts(seg.start)} --> {_fmt_ts(seg.end)}\n{text}\n")
        texts.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
    with open(srt_out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return {"srt": srt_out, "segments": texts, "language": info.language,
            "language_probability": round(info.language_probability, 3), "count": len(texts)}


def transcribe_and_burn(video, size="small", language=None, dst=None, font_size=24):
    """一键：视频 → 转写 → SRT → 烧录成片"""
    base = os.path.splitext(video)[0]
    srt = base + ".srt"
    result = transcribe(video, size=size, language=language, srt_out=srt)
    if dst is None:
        dst = base + "_subbed.mp4"
    vt.burn_subtitle(video, dst, srt, font_size=font_size)
    result["output"] = dst
    return result


if __name__ == "__main__":
    import argparse, json
    ap = argparse.ArgumentParser(description="Whisper 字幕工具")
    ap.add_argument("file", help="视频/音频文件")
    ap.add_argument("--model", default="small", help="tiny/base/small/medium/large-v3")
    ap.add_argument("--lang", default=None, help="语言，如 zh，默认自动检测")
    ap.add_argument("--burn", action="store_true", help="转写后直接烧录进视频")
    a = ap.parse_args()
    r = transcribe_and_burn(a.file, size=a.model, language=a.lang) if a.burn else transcribe(a.file, size=a.model, language=a.lang)
    print(json.dumps({k: v for k, v in r.items() if k != "segments"}, ensure_ascii=False, indent=2))
    for s in r.get("segments", [])[:20]:
        print(f"[{s['start']:.1f}-{s['end']:.1f}] {s['text']}")
