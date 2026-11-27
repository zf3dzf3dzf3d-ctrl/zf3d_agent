# -*- coding: utf-8 -*-
"""项目文件管理器·缩略图域（重构 Step4：自 mixin_project_fs.py 按 kind 拆出，方法体未改动）。

包含：缩略图缓存键/路径、生成、预热线程、/api/fs-thumb、缩略图进程内处理。
"""
# 【修复】模块级状态（重构拆分时丢失定义，导致预热线程 NameError 崩溃）
# 【20261123 补】handler 路径同样引用裸名 os/parse_qs/_thumb_sem 而定义丢失，
# /api/fs/thumb 每次请求 NameError 被底部大 except 兜成 500（缩略图功能静默残废）；此处补齐
import os
import threading as _thumb_th
from urllib.parse import parse_qs
from util_log import get_logger

log = get_logger('project_fs_thumb')
_thumb_sem = _thumb_th.Semaphore(4)  # 原定义 routes/mixin_project_fs.py:515，拆分后成孤儿，使用方在本文件
_THUMB_SIZE = 320
_thumb_done = set()
# 已确认缩略图就绪的原始路径（join 后、realpath 前）。空闲重扫先查这里，命中的直接跳过：
# 否则每 30s 巡检都要对全部图片各做一次 realpath，缩略图早已全部就绪时仍单核 100% 持续约 0.5s（2026-11-23）
_thumb_done_paths = set()
_thumb_inflight = set()
_thumb_inflight_lock = _thumb_th.Lock()
_thumb_user_active = 0
# 压缩失败黑名单：path -> 失败时的源文件 mtime；文件未变则不再重试。
# 否则损坏图片永远压不出缓存，每轮 batch>0，预热线程零休眠连续全量扫盘拖垮 CPU（2026-11-16）。
_thumb_fail = {}

def _thumb_cache_key(rp):
    """与请求侧一致的缓存键"""
    import hashlib
    import os as _os
    return hashlib.md5((rp + '|' + str(int(_os.path.getmtime(rp) or 0))).encode('utf-8', 'ignore')).hexdigest()


def _thumb_cache_path(rp):
    import os as _os
    cache_dir = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), '..', 'cache', 'thumbs')
    return _os.path.realpath(_os.path.join(cache_dir, _thumb_cache_key(rp) + '.thumb_320.webp'))


def _make_thumb_bytes(rp):
    """生成缩略图字节：320px + WebP（JPEG 源先 draft() 降采样再解码，小图跳过）。
    返回 (bytes, content_type)；失败返回 (None, None) 由调用方回退原图。单张失败不抛出。"""
    try:
        from PIL import Image
        import io as _io
        img = Image.open(rp)
        # draft 仅对 JPEG 生效，PNG/WebP 自动忽略，无副作用
        try:
            img.draft('RGB', (_THUMB_SIZE, _THUMB_SIZE))
        except Exception:
            pass
        if img.mode not in ('RGB', 'L'):
            # PNG 等透明图先铺白底再转 RGB，保证缩略图背景不透明
            if img.mode in ('RGBA', 'LA', 'PA') or (img.mode == 'P' and 'transparency' in img.info):
                img = img.convert('RGBA')
                _bg = Image.new('RGB', img.size, (255, 255, 255))
                _bg.paste(img, mask=img.split()[-1])
                img = _bg
            else:
                img = img.convert('RGB')
        img.thumbnail((_THUMB_SIZE, _THUMB_SIZE))
        buf = _io.BytesIO()
        img.save(buf, 'WEBP', quality=82)
        return buf.getvalue(), 'image/webp'
    except Exception:
        return None, None


def start_thumb_warmup():
    """启动后台预热 daemon 线程（单飞信号量保证只起一次）。
    限频：每张间 sleep 50ms；超 500 张暂停待下次调用续跑；不碰 private/.git/cache。
    空闲时每 30s 只走一遍目录找新图；已就绪的图不再逐张 realpath（见 _thumb_done_paths）。"""
    import threading as _th
    if getattr(start_thumb_warmup, '_started', False):
        return
    start_thumb_warmup._started = True

    def _worker():
        import os as _os
        import time as _time
        IMG_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'}
        root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
        SKIP = {'private', '.git', 'node_modules', 'cache', '__pycache__', '.bak'}

        def _mtime_or_neg1(p):
            try:
                return _os.path.getmtime(p)
            except OSError:
                return -1

        count = 0
        while True:
            batch = 0
            for dirpath, dirnames, filenames in _os.walk(root):
                dirnames[:] = [d for d in dirnames if d not in SKIP and not d.startswith('.')]
                for fn in filenames:
                    if _os.path.splitext(fn)[1].lower() not in IMG_EXTS:
                        continue
                    fp = _os.path.join(dirpath, fn)
                    if fp in _thumb_done_paths:
                        continue  # 【性能修复】本进程已确认就绪：空闲重扫直接跳过，不做 realpath
                    rp = _os.path.realpath(fp)
                    if rp in _thumb_done or rp in _thumb_inflight:
                        if rp in _thumb_done:
                            _thumb_done_paths.add(fp)  # 请求侧已生成过，同样登记免重查
                        continue
                    if rp in _thumb_fail:
                        if _mtime_or_neg1(rp) == _thumb_fail[rp]:
                            continue  # 已判损坏且文件未变，跳过
                        _thumb_fail.pop(rp, None)  # 文件改过了，给机会重试
                    if _os.path.isfile(_thumb_cache_path(rp)):
                        _thumb_done.add(rp)
                        _thumb_done_paths.add(fp)
                        continue
                    with _thumb_inflight_lock:
                        if rp in _thumb_inflight:
                            continue
                        _thumb_inflight.add(rp)
                    # 【性能修复】用户正在请求缩略图时预热线程让路：等待且不计数，
                    # 避免预热与首开面板请求抢 CPU/IO 拖慢响应
                    while _thumb_user_active > 0:
                        _time.sleep(0.5)
                    try:
                        content, _ct = _make_thumb_bytes(rp)
                        if content:
                            cp = _thumb_cache_path(rp)
                            tmp = cp + '.tmp'
                            with open(tmp, 'wb') as f:
                                f.write(content)
                            _os.replace(tmp, cp)
                            _thumb_done.add(rp)
                            _thumb_done_paths.add(fp)
                            _thumb_fail.pop(rp, None)
                        else:
                            # 损坏/不支持的图片：登记失败时的 mtime，文件没改就不再重试，
                            # 避免每轮 batch 永远>0 导致扫盘循环零休眠空转
                            _thumb_fail[rp] = _mtime_or_neg1(rp)
                    except Exception:
                        _thumb_fail[rp] = _mtime_or_neg1(rp)
                    finally:
                        with _thumb_inflight_lock:
                            _thumb_inflight.discard(rp)
                    count += 1
                    batch += 1
                    _time.sleep(0.05)  # 限频，避免抢占请求线程
                    if count >= 500:
                        # 超 500 张暂停 60s 待续跑，防占满 IO
                        _time.sleep(60)
                        count = 0
            if batch == 0:
                _time.sleep(30)  # 全部就绪后低频巡检新文件
            else:
                _time.sleep(5)  # 仍有积压也歇一口气再扫，防全量扫盘连续空转吃满 CPU
        # 不可达

    t = _th.Thread(target=_worker, name='thumb-warmup', daemon=True)
    t.start()
    log.info('[thumb-warmup] 后台缩略图预热线程已启动（320px/WebP，限频50ms/张）')


def _handle_fs_thumb(self, parsed):
    """【5.2.5 优化】/api/fs/thumb?path=...&v=...：返回图片缩略图（服务端压缩 + 磁盘缓存）。
    大图原图不再整张下载给浏览器，缩略图最长边压到 512px，缓存于 server/cache/thumbs/。
    Pillow 缺失或压缩失败时回退返回原图字节。仅限常见图片类型。"""
    qs = parse_qs(parsed.query)
    raw_path = (qs.get('path', [''])[0] or '').strip()
    try:
        if not raw_path:
            self._send_error('缺少 path 参数', 400)
            return
        rp = os.path.realpath(raw_path)
        if not os.path.isfile(rp):
            self._send_error('文件不存在: ' + raw_path, 404)
            return
        ext = os.path.splitext(rp)[1].lower()
        MIME = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
                '.tif': 'image/tiff', '.tiff': 'image/tiff',
                '.ico': 'image/x-icon', '.svg': 'image/svg+xml'}
        if ext not in MIME:
            self._send_error('不支持的图片类型: ' + ext, 403)
            return
        try:
            size = os.path.getsize(rp)
            if size > 50 * 1024 * 1024:
                self._send_error('文件过大', 413)
                return
        except (PermissionError, OSError) as e:
            self._send_error('无法读取: ' + str(e), 403)
            return
        # 【5.2.5 安全加固】敏感目录黑名单：项目内 private/、.git、server/cache 不允许出图，
        # 防止被注入页面借此探测本机敏感文件（路径仍保持全盘可用，与 /api/fs/file 同级定位）
        _low = rp.lower()
        for _seg in ('\\private\\', '\\.git\\', '\\cache\\thumbs\\'):
            if _seg in _low:
                self._send_error('敏感目录禁止访问', 403)
                return
        # 【2026-09-30 修复·审核加固】svg 分支移到大小检查+黑名单之后（保留在 Pillow 之前），
        # 并加 CSP sandbox 头防止直接打开时内嵌 script 执行
        if ext in ('.svg',):
            try:
                with open(rp, 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', MIME[ext])
                self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Length', str(len(content)))
                self.send_header('Cache-Control', 'private, max-age=86400')
                self.end_headers()
                self.wfile.write(content)
            except Exception as e:
                self._send_error('读取失败: ' + str(e), 500)
            return
        import hashlib
        cache_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                 'cache', 'thumbs')
        try:
            os.makedirs(cache_dir, exist_ok=True)
        except Exception:
            cache_dir = None
        key = hashlib.md5((rp + '|' + str(int(os.path.getmtime(rp) or 0))).encode('utf-8', 'ignore')).hexdigest()
        # 【首开提速 2026-10-27】缩略图降为 320px + WebP（面板显示仅 160~240px，2x 屏足够），
        # 缓存文件名带尺寸后缀 thumb_320.webp，避免旧 512 .jpg 缓存污染
        cache_path = os.path.join(cache_dir, key + '.thumb_320.webp') if cache_dir else None
        # 【5.2.5 优化】磁盘缓存淘汰：总量超 200MB 时按文件修改时间(mtime，即生成时间)从旧到新删除，
        # 随机抽样最多 500 个文件做快速检查，避免大缓存目录全量扫描拖慢请求
        if cache_path:
            # 【性能修复】淘汰扫描含 listdir+最多500次stat，较重；改为每5分钟最多执行一次，
            # 不再每个缩略图请求都全量扫描缓存目录（大目录首屏会发几百个缩略图请求，曾导致请求全部被拖慢）
            import time as _time
            if _time.time() - getattr(type(self), '_thumb_evict_at', 0) > 300:
                type(self)._thumb_evict_at = _time.time()
                try:
                    import random as _rand
                    _files = [os.path.join(cache_dir, f) for f in os.listdir(cache_dir)
                              if f.endswith('.thumb_320.webp')]
                    if len(_files) > 500:
                        _sample = _rand.sample(_files, min(500, len(_files)))
                    else:
                        _sample = _files
                    _total = 0
                    _items = []
                    for _p in _sample:
                        try:
                            _st = os.stat(_p)
                            _total += _st.st_size
                            _items.append((_st.st_mtime, _st.st_size, _p))
                        except OSError:
                            pass
                    if _total > 200 * 1024 * 1024 and len(_sample) >= len(_files):
                        _items.sort()
                        _need = _total - 150 * 1024 * 1024
                        for _at, _sz, _p in _items:
                            if _need <= 0 or _p == cache_path:
                                break
                            try:
                                os.remove(_p)
                                _need -= _sz
                            except OSError:
                                pass
                except Exception:
                    pass
        if cache_path and os.path.isfile(cache_path) and os.path.getsize(cache_path) > 0:
            _thumb_done.add(rp)
            with open(cache_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'image/webp')
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'private, max-age=86400')
            self.end_headers()
            self.wfile.write(content)
            return
        # 请求侧压缩前登记 inflight，防止预热线程重复压同一张
        global _thumb_user_active
        with _thumb_inflight_lock:
            _thumb_user_active += 1
            if rp in _thumb_inflight:
                _skip_dup = True
            else:
                _thumb_inflight.add(rp)
                _skip_dup = False
        try:
            _thumb_process(self, rp, cache_path, _skip_dup, MIME, ext)
        finally:
            with _thumb_inflight_lock:
                _thumb_user_active -= 1
    except (BrokenPipeError, ConnectionResetError):
        pass
    except Exception as e:
        log.error(f'[GET /api/fs/thumb] 500 错误: {e}')
        try:
            self._send_error(str(e), 500)
        except Exception:
            pass


def _thumb_process(self, rp, cache_path, _skip_dup, MIME, ext):
    """生成并返回缩略图（性能修复后拆出的处理段）。"""
    # ---- 生成缩略图（含 JPEG→WebP 回退）----
    # 【性能修复】压缩段套信号量限并发 4，防数百并发请求打满 CPU/GIL 拖垮全服务
    if _skip_dup:
        # 预热线程正在压同一张，轮询缓存避免双压；超时则自己压
        import time as _dup_t
        content, ctype = None, None
        for _ in range(40):
            _dup_t.sleep(0.05)
            if cache_path and os.path.isfile(cache_path) and os.path.getsize(cache_path) > 0:
                with open(cache_path, 'rb') as f:
                    content = f.read()
                ctype = 'image/webp'
                break
        if content is None:
            with _thumb_sem:
                content, ctype = _make_thumb_bytes(rp)
    else:
        try:
            with _thumb_sem:
                content, ctype = _make_thumb_bytes(rp)
        finally:
            with _thumb_inflight_lock:
                _thumb_inflight.discard(rp)
    if content is not None and cache_path:
        try:
            # 原子写：先写临时文件再 os.replace，防止请求/预热并发写坏缓存
            tmp = cache_path + '.tmp'
            with open(tmp, 'wb') as f:
                f.write(content)
            os.replace(tmp, cache_path)
            _thumb_done.add(rp)
        except Exception:
            pass
    if content is None:
        # 回退：直接吐原图
        with open(rp, 'rb') as f:
            content = f.read()
        ctype = MIME[ext]
    self.send_response(200)
    self.send_header('Content-Type', ctype)
    self.send_header('Content-Length', str(len(content)))
    self.send_header('Cache-Control', 'private, max-age=86400')
    self.end_headers()
    self.wfile.write(content)


# 【2026-10-27 修复】该函数定义于类体外（类块在 L498 被模块级辅助函数截断），
# 显式挂载为 MixinProjectFs 类方法，供 api_dispatch_get 的 self._handle_fs_thumb 调用
# 【2026-11-06 修复】此处不引用 MixinProjectFs（本文件未导入该类且会循环导入），
# 挂载统一由 mixin_project_fs.py 在 import 本模块后执行（第 648 行）


