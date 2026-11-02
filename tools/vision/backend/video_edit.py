#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""video_edit - AI 视频剪辑工具（FFmpeg + Whisper + pySceneDetect + edge-tts）

统一入口，action 分发到 server/video/ 下的各模块：
- info     : 视频元信息（时长/分辨率/编码/音轨）
- cut      : 按时段剪切（start/end 支持 '1:23' 或秒）
- concat   : 拼接多个视频
- subtitle : Whisper 转写生成 SRT（可选直接烧录）
- analyze  : 场景检测+静音段+响度曲线（供剪辑决策）
- highlight: 响度高光合集
- desilence: 去除静音/停顿（口播粗剪）
- speed/volume/text/gif/shot/mix : 变速/音量/文字水印/GIF/截图/混BGM
- produce  : 文案成片（TTS+素材+字幕+BGM 一键出片）

路径规则：相对路径基于项目根目录；输出文件若未指定默认在源文件旁生成。
"""
import os
import sys
import json

TOOL_NAME = 'video_edit'

_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_TOOLS_DIR)))
_VIDEO_DIR = os.path.join(_PROJECT_ROOT, 'server', 'video')

if _VIDEO_DIR not in sys.path:
    sys.path.insert(0, _VIDEO_DIR)

# 懒加载模块句柄
_mods = {}


def _m(name):
    if name not in _mods:
        import importlib
        _mods[name] = importlib.import_module(name)
    return _mods[name]


def _abs(p):
    if not p:
        return p
    p = os.path.expanduser(p)
    if not os.path.isabs(p):
        p = os.path.join(_PROJECT_ROOT, p)
    return os.path.abspath(p)


def _exists(body, key):
    p = _abs(body.get(key))
    if not p or not os.path.exists(p):
        raise ValueError(f"文件不存在: {body.get(key)}")
    return p


def handle(body, ctx):
    action = (body.get('action') or 'info').strip()
    try:
        result = _dispatch(action, body)
        ctx.send_json({'ok': True, 'action': action, **result})
    except Exception as e:  # noqa: BLE001
        ctx.send_json({'ok': False, 'action': action, 'error': str(e)})


def _dispatch(action, body):
    import video_tools as vt

    if action == 'info':
        return vt.probe(_exists(body, 'file'))

    if action == 'cut':
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_cut.mp4'
        return vt.cut(src, dst, body.get('start') or 0,
                      body.get('end') if body.get('end') is not None else None,
                      copy=bool(body.get('copy', True)))

    if action == 'concat':
        paths = [_abs(p) for p in (body.get('files') or body.get('paths') or [])]
        if len(paths) < 2:
            raise ValueError('concat 需要 files 数组（>=2 个）')
        dst = _abs(body.get('out')) or os.path.splitext(paths[0])[0] + '_concat.mp4'
        return vt.concat(paths, dst, copy=bool(body.get('copy', True)))

    if action == 'subtitle':
        src = _exists(body, 'file')
        size = body.get('model') or 'small'
        lang = body.get('lang')
        if body.get('burn') or body.get('burn_sub'):
            dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_subbed.mp4'
            base = os.path.splitext(dst)[0]
            r = _m('subtitle_ai').transcribe(src, size=size, language=lang, srt_out=base + '.srt')
            vt.burn_subtitle(src, dst, r['srt'], font_size=int(body.get('font_size') or 24))
            r['output'] = dst
            return r
        srt = _abs(body.get('out')) or os.path.splitext(src)[0] + '.srt'
        r = _m('subtitle_ai').transcribe(src, size=size, language=lang, srt_out=srt)
        r['segments'] = r.get('segments', [])[:50]  # 防止超长
        return r

    if action == 'analyze':
        src = _exists(body, 'file')
        r = _m('smart_cut').analyze(src)
        if body.get('compact'):
            r.pop('loudness_per_sec', None)
        return r

    if action == 'highlight':
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_highlight.mp4'
        return _m('smart_cut').highlight(src, dst, top_n=int(body.get('top') or 3),
                                         window=float(body.get('window') or 8.0))

    if action == 'desilence':
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_nosilence.mp4'
        return _m('smart_cut').remove_silence(src, dst,
                                              noise_db=float(body.get('noise_db') or -35))

    if action == 'speed':
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_speed.mp4'
        return vt.change_speed(src, dst, factor=float(body.get('factor') or 1.5))

    if action == 'volume':
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_vol.mp4'
        return vt.set_volume(src, dst, vol=float(body.get('vol') or 1.0))

    if action == 'mix':
        src = _exists(body, 'file')
        bgm = _exists(body, 'bgm')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_bgm.mp4'
        return vt.mix_audio(src, bgm, dst, bgm_volume=float(body.get('bgm_volume') or 0.25))

    if action == 'text':
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_text.mp4'
        if not body.get('text'):
            raise ValueError('text required')
        return vt.add_text(src, dst, body['text'], x=body.get('x') or '10',
                           y=body.get('y') or '10', font_size=int(body.get('font_size') or 32),
                           color=body.get('color') or 'white')

    if action == 'gif':
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '.gif'
        return vt.to_gif(src, dst, start=body.get('start') or 0,
                         duration=float(body.get('duration') or 5),
                         width=int(body.get('width') or 480))

    if action == 'shot':
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '.jpg'
        return vt.screenshot(src, dst, at=body.get('at') or 1)

    if action == 'produce':
        # 两种脚本格式兼容：
        # a) script: [{text, clip}, ...]（数组）
        # b) text: "文案...\n..."（换行分段）+ materials: [素材列表]（可空）
        items = body.get('script')
        if not items:
            text = (body.get('text') or '').strip()
            if not text:
                raise ValueError('produce 需要 script 数组或 text 文案（换行分段）')
            lines = [l.strip() for l in text.replace('\r\n', '\n').split('\n') if l.strip()]
            materials = [_abs(c) for c in (body.get('materials') or []) if c]
            items = []
            for i, line in enumerate(lines):
                clip = materials[i] if i < len(materials) else (materials[-1] if materials else None)
                items.append({'text': line, 'clip': clip})
        elif isinstance(items, str):
            p = _abs(items)
            with open(p, encoding='utf-8') as f:
                items = json.load(f)
        if not isinstance(items, list) or not items:
            raise ValueError('produce 脚本为空')
        out = _abs(body.get('out'))
        if not out:
            raise ValueError('out required（输出 mp4 路径）')
        return _m('auto_produce').produce(
            [{'text': s.get('text', ''), 'clip': _abs(s.get('clip')) if s.get('clip') else None}
             for s in items],
            out, voice=body.get('voice') or 'zh-CN-XiaoxiaoNeural',
            bgm=_abs(body.get('bgm')) if body.get('bgm') else None,
            bgm_volume=float(body.get('bgm_volume') or 0.2),
            burn_sub=bool(body.get('burn_sub', True)),
            size=tuple(body.get('size') or (1080, 1920)),
            tts_rate=body.get('tts_rate') or '+0%')

    if action == 'transition':
        # 两段视频加转场拼接
        src = _exists(body, 'file')
        src2 = _exists(body, 'file2')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_xfade.mp4'
        return _m('fx_cut').add_transition(src, src2, dst,
                    kind=body.get('kind') or 'fade',
                    duration=float(body.get('duration') or 0.5))

    if action == 'beat_sync':
        # 卡点视频：素材列表 + BGM，按节拍自动切换
        clips = [_abs(c) for c in (body.get('clips') or []) if c]
        if not clips:
            raise ValueError('clips 列表 required')
        for c in clips:
            if not os.path.exists(c):
                raise ValueError(f'素材不存在: {c}')
        bgm = _exists(body, 'bgm')
        dst = _abs(body.get('out')) or os.path.splitext(bgm)[0] + '_beat.mp4'
        return _m('fx_cut').beat_sync(clips, bgm, dst,
                    mode=body.get('mode') or 'beats',
                    threshold=float(body.get('threshold') or 1.15),
                    max_out=float(body.get('max_out') or 60.0))

    if action == 'fade':
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_fade.mp4'
        return _m('fx_cut').fade_in_out(src, dst,
                    fin=float(body.get('fin') or 0.5), fout=float(body.get('fout') or 0.5))

    if action == 'auto_materials':
        # 素材自动搜配：给文案列表自动匹配素材库
        lines = [l.strip() for l in (body.get('texts') or body.get('text') or '').replace('\r\n', '\n').split('\n') if l.strip()]
        if not lines:
            raise ValueError('texts (多行文案) required')
        lib = _abs(body.get('lib'))
        if not lib or not os.path.isdir(lib):
            raise ValueError('lib (素材库目录) required')
        return {'ok': True, 'items': _m('material_match').auto_assign(lines, lib)}

    if action == 'visual_highlight':
        # 多模态选片：音频响度 + 视觉画面分加权融合高光
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_mm_highlight.mp4'
        return _m('visual_score').multimodal_highlight(src, dst,
                    top=int(body.get('top') or 3),
                    window=float(body.get('window') or 5.0),
                    audio_weight=float(body.get('audio_weight') or 0.6))

    if action == 'vision_pick':
        # 大模型识图选片：视觉大模型逐帧打分挑高光
        src = _exists(body, 'file')
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_visionpick.mp4'
        return _m('vision_pick').vision_pick(
            src, out=dst,
            fps=body.get('fps') if body.get('fps') not in (None, '') else 'auto',
            vision_model=body.get('vision_model'),
            prompt=body.get('prompt'),
            top_ratio=float(body.get('top_ratio') or 0.3),
            max_frames=int(body.get('max_frames') or 24),
            cut=body.get('cut', True))

    if action == 'clip_select':
        # CLIP 语义选片：本地 CLIP，文案↔画面语义匹配，自动/自定义抽帧率
        src = _exists(body, 'file')
        query = body.get('query') or body.get('prompt') or ''
        if not query:
            raise ValueError('缺少 query（查询文案，可分号分隔多条）')
        if os.path.isfile(_abs(query)):
            query = open(_abs(query), encoding='utf-8').read()
        dst = _abs(body.get('out')) or os.path.splitext(src)[0] + '_clip_select.mp4'
        return _m('clip_select').select_and_cut(
            src, query, out=dst,
            fps=body.get('fps') if body.get('fps') not in (None, '') else 'auto',
            top=int(body.get('top') or 5),
            minlen=float(body.get('minlen') or 6.0),
            max_frames=int(body.get('max_frames') or 400))

    if action == 'summary':
        # 智能分段+文案：转写+画面 → 大模型生成标题/简介/文案/分段
        src = _exists(body, 'file')
        return _m('video_summary').summarize_video(
            src,
            model=body.get('model'),
            vision_model=body.get('vision_model'),
            whisper_size=body.get('whisper_size') or 'small',
            language=body.get('language') or 'zh',
            max_frames=int(body.get('max_frames') or 16),
            use_vision=body.get('use_vision', True) not in (False, 'false', '0'))

    raise ValueError(f'未知 action: {action}，可用: info/cut/concat/subtitle/analyze/highlight/'
                     f'desilence/speed/volume/mix/text/gif/shot/produce/'
                     f'transition/beat_sync/fade/auto_materials/visual_highlight/vision_pick/clip_select/summary')
