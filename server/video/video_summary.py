# -*- coding: utf-8 -*-
"""video_summary.py — 视频智能分段 + 文案/标题/简介生成

流程：
1. Whisper 本地转写 → 带时间戳的段落
2. 抽关键帧（场景镜头中点），多帧缩略图网格发视觉大模型看内容（可选，无视觉模型则纯文本）
3. 把转写+画面描述一起交给文本大模型，输出 JSON：
   { "title": 标题, "intro": 一句话简介, "description": 详细文案/介绍,
     "tags": [标签], "chapters": [ {start, end, title, summary} 分段 ] }
4. 结果存 JSON + Markdown 文件

依赖：subtitle_ai.transcribe / vision_pick._chat / model_config
"""
import os
import re
import json
import subprocess


def _probe_dur(path):
    r = subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json',
                        '-show_format', path], capture_output=True, text=True, encoding='utf-8')
    return float(json.loads(r.stdout or '{}').get('format', {}).get('duration', 0) or 0)


def _shot_frames(src, max_frames=16, scale=448):
    """scenedetect 思路简化版：均匀抽帧做视觉概览（网格发给视觉大模型）。"""
    import cv2
    import tempfile
    dur = _probe_dur(src)
    if dur <= 0:
        return [], 0
    n = max(4, min(max_frames, int(dur // 10) or 4))
    tmp = tempfile.mkdtemp(prefix='vs_frames_')
    paths = []
    for i in range(n):
        t = (i + 0.5) * dur / n
        out = os.path.join(tmp, f'{i:03d}.jpg')
        subprocess.run(['ffmpeg', '-y', '-ss', str(t), '-i', src,
                        '-frames:v', '1', '-vf', f'scale={scale}:-2', '-q:v', '5', out],
                       capture_output=True)
        if os.path.exists(out):
            paths.append((round(t, 2), out))
    return paths, dur


def _grid_b64(frames):
    """抽出的帧拼成网格，返回 base64 data url。"""
    import cv2
    import base64
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
        return None
    rows = (len(imgs) + 3) // 4
    ch = max(i.shape[0] for i in imgs)
    canvas = np.zeros((rows * ch, 4 * 320, 3), np.uint8)
    for idx, im in enumerate(imgs):
        r, c = divmod(idx, 4)
        canvas[r * ch:r * ch + im.shape[0], c * 320:c * 320 + im.shape[1]] = im
    ok, buf = cv2.imencode('.jpg', canvas, [cv2.IMWRITE_JPEG_QUALITY, 70])
    return 'data:image/jpeg;base64,' + base64.b64encode(buf).decode() if ok else None


def _get_text_model(name=None):
    sys_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if sys_path not in __import__('sys').path:
        __import__('sys').path.insert(0, sys_path)
    import model_config as mc
    cfg = mc.load_models_config(include_key=True)
    items = cfg.get('models') or cfg.get('list') or []
    if name:
        for m in items:
            if m.get('name') == name:
                return m
    for m in items:
        if m.get('key'):
            return m
    raise RuntimeError('model_config 中没有可用的文本大模型（缺少 key）')


def _transcript_text(src, size='small', language='zh'):
    sys_path = os.path.dirname(os.path.abspath(__file__))
    if sys_path not in __import__('sys').path:
        __import__('sys').path.insert(0, sys_path)
    import subtitle_ai
    r = subtitle_ai.transcribe(src, size=size, language=language)
    lines = [f"[{s['start']:.0f}-{s['end']:.0f}s] {s['text']}" for s in r['segments']]
    return '\n'.join(lines), r


def summarize_video(src, out_json=None, out_md=None, model=None, vision_model=None,
                    whisper_size='small', language='zh', max_frames=16, use_vision=True):
    """主入口：视频 → 分段 → 标题/简介/文案。返回 dict 并落盘。"""
    if out_json is None:
        out_json = os.path.splitext(src)[0] + '_summary.json'
    if out_md is None:
        out_md = os.path.splitext(src)[0] + '_summary.md'

    # 1. 转写
    transcript, tr = _transcript_text(src, size=whisper_size, language=language)
    if not transcript:
        transcript = '（无语音内容）'

    # 2. 画面概览（可选）
    visual_note = ''
    grid = None
    if use_vision and vision_model != 'none':
        try:
            import vision_pick as vp
            frames, dur = _shot_frames(src, max_frames=max_frames)
            if frames:
                grid = _grid_b64(frames)
                vm = vp._get_vision_model(vision_model)
                if grid and vm.get('key'):
                    content = [{'type': 'text', 'text': '这是一个视频按时间均匀抽出的帧网格，请用两三句话概括视频画面内容与风格。'},
                               {'type': 'image_url', 'image_url': {'url': grid}}]
                    visual_note = vp._chat(vm, [{'role': 'user', 'content': content}], timeout=120)
        except Exception as e:
            visual_note = f'（视觉分析不可用: {e}）'

    # 3. 文本大模型生成
    tm = _get_text_model(model)
    sys_prompt = (
        '你是短视频编导。根据视频的语音转写（带时间戳）和画面描述，输出严格的 JSON，字段：\n'
        '{"title":"吸睛标题(20字内)","intro":"一句话简介(50字内)","description":"完整文案/介绍(200-400字)",'
        '"tags":["标签x5"],"chapters":[{"start":秒,"end":秒,"title":"段落标题","summary":"段落摘要(40字内)"}]}\n'
        'chapters 按 3~8 个有意义的叙事段落划分，start/end 用转写中的时间戳。只输出 JSON。'
    )
    user_prompt = f'【语音转写】\n{transcript}\n\n【画面描述】\n{visual_note or "（无）"}'
    messages = [{'role': 'system', 'content': sys_prompt}, {'role': 'user', 'content': user_prompt}]
    reply = _chat(tm, messages, timeout=180)

    # 4. 解析 JSON（兜底提取）
    data = None
    m = re.search(r'\{[\s\S]*\}', reply)
    if m:
        try:
            data = json.loads(m.group(0))
        except Exception:
            try:
                data = json.loads(m.group(0).replace('\n', ''))
            except Exception:
                data = None
    if data is None:
        data = {'title': '', 'intro': '', 'description': reply, 'tags': [], 'chapters': []}

    result = {'file': src, 'duration': tr.get('count') and None or _probe_dur(src),
              'transcript_segments': tr['count'],
              'visual_note': visual_note,
              'title': data.get('title', ''), 'intro': data.get('intro', ''),
              'description': data.get('description', ''), 'tags': data.get('tags', []),
              'chapters': data.get('chapters', []), 'summary_json': out_json, 'summary_md': out_md}

    def _fmt(sec):
        try:
            sec = float(sec)
            return f'{int(sec // 60):02d}:{int(sec % 60):02d}'
        except Exception:
            return str(sec)

    # 5. 落盘
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    md = [f'# {result["title"]}', '', f'> {result["intro"]}', '', result['description'], '', '## 分段', '']
    for ch in result['chapters']:
        md.append(f"- **{_fmt(ch.get('start'))} - {_fmt(ch.get('end'))} {ch.get('title','')}**：{ch.get('summary','')}")
    if result['tags']:
        md += ['', '## 标签', '', ' '.join(f'#{t}' for t in result['tags'])]
    with open(out_md, 'w', encoding='utf-8') as f:
        f.write('\n'.join(md))
    return result


def _chat(model, messages, timeout=120):
    """OpenAI 兼容 chat 调用（复用 vision_pick 的实现思路）。"""
    import requests
    m = model
    key = m.get('key') or m.get('apiKey') or ''
    base = (m.get('baseUrl') or m.get('baseURL') or m.get('apiUrl') or '').rstrip('/')
    if base.endswith('/chat/completions'):
        base = base[:-len('/chat/completions')]
    r = requests.post(base + '/chat/completions',
                      json={'model': m.get('modelId'), 'messages': messages,
                            'temperature': 0.4, 'max_tokens': 2000},
                      headers={'Authorization': 'Bearer ' + key}, timeout=timeout)
    r.raise_for_status()
    return r.json()['choices'][0]['message']['content']


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('file')
    ap.add_argument('--model', default=None)
    ap.add_argument('--vision-model', default=None)
    ap.add_argument('--no-vision', action='store_true')
    ap.add_argument('--whisper', default='small')
    a = ap.parse_args()
    r = summarize_video(a.file, model=a.model, vision_model=None if a.no_vision else a.vision_model,
                        whisper_size=a.whisper)
    print(json.dumps({k: v for k, v in r.items() if k not in ('chapters',)}, ensure_ascii=False, indent=2))
    for ch in r.get('chapters', []):
        print(f"[{ch.get('start')}-{ch.get('end')}] {ch.get('title')}: {ch.get('summary')}")
