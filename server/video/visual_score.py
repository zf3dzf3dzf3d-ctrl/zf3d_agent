# -*- coding: utf-8 -*-
"""visual_score.py - 多模态选片：视觉画面打分

纯 OpenCV 信号（无需大模型，本地秒级运行）：
- 画面变化度：帧差（运动/切换越激烈分越高）
- 色彩丰富度：HSV 饱和度均值
- 亮度适中度：过暗/过曝扣分
- 构图复杂度：边缘密度（Canny）

综合打分后输出每秒分数曲线 + top 片段，可与 smart_cut 的音频高光加权融合
（audio 60% + visual 40%）实现多模态选片。
"""
import os
import subprocess
import json


def _probe_dur(path):
    r = subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json',
                        '-show_format', path], capture_output=True, text=True, encoding='utf-8')
    return float(json.loads(r.stdout or '{}').get('format', {}).get('duration', 0) or 0)


def visual_scores(path, sample_fps=2.0, tmpdir=None):
    """返回 (scores, fps)：scores 为每采样帧的 0~1 分数列表。"""
    import cv2
    import numpy as np

    tmp = None
    if sample_fps and abs(sample_fps - 30) > 5:
        # 抽帧到临时低帧率视频，加快分析
        import tempfile
        tmp = os.path.join(tmpdir or tempfile.gettempdir(), f'vs_{os.getpid()}_{os.path.basename(path)}.mp4')
        subprocess.run(['ffmpeg', '-y', '-i', path, '-vf', f'fps={sample_fps},scale=320:-2',
                        '-an', '-c:v', 'libx264', '-preset', 'ultrafast', tmp],
                       capture_output=True)
        src = tmp
    else:
        src = path

    cap = cv2.VideoCapture(src)
    scores = []
    prev = None
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            small = cv2.resize(frame, (160, 90))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32)
            hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)

            # 1. 帧差（运动/切换）
            motion = 0.0
            if prev is not None:
                motion = float(np.mean(np.abs(gray - prev))) / 60.0
            prev = gray

            # 2. 色彩丰富度（饱和度均值归一）
            color = float(np.mean(hsv[:, :, 1])) / 255.0

            # 3. 亮度适中度（理想 100~160）
            lum = float(np.mean(gray))
            bright = 1.0 - min(1.0, abs(lum - 128) / 128)

            # 4. 边缘密度（细节/构图复杂度）
            edges = cv2.Canny(gray.astype(np.uint8), 60, 160)
            detail = float(np.count_nonzero(edges)) / edges.size

            s = 0.35 * min(1.0, motion) + 0.25 * color + 0.2 * bright + 0.2 * min(1.0, detail * 3)
            scores.append(round(max(0.0, min(1.0, s)), 3))
    finally:
        cap.release()
        if tmp and os.path.exists(tmp):
            os.remove(tmp)
    return scores, sample_fps


def top_segments(path, top=3, window=5.0, sample_fps=2.0):
    """返回视觉高光 top 片段 [{start, end, score}]。"""
    dur = _probe_dur(path)
    if dur <= 0:
        return []
    scores, fps = visual_scores(path, sample_fps=sample_fps)
    if not scores:
        return []
    import numpy as np
    win_frames = max(1, int(window * fps))
    segs = []
    for i in range(0, max(1, len(scores) - win_frames + 1), max(1, win_frames // 2)):
        seg = scores[i:i + win_frames]
        segs.append((i / fps, min(dur, (i + len(seg)) / fps), float(np.mean(seg)) if seg else 0))
    segs.sort(key=lambda x: -x[2])
    return [{'start': round(s, 2), 'end': round(e, 2), 'score': round(sc, 3)}
            for s, e, sc in segs[:top]]


def multimodal_highlight(src, out, top=3, window=5.0, audio_weight=0.6):
    """多模态高光：音频响度高光(60%) + 视觉画面分(40%) 加权融合选片后拼接。
    out 为输出合集文件。返回 dict。
    """
    import numpy as np
    import smart_cut

    # 音频侧：用 smart_cut.analyze 的响度曲线
    info = smart_cut.analyze(src)
    loud = info.get('loudness_per_sec') or []
    scenes = info.get('scenes') or []

    # 视觉侧
    v_scores, v_fps = visual_scores(src, sample_fps=2.0)
    dur = _probe_dur(src)

    # 对齐到同一时间轴（每秒一个分数）
    n = max(1, int(dur))
    a = np.zeros(n)
    if loud:
        for i, v in enumerate(loud[:n]):
            a[i] = v
        if a.max() > 0:
            a = a / a.max()
    v = np.zeros(n)
    for i, s in enumerate(v_scores):
        t = int(i / v_fps)
        if t < n:
            v[t] = max(v[t], s)

    fused = audio_weight * a + (1 - audio_weight) * v

    # 按 window 切段取 top
    win = max(1, int(window))
    segs = []
    for st in range(0, max(1, n - win + 1), max(1, win // 2)):
        seg = fused[st:st + win]
        segs.append((st, min(dur, st + len(seg)), float(np.mean(seg))))
    segs.sort(key=lambda x: -x[2])
    picked = segs[:max(1, top)]
    picked.sort(key=lambda x: x[0])

    # 拼接
    import tempfile
    tmpdir = tempfile.mkdtemp(prefix='mm_')
    parts = []
    try:
        for idx, (st, en, _sc) in enumerate(picked):
            p = os.path.join(tmpdir, f'p{idx}.mp4')
            subprocess.run(['ffmpeg', '-y', '-ss', str(st), '-to', str(en), '-i', src,
                            '-c', 'copy', p], capture_output=True)
            if os.path.exists(p) and os.path.getsize(p) > 0:
                parts.append(p)
        lst = os.path.join(tmpdir, 'l.txt')
        with open(lst, 'w', encoding='utf-8') as f:
            for p in parts:
                f.write(f"file '{p}'\n")
        subprocess.run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', lst,
                        '-c', 'copy', out], capture_output=True)
    finally:
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)

    return {'ok': True, 'out': out, 'picked': [
        {'start': round(s, 2), 'end': round(e, 2), 'score': round(sc, 3)} for s, e, sc in picked],
        'audio_weight': audio_weight}
