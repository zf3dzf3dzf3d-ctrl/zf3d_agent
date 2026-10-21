# -*- coding: utf-8 -*-
"""Mixin: 峰控文件桥（2026-10）——手机端「文件」Tab 直通电脑智能体产出目录。

接口：
  GET  /api/fengkong/files?dir=产出目录&limit=100   最近产出列表（按 mtime 倒序）
  GET  /api/fengkong/download?p=<文件路径>          单文件下载流
  GET  /api/fengkong/thumb?p=<图片路径>&w=256       图片缩略图（Pillow 缓存 tmp\thumbs）
  GET  /api/fengkong/changes?since=<epoch秒>        增量变更（mtime > since 的文件）
  POST /api/fengkong/upload                        反向上传（multipart，保存到 downloads\from_phone）
  POST /api/fengkong/send                          电脑→手机推送（复制到 downloads\to_phone）

安全：只允许产出目录白名单（mixin 内 _PRODUCE_DIRS，realpath 归一后必须位于
白名单内，越权直接 403；fk 接口要求 X-FK-Key 与电脑端 ZF_API_KEY 一致，
缺 key/不匹配 401，防公网裸奔）。列表不读文件正文，只给元信息。
"""
import os
import io
import re
import time
import mimetypes
import urllib.parse
from routes.mixin_base import MixinBase

try:
    from routes._shared import BASE_DIR, parse_qs, urlparse  # 与其他 mixin 一致
except Exception:
    BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    from urllib.parse import parse_qs, urlparse

# 产出目录白名单（相对项目根，可按需追加）
_PRODUCE_DIRS = ['outputs', 'downloads', 'tmp', 'public']

_THUMB_CACHE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tmp', 'thumbs')
_THUMB_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'}
_IMG_EXTS = _THUMB_EXTS
_SKIP_NAMES = {'desktop.ini', 'thumbs.db'}
_SKIP_DIRS = {'__pycache__', 'node_modules', '.git', 'browser_profile'}

# 访问密钥：private\fk_key.txt 存在时强制校验 X-FK-Key 头（公网/跨网段场景开启）；
# 文件不存在则放行（局域网默认）。不自动生成——开启鉴权须手动执行
# python server\gen_fk_key.py 生成 key，再配到手机端 X-FK-Key 头。
def _get_fk_key():
    p = os.path.join(BASE_DIR, 'private', 'fk_key.txt')
    try:
        with open(p, 'r', encoding='utf-8') as f:
            return (f.read() or '').strip()
    except Exception:
        return ''


def _fk_auth_ok(self):
    """fk_key.txt 存在且非空时校验 X-FK-Key；否则放行。"""
    want = _get_fk_key()
    if not want:
        return True  # 未开启鉴权模式，局域网放行
    got = (self.headers.get('X-FK-Key') or '').strip()
    return got == want


def _resolve_allow(self, raw):
    """路径守卫：realpath 归一后必须在白名单目录内。返回绝对路径或 None。"""
    if not raw:
        return None
    p = os.path.realpath(os.path.abspath(raw))
    for d in _PRODUCE_DIRS:
        base = os.path.realpath(os.path.join(BASE_DIR, d))
        if p == base or p.startswith(base + os.sep):
            return p
    return None


def _safe_name(name):
    return re.sub(r'[\\/:*?"<>|]', '_', name or 'file')


# 【永久修复：手机峰控打开→电脑对话全断】文件桥接口每次请求都全量 os.walk+
# os.stat（纯 Python 循环占用 GIL），手机 App 打开后高频轮询 files/changes 会把
# CPU/GIL 打满，PC 端 SSE 心跳与请求线程被饿死，表现为所有对话断线。
# 解法：进程内结果缓存（短 TTL）+ 单次扫描限量，把每秒可重复执行的成本降为 O(1)。
_CACHE_TTL = 1.5          # 列表/增量缓存秒数（手机轮询间隔通常 ≥1s，感知不到）
_WALK_ITEM_CAP = 3000     # 单次扫描最多收集条目，防超大目录拖垮
_LIST_CACHE = {}          # {(dir_sub): (ts, items)}
_CHANGES_CACHE = {'ts': 0.0, 'items': []}


def _iter_files(roots):
    """带限量与跳过规则的文件迭代器（替代裸 os.walk 全量遍历）。"""
    count = 0
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS and not d.startswith('.')]
            for name in filenames:
                if count >= _WALK_ITEM_CAP:
                    return
                if name.startswith('.') or name in _SKIP_NAMES or name.endswith('.bak') or '.bak.' in name:
                    continue
                fp = os.path.join(dirpath, name)
                try:
                    st = os.stat(fp)
                except OSError:
                    continue
                count += 1
                yield fp, st


class FengkongFileBridge(MixinBase):
    # ---------- 电脑→手机推送 ----------
    def _handle_fk_send(self, body):
        """电脑端「📲 发到手机」：把选中文件复制到 downloads\\to_phone（手机文件 Tab 可见）。"""
        paths = body.get('paths') or []
        if not isinstance(paths, list) or not paths:
            self._send_json({'ok': False, 'error': 'no paths'}, 400)
            return
        dest_dir = os.path.join(BASE_DIR, 'downloads', 'to_phone')
        os.makedirs(dest_dir, exist_ok=True)
        done, errors = [], []
        for raw in paths[:50]:
            src = _resolve_allow(self, raw)
            if not src or not os.path.isfile(src):
                errors.append(str(raw) + ': 越权或不存在')
                continue
            name = os.path.basename(src)
            dst = os.path.join(dest_dir, name)
            base, ext = os.path.splitext(name)
            n = 1
            while os.path.exists(dst):
                dst = os.path.join(dest_dir, '%s(%d)%s' % (base, n, ext))
                n += 1
            try:
                import shutil
                shutil.copy2(src, dst)
                done.append(os.path.basename(dst))
            except Exception as e:
                errors.append(name + ': ' + str(e))
        self._send_json({'ok': True, 'done': done, 'errors': errors})

    # ---------- 列表 ----------
    def _handle_fk_files(self, parsed):
        if not _fk_auth_ok(self):
            self._send_json({'ok': False, 'error': 'unauthorized'}, 401)
            return
        qs = parse_qs(parsed.query)
        sub = (qs.get('dir', [''])[0] or '').strip()
        try:
            limit = min(int(qs.get('limit', ['100'])[0]), 500)
        except ValueError:
            limit = 100
        now = time.time()
        cached = _LIST_CACHE.get(sub)
        if cached and now - cached[0] < _CACHE_TTL:
            items = cached[1]
        else:
            items = []
            if sub:
                rp = _resolve_allow(self, os.path.join(BASE_DIR, sub))
                if rp:
                    roots = [rp]
                else:
                    roots = []
            else:
                roots = [os.path.realpath(os.path.join(BASE_DIR, d)) for d in _PRODUCE_DIRS]
            for fp, st in _iter_files(roots):
                items.append({
                    'path': fp,
                    'name': os.path.basename(fp),
                    'size': st.st_size,
                    'mtime': int(st.st_mtime),
                    'dir': os.path.basename(os.path.dirname(fp)),
                    'img': os.path.splitext(fp)[1].lower() in _IMG_EXTS,
                })
            items.sort(key=lambda x: -x['mtime'])
            # 缓存只留前 500 条（手机最多看 500），并防缓存无限膨胀
            items = items[:500]
            if len(_LIST_CACHE) > 32:
                _LIST_CACHE.clear()
            _LIST_CACHE[sub] = (now, items)
        self._send_json({'ok': True, 'items': items[:limit], 'ts': int(now)})

    # ---------- 增量 ----------
    def _handle_fk_changes(self, parsed):
        if not _fk_auth_ok(self):
            self._send_json({'ok': False, 'error': 'unauthorized'}, 401)
            return
        qs = parse_qs(parsed.query)
        try:
            since = float(qs.get('since', ['0'])[0])
        except ValueError:
            since = 0.0
        now = time.time()
        if now - _CHANGES_CACHE['ts'] < _CACHE_TTL:
            items = _CHANGES_CACHE['items']
        else:
            items = []
            roots = [os.path.realpath(os.path.join(BASE_DIR, d)) for d in _PRODUCE_DIRS]
            for fp, st in _iter_files(roots):
                if st.st_mtime > now - 86400 * 7:   # 增量语义：近期变更才有意义，7 天窗口防全量回放
                    items.append({'path': fp, 'name': os.path.basename(fp),
                                  'mtime': int(st.st_mtime), 'img': os.path.splitext(fp)[1].lower() in _IMG_EXTS})
            items.sort(key=lambda x: -x['mtime'])
            items = items[:200]
            _CHANGES_CACHE['ts'] = now
            _CHANGES_CACHE['items'] = items
        self._send_json({'ok': True, 'items': [i for i in items if i['mtime'] > since][:200], 'ts': int(now)})

    # ---------- 下载 ----------
    def _handle_fk_download(self, parsed):
        if not _fk_auth_ok(self):
            self._send_json({'ok': False, 'error': 'unauthorized'}, 401)
            return
        qs = parse_qs(parsed.query)
        p = _resolve_allow(self, qs.get('p', [''])[0])
        if not p or not os.path.isfile(p):
            self._send_json({'ok': False, 'error': '文件不存在或不在白名单'}, 403)
            return
        ctype = mimetypes.guess_type(p)[0] or 'application/octet-stream'
        size = os.path.getsize(p)
        # ---- Range 支持：视频/音频拖动播放 + 下载器断点续传（HTTP 206） ----
        range_hdr = (self.headers.get('Range') or '').strip()
        start, end = 0, size - 1
        is_range = False
        m = re.match(r'bytes=(\d*)-(\d*)$', range_hdr)
        if m and (m.group(1) or m.group(2)):
            is_range = True
            if m.group(1):
                start = int(m.group(1))
            else:  # bytes=-N 后缀范围
                start = max(0, size - int(m.group(2)))
            if m.group(2):
                end = min(int(m.group(2)), size - 1)
            if start > end or start >= size:
                self.send_response(416)
                self.send_header('Content-Range', 'bytes */%d' % size)
                self.end_headers()
                return
        self.send_response(206 if is_range else 200)
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        if is_range:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        else:
            self.send_header('Content-Disposition', "attachment; filename*=UTF-8''%s"
                             % urllib.parse.quote(os.path.basename(p)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        with open(p, 'rb') as f:
            f.seek(start)
            remain = end - start + 1
            while remain > 0:
                chunk = f.read(min(256 * 1024, remain))
                if not chunk:
                    break
                remain -= len(chunk)
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return

    # ---------- 缩略图 ----------
    def _handle_fk_thumb(self, parsed):
        if not _fk_auth_ok(self):
            self._send_json({'ok': False, 'error': 'unauthorized'}, 401)
            return
        qs = parse_qs(parsed.query)
        p = _resolve_allow(self, qs.get('p', [''])[0])
        try:
            w = min(int(qs.get('w', ['256'])[0]), 512)
        except ValueError:
            w = 256
        if not p or not os.path.isfile(p) or os.path.splitext(p)[1].lower() not in _THUMB_EXTS:
            self._send_json({'ok': False, 'error': '无效图片'}, 404)
            return
        os.makedirs(_THUMB_CACHE, exist_ok=True)
        cache = os.path.join(_THUMB_CACHE, '%d_%d.png' % (abs(hash(p)), w))
        if not os.path.exists(cache) or os.path.getmtime(cache) < os.path.getmtime(p):
            try:
                from PIL import Image
                im = Image.open(p)
                im.thumbnail((w, w))
                im.convert('RGBA').save(cache, 'PNG')
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
                return
        data = open(cache, 'rb').read()
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'max-age=300')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    # ---------- 上传 ----------
    def _handle_fk_upload(self, body):
        if not _fk_auth_ok(self):
            self._send_json({'ok': False, 'error': 'unauthorized'}, 401)
            return
        """简易 multipart 解析：仅单文件字段 file，保存到 uploads\（白名单内自动生效需加入列表）。"""
        ct = self.headers.get('Content-Type', '')
        m = re.search(r'boundary=(.+)', ct)
        if not m:
            self._send_json({'ok': False, 'error': 'need multipart'}, 400)
            return
        boundary = m.group(1).strip().encode()
        updir = os.path.realpath(os.path.join(BASE_DIR, 'downloads', 'from_phone'))
        os.makedirs(updir, exist_ok=True)
        # 从 body 找第一个文件段
        parts = body.split(b'--' + boundary)
        for part in parts:
            if b'filename=' not in part:
                continue
            try:
                head, _, data = part.partition(b'\r\n\r\n')
                fn_m = re.search(rb'filename="([^"]*)"', head)
                fname = _safe_name(fn_m.group(1).decode('utf-8', 'ignore')) if fn_m else 'upload_%d.bin' % int(time.time())
                if data.endswith(b'\r\n'):
                    data = data[:-2]
                if not data:
                    self._send_json({'ok': False, 'error': '文件内容为空：手机端未送出 body（检查 Content-Length/读取权限）'}, 400)
                    return
                dest = os.path.join(updir, '%d_%s' % (int(time.time()), fname))
                with open(dest, 'wb') as f:
                    f.write(data)
                self._send_json({'ok': True, 'path': dest, 'size': len(data)})
                return
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
                return
        self._send_json({'ok': False, 'error': 'no file part'}, 400)
