# -*- coding: utf-8 -*-
"""vision_pick.py - 大模型识图选片（视觉理解版高光挑选）

流程：
1. ffmpeg 均匀抽帧（用户可指定 sample_fps 每秒抽几帧；fps='auto' 时先低密度抽样
   让大模型看缩略图网格，由大模型返回建议密度和关注点，再按建议重新抽帧）
2. 每帧压缩为小图，批量发给视觉大模型打分（0~10 分 + 一句话理由）
3. 分数曲线合并为高光片段，ffmpeg 剪出成片

依赖：OpenAI 兼容接口（chat/completions + image_url base64），
模型/key 从 model_config 读取（默认模型，或传 vision_model 指定）。
"""
import os
import re
import json
import shutil
import base64
import tempfile
import subprocess


def _probe_dur(path):
    r = subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json',
                        '-show_format', path], capture_output=True, text=True, encoding='utf-8')
    return float(json.loads(r.stdout or '{}').get('format', {}).get('duration', 0) or 0)


def _extract_frames(src, fps, outdir, scale=512):
    """均匀抽帧到 outdir，返回 [(t, path), ...] 按时间排序。"""
    os.makedirs(outdir, exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-i', src, '-vf',
                    f'fps={fps},scale={scale}:-2', '-q:v', '5',
                    os.path.join(outdir, '%06d.jpg')],
                   capture_output=True)
    dur = _probe_dur(src)
    n = fps if fps > 0 else 1
    frames = []
    files = sorted(f for f in os.listdir(outdir) if f.endswith('.jpg'))
    for i, fn in enumerate(files):
        t = (i + 0.5) / fps
        frames.append((round(min(t, dur), 3), os.path.join(outdir, fn)))
    return frames, dur


def _b64(path):
    with open(path, 'rb') as f:
        return 'data:image/jpeg;base64,' + base64.b64encode(f.read()).decode()


def _get_vision_model(name=None):
    """从 model_config 拿视觉模型配置（含真实 key）。
    优先顺序：指定 name > visionInput=true 且有 key > 默认模型。"""
    sys_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if sys_path not in __import__('sys').path:
        __import__('sys').path.insert(0, sys_path)
    import model_config as mc
    cfg = mc.load_models_config(include_key=True)
    items = cfg.get('list', [])
    m = None
    if name:
        m = next((x for x in items if x.get('name') == name), None)
        if not m:
            raise RuntimeError(f'未找到模型: {name}')
    if not m:
        m = next((x for x in items if x.get('visionInput') and (x.get('key') or x.get('apiKey'))), None)
    if not m:
        m = mc.get_default_model()
    if not m:
        raise RuntimeError('未配置任何大模型（public/config/models.json 为空）')
    key = m.get('key') or m.get('apiKey') or ''
    base = (m.get('baseUrl') or m.get('baseURL') or m.get('apiUrl') or '').rstrip('/')
    if base.endswith('/chat/completions'):
        base = base[:-len('/chat/completions')]
    return {'name': m.get('name'), 'model_id': m.get('modelId'), 'key': key, 'base': base}


def _chat(model, messages, timeout=120):
    import requests
    url = model['base'] + '/chat/completions'
    r = requests.post(url, json={'model': model['model_id'], 'messages': messages,
                                 'temperature': 0.2, 'max_tokens': 2000},
                      headers={'Authorization': 'Bearer ' + model['key']}, timeout=timeout)
    r.raise_for_status()
    return r.json()['choices'][0]['message']['content']


def _parse_scores(text, n):
    """从大模型回复解析分数：优先 JSON，兜底按行 '序号: 分数'。"""
    try:
        m = re.search(r'\[[\s\S]*?\]', text)
        if m:
            arr = json.loads(m.group(0))
            if isinstance(arr, list) and len(arr) >= n:
                return [max(0.0, min(1.0, float(x) / 10.0)) for x in arr[:n]]
    except Exception:
        pass
    scores = {}
    for line in text.splitlines():
        m = re.match(r'\s*(\d+)\D{1,4}(\d+(?:\.\d+)?)', line)
        if m:
            i, s = int(m.group(1)), float(m.group(2))
            if 0 <= i < n:
                scores[i] = max(0.0, min(1.0, s / 10.0))
    return [scores.get(i, 0.5) for i in range(n)]


def _grid_image(frames, cols=4):
    """把多帧拼成网格图，供 auto 模式概览。"""
    import cv2
    import numpy as np
    imgs = []
    for _, p in frames:
        img = cv2.imread(p)
        if img is None:
            continue
        h, w = img.shape[:2]
        tw = 320
        imgs.append(cv2.resize(img, (tw, int(h * tw / w))))
    if not imgs:
        raise RuntimeError('抽帧失败')
    h = max(i.shape[0] for i in imgs)
    rows = []
    for k in range(0, len(imgs), cols):
        row = imgs[k:k + cols]
        while len(row) < cols:
            row.append(np.full_like(imgs[0], 32))
        rows.append(np.hstack(row))
    grid = np.vstack(rows)
    ok, buf = cv2.imencode('.jpg', grid, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return 'data:image/jpeg;base64,' + base64.b64encode(buf).decode()


def _segment(scores, times, dur, top_ratio=0.3, min_seg=1.5, max_seg=8.0):
    """分数曲线 -> 高光片段。"""
    if not scores:
        return []
    thr = sorted(scores)[int(len(scores) * (1 - top_ratio))]
    segs, cur = [], None
    for s, t in zip(scores, times):
        if s >= thr:
            if cur is None:
                cur = [t, t, s]
            else:
                cur[1] = t
                cur[2] = max(cur[2], s)
        elif cur is not None:
            if cur[1] - cur[0] >= min_seg:
                segs.append(cur)
            cur = None
    if cur is not None and cur[1] - cur[0] >= min_seg:
        segs.append(cur)
    # 扩边、限长
    out = []
    for s, e, sc in segs:
        s = max(0, s - 0.5)
        e = min(dur, e + 0.5)
        if e - s > max_seg:
            mid = (s + e) / 2
            s, e = mid - max_seg / 2, mid + max_seg / 2
        out.append((s, e, sc))
    out.sort(key=lambda x: -x[2])
    return out


def vision_pick(src, out=None, fps='auto', vision_model=None, prompt=None,
                top_ratio=0.3, max_frames=24, cut=True):
    """大模型识图选片主入口。

    fps: 数字（每秒抽几帧，如 1、0.5、2）或 'auto'（大模型先看概览网格自己定密度）。
    prompt: 自定义挑选标准；缺省=精彩/信息量大/画面有看头的片段。
    """
    out = out or os.path.splitext(src)[0] + '_visionpick.mp4'
    tmpdir = tempfile.mkdtemp(prefix='vpick_')
    notes = []
    try:
        model = _get_vision_model(vision_model)
        dur = _probe_dur(src)
        base_prompt = prompt or '你是视频剪辑师。按画面精彩程度、信息量、视觉冲击力打分。'

        # ---- auto 模式：概览网格让大模型自己定抽帧密度和关注点 ----
        if fps == 'auto':
            overview, _ = _extract_frames(src, 0.25, os.path.join(tmpdir, 'ov'), scale=320)
            grid = _grid_image(overview)
            resp = _chat(model, [{
                'role': 'user',
                'content': [
                    {'type': 'text', 'text': base_prompt +
                     '\n这是视频按0.25帧/秒抽的概览图（从左到右、从上到下按时间顺序）。'
                     '请回答（JSON）：{"fps": 建议每秒抽几帧(0.2~2之间的小数, 内容变化快给高值), '
                     '"focus": "你识别到的内容类型与挑选重点(50字内)"}'},
                    {'type': 'image_url', 'image_url': {'url': grid}}]}])
            try:
                j = json.loads(re.search(r'\{[\s\S]*\}', resp).group(0))
                fps = max(0.2, min(2.0, float(j.get('fps', 1))))
                notes.append('AI auto: fps=%s, focus=%s' % (fps, j.get('focus', '')))
            except Exception:
                fps = 1.0
                notes.append('AI auto 解析失败，回退 fps=1.0')
        fps = float(fps)

        # ---- 正式抽帧 ----
        frames, _ = _extract_frames(src, fps, os.path.join(tmpdir, 'fr'))
        if len(frames) > max_frames:
            step = len(frames) / max_frames
            frames = [frames[int(i * step)] for i in range(max_frames)]

        # ---- 分批打分 ----
        scores, times = [], []
        batch = 6
        for k in range(0, len(frames), batch):
            chunk = frames[k:k + batch]
            content = [{'type': 'text', 'text':
                        base_prompt + '\n下面%d帧按时间顺序（%.1f秒~%.1f秒）。'
                        '对每帧打0~10分（10=必留），只返回JSON数组如[8,3,5,...]，共%d个数。'
                        % (len(chunk), chunk[0][0], chunk[-1][0], len(chunk))}]
            for _, p in chunk:
                content.append({'type': 'image_url', 'image_url': {'url': _b64(p)}})
            resp = _chat(model, [{'role': 'user', 'content': content}])
            sc = _parse_scores(resp, len(chunk))
            scores.extend(sc)
            times.extend([t for t, _ in chunk])

        segs = _segment(scores, times, dur, top_ratio=top_ratio)
        if not segs:
            return {'ok': True, 'out': None, 'message': '无高于阈值片段', 'fps': fps, 'notes': notes}

        # ---- 剪出 ----
        if cut:
            cdir = os.path.join(tmpdir, 'cuts')
            os.makedirs(cdir, exist_ok=True)
            lst = os.path.join(cdir, 'list.txt')
            with open(lst, 'w', encoding='utf-8') as f:
                for i, (s, e, _) in enumerate(segs):
                    p = os.path.join(cdir, '%03d.mp4' % i)
                    subprocess.run(['ffmpeg', '-y', '-ss', str(s), '-to', str(e), '-i', src,
                                    '-c', 'copy', '-avoid_negative_ts', 'make_zero', p],
                                   capture_output=True)
                    f.write("file '%s'\n" % p.replace('\\', '/'))
            subprocess.run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', lst,
                            '-c', 'copy', out], capture_output=True)

        return {'ok': True, 'out': out if cut else None, 'fps': fps,
                'frames_scored': len(scores),
                'picked': [{'start': round(s, 2), 'end': round(e, 2), 'score': round(sc, 2)}
                           for s, e, sc in segs[:10]],
                'notes': notes}
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
