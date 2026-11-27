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
import ssl as _ssl
import urllib.request
import urllib.error

from util_log import get_logger

log = get_logger('download')
try:
    import certifi as _certifi
    _DL_SSL_CTX = _ssl.create_default_context(cafile=_certifi.where())
except ImportError:
    _DL_SSL_CTX = None


def _dl_urlopen(req, timeout):
    """带 certifi CA 的 urlopen（修复 CERTIFICATE_VERIFY_FAILED：本机 Python 无系统 CA）"""
    if _DL_SSL_CTX is not None and (req.full_url or '').startswith('https'):
        return urllib.request.urlopen(req, timeout=timeout, context=_DL_SSL_CTX)
    return urllib.request.urlopen(req, timeout=timeout)

from routes.mixin_base import MixinBase

# 下载任务注册表：{task_id: {...}}
_DL_TASKS = {}
_DL_TASKS_LOCK = threading.Lock()
_DL_SEQ = {'n': 0}


def _dl_check_ssf(url):
    """[20261106 收口R2] SSRF 校验：scheme 白名单 + 拒内网/回环地址，违规返回错误串。"""
    import ipaddress as _ipa
    import socket as _sk
    import urllib.parse as _up
    p = _up.urlparse(url)
    if p.scheme not in ('http', 'https'):
        return '仅支持 http/https'
    host = p.hostname or ''
    if not host:
        return '缺少主机名'
    try:
        infos = _sk.getaddrinfo(host, None)
    except Exception as e:
        return '域名解析失败: %s' % e
    blocked = []
    for net_str in ('127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
                    '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10', '0.0.0.0/8'):
        blocked.append(_ipa.ip_network(net_str))
    for info in infos:
        ip = _ipa.ip_address(info[4][0])
        for net in blocked:
            if ip in net:
                return '禁止访问内网/回环地址 (SSRF 防护)'
    return None


def _dl_downloads_dir():
    """下载保存目录：项目根 /downloads"""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    d = os.path.join(os.path.dirname(root), 'downloads')
    os.makedirs(d, exist_ok=True)
    return d


def _dl_probe(url, timeout=15):
    """HEAD/GET 探测：返回 (total_size, accept_ranges, final_url)"""
    # [20261106 收口R2] SSRF 校验（与 webproxy 同规则：拒内网/回环/非 http(s)）
    err = _dl_check_ssf(url)
    if err:
        raise ValueError('目标被拒绝: ' + err)
    req = urllib.request.Request(url, method='HEAD',
                                 headers={'User-Agent': 'Mozilla/5.0 ZFDownloader'})
    try:
        resp = _dl_urlopen(req, timeout=timeout)
        total = int(resp.headers.get('Content-Length') or 0)
        ranges = (resp.headers.get('Accept-Ranges') or '').lower() == 'bytes'
        final_url = resp.geturl()
        # 重定向后的最终地址也须校验（防 302 跳内网）
        if final_url and final_url != url:
            err2 = _dl_check_ssf(final_url)
            if err2:
                raise ValueError('重定向目标被拒绝: ' + err2)
        return total, ranges, final_url
    except ValueError:
        raise  # [20261107 收口] SSRF 拒绝必须上抛，不得被 HEAD 失败吞掉后退化 GET 放行
    except Exception:
        # 某些服务器不支持 HEAD，退化 GET Range:0-0
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 ZFDownloader', 'Range': 'bytes=0-0'})
        resp = _dl_urlopen(req, timeout=timeout)
        cr = resp.headers.get('Content-Range') or ''
        total = int(cr.rsplit('/', 1)[-1]) if '/' in cr else 0
        ranges = bool(cr)
        final_url = resp.geturl()
        # [20261107 收口] GET 退化分支同样复检重定向最终地址（防 302 跳内网）
        if final_url and final_url != url:
            err2 = _dl_check_ssf(final_url)
            if err2:
                raise ValueError('重定向目标被拒绝: ' + err2)
        return total, ranges, final_url


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
            log.info('[zf-download] task %s error: %s' % (self.id, e))

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
        # [20261106 收口R2] worker 请求前也校验（self.url 可能被 probe 重定向更新过）
        errw = _dl_check_ssf(self.url)
        if errw:
            self.status = 'error'
            self.error = errw
            return
        while pos <= e and not self._cancel:
            req = urllib.request.Request(self.url, headers={
                'User-Agent': 'Mozilla/5.0 ZFDownloader',
                'Range': 'bytes=%d-%d' % (pos, e)})
            try:
                resp = _dl_urlopen(req, timeout=30)
            except Exception:
                if self._cancel:
                    return
                self._retry = getattr(self, '_retry', 0) + 1
                if self._retry > 10:
                    raise
                time.sleep(1)
                continue
            self._retry = 0
            # [20261107 收口] worker 请求也可能被 302 重定向，最终地址同样须 SSRF 复检
            wu = resp.geturl()
            if wu and wu != self.url:
                errw2 = _dl_check_ssf(wu)
                if errw2:
                    resp.close()
                    self.status = 'error'
                    self.error = '重定向目标被拒绝: ' + errw2
                    return
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
        # [20261106 收口R2] 入口同步 SSRF 校验
        err = _dl_check_ssf(url)
        if err:
            self._send_json({'ok': False, 'error': err}, 403)
            return
        filename = (body.get('filename') or '').strip() or url.split('/')[-1].split('?')[0] or ('dl_%d' % time.time())
        filename = os.path.basename(filename).replace('\\', '_').replace('/', '_') or 'download.bin'
        threads = max(1, min(32, int(body.get('threads') or 8)))
        dest = body.get('dest') or ''
        if dest:
            # [20261107 收口·安全] dest 白名单：只允许落在下载目录内，防任意路径写入
            _dl_root = os.path.abspath(_dl_downloads_dir())
            dest = os.path.abspath(dest)
            if not dest.lower().startswith(_dl_root.lower() + os.sep):
                self._send_json({'ok': False,
                                 'error': 'dest 仅允许下载目录内路径: ' + _dl_root}, 403)
                return
        else:
            dest = os.path.join(_dl_downloads_dir(), filename)

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
