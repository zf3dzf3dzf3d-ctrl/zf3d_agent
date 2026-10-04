# -*- coding: utf-8 -*-
"""Mixin: 多线程下载器（2026-09 恢复，原 5.0.x 临时 aria2 方案的正式化实现）。

功能：
  - POST /api/download/start   {url, filename?, threads?, dest?}  启动多线程分段下载
  - GET  /api/download/progress?id=xxx  查询单个任务进度
  - GET  /api/download/list             列出所有任务
  - POST /api/download/cancel  {id}                    取消任务

实现：HTTP Range 分段并发（默认 8 线程），预分配文件，各线程写自己的段，
断点续传：.zfpart 状态文件保存各段已下字节，重试 start 相同 url 自动续传。
"""
import os
import json
import time
import threading
import urllib.request
import urllib.error

from routes.mixin_base import MixinBase

# 下载任务注册表：{task_id: {...}}
_DL_TASKS = {}
_DL_TASKS_LOCK = threading.Lock()
_DL_SEQ = {'n': 0}


def _dl_downloads_dir():
    """下载保存目录：项目根 /downloads"""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    d = os.path.join(os.path.dirname(root), 'downloads')
    os.makedirs(d, exist_ok=True)
    return d


def _dl_probe(url, timeout=15):
    """HEAD/GET 探测：返回 (total_size, accept_ranges, final_url)"""
    req = urllib.request.Request(url, method='HEAD',
                                 headers={'User-Agent': 'Mozilla/5.0 ZFDownloader'})
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        total = int(resp.headers.get('Content-Length') or 0)
        ranges = (resp.headers.get('Accept-Ranges') or '').lower() == 'bytes'
        return total, ranges, resp.geturl()
    except Exception:
        # 某些服务器不支持 HEAD，退化 GET Range:0-0
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 ZFDownloader', 'Range': 'bytes=0-0'})
        resp = urllib.request.urlopen(req, timeout=timeout)
        cr = resp.headers.get('Content-Range') or ''
        total = int(cr.rsplit('/', 1)[-1]) if '/' in cr else 0
        ranges = bool(cr)
        return total, ranges, resp.geturl()


class _DlTask:
    def __init__(self, tid, url, filename, threads, dest):
        self.id = tid
        self.url = url
        self.filename = filename
        self.threads = threads
        self.dest = dest          # 最终文件路径
        self.part = dest + '.zfpart'   # 状态+数据临时
        self.total = 0
        self.done = 0             # 已完成字节
        self.status = 'starting'  # starting/running/done/error/canceled
        self.error = ''
        self.speed = 0
        self.created = time.time()
        self.finished = 0
        self._cancel = False
        self._segs = []           # [ [start, end, got], ... ]
        self._speed_win = [0, time.time()]  # (bytes, ts)

    def to_dict(self):
        pct = round(self.done * 100 / self.total, 1) if self.total else 0
        return {
            'id': self.id, 'url': self.url, 'filename': self.filename,
            'threads': self.threads, 'total': self.total, 'done': self.done,
            'percent': pct, 'speed': self.speed, 'status': self.status,
            'error': self.error, 'dest': self.dest,
            'created': self.created, 'finished': self.finished,
        }

    # ---------- 断点状态 ----------
    def _save_state(self):
        try:
            with open(self.part + '.json', 'w', encoding='utf-8') as f:
                json.dump({'url': self.url, 'total': self.total,
                           'segs': self._segs}, f)
        except Exception:
            pass

    def _load_state(self):
        try:
            with open(self.part + '.json', 'r', encoding='utf-8') as f:
                st = json.load(f)
            if st.get('url') == self.url and st.get('total'):
                return st
        except Exception:
            pass
        return None

    # ---------- 速度统计 ----------
    def _add_bytes(self, n):
        self.done += n
        now = time.time()
        self._speed_win[0] += n
        dt = now - self._speed_win[1]
        if dt >= 1.0:
            self.speed = int(self._speed_win[0] / dt)
            self._speed_win = [0, now]

    # ---------- 主流程 ----------
    def run(self):
        try:
            self._run_inner()
        except Exception as e:
            if not self._cancel:
                self.status = 'error'
                self.error = str(e)
            print('[zf-download] task %s error: %s' % (self.id, e))

    def _run_inner(self):
        total, ranges, final_url = _dl_probe(self.url)
        self.url = final_url
        if not ranges or total <= 0:
            # 不支持 Range → 单线程直下
            self.threads = 1
            self.total = total
            self._segs = [[0, max(total - 1, 0), 0]]
            # 预分配文件（与多线程分支一致，worker 以 r+b 打开，必须先存在）
            with open(self.part, 'wb') as f:
                if total > 0:
                    f.truncate(total)
        else:
            st = self._load_state()
            if st and os.path.exists(self.part):
                self.total = st['total']
                self._segs = st['segs']
            else:
                self.total = total
                chunk = total // self.threads
                self._segs = []
                pos = 0
                for i in range(self.threads):
                    s = pos
                    e = (pos + chunk - 1) if i < self.threads - 1 else total - 1
                    self._segs.append([s, e, 0])
                    pos += chunk
                # 预分配文件
                with open(self.part, 'wb') as f:
                    f.truncate(total)
            self.done = sum(s[2] for s in self._segs)

        self.status = 'running'
        threads = []
        for i, seg in enumerate(self._segs):
            if seg[2] > seg[1] - seg[0] + 1:
                continue  # 该段已完成
            t = threading.Thread(target=self._worker, args=(i,), daemon=True)
            t.start()
            threads.append(t)
        for t in threads:
            t.join()

        if self._cancel:
            self.status = 'canceled'
            return
        if self.done >= self.total > 0 or all(s[2] >= s[1] - s[0] + 1 for s in self._segs):
            if os.path.exists(self.dest):
                os.remove(self.dest)
            os.replace(self.part, self.dest)
            for ext in ('.json',):
                try:
                    os.remove(self.part + ext)
                except OSError:
                    pass
            self.status = 'done'
            self.finished = time.time()
            self.speed = 0
        else:
            self.status = 'error'
            self.error = '下载未完成（段缺失）'

    def _worker(self, idx):
        s, e, got = self._segs[idx]
        pos = s + got
        while pos <= e and not self._cancel:
            req = urllib.request.Request(self.url, headers={
                'User-Agent': 'Mozilla/5.0 ZFDownloader',
                'Range': 'bytes=%d-%d' % (pos, e)})
            try:
                resp = urllib.request.urlopen(req, timeout=30)
            except Exception as ex:
                if self._cancel:
                    return
                self._retry = getattr(self, '_retry', 0) + 1
                if self._retry > 10:
                    raise
                time.sleep(1)
                continue
            self._retry = 0
            try:
                with open(self.part, 'r+b') as f:
                    f.seek(pos)
                    while pos <= e and not self._cancel:
                        buf = resp.read(256 * 1024)
                        if not buf:
                            break
                        f.write(buf)
                        pos += len(buf)
                        self._add_bytes(len(buf))
                        self._segs[idx][2] = pos - s
                self._save_state()
            finally:
                try:
                    resp.close()
                except Exception:
                    pass


class MixinDownload(MixinBase):

    def _handle_download_start(self):
        # 注意：do_POST 入口已 _drain_body 排干并缓存 body，
        # 必须用 _read_body() 读缓存，直接 rfile.read 会永久阻塞
        try:
            body = self._read_body() or {}
        except Exception:
            body = {}
        url = (body.get('url') or '').strip()
        if not url:
            self._send_json({'ok': False, 'error': '缺少 url'})
            return
        filename = (body.get('filename') or '').strip() or url.split('/')[-1].split('?')[0] or ('dl_%d' % time.time())
        filename = os.path.basename(filename).replace('\\', '_').replace('/', '_') or 'download.bin'
        threads = max(1, min(32, int(body.get('threads') or 8)))
        dest = body.get('dest') or ''
        dest = os.path.abspath(dest) if dest else os.path.join(_dl_downloads_dir(), filename)

        # 相同 url+dest 且未完成 → 续传
        with _DL_TASKS_LOCK:
            for t in _DL_TASKS.values():
                if t.url == url and t.dest == dest and t.status in ('running', 'starting', 'error'):
                    self._send_json({'ok': True, 'id': t.id, 'resumed': True})
                    return
            _DL_SEQ['n'] += 1
            tid = 'dl_%d_%d' % (int(time.time()), _DL_SEQ['n'])
            task = _DlTask(tid, url, filename, threads, dest)
            _DL_TASKS[tid] = task
        threading.Thread(target=task.run, daemon=True).start()
        self._send_json({'ok': True, 'id': tid, 'resumed': False})

    def _handle_download_progress(self, qs):
        tid = (qs.get('id') or [''])[0]
        with _DL_TASKS_LOCK:
            t = _DL_TASKS.get(tid)
            self._send_json({'ok': True, 'task': t.to_dict() if t else None})

    def _handle_download_list(self):
        with _DL_TASKS_LOCK:
            tasks = [t.to_dict() for t in
                     sorted(_DL_TASKS.values(), key=lambda x: x.created, reverse=True)]
        self._send_json({'ok': True, 'tasks': tasks})

    def _handle_download_cancel(self):
        # 同 start：do_POST 入口已排干 body，用 _read_body() 读缓存
        try:
            body = self._read_body() or {}
        except Exception:
            body = {}
        tid = body.get('id') or ''
        with _DL_TASKS_LOCK:
            t = _DL_TASKS.get(tid)
        if not t:
            self._send_json({'ok': False, 'error': '任务不存在'})
            return
        t._cancel = True
        self._send_json({'ok': True})
