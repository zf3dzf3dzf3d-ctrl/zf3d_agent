# -*- coding: utf-8 -*-
"""
director_ai.py — AI 导演台核心引擎
一句话 → 剧本分镜（LLM）→ 逐镜文生视频（video_gen_engine）→ 转场拼装成片（fx_cut）

数据落盘：<root>/private/workspace/director/<项目名>/
  storyboard.json  分镜脚本（LLM 产出 + 可人工修改后重拍）
  shots/shot_001.mp4 ... 逐镜视频
  final.mp4        成片

可被复用的上游模块：
  - model_config.get_default_model()  走「设置-大模型」用户选的默认模型（无需 key 参数）
  - tools/video_gen_engine.generate_video()  文生视频（智谱CogVideoX-3/火山seedance/硅基Wan 自动切换）
  - server/video/fx_cut.py  16 种 xfade 转场 + 拼接
"""
import os
import re
import sys
import json
import time
import shutil
import urllib.request

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(os.path.dirname(_HERE))  # server/routes -> server -> root
for p in (os.path.join(_ROOT, 'server'), os.path.join(_ROOT, 'tools'),
          os.path.join(_ROOT, 'server', 'video')):
    if p not in sys.path:
        sys.path.insert(0, p)

import model_config  # noqa: E402

WORK_DIR = os.path.join(_ROOT, 'private', 'workspace', 'director')

# ===================== 工具函数 =====================

def _safe_name(name):
    """项目名只留安全字符。"""
    name = re.sub(r'[\\/:*?"<>|\s]+', '_', str(name or '')).strip('._')
    return name[:40] or 'project'


def _project_dir(name):
    d = os.path.join(WORK_DIR, _safe_name(name))
    os.makedirs(os.path.join(d, 'shots'), exist_ok=True)
    return d


def _now():
    return time.strftime('%Y-%m-%d %H:%M:%S')


# ===================== LLM：走设置里的默认大模型 =====================

def _llm_chat(system, user, temperature=0.8, timeout=120):
    """用「设置-大模型配置」中 isDefault 的模型生成分镜。OpenAI 兼容协议。
    返回 (文本, 模型显示名)；失败抛异常。"""
    m = model_config.get_default_model()
    if not m:
        raise RuntimeError('设置里还没有配置任何大模型，请先到「设置 → 大模型配置」添加')
    key = m.get('key') or ''
    if not key:
        raise RuntimeError('默认大模型「%s」没有配置 API Key，请到设置里填写' % m.get('name'))
    endpoint = (m.get('endpoint') or m.get('baseUrl') or '').strip()
    if not endpoint:
        raise RuntimeError('默认大模型「%s」缺少接口地址' % m.get('name'))
    model_id = m.get('modelId') or m.get('id') or ''
    payload = {
        'model': model_id,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ],
        'temperature': temperature,
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json',
                 'Authorization': 'Bearer ' + key})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode('utf-8'))
    text = (((data.get('choices') or [{}])[0].get('message') or {}).get('content') or '').strip()
    if not text:
        raise RuntimeError('模型返回空内容')
    display = '%s(%s)' % (m.get('name'), model_id)
    return text, display


_DIRECTOR_SYSTEM = (
    '你是顶级短片导演兼分镜师。用户给你一句话创意，你产出中文分镜脚本 JSON。'
    '要求：分镜之间有清晰叙事或情绪递进；每个分镜的 prompt 是可直接喂给文生视频模型的'
    '英文画面描述（含主体/动作/场景/光线/镜头运动/风格词），具体、可视化、不出现对话与文字；'
    '相邻分镜保持同一画风与连贯主体。只输出 JSON，不要输出任何其他文字。'
)

_DIRECTOR_USER_TMPL = '''创意：{idea}

要求：
- 分成 {count} 个分镜
- 每个 video_prompt 40~80 个英文单词，电影感描述
- 每镜时长 {duration} 秒
- 只输出如下格式的 JSON：
{{"title": "短片标题(中文,10字内)", "shots": [{{"id": 1, "name": "分镜名(中文4字内)", "desc": "中文画面描述(30字内)", "video_prompt": "English cinematic video prompt", "duration": {duration}, "transition": "fade"}}]}}
- transition 从这些里选：fade wipeleft wideright wipeup wipedown slideleft slideright slideup circleopen circleclose dissolve pixelize radial smoothup (不写或写 none 表示硬切)
'''


def _extract_json(text):
    """从模型输出中抠出 JSON（容忍 ```json 包裹 / 前后废话）。"""
    text = text.strip()
    m = re.search(r'```(?:json)?\s*(.+?)\s*```', text, re.S)
    if m:
        text = m.group(1)
    start = text.find('{')
    end = text.rfind('}')
    if start >= 0 and end > start:
        text = text[start:end + 1]
    return json.loads(text)


def gen_storyboard(idea, count=4, duration=5, model=''):
    """一句话 → 分镜 JSON。model 仅用于提示，实际走设置默认模型。"""
    idea = str(idea or '').strip()
    if not idea:
        return {'ok': False, 'error': '请先输入一句话创意'}
    count = max(1, min(int(count or 4), 12))
    duration = max(3, min(int(duration or 5), 10))
    user = _DIRECTOR_USER_TMPL.format(idea=idea, count=count, duration=duration)
    text, used = _llm_chat(_DIRECTOR_SYSTEM, user)
    data = _extract_json(text)
    shots = data.get('shots') or []
    if not shots:
        return {'ok': False, 'error': '模型未产出分镜，原始返回：' + text[:300]}
    # 规整字段
    for i, s in enumerate(shots, 1):
        s.setdefault('id', i)
        s['id'] = i
        s.setdefault('name', '镜头%d' % i)
        s.setdefault('desc', '')
        s.setdefault('video_prompt', '')
        s['duration'] = max(3, min(int(s.get('duration') or duration), 10))
        tr = str(s.get('transition') or 'none').strip().lower()
        s['transition'] = tr if tr in ('none', 'fade', 'wipeleft', 'wiperight', 'wipeup',
                                       'wipedown', 'slideleft', 'slideright', 'slideup',
                                       'circieopen', 'circleopen', 'circleclose', 'dissolve',
                                       'pixelize', 'radial', 'smoothup') else 'none'
    return {'ok': True, 'title': str(data.get('title') or '未命名短片')[:20],
            'idea': idea, 'shots': shots, 'llm': used,
            'created_at': _now()}


def save_storyboard(name, storyboard):
    """保存（或人工修改后另存）分镜脚本。"""
    d = _project_dir(name)
    sb = dict(storyboard or {})
    sb['updated_at'] = _now()
    with open(os.path.join(d, 'storyboard.json'), 'w', encoding='utf-8') as f:
        json.dump(sb, f, ensure_ascii=False, indent=2)
    return {'ok': True, 'dir': d, 'shots': len(sb.get('shots') or [])}


def load_storyboard(name):
    d = _project_dir(name)
    p = os.path.join(d, 'storyboard.json')
    if not os.path.isfile(p):
        return {'ok': False, 'error': '项目「%s」还没有分镜脚本，先生成分镜' % name}
    with open(p, encoding='utf-8-sig') as f:
        sb = json.load(f)
    return {'ok': True, 'storyboard': sb, 'dir': d}


def list_projects():
    """列出所有导演台项目（含进度）。"""
    out = []
    if os.path.isdir(WORK_DIR):
        for n in sorted(os.listdir(WORK_DIR)):
            d = os.path.join(WORK_DIR, n)
            if not os.path.isdir(d):
                continue
            item = {'name': n, 'dir': d}
            sb_p = os.path.join(d, 'storyboard.json')
            if os.path.isfile(sb_p):
                try:
                    with open(sb_p, encoding='utf-8-sig') as f:
                        sb = json.load(f)
                    item['title'] = sb.get('title', '')
                    shots = sb.get('shots') or []
                    item['shots_total'] = len(shots)
                    done = 0
                    for i in range(1, len(shots) + 1):
                        if os.path.isfile(os.path.join(d, 'shots', 'shot_%03d.mp4' % i)):
                            done += 1
                    item['shots_done'] = done
                    item['has_final'] = os.path.isfile(os.path.join(d, 'final.mp4'))
                except Exception:
                    pass
            out.append(item)
    return {'ok': True, 'projects': out}


# ===================== 逐镜生成 =====================

def generate_shots(name, only_ids=None, size='832x480', key=''):
    """按分镜逐镜文生视频。已存在的镜头自动跳过（断点续拍）。
    only_ids: [1,3] 只重拍指定镜头。"""
    ld = load_storyboard(name)
    if not ld.get('ok'):
        return ld
    sb = ld['storyboard']
    d = ld['dir']
    sys.path.insert(0, os.path.join(_ROOT, 'tools'))
    import video_gen_engine as vgen
    shots = sb.get('shots') or []
    only = set(int(i) for i in (only_ids or []))
    results, errors = [], []
    for s in shots:
        sid = int(s.get('id', 0)) or (results.__len__() + 1)
        if only and sid not in only:
            continue
        out = os.path.join(d, 'shots', 'shot_%03d.mp4' % sid)
        if os.path.isfile(out) and os.path.getsize(out) > 10240 and not only:
            results.append({'id': sid, 'path': out, 'status': 'cached'})
            continue
        prompt = (s.get('video_prompt') or s.get('desc') or '').strip()
        if not prompt:
            errors.append({'id': sid, 'error': '分镜缺少 video_prompt'})
            continue
        r = vgen.generate_video(prompt, duration=int(s.get('duration', 5)),
                                size=size, key=key)
        if r.get('ok') and r.get('url'):
            # 统一落到 shots/shot_00N.mp4（远程 CDN 地址则下载，本地路径则复制）
            src = r['url']
            try:
                if re.match(r'^https?://', src, re.I):
                    req = urllib.request.Request(src, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=120) as resp, \
                            open(out, 'wb') as f:
                        shutil.copyfileobj(resp, f)
                elif os.path.abspath(src) != os.path.abspath(out):
                    shutil.copyfile(src, out)
            except Exception as e:
                errors.append({'id': sid, 'error': '落盘失败: %s' % e,
                               'remote': src})
                continue
            results.append({'id': sid, 'path': out, 'status': 'generated',
                            'provider': r.get('provider'), 'model': r.get('model')})
        else:
            errors.append({'id': sid, 'error': r.get('error', '生成失败'),
                           'provider': r.get('provider')})
    return {'ok': len(errors) == 0, 'generated': results, 'errors': errors,
            'dir': d,
            'summary': '完成 %d 镜，失败 %d 镜' % (len(results), len(errors))}


# ===================== 拼装成片 =====================

def assemble(name, kind='fade', dur=0.8, out=''):
    """把已生成的镜头按顺序转场拼装成片。"""
    ld = load_storyboard(name)
    if not ld.get('ok'):
        return ld
    sb = ld['storyboard']
    d = ld['dir']
    paths = []
    for s in sorted((sb.get('shots') or []), key=lambda x: int(x.get('id', 0))):
        p = os.path.join(d, 'shots', 'shot_%03d.mp4' % int(s.get('id', 0)))
        if os.path.isfile(p):
            paths.append(p)
    if len(paths) < 1:
        return {'ok': False, 'error': '还没有任何镜头视频，请先生成'}
    if len(paths) == 1:
        dst = out or os.path.join(d, 'final.mp4')
        shutil.copyfile(paths[0], dst)
        return {'ok': True, 'output': dst, 'shots': 1, 'note': '单镜直接成片'}

    sys.path.insert(0, os.path.join(_ROOT, 'server', 'video'))
    import video_tools as vt
    if kind == 'none':
        dst = out or os.path.join(d, 'final.mp4')
        r = vt.concat(paths, dst)
        return {'ok': True, 'output': r.get('out', dst), 'shots': len(paths)}

    # 按 storyboard 里每镜 transition 串联转场（fx_cut.add_transition 两两相接）
    import fx_cut
    valid_tr = set(fx_cut.TRANSITIONS) | {'none'}
    cur = paths[0]
    for i in range(1, len(paths)):
        tr = 'fade'
        try:
            tr = str((sb.get('shots') or [])[i].get('transition') or 'fade').lower()
        except Exception:
            pass
        if tr not in valid_tr or tr == 'none':
            tr = 'fade'
        tmp_out = os.path.join(d, 'shots', '_chain_%02d.mp4' % i)
        r = fx_cut.add_transition(cur, paths[i], out=tmp_out, kind=tr, duration=dur)
        if isinstance(r, dict) and r.get('out'):
            cur = r['out']
        else:
            # 转场失败兜底：硬拼
            vt.concat([cur, paths[i]], tmp_out)
            cur = tmp_out
    dst = out or os.path.join(d, 'final.mp4')
    if os.path.abspath(cur) != os.path.abspath(dst):
        shutil.copyfile(cur, dst)
    return {'ok': True, 'output': dst, 'shots': len(paths), 'transition': kind}


# ===================== 一句话全流程 =====================

def full_produce(idea, name='', count=4, duration=5, size='832x480',
                 kind='fade', key=''):
    """一句话 → 分镜 → 逐镜生成 → 成片，全自动。"""
    t0 = time.time()
    name = _safe_name(name or (' film_' + time.strftime('%m%d_%H%M%S')))
    if not idea:
        return {'ok': False, 'error': '请输入一句话创意'}
    # 1. 分镜
    sb = gen_storyboard(idea, count=count, duration=duration)
    if not sb.get('ok'):
        return sb
    save_storyboard(name, sb)
    # 2. 逐镜
    gs = generate_shots(name, size=size, key=key)
    # 3. 成片（有镜头就拼，哪怕部分失败）
    asm = {'ok': False}
    if gs.get('generated'):
        asm = assemble(name, kind=kind)
    return {'ok': asm.get('ok', False), 'name': name,
            'storyboard': {'title': sb.get('title'), 'shots': sb.get('shots'),
                           'llm': sb.get('llm')},
            'generate': {'summary': gs.get('summary'), 'errors': gs.get('errors')},
            'output': (asm or {}).get('output'),
            'elapsed': round(time.time() - t0, 1),
            'dir': _project_dir(name)}


# ===================== HTTP 入口 =====================

def handle(body, ctx=None):
    """路由分发：/api/video-director {action:...}"""
    action = str((body or {}).get('action') or '').strip()
    try:
        if action == 'storyboard':
            return gen_storyboard(body.get('idea', ''), body.get('count', 4),
                                  body.get('duration', 5))
        if action == 'save':
            return save_storyboard(body.get('name', ''), body.get('storyboard'))
        if action == 'load':
            return load_storyboard(body.get('name', ''))
        if action == 'list':
            return list_projects()
        if action == 'generate':
            return generate_shots(body.get('name', ''), body.get('ids'),
                                  body.get('size', '832x480'), body.get('key', ''))
        if action == 'assemble':
            return assemble(body.get('name', ''), body.get('kind', 'fade'),
                            body.get('dur', 0.8), body.get('out', ''))
        if action == 'full':
            return full_produce(body.get('idea', ''), body.get('name', ''),
                                body.get('count', 4), body.get('duration', 5),
                                body.get('size', '832x480'),
                                body.get('kind', 'fade'), body.get('key', ''))
        if action == 'status':
            sys.path.insert(0, os.path.join(_ROOT, 'tools'))
            import video_gen_engine as vgen
            llm = model_config.get_default_model() or {}
            return {'ok': True,
                    'llm': {'name': llm.get('name'), 'modelId': llm.get('modelId'),
                            'has_key': bool(llm.get('key'))},
                    'video': vgen.video_status()}
        return {'ok': False, 'error': '未知 action: %s' % (action or '(空)')}
    except Exception as e:
        return {'ok': False, 'error': str(e)}
