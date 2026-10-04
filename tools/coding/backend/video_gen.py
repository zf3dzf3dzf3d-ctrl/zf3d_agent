#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""video_gen - 生产级视频生成（零API费默认管线：文生图关键帧 → ffmpeg 合成 mp4）
用法: {"action":"generate","prompt":"...","scenes":3,"duration_per_scene":3,"size":"1280x720"}
预留: private/api_keys.json 含 jimeng/kling key 时走真视频模型（占位实现）。
"""
import os
import json
import time
import subprocess
import urllib.request

TOOL_NAME = 'video_gen'

_FFMPEG_CANDIDATES = [r'C:\ffmpeg\bin\ffmpeg.exe', 'ffmpeg']
_OUTPUT_DIR = os.path.join('public', 'outputs', 'video')


def _ffmpeg():
    for f in _FFMPEG_CANDIDATES:
        try:
            subprocess.run([f, '-version'], capture_output=True, timeout=10)
            return f
        except Exception:
            continue
    return None


def _gen_keyframe(prompt, idx, size):
    """调已有 image_gen 产关键帧图，返回本地路径"""
    sys_path = '.'
    import sys
    if sys_path not in sys.path:
        sys.path.insert(0, sys_path)
    from tools import get_handler
    from tools.coding.backend.base import ToolContext

    class _Cap(ToolContext):
        def __init__(self, *a, **k):
            self._out = {}
        def send_json(self, obj, *a, **kw):
            self._out = obj or {}
        def send_text(self, *a, **kw):
            pass
        def send_event(self, *a, **kw):
            pass

    mod = get_handler('image_gen')
    cap = _Cap()
    mod.handle({'action': 'generate', 'prompt': prompt, 'size': size}, cap)
    d = cap._out.get('data') or {}
    url = d.get('url') or ''
    if not url:
        raise RuntimeError('关键帧生成失败: %s' % (d.get('error') or cap._out.get('error')))
    # url 形如 /outputs/image/xxx.png -> public/outputs/image/xxx.png
    local = os.path.join('public', url.lstrip('/').replace('/', os.sep))
    if not os.path.exists(local):
        # 可能是外链，下载
        local = os.path.join('public', 'outputs', 'video', 'kf_%d_%s.png' % (idx, time.strftime('%H%M%S')))
        os.makedirs(os.path.dirname(local), exist_ok=True)
        urllib.request.urlretrieve(url, local)
    return local


def _compose(frames, out_path, per_scene=3.0, size='1280x720'):
    ff = _ffmpeg()
    if not ff:
        raise RuntimeError('未找到 ffmpeg（检查 C:\\ffmpeg\\bin\\ffmpeg.exe）')
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    # Ken Burns 缩放 + 交叉淡化，简单可靠：逐帧 zoompan 后 concat
    cmd = [ff, '-y']
    for f in frames:
        cmd += ['-loop', '1', '-t', str(per_scene), '-i', f]
    n = len(frames)
    if n == 1:
        cmd += ['-vf', 'scale=%s,format=yuv420p' % size.replace('x', ':'),
                '-t', str(per_scene)]
    else:
        fc = []
        for i in range(n):
            fc.append('[%d:v]scale=%s:force_original_aspect_ratio=increase,crop=%s,zoompan=z=\
\'min(zoom+0.0015,1.15)\':d=%d:s=%s,format=yuv420p[v%d]'
                      % (i, size.replace('x', ':'), size.replace('x', ':'),
                         int(per_scene * 25), size.replace(':', 'x'), i))
        # xfade 链
        cur = 'v0'
        dur = per_scene
        for i in range(1, n):
            out = 'x%d' % i
            fc.append('[%s][v%d]xfade=transition=fade:duration=0.5:offset=%.2f[%s]'
                      % (cur, i, dur - 0.5, out))
            cur = out
            dur += per_scene - 0.5
        cmd += ['-filter_complex', ';'.join(fc), '-map', '[%s]' % cur]
    cmd += ['-c:v', 'libx264', '-preset', 'fast', '-crf', '23', out_path]
    subprocess.run(cmd, check=True, capture_output=True, timeout=600)
    return out_path


def _video_provider_key():
    """检测可用的付费视频模型 key（jimeng/kling），返回 (provider, key) or None"""
    try:
        with open(os.path.join('private', 'api_keys.json'), encoding='utf-8') as f:
            keys = (json.load(f) or {}).get('keys', {}) or {}
    except Exception:
        return None
    for name in ('jimeng', '火山即梦', 'kling', '可灵'):
        for k, v in keys.items():
            if name.lower() in k.lower() and v:
                return (k, v)
    return None


def handle(body, ctx):
    action = (body or {}).get('action', 'generate')
    if action == 'status':
        ff = _ffmpeg()
        ctx.send_json({'ok': True, 'data': {'tool': 'video_gen', 'ffmpeg': ff,
                                            'ready': bool(ff),
                                            'provider_key': bool(_video_provider_key())}})
        return
    prompt = (body or {}).get('prompt', '').strip()
    if not prompt:
        ctx.send_json({'ok': False, 'data': {'error': 'prompt 不能为空'}})
        return
    scenes = int(body.get('scenes') or 3)
    scenes = max(1, min(scenes, 6))
    per = float(body.get('duration_per_scene') or 3.0)
    size = body.get('size') or '1280x720'
    try:
        pv = _video_provider_key()
        if pv:
            # 预留：接入火山即梦/可灵等真视频模型，当前回退免费管线
            pass
        frames = []
        for i in range(scenes):
            scene_prompt = prompt if scenes == 1 else '%s, 镜头%d视角, 同一风格连贯场景' % (prompt, i + 1)
            frames.append(_gen_keyframe(scene_prompt, i, size))
        out = os.path.join(_OUTPUT_DIR, 'video_%s_%s.mp4' % (
            time.strftime('%Y%m%d_%H%M%S'), os.urandom(3).hex()))
        _compose(frames, out, per, size)
        url = '/outputs/video/' + os.path.basename(out)
        ctx.send_json({'ok': True, 'data': {
            'tool': 'video_gen', 'url': url, 'file': os.path.basename(out),
            'duration': round(per * scenes - 0.5 * (scenes - 1), 1),
            'scenes': scenes, 'provider': 'free-pipeline(文生图+ffmpeg)',
            'bytes': os.path.getsize(out)}})
    except Exception as e:
        ctx.send_json({'ok': False, 'data': {'error': '视频生成失败: %s' % e}})


if __name__ == '__main__':
    class _T:
        def send_json(self, o, *a, **k):
            print(json.dumps(o, ensure_ascii=False, indent=2))
    handle({'action': 'generate', 'prompt': '赛博朋克城市夜景，霓虹灯，电影感', 'scenes': 2,
            'duration_per_scene': 2.5}, _T())
