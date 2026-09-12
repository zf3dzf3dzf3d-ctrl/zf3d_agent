# -*- coding: utf-8 -*-
"""
smart_cut.py — 场景检测 + 静音智能剪辑 + 高光提取
- analyze: 一键分析视频（场景列表/静音段/响度曲线），供 LLM 做剪辑决策
- highlight: 按响度+场景自动挑高光片段输出合集
- remove_silence: 口播去停顿
"""
import os, json
import video_tools as vt


def analyze(src, scene_threshold=27.0, noise_db=-35):
    """全维度分析，结果 JSON 可直接丢给 LLM 决策"""
    info = vt.probe(src)
    try:
        scenes = vt.detect_scenes(src, threshold=scene_threshold)
    except Exception as e:
        scenes = {"error": str(e)}
    silence = vt.detect_silence(src, noise_db=noise_db)
    curve = vt.loudness_curve(src, step=1.0)
    # 找响度峰值（高光候选）
    hot = sorted(range(len(curve)), key=lambda i: -curve[i])[:5] if curve else []
    return {
        "info": info,
        "scenes": scenes,
        "silence_segments": silence,
        "silence_total_sec": round(sum(e - s for s, e in silence), 1),
        "loudness_per_sec": curve,
        "loudest_seconds": sorted(hot),
    }


def highlight(src, dst=None, top_n=3, min_len=3.0, window=8.0):
    """响度高峰为中心取 window 秒片段，拼接成高光合集"""
    if dst is None:
        base = os.path.splitext(src)[0]
        dst = base + "_highlight.mp4"
    info = vt.probe(src)
    dur = info["duration"]
    curve = vt.loudness_curve(src, step=1.0)
    if not curve:
        raise vt.VideoError("无法分析音频")
    # 取峰值为中心的窗口，去重合并
    ranked = sorted(range(len(curve)), key=lambda i: -curve[i])
    picks = []
    for sec in ranked:
        c = min(max(sec, int(window // 2)), max(0, int(dur - window)))
        seg = (float(c), min(float(c) + window, dur))
        if seg[1] - seg[0] < min_len:
            continue
        # 与已选片段重叠超过一半则视为重复
        dup = any(min(seg[1], p[1]) - max(seg[0], p[0]) > (seg[1] - seg[0]) / 2 for p in picks)
        if dup:
            continue
        picks.append(seg)
        if len(picks) >= top_n:
            break
    picks.sort()
    if not picks:
        picks = [(0.0, min(window, dur))]
    # 逐段剪切拼接
    import tempfile
    tmpdir = tempfile.mkdtemp()
    parts = []
    try:
        for i, (s, e) in enumerate(picks):
            t = os.path.join(tmpdir, f"p{i}.mp4")
            vt.cut(src, t, s, e, copy=False)
            parts.append(t)
        vt.concat(parts, dst, copy=False)
    finally:
        for t in parts:
            if os.path.exists(t): os.remove(t)
        os.rmdir(tmpdir)
    return {"output": dst, "clips": [{"start": s, "end": e} for s, e in picks]}


def remove_silence(src, dst=None, **kw):
    if dst is None:
        base = os.path.splitext(src)[0]
        dst = base + "_nosilence.mp4"
    r = vt.auto_remove_silence(src, dst, **kw)
    return r


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--highlight", action="store_true", help="提取高光合集")
    ap.add_argument("--desilence", action="store_true", help="去除静音/停顿")
    ap.add_argument("--top", type=int, default=3)
    a = ap.parse_args()
    if a.highlight:
        print(json.dumps(highlight(a.file, top_n=a.top), ensure_ascii=False, indent=2))
    elif a.desilence:
        print(json.dumps(remove_silence(a.file), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(analyze(a.file), ensure_ascii=False, indent=2))
