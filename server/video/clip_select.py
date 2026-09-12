# -*- coding: utf-8 -*-
"""
clip_select.py — CLIP 语义选片
用本地 CLIP 模型把「文案/查询词」和视频画面做语义匹配，自动挑出最相关的镜头。

用法:
    python clip_select.py <视频路径> <查询文案或txt路径> [输出.mp4] [--fps N] [--top N] [--minlen 秒]

抽帧策略:
    --fps N      每秒抽 N 帧（默认 auto）
    --fps auto   自动模式：短视频(<60s) 1帧/秒，长视频按镜头变化抽帧（scenedetect），每镜头至少1帧
"""
import sys, os, json, subprocess, tempfile
import numpy as np

SERVER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_NAME = 'ViT-B-32'
PRETRAINED = 'laion2b_s34b_b79k'
_cache = {}

def _get_model():
    if 'm' in _cache:
        return _cache['m'], _cache['p']
    import open_clip, torch
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED)
    model.eval()
    tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    _cache['m'], _cache['p'], _cache['t'] = model, preprocess, tokenizer
    return model, preprocess, tokenizer

def _ffprobe_duration(path):
    out = subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', path],
                         capture_output=True, text=True).stdout
    return float(json.loads(out)['format']['duration'])

def _scene_times(path, threshold=27.0):
    """scenedetect 拿镜头切换时间点"""
    try:
        from scenedetect import detect, ContentDetector
        scenes = detect(path, ContentDetector(threshold=threshold))
        return [s[0].get_seconds() for s, _ in scenes]
    except Exception:
        return []

def extract_frames(path, fps='auto', max_frames=400):
    """抽帧 -> 返回 (帧文件列表, 时间列表)"""
    dur = _ffprobe_duration(path)
    if fps == 'auto':
        scene_cuts = _scene_times(path)
        if scene_cuts and len(scene_cuts) >= max(3, dur // 15):
            # 有镜头变化：每镜头中点抽1帧（镜头级识图，大模型视角自己定义"哪里值得看"）
            times = []
            pts = [0.0] + scene_cuts + [dur]
            for a, b in zip(pts[:-1], pts[1:]):
                times.append((a + b) / 2)
            # 镜头太多则均匀稀疏化
            if len(times) > max_frames:
                idx = np.linspace(0, len(times) - 1, max_frames).astype(int)
                times = [times[i] for i in idx]
            mode = f'scene({len(scene_cuts)}镜头)'
        else:
            n = min(max_frames, max(8, int(dur / 3)))  # 约1帧/3秒
            times = list(np.linspace(0, dur * 0.98, n))
            mode = f'uniform({n}帧)'
    else:
        n = min(max_frames, int(dur * float(fps)))
        times = list(np.linspace(0, dur * 0.98, max(n, 1)))
        mode = f'manual fps={fps}'

    frames, tlist, tmpdir = [], [], tempfile.mkdtemp(prefix='clip_frames_')
    for i, t in enumerate(times):
        f = os.path.join(tmpdir, f'{i:04d}.jpg')
        r = subprocess.run(['ffmpeg', '-y', '-v', 'quiet', '-ss', f'{t:.2f}', '-i', path,
                            '-frames:v', '1', '-q:v', '3', f], capture_output=True)
        if r.returncode == 0 and os.path.getsize(f) > 0:
            frames.append(f); tlist.append(float(t))
    return frames, tlist, mode, dur

def score_frames(frames, query, batch=32):
    """CLIP 打分：query 可以是多行/分号分隔的多条查询"""
    import torch
    from PIL import Image
    model, preprocess, tokenizer = _get_model()
    queries = [q.strip() for q in query.replace('；', ';').split(';') if q.strip()]
    with torch.no_grad():
        t = tokenizer(queries)
        tf = model.encode_text(t)
        tf = tf / tf.norm(dim=-1, keepdim=True)
        scores = []
        for i in range(0, len(frames), batch):
            imgs = torch.stack([preprocess(Image.open(f).convert('RGB')) for f in frames[i:i+batch]])
            imf = model.encode_image(imgs)
            imf = imf / imf.norm(dim=-1, keepdim=True)
            sim = (imf @ tf.T).max(dim=1).values  # 与任一查询的最大相似度
            scores.extend(sim.tolist())
    return scores, queries

def select_and_cut(video, query, out=None, fps='auto', top=5, minlen=6.0, padding=1.5, max_frames=400):
    frames, tlist, mode, dur = extract_frames(video, fps, max_frames)
    if not frames:
        raise RuntimeError('抽帧失败')
    scores, queries = score_frames(frames, query)
    order = np.argsort(scores)[::-1]
    # 贪心合并重叠区间
    segments = []
    for idx in order:
        if len(segments) >= top:
            break
        c = tlist[idx]
        a, b = max(0, c - padding), min(dur, c + max(minlen - padding, padding))
        b = min(dur, a + minlen)
        if any(not (b <= s or a >= e) for s, e in segments):
            continue
        segments.append((a, b))
    segments.sort()
    out = out or os.path.splitext(video)[0] + '_clip_select.mp4'
    # 用 ffmpeg select 滤镜一次剪辑
    parts = []
    for i, (a, b) in enumerate(segments):
        parts.append(f'between(t,{a:.2f},{b:.2f})')
    vf = f"select='{'+'.join(parts)}',setpts=N/FRAME_RATE/TB"
    af = f"aselect='{'+'.join(parts)}',asetpts=N/SR/TB"
    r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', video, '-vf', vf, '-af', af,
                        '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', out],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-500:])
    return {
        'ok': True, 'output': out, 'mode': mode, 'duration': round(dur, 1),
        'queries': queries,
        'top_matches': [
            {'time': round(tlist[i], 1), 'score': round(scores[i], 3)}
            for i in order[:top]
        ],
        'segments': [{'start': round(a, 2), 'end': round(b, 2)} for a, b in segments],
    }

def main():
    args = [a for a in sys.argv[1:]]
    if not args:
        print(__doc__); return
    video = args[0]
    q = args[1]
    if os.path.isfile(q):
        q = open(q, encoding='utf-8-sig').read()
    out, fps, top, minlen = None, 'auto', 5, 6.0
    i = 2
    while i < len(args):
        if args[i] == '--fps': fps = args[i+1]; i += 2
        elif args[i] == '--top': top = int(args[i+1]); i += 2
        elif args[i] == '--minlen': minlen = float(args[i+1]); i += 2
        elif args[i] == '--out': out = args[i+1]; i += 2
        else: i += 1
    res = select_and_cut(video, q, out, fps, top, minlen)
    print(json.dumps(res, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
