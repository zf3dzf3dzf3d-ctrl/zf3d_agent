# -*- coding: utf-8 -*-
"""Mixin: 漫画柜 API（v3 策划案 M1 后端底座）
GET  /api/comics/sources                      -> 源列表
GET  /api/comics/list?src=local&kw=           -> 漫画列表/搜索
GET  /api/comics/chapters?src=&id=            -> 章节列表
GET  /api/comics/pages?src=&id=&ch=           -> 页图片URL列表
GET  /api/comics/img?src=local&f=a/b.jpg      -> 本地图片流
GET  /api/comics/proxy?url=                   -> 远图代理（LRU磁盘缓存+域白名单）
GET  /api/comics/progress                     -> 全部阅读进度
POST /api/comics/progress                     -> 上报进度（复合键，原子写，单锁）
安全：proxy 仅白名单域；img/proxy 路径规范化防穿越；进度落 server/data/（不入 git）。
"""
import hashlib
import json
import os
import re
import threading
import urllib.request

from routes._shared import *
from routes.mixin_base import MixinBase

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 项目根
_DATA_DIR = os.path.normpath(os.path.join(_BASE, 'server', 'data'))
_PROGRESS_FILE = os.path.join(_DATA_DIR, 'comics_progress.json')
_CACHE_DIR = os.path.join(_DATA_DIR, 'comics_cache')
_CACHE_MAX = 500 * 1024 * 1024  # 500MB LRU
_PROXY_HOSTS = ('uploads.mangadex.org',)
# 章节页实际走 at-home server 返回的 *.mangadex.network 时效域，统一放行
_PROXY_HOST_SUFFIXES = ('.mangadex.network',)

_progress_lock = threading.Lock()
_cache_lock = threading.Lock()

sys.path.insert(0, os.path.join(_BASE, 'server'))
from comics_sources import get_source, list_sources  # noqa: E402
import comics_sources.local_source  # noqa: F401,E402
import comics_sources.mangadex_source  # noqa: F401,E402
import applock as _applock  # noqa: E402


class MixinComics(MixinBase):

    # ---------- 进度持久化（单锁 + tmp/rename 原子写） ----------
    def _progress_read_all(self):
        try:
            with open(_PROGRESS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f) or {}
        except Exception:
            return {}

    def _progress_write_all(self, data):
        os.makedirs(_DATA_DIR, exist_ok=True)
        tmp = _PROGRESS_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.replace(tmp, _PROGRESS_FILE)

    def _handle_comics_progress_get(self):
        with _progress_lock:
            data = self._progress_read_all()
        self._send_json({'ok': True, 'progress': data})

    def _handle_comics_progress_post(self):
        try:
            raw = self._read_body()
            body = raw if isinstance(raw, dict) else json.loads(raw or '{}')
            key = '%s:%s' % (body.get('source') or 'local', body.get('mangaId') or '')
            if not key.split(':')[-1]:
                return self._send_json({'ok': False, 'err': 'mangaId required'}, 400)
            entry = {
                'chapterId': str(body.get('chapterId') or ''),
                'page': int(body.get('page') or 0),
                'totalPages': int(body.get('totalPages') or 0),
                'ratio': float(body.get('ratio') or 0),
                'updatedAt': time.strftime('%Y-%m-%d %H:%M:%S'),
            }
            with _progress_lock:
                data = self._progress_read_all()
                data[key] = entry
                self._progress_write_all(data)
            self._send_json({'ok': True, 'key': key})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- 应用锁（策划案-App应用锁-v2）----------
    def _applock_guard(self, app):
        """守卫 /api/comics/* 内容四入口：未解锁返回 True（已发 403）"""
        if not _applock.is_locked(app):
            return False
        if _applock.check_token(app, self.headers.get('Cookie')):
            return False
        self._send_json({'ok': False, 'err': 'app-locked'}, 403)
        return True

    def _handle_applock_status(self, app):
        st = _applock.status(app)
        st['unlocked'] = st.get('ok') and _applock.check_token(app, self.headers.get('Cookie'))
        return st

    def _handle_applock_check(self, app):
        locked = _applock.is_locked(app)
        unlocked = locked and _applock.check_token(app, self.headers.get('Cookie'))
        return {'ok': True, 'app': app, 'needUnlock': locked and not unlocked,
                'wait': _applock.check_bruteforce(app) if locked else 0}

    def _handle_applock_post(self, path):
        """POST /api/applock/set | verify | lock | reset（app 默认 manga）"""
        try:
            body = self._read_body() or {}
        except Exception:
            body = {}
        app = str(body.get('app') or 'manga')
        ip = self.client_address[0] if self.client_address else ''

        def _applock_confirm(action):
            """改保护状态的动作先过本机桌面确认（跨站请求发不出这种确认）。"""
            try:
                from util_desktop_confirm import ask
            except ImportError:
                return False
            return ask('朱峰智能体无限 · 应用锁确认',
                       '确认%s「%s」的应用锁？\n（若不是你本人在操作，请点“否”并检查安全）'
                       % (action, _applock.LOCKED_APPS.get(app, app)))

        if path == '/api/applock/set':
            approved = True if _applock.is_locked(app) else _applock_confirm('设置')
            self._send_json(_applock.set_password(app, str(body.get('pw') or ''),
                                                  str(body.get('old') or ''), approved=approved))
        elif path == '/api/applock/verify':
            res, token = _applock.verify(app, str(body.get('pw') or ''), ip)
            if token:
                # HttpOnly Cookie：img 标签自动携带（策划案 v2 核心修订）
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Set-Cookie',
                                 'applock_%s=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d' % (app, token, _applock.TTL_SECONDS))
                self.send_header('Content-Length', str(len(json.dumps(res).encode('utf-8'))))
                self.end_headers()
                self.wfile.write(json.dumps(res).encode('utf-8'))
            else:
                self._send_json(res, 403)
        elif path == '/api/applock/lock':
            self._send_json(_applock.lock_now(app))
        elif path == '/api/applock/reset':
            # 忘记密码兜底：清除重设。须本机桌面确认（2026-11-24：此前空 POST 即可拆锁）
            self._send_json(_applock.reset_password(app, approved=_applock_confirm('拆除')))
        else:
            self._send_json({'ok': False, 'err': 'unknown applock api'}, 404)

    # ---------- 图片代理（LRU 磁盘缓存 + 域白名单） ----------
    def _handle_comics_proxy(self, qs):
        if self._applock_guard('manga'):
            return
        try:
            url = (qs.get('url') or [''])[0]
            m = re.match(r'^https?://([^/]+)/', url)
            host = m.group(1)
            if host not in _PROXY_HOSTS and not any(host.endswith(s) for s in _PROXY_HOST_SUFFIXES):
                return self._send_json({'ok': False, 'err': 'host not allowed'}, 403)
            key = hashlib.sha1(url.encode('utf-8')).hexdigest()
            os.makedirs(_CACHE_DIR, exist_ok=True)
            path = os.path.join(_CACHE_DIR, key)
            if os.path.isfile(path) and os.path.getsize(path) > 0:
                self._cache_touch(key)
                return self._send_bytes_file(path)
            req = urllib.request.Request(url, headers={'User-Agent': 'ZFComics/1.0'})
            with urllib.request.urlopen(req, timeout=15) as r:
                buf = r.read()
            with open(path, 'wb') as f:
                f.write(buf)
            self._cache_touch(key)
            self._cache_evict()
            self._send_bytes_file(path)
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 502)
            except Exception:
                pass

    def _cache_touch(self, key):
        with _cache_lock:
            try:
                os.utime(os.path.join(_CACHE_DIR, key), None)
            except Exception:
                pass

    def _cache_evict(self):
        with _cache_lock:
            try:
                items = []
                total = 0
                for f in os.listdir(_CACHE_DIR):
                    p = os.path.join(_CACHE_DIR, f)
                    if os.path.isfile(p):
                        st = os.stat(p)
                        items.append((st.st_mtime, st.st_size, p))
                        total += st.st_size
                if total <= _CACHE_MAX:
                    return
                items.sort()
                for _, sz, p in items:
                    if total <= _CACHE_MAX:
                        break
                    os.remove(p)
                    total -= sz
            except Exception:
                pass

    def _send_bytes_file(self, path, ctype='image/jpeg'):
        try:
            ext = os.path.splitext(path)[1].lower()
            ctype = {'.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif'}.get(ext, ctype)
            with open(path, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            # applock：锁内图片禁止任何缓存（策划案 v2：被锁内容不得留浏览器缓存副本）
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            pass

    # ---------- 本地图片流 ----------
    def _handle_comics_img(self, qs):
        if self._applock_guard('manga'):
            return
        # [安全 2026-11-08] 本地库为版权/隐私内容，仅本机可访问，禁止局域网/外网拉取
        _cli = (self.client_address[0] if self.client_address else '')
        _xfwd = (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
        if _cli not in ('127.0.0.1', '::1', 'localhost') or (_xfwd and _xfwd not in ('127.0.0.1', '::1')):
            return self._send_json({'ok': False, 'err': 'Private area: local access only'}, 403)
        rel = (qs.get('f') or [''])[0]
        root = os.path.normpath(os.path.join(_BASE, 'public', 'canvas', '漫画柜', '本地库'))
        p = os.path.normpath(os.path.join(root, rel))
        if not p.startswith(root) or not os.path.isfile(p):
            return self._send_json({'ok': False, 'err': 'not found'}, 404)
        self._send_bytes_file(p)

    # ---------- 列表/章节/页 ----------
    def _handle_comics_list(self, qs):
        if self._applock_guard('manga'):
            return
        src = (qs.get('src') or ['local'])[0]
        kw = (qs.get('kw') or [''])[0]
        s = get_source(src)
        if not s:
            return self._send_json({'ok': False, 'err': 'unknown source'}, 404)
        try:
            items = s.search(kw) if kw else s.list()
        except Exception:
            items = []
        # 跨源搜索：带关键词时同时搜其它源，合并结果（item 带 source，阅读器按 source 打开）
        if kw:
            seen = set((it.get('source') or src, it['id']) for it in items)
            for meta in list_sources():
                sid = meta['id']
                if sid == getattr(s, 'id', src):
                    continue
                s2 = get_source(sid)
                if not s2:
                    continue
                try:
                    for it in (s2.search(kw) or []):
                        k2 = (it.get('source') or sid, it['id'])
                        if k2 not in seen:
                            seen.add(k2)
                            items.append(it)
                except Exception:
                    pass
        for it in items:
            it.setdefault('cover', s.cover(it['id']) if (it.get('source') or src) == getattr(s, 'id', src) else get_source(it.get('source') or src).cover(it['id']))
        self._send_json({'ok': True, 'items': items})

    def _handle_comics_chapters(self, qs):
        if self._applock_guard('manga'):
            return
        s = get_source((qs.get('src') or ['local'])[0])
        if not s:
            return self._send_json({'ok': False, 'err': 'unknown source'}, 404)
        try:
            chs = s.chapters((qs.get('id') or [''])[0])
        except Exception:
            chs = []
        self._send_json({'ok': True, 'chapters': chs})

    def _handle_comics_pages(self, qs):
        if self._applock_guard('manga'):
            return
        s = get_source((qs.get('src') or ['local'])[0])
        if not s:
            return self._send_json({'ok': False, 'err': 'unknown source'}, 404)
        try:
            pages = s.pages((qs.get('id') or [''])[0], (qs.get('ch') or [''])[0])
        except Exception:
            pages = []
        self._send_json({'ok': True, 'pages': pages})

    def _handle_comics_sources(self):
        self._send_json({'ok': True, 'sources': list_sources()})
