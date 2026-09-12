# -*- coding: utf-8 -*-
"""fx_cut.py - 转场特效 + BGM 节奏卡点（基于 FFmpeg xfade / 响度节拍）

能力：
1. add_transition   两段视频之间加转场（fade/wipeleft/slideup/circleopen/dissolve 等）
2. beat_sync        检测 BGM 节拍点，按节拍切割素材并硬切拼接（卡点视频）
3. fx_apply         单视频加特效（fadein/fadeout/慢放卡点等组合）

依赖：ffmpeg 8.0.1、numpy（响度节拍检测用）。
"""
import os
import json
import subprocess
import math


def _ff():
    return 'ffmpeg'


def _ffprobe():
    return 'ffprobe'


def probe_dur(path):
    r = subprocess.run([_ffprobe(), '-v', 'quiet', '-print_format', 'json',
                        '-show_format', path], capture_output=True, text=True, encoding='utf-8')
    d = json.loads(r.stdout or '{}')
    return float(d.get('format', {}).get('duration', 0) or 0)


def _probe_wh(path):
    r = subprocess.run([_ffprobe(), '-v', 'quiet', '-print_format', 'json',
                        '-select_streams', 'v:0', '-show_streams', path],
                       capture_output=True, text=True, encoding='utf-8')
    s = (json.loads(r.stdout or '{}').get('streams') or [{}])[0]
    return int(s.get('width', 1920)), int(s.get('height', 1080)), float(s.get('r_frame_rate', '30/1').split('/')[0]) / max(1, float(s.get('r_frame_rate', '30/1').split('/')[1] if '/' in s.get('r_frame_rate', '30/1') else 1))


def _scale_norm(w, h, tw, th):
    """缩放+补边让尺寸一致（xfade 要求两输入同尺寸）"""
    return (f"scale={tw}:{th}:force_original_aspect_ratio=decrease,"
            f"pad={tw}:{th}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p")


TRANSITIONS = ['fade', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft',
               'slideright', 'slideup', 'slidedown', 'circleopen', 'circleclose',
               'dissolve', 'pixelize', 'radial', 'hblur', 'zoomin']


def add_transition(clip_a, clip_b, out, kind='fade', duration=0.5):
    """两段视频加转场拼接。返回 dict。"""
    if kind not in TRANSITIONS:
        raise ValueError(f'未知转场 {kind}，可用: {",".join(TRANSITIONS)}')
    wa, ha, _ = _probe_wh(clip_a)
    dur = float(duration)
    da = probe_dur(clip_a)
    offset = max(0.0, da - dur)
    norm = _scale_norm(wa, ha, wa, ha)
    cmd = [_ff(), '-y', '-i', clip_a, '-i', clip_b,
           '-filter_complex',
           f"[0:v]{norm}[a];[1:v]{_scale_norm(*_probe_wh(clip_b)[:2], wa, ha)}[b];"
           f"[a][b]xfade=transition={kind}:duration={dur}:offset={offset:.3f}[v]",
           '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast',
           '-c:a', 'aac', out]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        raise RuntimeError(f'xfade 失败: {r.stderr[-500:]}')
    return {'ok': True, 'out': out, 'transition': kind, 'duration': dur, 'offset': round(offset, 3)}


def detect_beats(audio_path, threshold=1.15):
    """基于能量峰值检测节拍点（秒列表）。无需额外依赖。"""
    import numpy as np
    import wave
    # 先用 ffmpeg 抽 16k 单声道 wav
    tmp = audio_path + '.beat.wav'
    subprocess.run([_ff(), '-y', '-i', audio_path, '-ar', '16000', '-ac', '1', tmp],
                   capture_output=True)
    try:
        with wave.open(tmp, 'rb') as w:
            sr = w.getframerate()
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32)
        # 每帧 1024 能量
        hop = 1024
        n = len(data) // hop
        energy = np.array([np.sqrt(np.mean(data[i*hop:(i+1)*hop] ** 2)) for i in range(n)])
        if energy.max() == 0:
            return []
        med = np.median(energy)
        beats = []
        last = -1.0
        min_gap = 0.2  # 最小节拍间隔 200ms（≤300BPM）
        for i in range(1, n - 1):
            e = energy[i]
            if e > med * threshold and e >= energy[i-1] and e >= energy[i+1]:
                t = i * hop / sr
                if t - last >= min_gap:
                    beats.append(round(t, 3))
                    last = t
        return beats
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def beat_sync(clips, bgm, out, mode='beats', threshold=1.15, max_out=60.0):
    """卡点视频：检测 BGM 节拍，素材按节拍硬切循环铺满。

    clips: 素材视频列表；bgm: 音乐文件；mode: beats=节拍切, fixed=固定2s切
    """
    if mode == 'beats':
        beats = detect_beats(bgm, threshold=threshold)
        if len(beats) < 2:
            beats = [i * 2.0 for i in range(1, int(probe_dur(bgm) / 2) + 1)]
        cuts = [beats[i+1] - beats[i] for i in range(len(beats) - 1)]
        starts = beats[:-1]
    else:
        cuts, starts = [2.0], [0.0]
        beats = []

    total = 0.0
    segments = []  # (clip, seg_dur)
    ci = 0
    for d in cuts:
        if total >= max_out:
            break
        d = min(d, max_out - total)
        segments.append((clips[ci % len(clips)], d))
        ci += 1
        total += d
    if not segments:
        raise ValueError('无可用片段')

    # 逐段裁剪到临时文件，再 concat
    tmpdir = os.path.splitext(out)[0] + '_beats_tmp'
    os.makedirs(tmpdir, exist_ok=True)
    parts = []
    try:
        for idx, (c, d) in enumerate(segments):
            p = os.path.join(tmpdir, f'seg{idx:03d}.mp4')
            w, h, _ = _probe_wh(c)
            subprocess.run([_ff(), '-y', '-i', c,
                            '-filter_complex',
                            f"[0:v]{_scale_norm(w, h, w, h)},trim=duration={d:.3f},setpts=PTS-STARTPTS[v];"
                            f"[0:a]atrim=duration={d:.3f},asetpts=PTS-STARTPTS[a]"],
                           capture_output=True)
            # 简化：直接流拷贝不行（时长不定），用定长转码
            subprocess.run([_ff(), '-y', '-i', c, '-t', f'{d:.3f}',
                            '-vf', _scale_norm(w, h, w, h),
                            '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', p],
                           capture_output=True)
            if not os.path.exists(p) or os.path.getsize(p) == 0:
                continue
            parts.append(p)
        if not parts:
            raise RuntimeError('卡点切片全部失败')
        lst = os.path.join(tmpdir, 'list.txt')
        with open(lst, 'w', encoding='utf-8') as f:
            for p in parts:
                f.write(f"file '{p}'\n")
        concat = os.path.join(tmpdir, 'concat.mp4')
        subprocess.run([_ff(), '-y', '-f', 'concat', '-safe', '0', '-i', lst,
                        '-c', 'copy', concat], capture_output=True)
        # 混 BGM（音乐循环、随视频截止）
        subprocess.run([_ff(), '-y', '-i', concat, '-stream_loop', '-1', '-i', bgm,
                        '-map', '0:v', '-map', '1:a', '-shortest',
                        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                        '-af', f"afade=t=out:st={max(0, total-1)}:d=1", out],
                       capture_output=True, text=True, encoding='utf-8')
    finally:
        import shutil
        shutil.rmtree(tmpdir, ignore_errors=True)

    return {'ok': True, 'out': out, 'beats_detected': len(beats),
            'segments': len(segments), 'total': round(total, 2)}


def fade_in_out(src, out, fin=0.5, fout=0.5):
    d = probe_dur(src)
    vf = f"fade=t=in:st=0:d={fin},fade=t=out:st={max(0, d-fout):.3f}:d={fout}"
    subprocess.run([_ff(), '-y', '-i', src, '-vf', vf, '-c:v', 'libx264',
                    '-preset', 'veryfast', '-c:a', 'copy', out],
                   capture_output=True, text=True, encoding='utf-8')
    return {'ok': True, 'out': out, 'fade_in': fin, 'fade_out': fout}
