#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
video_gen_engine - AI 文生视频真实引擎（2026-08 修复）
====================================================
此前 /api/video-gen 与 video_gen 工具都 `import video_gen`（项目内不存在该模块），
导致视频生成永远报"模块不可用"。本模块是真实实现。

渠道（自动按可用性切换，实测结果）：
  1. zhipu   - 智谱 CogVideoX-3（异步任务提交 + 轮询，实测 SUCCESS 拿到 mp4）✅
  2. ark     - 火山方舟 seedance（仅标准 API key 可用；plan key 不支持视频模型，会明确报错）
  3. siliconflow - Wan 系（需有效 SF key）

公共接口：
  generate_video(prompt, duration=5, size='832x480', model='', key='', negative_prompt='', seed=None)
      -> {'ok': True, 'url': mp4地址, 'provider': 渠道名, 'model': 模型id, 'duration': 时长}
      或 {'ok': False, 'error': 原因, 'provider': 尝试过的渠道}
  video_status() -> {'ok': True, 'channels': [...]} 各渠道可用状态
"""

import os
import re
import sys
import json
import time
import urllib.request
import urllib.error

TOOL_NAME = 'video_gen'

# ===================== 配置读取 =====================

def _project_root():
    """tool/video_gen_engine.py -> 项目根 = tool/ 的上一级"""
    here = os.path.dirname(os.path.abspath(__file__))      # .../tool
    root = os.path.dirname(here)                            # 项目根
    if not os.path.isdir(os.path.join(root, 'private')):
        # 兜底：从当前工作目录找
        for cand in (os.getcwd(), os.path.dirname(os.getcwd())):
            if os.path.isfile(os.path.join(cand, 'private', 'api_keys.json')):
                return cand
    return root


def _load_keys():
    """private/api_keys.json -> {名称: key}"""
    result = {}
    root = _project_root()
    for rel in ('private/api_keys.json', '../private/api_keys.json'):
        p = os.path.join(root, rel) if not rel.startswith('..') else os.path.normpath(os.path.join(root, rel))
        try:
            with open(p, encoding='utf-8') as f:
                result = (json.load(f) or {}).get('keys', {}) or {}
            break
        except Exception:
            continue
    return result


def _video_models():
    """从 models.json 中筛出可当视频生成渠道的配置。
    智谱系 -> cogvideox；硅基流动 -> Wan 系。返回 [(provider, endpoint, key, model)]"""
    out = []
    keys = _load_keys()
    root = _project_root()
    cfg = None
    for name in ('models.json',):
        for base in ('private', '.'):
            p = os.path.join(root, base, name)
            try:
                with open(p, encoding='utf-8') as f:
                    cfg = json.load(f)
                break
            except Exception:
                continue
        if cfg:
            break
    # models.json 不存在时走固定默认（智谱）
    def _key(*names):
        for n in names:
            k = keys.get(n, '')
            if k:
                return k
        return ''
    _ = sys  # noqa
    if cfg:
        raw = cfg.get('list', []) if isinstance(cfg, dict) else (cfg or [])
        for m in raw:
            if not isinstance(m, dict):
                continue
            ep = str(m.get('endpoint') or m.get('baseUrl') or '')
            mid = str(m.get('modelId') or m.get('id') or '')
            key = m.get('apiKey') or m.get('key') or keys.get(m.get('name', '')) or keys.get(mid) or ''
            if not ep or not mid or '/images/' in ep:
                continue
            if 'bigmodel.cn' in ep or 'zhipu' in mid.lower():
                out.append({'provider': 'zhipu', 'endpoint': 'https://open.bigmodel.cn/api/paas/v4',
                            'key': key, 'model': 'cogvideox-3'})
            elif 'siliconflow' in ep:
                out.append({'provider': 'siliconflow', 'endpoint': 'https://api.siliconflow.cn/v1',
                            'key': key, 'model': 'Wan2.1-T2V-14B'})
    if not any(v['provider'] == 'zhipu' for v in out):
        zk = _key('智谱 GLM', '智谱', 'zhipu')
        if zk:
            out.insert(0, {'provider': 'zhipu', 'endpoint': 'https://open.bigmodel.cn/api/paas/v4',
                           'key': zk, 'model': 'cogvideox-3'})
    sk = _key('硅基流动', 'siliconflow')
    if sk and not any(v['provider'] == 'siliconflow' for v in out):
        out.append({'provider': 'siliconflow', 'endpoint': 'https://api.siliconflow.cn/v1',
                    'key': sk, 'model': 'Wan2.1-T2V-14B'})
    ak = _key('火山方舟API', '火山方舟')
    if ak and not any(v['provider'] == 'ark' for v in out):
        out.append({'provider': 'ark', 'endpoint': 'https://ark.cn-beijing.volces.com/api/v3',
                    'key': ak, 'model': 'doubao-seedance-1-0-lite-t2v-250428'})
    return [v for v in out if v['key']]


# ===================== 智谱 CogVideoX =====================

def _zhipu_generate(cfg, prompt, duration, size, quality='quality',
                    negative_prompt='', seed=None, wait=True, timeout=300, fps=30):
    """智谱 CogVideoX：POST videos/generations 提交 -> 轮询 async-result/<id>"""
    ep = cfg['endpoint'].rstrip('/')
    headers = {'Authorization': 'Bearer ' + cfg['key'], 'Content-Type': 'application/json'}
    payload = {'model': cfg['model'], 'prompt': prompt,
               'quality': quality, 'with_audio': False}
    if size:
        payload['size'] = size if size in ('576x1024', '1024x576') else (
            '576x1024' if size.endswith('832x480') or size.endswith('480x832')
            else ('1024x576' if int(size.split('x')[0]) >= int(size.split('x')[1]) else '576x1024'))
    if duration:
        payload['fps'] = max(4, min(60, int(fps or 30)))
    try:
        req = urllib.request.Request(ep + '/videos/generations',
                                     data=json.dumps(payload).encode(), headers=headers)
        r = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'ignore')[:400]
        return {'ok': False, 'error': '智谱提交失败 HTTP %s: %s' % (e.code, detail), 'provider': 'zhipu'}
    except Exception as e:
        return {'ok': False, 'error': '智谱请求失败: %s' % e, 'provider': 'zhipu'}
    task_id = r.get('id') or r.get('request_id')
    if not task_id:
        return {'ok': False, 'error': '智谱未返回任务ID: ' + json.dumps(r, ensure_ascii=False)[:200],
                'provider': 'zhipu'}
    if not wait:
        return {'ok': True, 'pending': True, 'task_id': task_id, 'provider': 'zhipu',
                'model': cfg['model']}
    # 轮询（智谱一般 60~150 秒出片）
    deadline = time.time() + timeout
    url_ep = ep + '/async-result/' + task_id
    while time.time() < deadline:
        time.sleep(5)
        try:
            req = urllib.request.Request(url_ep, headers={'Authorization': 'Bearer ' + cfg['key']})
            rr = json.load(urllib.request.urlopen(req, timeout=20))
        except Exception as e:
            continue
        st = rr.get('task_status')
        if st == 'SUCCESS':
            vids = rr.get('video_result') or []
            url = (vids[0].get('url') if vids else '') or ''
            cover = (vids[0].get('cover_image_url') if vids else '') or ''
            if not url:
                return {'ok': False, 'error': '智谱成功但无视频URL', 'provider': 'zhipu'}
            return {'ok': True, 'url': url, 'cover': cover, 'provider': 'zhipu',
                    'model': rr.get('model', cfg['model']), 'task_id': task_id}
        if st == 'FAIL':
            return {'ok': False, 'error': '智谱生成失败(task FAIL)', 'provider': 'zhipu'}
    return {'ok': False, 'error': '等待超时(%ss)，任务ID: %s' % (timeout, task_id), 'provider': 'zhipu',
            'task_id': task_id}


# ===================== 硅基流动 Wan =====================

def _sf_generate(cfg, prompt, duration, size, wait=True, timeout=600, fps=30):
    ep = cfg['endpoint'].rstrip('/')
    headers = {'Authorization': 'Bearer ' + cfg['key'], 'Content-Type': 'application/json'}
    w, h = (size.split('x') + ['480'])[:2] if size and 'x' in size else ('832', '480')
    payload = {'model': cfg['model'], 'prompt': prompt, 'size': '%sx%s' % (w, h)}
    if fps:
        payload['fps'] = max(4, min(60, int(fps)))
    try:
        req = urllib.request.Request(ep + '/video/submit',
                                     data=json.dumps(payload).encode(), headers=headers)
        r = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        return {'ok': False, 'error': '硅基流动提交失败 HTTP %s: %s' % (e.code, e.read().decode('utf-8', 'ignore')[:300]),
                'provider': 'siliconflow'}
    except Exception as e:
        return {'ok': False, 'error': '硅基流动请求失败: %s' % e, 'provider': 'siliconflow'}
    rid = r.get('requestId')
    if not rid:
        return {'ok': False, 'error': '硅基流动未返回 requestId', 'provider': 'siliconflow'}
    if not wait:
        return {'ok': True, 'pending': True, 'task_id': rid, 'provider': 'siliconflow'}
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(6)
        try:
            req = urllib.request.Request(ep + '/video/status?requestId=' + rid, headers=headers)
            rr = json.load(urllib.request.urlopen(req, timeout=20))
        except Exception:
            continue
        st = rr.get('status')
        if st == 'Succeed':
            url = (rr.get('results') or {}).get('videos', [{}])[0].get('url', '')
            if url:
                return {'ok': True, 'url': url, 'provider': 'siliconflow', 'model': cfg['model'], 'task_id': rid}
            return {'ok': False, 'error': '硅基流动成功但无URL', 'provider': 'siliconflow'}
        if st == 'Failed':
            return {'ok': False, 'error': '硅基流动生成失败', 'provider': 'siliconflow'}
    return {'ok': False, 'error': '等待超时(%ss)' % timeout, 'provider': 'siliconflow', 'task_id': rid}


# ===================== 火山方舟 Seedance =====================

def _ark_generate(cfg, prompt, duration, size, wait=True, timeout=600, fps=30):
    ep = cfg['endpoint'].rstrip('/')
    headers = {'Authorization': 'Bearer ' + cfg['key'], 'Content-Type': 'application/json'}
    text = prompt + ' --resolution 480p --duration %d' % int(duration or 5)
    if fps:
        text += ' --fps %d' % max(4, min(60, int(fps)))
    payload = {'model': cfg['model'], 'content': [{'type': 'text', 'text': text}]}
    try:
        req = urllib.request.Request(ep + '/contents/generations/tasks',
                                     data=json.dumps(payload).encode(), headers=headers)
        r = json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'ignore')[:400]
        hint = '（注意：方舟"计划/Coding Plan"类 key 不支持视频模型，需要标准推理 key）' \
            if 'UnsupportedModel' in body or 'agent plan' in body else ''
        return {'ok': False, 'error': '方舟提交失败 HTTP %s: %s%s' % (e.code, body, hint), 'provider': 'ark'}
    except Exception as e:
        return {'ok': False, 'error': '方舟请求失败: %s' % e, 'provider': 'ark'}
    tid = r.get('id')
    if not tid:
        return {'ok': False, 'error': '方舟未返回任务ID', 'provider': 'ark'}
    if not wait:
        return {'ok': True, 'pending': True, 'task_id': tid, 'provider': 'ark'}
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(8)
        try:
            req = urllib.request.Request(ep + '/contents/generations/tasks/' + tid, headers=headers)
            rr = json.load(urllib.request.urlopen(req, timeout=20))
        except Exception:
            continue
        st = rr.get('status')
        if st == 'succeeded':
            url = ((rr.get('content') or {}).get('video_url')) or ''
            if url:
                return {'ok': True, 'url': url, 'provider': 'ark', 'model': cfg['model'], 'task_id': tid}
        if st == 'failed':
            return {'ok': False, 'error': '方舟生成失败', 'provider': 'ark'}
    return {'ok': False, 'error': '等待超时(%ss)' % timeout, 'provider': 'ark', 'task_id': tid}


# ===================== 对外接口 =====================

_ENGINES = {'zhipu': _zhipu_generate, 'siliconflow': _sf_generate, 'ark': _ark_generate}


def generate_video(prompt, duration=5, size='832x480', model='', key='', fps=30,
                   negative_prompt='', seed=None, wait=True, timeout=330):
    """主入口：按渠道优先级尝试，任一成功即返回"""
    channels = _video_models()
    errors = []
    tried = []
    for cfg in channels:
        eng = _ENGINES.get(cfg['provider'])
        if not eng:
            continue
        tried.append(cfg['provider'])
        r = eng(cfg, prompt, duration, size, negative_prompt=negative_prompt,
                seed=seed, wait=wait, timeout=timeout, fps=fps) if cfg['provider'] == 'zhipu' else eng(cfg, prompt, duration, size, wait=wait, timeout=timeout, fps=fps)
        if r.get('ok'):
            r.setdefault('channel_name', cfg['provider'])
            return r
        errors.append('%s: %s' % (cfg['provider'], r.get('error', '?')))
    if not channels:
        return {'ok': False, 'error': '没有可用的视频生成渠道：请在 private/api_keys.json 配置「智谱 GLM」'
                                       '或「硅基流动」的 API Key 后重试'}
    return {'ok': False, 'error': ' | '.join(errors), 'tried': tried}


def video_status():
    chans = []
    for cfg in _video_models():
        chans.append({'provider': cfg['provider'], 'model': cfg['model'],
                      'ready': bool(cfg['key'])})
    if not chans:
        chans = [{'provider': None, 'model': '-', 'ready': False}]
    return {'ok': len(chans) > 0 and any(c['ready'] for c in chans), 'channels': chans}


def generate_video_from_task(task_id, provider='zhipu'):
    """查询已有任务结果（不重新生成）"""
    keys = _load_keys()
    if provider == 'zhipu':
        key = keys.get('智谱 GLM', '')
        if not key:
            return {'ok': False, 'error': '缺少智谱 key'}
        try:
            req = urllib.request.Request('https://open.bigmodel.cn/api/paas/v4/async-result/' + task_id,
                                         headers={'Authorization': 'Bearer ' + key})
            rr = json.load(urllib.request.urlopen(req, timeout=20))
        except Exception as e:
            return {'ok': False, 'error': str(e)}
        if rr.get('task_status') == 'SUCCESS':
            vids = rr.get('video_result') or []
            return {'ok': True, 'url': (vids[0].get('url') if vids else ''),
                    'cover': (vids[0].get('cover_image_url') if vids else ''),
                    'provider': 'zhipu', 'task_id': task_id}
        return {'ok': True, 'pending': rr.get('task_status'), 'task_id': task_id, 'provider': 'zhipu'}
    return {'ok': False, 'error': '不支持的任务查询渠道: ' + provider}


if __name__ == '__main__':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    print(json.dumps(video_status(), ensure_ascii=False, indent=2))
