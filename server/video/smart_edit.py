# -*- coding: utf-8 -*-
"""
smart_edit.py — AI 能力二：场景检测 + 高光/静音智能剪辑
- analyze(src): 一键分析：场景切分 + 静音检测 + 响度曲线 + (可选)Whisper 转写关键词
- highlights(src): 高光片段提取（场景变化 + 音频能量综合打分）
- rough_cut(src, dst, keep_ratio): 自动粗剪——去掉低能量/静音段，保留高光
- extract_highlight(src, dst, n): 输出前 n 个高光片段合集
"""
import os, sys, json, subprocess, tempfile
import video_tools as vt

HERE = os.path.dirname(os.path.abspath(__file__))


def _norm_scene(s):
    """兼容 [start,end] 列表和 {start,end} 字典两种格式"""
    if isinstance(s, dict):
        return {"start": s["start"], "end": s["end"]}
    return {"start": s[0], "end": s[1]}


def _fmt(sec):
    return f"{int(sec//60):02d}:{sec%60:04.1f}"


def analyze(src, noise_db=-35, min_silence=0.6, threshold=27.0, step=1.0):
    """综合分析：场景、静音、响度。返回剪辑建议"""
    meta = vt.probe(src)
    scenes = [_norm_scene(s) for s in vt.detect_scenes(src, threshold=threshold)]
    silences = [_norm_scene(s) for s in vt.detect_silence(src, noise_db=noise_db, min_silence=min_silence)]
    curve = vt.loudness_curve(src, step=step)
    dur = meta.get("duration", 0)
    silence_total = sum(s["end"] - s["start"] for s in silences)
    return {
        "duration": dur,
        "scenes": scenes,
        "scene_count": len(scenes),
        "silences": silences,
        "silence_seconds": round(silence_total, 2),
        "silence_ratio": round(silence_total / dur, 3) if dur else 0,
        "loudness_curve": curve,
        "suggest_cut_silence": silence_total > dur * 0.15,
        "suggest_scene_split": len(scenes) > 3,
    }


def highlights(src, top_n=5, min_len=2.0, step=1.0, threshold=27.0):
    """高光打分：每个候选窗口得分 = 场景边界密度 + 音频能量"""
    meta = vt.probe(src)
    dur = meta.get("duration", 0)
    scenes = [_norm_scene(s) for s in vt.detect_scenes(src, threshold=threshold)]
    curve = vt.loudness_curve(src, step=step)  # [{t, db}...]
    bounds = [s["start"] for s in scenes] + [s["end"] for s in scenes]

    win = max(min_len, dur / 20)  # 候选窗口
    cands = []
    t = 0.0
    while t + win <= dur:
        e = t + win
        # 窗口内平均响度
        vals = [c["db"] for c in curve if t <= c["t"] < e and c["db"] is not None]
        energy = sum(vals) / len(vals) if vals else -60.0
        # 窗口内场景边界数
        cuts = sum(1 for b in bounds if t < b < e)
        score = energy + cuts * 2.0
        cands.append({"start": round(t, 2), "end": round(e, 2),
                      "score": round(score, 2), "scene_cuts": cuts, "avg_db": round(energy, 1)})
        t += win / 2  # 50% 重叠
    cands.sort(key=lambda c: -c["score"])
    # 去重叠
    picked = []
    for c in cands:
        if all(c["end"] <= p["start"] or c["start"] >= p["end"] for p in picked):
            picked.append(c)
        if len(picked) >= top_n:
            break
    picked.sort(key=lambda c: c["start"])
    return {"highlights": picked, "window": round(win, 2)}


def extract_highlight(src, dst=None, top_n=3, transition_crossfade=0.0):
    """提取高光并拼接成合集"""
    if dst is None:
        dst = os.path.splitext(src)[0] + "_highlights.mp4"
    hs = highlights(src, top_n=top_n)["highlights"]
    if not hs:
        return {"output": None, "highlights": []}
    tmpdir = tempfile.mkdtemp(prefix="hl_")
    parts = []
    for i, h in enumerate(hs):
        p = os.path.join(tmpdir, f"hl{i}.mp4")
        vt.cut(src, p, h["start"], h["end"])
        parts.append(p)
    vt.concat(parts, dst)
    for p in parts:
        try: os.remove(p)
        except OSError: pass
    try: os.rmdir(tmpdir)
    except OSError: pass
    return {"output": dst, "highlights": hs, "exists": os.path.exists(dst)}


def rough_cut(src, dst=None, noise_db=-35, min_silence=0.6):
    """自动粗剪：先去静音（变速压缩），即口播类视频的快速粗剪"""
    if dst is None:
        dst = os.path.splitext(src)[0] + "_roughcut.mp4"
    vt.auto_remove_silence(src, dst, noise_db=noise_db, min_silence=min_silence)
    meta = vt.probe(dst)
    return {"output": dst, "new_duration": meta.get("duration"), "exists": os.path.exists(dst)}


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("cmd", choices=["analyze", "highlights", "extract", "roughcut"])
    ap.add_argument("--top", type=int, default=3)
    a = ap.parse_args()
    if a.cmd == "analyze":
        r = analyze(a.file)
    elif a.cmd == "highlights":
        r = highlights(a.file, top_n=a.top)
    elif a.cmd == "extract":
        r = extract_highlight(a.file, top_n=a.top)
    else:
        r = rough_cut(a.file)
    print(json.dumps(r, ensure_ascii=False, indent=2))
