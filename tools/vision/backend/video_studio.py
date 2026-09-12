#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""video_studio - 视频工作台易用性支撑工具

配合 public/video-studio.html 使用；重活通过 job_submit 转交 video_edit 后台执行。

op 一览：
- browse       : 浏览目录（path 空=列盘符），只返回目录+媒体文件
- open_folder  : 在资源管理器中打开目录/定位文件
- env_check    : 检查 ffmpeg/ffprobe/scenedetect/whisper/edge_tts/numpy 是否就绪
- job_submit   : 提交 video_edit 动作到后台队列（单线程串行），返回 job_id
- job_get      : 查询任务状态/结果/友好错误
- job_list     : 任务队列列表
- recent_files : 最近文件记录（op=get/add，最多 10 条）
- save_upload  : base64 上传小文件（<200MB）到 server/video_uploads/
"""
import os
import sys
import json
import time
import uuid
import base64
import queue
import string
import threading
import subprocess
import traceback

TOOL_NAME = 'video_studio'

_TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(_TOOLS_DIR)))
_VIDEO_DIR = os.path.join(_PROJECT_ROOT, 'server', 'video')
_UPLOAD_DIR = os.path.join(_PROJECT_ROOT, 'server', 'video_uploads')
_RECENT_JSON = os.path.join(_PROJECT_ROOT, 'server', 'video_studio_recent.json')

if _VIDEO_DIR not in sys.path:
    sys.path.insert(0, _VIDEO_DIR)

VIDEO_EXTS = {'.mp4', '.mov', '.mkv', '.avi', '.webm', '.flv', '.wmv',
              '.m4v', '.ts', '.mpg', '.mpeg', '.3gp'}
MEDIA_EXTS = VIDEO_EXTS | {'.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg',
                           '.jpg', '.jpeg', '.png', '.gif', '.srt'}

# ============ 任务队列（单工作线程串行执行，避免多个 ffmpeg 抢 CPU） ============
_JOBS = {}          # id -> job dict
_JOB_ORDER = []     # 保序
_QUEUE = queue.Queue()
_WORKER = None
_LOCK = threading.Lock()


def _get_video_edit():
    """复用 video_edit 的 _dispatch（优先走 tools 包路径，避免重复加载）。"""
    try:
        from tools.vision.backend import video_edit as ve
        return ve
    except Exception:
        if _TOOLS_DIR not in sys.path:
            sys.path.insert(0, _TOOLS_DIR)
        import video_edit as ve
        return ve


_VALID_ACTIONS = ('info cut concat subtitle analyze highlight desilence speed '
                  'volume mix text gif shot produce transition beat_sync fade '
                  'auto_materials visual_highlight vision_pick clip_select summary').split()


def _worker_loop():
    while True:
        job_id = _QUEUE.get()
        job = _JOBS.get(job_id)
        if not job:
            continue
        job['status'] = 'running'
        job['started_at'] = time.time()
        try:
            ve = _get_video_edit()
            job['result'] = ve._dispatch(job['action'], dict(job['params']))
            job['status'] = 'done'
        except Exception as e:  # noqa: BLE001
            job['status'] = 'error'
            job['error'] = _friendly(str(e))
            job['error_raw'] = str(e)[:2000]
            traceback.print_exc()
        job['finished_at'] = time.time()
        job['elapsed'] = round(job['finished_at'] - (job.get('started_at') or job['submitted_at']), 1)
        with _LOCK:
            done_ids = [i for i in _JOB_ORDER if _JOBS.get(i, {}).get('status') in ('done', 'error')]
            while len(done_ids) > 30:
                old = done_ids.pop(0)
                _JOBS.pop(old, None)
                if old in _JOB_ORDER:
                    _JOB_ORDER.remove(old)


def _ensure_worker():
    global _WORKER
    if _WORKER is None or not _WORKER.is_alive():
        _WORKER = threading.Thread(target=_worker_loop, daemon=True, name='video-studio-worker')
        _WORKER.start()


# ============ 友好错误翻译 ============
_ERROR_MAP = [
    ('no such file or directory', '文件或目录不存在，请确认路径是否正确'),
    ('invalid data found when processing input', '文件损坏或不是有效的视频/音频格式'),
    ('does not contain any stream', '处理结果没有有效内容，请检查输入文件是否完好（如无画面/无音轨）'),
    ('permission denied', '文件被其他程序占用（如播放器/剪辑软件正在使用），请关闭后重试'),
    ('无法分析音频', '该视频没有可用音轨，无法做声音分析；可先在「常用-混音」里配一段 BGM 再试'),
    ('需要安装 scenedetect', '缺少场景检测库，请在项目 Python 环境执行: pip install scenedetect'),
    ('whisper', 'Whisper 语音识别库未安装或模型未下载；可先换更小的模型（tiny/base）重试'),
    ('命令超时', '处理超时（视频太长或机器繁忙），建议先剪出片段再处理，或关闭其他占 CPU 的程序'),
    ('connection', '联网功能（TTS 配音/在线模型下载）失败，请检查网络后重试'),
    ('cuda', 'GPU/CUDA 环境异常，可改用更小模型或纯 CPU 模式重试'),
    ('out of memory', '内存/显存不足，建议换更小模型、缩短片段或降低分辨率'),
]


def _friendly(err):
    msg = str(err)
    low = msg.lower()
    for key, tip in _ERROR_MAP:
        if key in low:
            return f'{tip}（原始错误: {msg[:300]}）'
    return msg


# ============ 各 op 实现 ============

def _browse(body):
    p = (body.get('path') or '').strip()
    if not p:
        drives = [d + ':\\' for d in string.ascii_uppercase if os.path.exists(d + ':\\')]
        return {'ok': True, 'level': 'drives', 'drives': drives,
                'hint': '双击盘符进入，或直接在路径框粘贴完整路径'}
    p = os.path.abspath(os.path.expanduser(p))
    if not os.path.exists(p):
        raise ValueError(f'路径不存在: {p}')
    if os.path.isfile(p):
        return {'ok': True, 'level': 'file', 'file': p}
    dirs, files = [], []
    try:
        names = os.listdir(p)
    except PermissionError:
        raise ValueError('无权限访问该目录')
    for name in sorted(names):
        full = os.path.join(p, name)
        ext = os.path.splitext(name)[1].lower()
        try:
            if os.path.isdir(full):
                dirs.append(name)
            elif ext in MEDIA_EXTS:
                st = os.stat(full)
                files.append({'name': name, 'path': full, 'ext': ext,
                              'is_video': ext in VIDEO_EXTS,
                              'size_mb': round(st.st_size / 1048576, 1),
                              'mtime': int(st.st_mtime)})
        except OSError:
            continue
    files.sort(key=lambda f: (not f['is_video'], f['name'].lower()))
    parent = os.path.dirname(p) if os.path.dirname(p) != p else None
    return {'ok': True, 'level': 'dir', 'cwd': p, 'parent': parent,
            'dirs': dirs, 'files': files}


def _open_folder(body):
    p = (body.get('path') or '').strip()
    if not p:
        raise ValueError('path required（文件或目录均可）')
    p = os.path.abspath(os.path.expanduser(p))
    if not os.path.exists(p):
        raise ValueError(f'路径不存在: {p}')
    if os.path.isfile(p):
        subprocess.Popen(['explorer', '/select,', os.path.normpath(p)])
        return {'ok': True, 'opened': os.path.dirname(p), 'selected': p}
    subprocess.Popen(['explorer', os.path.normpath(p)])
    return {'ok': True, 'opened': p}


def _env_check():
    def _ver(cmd):
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8',
                                 errors='replace', timeout=15)
            first = (out.stdout or out.stderr or '').splitlines()
            return {'ok': out.returncode == 0, 'version': first[0][:120] if first else ''}
        except Exception as e:
            return {'ok': False, 'version': str(e)[:120]}

    def _imp(name):
        try:
            m = __import__(name)
            return {'ok': True, 'version': getattr(m, '__version__', '') or ''}
        except Exception:
            return {'ok': False, 'version': ''}

    env = {}
    env['ffmpeg'] = _ver(['ffmpeg', '-version'])
    env['ffprobe'] = _ver(['ffprobe', '-version'])
    env['scenedetect'] = _imp('scenedetect')
    env['numpy'] = _imp('numpy')
    env['edge_tts'] = _imp('edge_tts')
    try:
        import whisper as _w  # noqa: F401
        env['whisper'] = {'ok': True, 'version': getattr(_w, '__version__', '')}
    except Exception:
        try:
            import faster_whisper  # noqa: F401
            env['whisper'] = {'ok': True, 'version': 'faster-whisper'}
        except Exception:
            env['whisper'] = {'ok': False, 'version': ''}
    missing = [k for k, v in env.items() if not v.get('ok')]
    return {'ok': True, 'env': env, 'all_ready': not missing, 'missing': missing,
            'hint': ('全部就绪' if not missing
                     else '缺少: ' + ', '.join(missing) + '；对应功能不可用，其余不受影响')}


def _job_submit(body):
    action = (body.get('action') or '').strip()
    if not action:
        raise ValueError('action required（video_edit 的动作名）')
    if action not in _VALID_ACTIONS:
        raise ValueError(f'未知 action: {action}，可用: {", ".join(_VALID_ACTIONS)}')
    params = body.get('params') or {}
    jid = uuid.uuid4().hex[:12]
    with _LOCK:
        pending = sum(1 for j in _JOBS.values() if j.get('status') in ('queued', 'running'))
        job = {'id': jid, 'action': action, 'label': body.get('label') or action,
               'params': params, 'status': 'queued', 'submitted_at': time.time()}
        _JOBS[jid] = job
        _JOB_ORDER.append(jid)
    _ensure_worker()
    _QUEUE.put(jid)
    return {'ok': True, 'job_id': jid, 'queue_before': pending}


def _job_get(body):
    jid = (body.get('job_id') or '').strip()
    with _LOCK:
        job = _JOBS.get(jid)
        if not job:
            raise ValueError('任务不存在或已清理: ' + jid)
        r = {k: v for k, v in job.items() if k != 'params'}
    return r


def _job_list():
    with _LOCK:
        items = [{k: v for k, v in _JOBS[i].items() if k != 'params'}
                 for i in reversed(_JOB_ORDER[-30:]) if i in _JOBS]
    return {'ok': True, 'jobs': items}


def _decorate_recent(data):
    out = []
    for x in data:
        p = x.get('path', '')
        out.append({'path': p, 'name': os.path.basename(p),
                    'exists': os.path.exists(p), 'ts': x.get('ts')})
    return out


def _recent(body):
    act = (body.get('recent_op') or 'get').strip()
    data = []
    if os.path.exists(_RECENT_JSON):
        try:
            with open(_RECENT_JSON, encoding='utf-8') as f:
                data = json.load(f)
        except Exception:
            data = []
    if act == 'add':
        p = os.path.abspath(os.path.expanduser(body.get('path') or ''))
        if not p:
            raise ValueError('path required')
        data = [x for x in data if x.get('path') != p]
        data.insert(0, {'path': p, 'ts': int(time.time())})
        data = data[:10]
        try:
            with open(_RECENT_JSON, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
        except OSError:
            pass
    return {'ok': True, 'recent': _decorate_recent(data)}


def _save_upload(body):
    name = os.path.basename(body.get('name') or body.get('filename') or 'upload.mp4')
    data = body.get('data_b64') or ''
    if not data:
        raise ValueError('data_b64 required')
    if data.strip().startswith('data:') and ',' in data:
        data = data.split(',', 1)[1]
    raw = base64.b64decode(data)
    if len(raw) > 200 * 1024 * 1024:
        raise ValueError('文件超过 200MB，拖拽上传太慢；建议用「浏览文件」直接选取本机文件')
    os.makedirs(_UPLOAD_DIR, exist_ok=True)
    dst = os.path.join(_UPLOAD_DIR, name)
    stem, ext = os.path.splitext(dst)
    i = 1
    while os.path.exists(dst):
        dst = f'{stem}_{i}{ext}'
        i += 1
    with open(dst, 'wb') as f:
        f.write(raw)
    return {'ok': True, 'path': dst, 'size_mb': round(len(raw) / 1048576, 1)}


def handle(body, ctx):
    op = (body.get('op') or body.get('action') or 'browse').strip()
    try:
        if op in ('', 'browse'):
            result = _browse(body)
        elif op == 'open_folder':
            result = _open_folder(body)
        elif op == 'env_check':
            result = _env_check()
        elif op == 'job_submit':
            result = _job_submit(body)
        elif op == 'job_get':
            result = _job_get(body)
        elif op == 'job_list':
            result = _job_list()
        elif op == 'recent_files':
            result = _recent(body)
        elif op == 'save_upload':
            result = _save_upload(body)
        else:
            raise ValueError(f'未知 op: {op}，可用: browse/open_folder/env_check/'
                             f'job_submit/job_get/job_list/recent_files/save_upload')
        ctx.send_json(result)
    except Exception as e:  # noqa: BLE001
        ctx.send_json({'ok': False, 'op': op, 'error': _friendly(str(e))})


if __name__ == '__main__':
    class _Ctx:
        @staticmethod
        def send_json(obj):
            print(json.dumps(obj, ensure_ascii=False, indent=2)[:3000])
    handle({'op': 'env_check'}, _Ctx())
