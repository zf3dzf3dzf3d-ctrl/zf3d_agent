# -*- coding: utf-8 -*-
"""i漫画 本地下载器（策划案 i漫画2.0 M-D1）
章节级下载队列：单线程后台 worker，逐页抓取（走漫画柜代理缓存逻辑同款白名单域），
落盘 server/data/comics_local/<漫画>/<章节>/<NNN>.jpg，跳过已存在文件（断点续传）。
状态内存队列 + JSON 落盘，前端轮询 /api/comics/download/status。
线程安全：单把 _dl_lock 保护队列与状态。
"""
import hashlib
import json
import os
import re
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from util_log import get_logger

log = get_logger('comics_download')
_BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(_BASE, 'server', 'data')
LOCAL_DIR = os.path.join(DATA_DIR, 'comics_local')
STATE_FILE = os.path.join(DATA_DIR, 'comics_download_state.json')

# 与 mixin_comics 一致的白名单域
_ALLOWED = ('uploads.mangadex.org',)
_ALLOWED_SUFFIX = ('.mangadex.network',)

_dl_lock = threading.RLock()
_queue = []           # [{task_id, source, mangaId, title, chapterId, chapterTitle, pages, done, total, status, err}]
_worker = None
_state_dirty = False

# Windows 保留设备名（含 CON.jpg 形式也不允许作路径组件）
_WIN_RESERVED = ({'CON', 'PRN', 'AUX', 'NUL'}
                 | {'COM%d' % i for i in range(1, 10)}
                 | {'LPT%d' % i for i in range(1, 10)})


def _safe_name(s):
    s = re.sub(r'[\\/:*?"<>|]', '_', str(s or ''))
    s = s.replace('..', '_')            # 【安全加固】拦目录穿越（.. → _）
    s = s.strip(' .')
    if s.split('.')[0].upper() in _WIN_RESERVED:   # 【安全加固】拦 Windows 保留名
        s = '_' + s
    return s[:80] or '未命名'


def _save_state():
    try:
        # 【P1-5 收口】原子写走公共工具 util_fs（原手写 tmp+os.replace 样板）
        from util_fs import atomic_write_json
        atomic_write_json(STATE_FILE, _queue)
    except Exception:
        pass


def load_state():
    """启动时恢复未完成任务为 failed（不自动续跑，用户可重新下发）。"""
    global _queue
    with _dl_lock:
        if _queue:
            return
        try:
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                _queue = json.load(f) or []
            for t in _queue:
                if t.get('status') in ('pending', 'downloading'):
                    t['status'] = 'interrupted'
        except Exception:
            _queue = []


def fetch_image(url):
    """按白名单域抓远图（与 proxy 同规则），返回 bytes。"""
    m = re.match(r'^https?://([^/]+)/', url)
    if not m:
        raise ValueError('bad url')
    host = m.group(1)
    if host not in _ALLOWED and not any(host.endswith(s) for s in _ALLOWED_SUFFIX):
        raise PermissionError('host not allowed: ' + host)
    req = urllib.request.Request(url, headers={'User-Agent': 'ZFComics/1.0'})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def _page_to_url(p):
    """前端拿到的 pages 可能是相对路径 api/comics/proxy?url=…，还原真实 URL。"""
    if p.startswith('api/comics/proxy?url='):
        from urllib.parse import unquote
        return unquote(p.split('url=', 1)[1])
    if p.startswith('http'):
        return p
    return None   # 本地图/其它形式不下载


def add_task(source, manga_id, title, chapter_id, chapter_title, pages):
    """入队一个章节下载任务，返回 task_id。已在队列/已完成则跳过。"""
    global _worker
    with _dl_lock:
        for t in _queue:
            if (t['source'] == source and t['mangaId'] == manga_id
                    and t['chapterId'] == chapter_id
                    and t['status'] in ('pending', 'downloading')):
                return t['task_id']
        task_id = hashlib.sha1(('%s|%s|%s|%s' % (source, manga_id, chapter_id, time.time())).encode()).hexdigest()[:12]
        task = {
            'task_id': task_id, 'source': source, 'mangaId': manga_id,
            'title': _safe_name(title), 'chapterId': chapter_id,
            'chapterTitle': _safe_name(chapter_title),
            'pages': pages, 'done': 0, 'total': len(pages),
            'status': 'pending', 'err': ''
        }
        _queue.append(task)
        _save_state()
        if _worker is None or not _worker.is_alive():
            _worker = threading.Thread(target=_run_queue, daemon=True)
            _worker.start()
        return task_id


def status():
    with _dl_lock:
        return [dict(t) for t in _queue[-50:]]


def chapter_path(source, manga_id, title, chapter_id):
    d = os.path.join(LOCAL_DIR, _safe_name(title), _safe_name(chapter_id or 'chapter'))
    # 【安全加固】realpath 前缀断言兜底：最终路径必须落在 LOCAL_DIR 内，越界直接拒绝
    rp = os.path.realpath(d)
    root = os.path.realpath(LOCAL_DIR)
    if rp != root and not rp.startswith(root + os.sep):
        raise ValueError('章节路径越出本地下载目录: ' + rp)
    return rp


def _run_queue():
    # 【kill_switch 总闸】紧急停止一切出网：开闸时清空待处理队列（置 failed，
    # 不自动续跑，与 load_state 中断语义一致）并退出本轮 worker。
    try:
        import kill_switch
        if kill_switch.is_on():
            cleared = 0
            with _dl_lock:
                for t in _queue:
                    if t.get('status') == 'pending':
                        t['status'] = 'failed'
                        t['err'] = 'kill_switch 已开启, 下载已停止'
                        cleared += 1
            if cleared:
                log.info('[comics_download] kill_switch 已开启: 已清空 %d 个待处理下载任务并退出本轮' % cleared)
            _save_state()
            return
    except Exception:
        pass
    while True:
        task = None
        with _dl_lock:
            for t in _queue:
                if t['status'] == 'pending':
                    task = t
                    break
        if task is None:
            _save_state()
            return
        with _dl_lock:
            task['status'] = 'downloading'
        out_dir = ''
        try:
            out_dir = chapter_path(task['source'], task['mangaId'], task['title'], task['chapterId'])
            os.makedirs(out_dir, exist_ok=True)
        except Exception as e:
            with _dl_lock:
                task['status'] = 'failed'; task['err'] = str(e)
            continue
        err_list = []
        # S4: 页内 3 路并发下载（锁审计：fetch_image 为纯网络 IO 不碰 _dl_lock，
        # done/err/status 写点全部收进锁内，无持锁重入风险）
        _dlock = threading.Lock()
        def _dl_page(args):
            i, p = args
            ext = '.jpg'
            fp = os.path.join(out_dir, '%03d%s' % (i + 1, ext))
            if os.path.isfile(fp) and os.path.getsize(fp) > 0:
                return i
            url = _page_to_url(p)
            if not url:
                return i   # 非远图（本地已存在），跳过
            try:
                data = fetch_image(url)
                with open(fp, 'wb') as f:
                    f.write(data)
                return i
            except Exception as e:
                with _dlock:
                    err_list.append('%s: %s' % (i + 1, e))
                return -1
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(_dl_page, enumerate(task['pages'])))
        with _dl_lock:
            task['done'] = sum(1 for r in results if r >= 0)
            if task['done'] >= task['total'] and not err_list:
                task['status'] = 'done'
            else:
                task['status'] = 'failed'
                task['err'] = '; '.join(err_list[:3]) or '未完成'
                # 断点续传：只记剩余未成功页（results[i] < 0 = 失败页）
                task['pages'] = [p for (i, p) in enumerate(task['pages']) if results[i] < 0]
        _save_state()
