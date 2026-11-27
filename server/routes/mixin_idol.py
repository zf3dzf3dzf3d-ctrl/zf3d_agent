# -*- coding: utf-8 -*-
"""Mixin: i偶像 私有档案馆 API（P0，2026-11-13，策划案-i偶像-v3 落地顺序第2步）

定位：以"人物实体"为中心的图/视频/资料私有档案馆（全部存 private/idols/，HTTP 不可直读）。
设计真源：策划案-i偶像-v3-融合终版（见 private/记忆/）。

接口：
  GET  /api/idol/list              -> 偶像清单（扫描 private/idols/*/profile.json）
  GET  /api/idol/detail?id=xxx     -> 单个偶像：profile + media[] + sources[]
  GET  /api/idol/file?id=xxx&rel=  -> private 媒体代理读（带目录穿越越权校验）
  POST /api/idol/save              -> 建档/改档 {id, profile, sources?}（写操作需 confirmed=true）
  POST /api/idol/media/add         -> 追加媒体条目 {id, item}；type=image 且 https 则归档落盘
数据落盘：private/idols/<id>/{profile.json, media.json, sources.json, images/*}
媒体策略（v3 裁决）：仅图片物理落盘归档；视频只存可播放指针（playVia=ivideo），不下载。
安全：file 代理读严格限制在 private/idols/<id>/ 内，../ 越权直接 403；图片归档走 net_guard（verify=True、16MB 上限、仅 image/*）。
"""
import os
import re
import json
import time
import hashlib
import threading
from routes._shared import *  # noqa: F401,F403
from routes.mixin_base import MixinBase
from util_net_guard import guard_fetch
from util_log import get_logger

log = get_logger('idol')

_IDOL_ROOT = os.path.normpath(os.path.join(BASE_DIR, 'private', 'idols'))
_idol_lock = threading.Lock()  # 档案读写互斥（per-process）
_IMG_MAX_BYTES = 16 * 1024 * 1024
_IMG_EXT = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
            'image/webp': '.webp', 'image/bmp': '.bmp'}

# id 仅允许 字母/数字/中文/下划线/连字符，长度<=40，禁一切路径符号
_ID_RE = re.compile(r'^[0-9A-Za-z\u4e00-\u9fa5_\-]{1,40}$')


def _safe_id(raw):
    s = str(raw or '').strip()
    if not s or not _ID_RE.match(s):
        return None
    return s


def _idol_dir(iid):
    return os.path.normpath(os.path.join(_IDOL_ROOT, iid))


def _read_json(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def _write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _archive_image(iid, url, referer=None):
    """下载 https 图片归档到 private/idols/<iid>/images/，返回 (rel_path, bytes, err)。
    复用 net_guard（verify=True、SSRF 拦截、仅 https、16MB 上限）。仅 image/* 落盘。
    referer 可选：防盗链站传源页 URL（i采集案新增）。"""
    try:
        data, ctype = guard_fetch(url, timeout=15, max_bytes=_IMG_MAX_BYTES, require_https=True, referer=referer)
    except Exception as e:
        return None, 0, 'fetch fail: %s' % e
    if not ctype.startswith('image/'):
        return None, 0, 'not an image: %s' % ctype
    ext = _IMG_EXT.get(ctype, '.img')
    name = hashlib.sha1(url.encode('utf-8')).hexdigest()[:16] + ext
    idir = _idol_dir(iid)
    os.makedirs(os.path.join(idir, 'images'), exist_ok=True)
    fp = os.path.join(idir, 'images', name)
    with open(fp, 'wb') as f:
        f.write(data)
    rel = 'images/' + name
    return rel, len(data), None


_THUMB_MAX = 640  # 缩略图最长边（瀑布流/头像用），原图仍走无 w 参数

def _thumb_for(target):
    """按需生成缩略图（缓存于 <idols根>/.thumbs/），返回缓存文件路径或 None。"""
    try:
        from PIL import Image
    except Exception:
        return None
    tdir = os.path.join(_IDOL_ROOT, '.thumbs')
    os.makedirs(tdir, exist_ok=True)
    st = os.stat(target)
    key = hashlib.md5(('%s|%s|%s|%s' % (target, st.st_size, st.st_mtime, _THUMB_MAX)).encode('utf-8')).hexdigest() + '.jpg'
    tp = os.path.join(tdir, key)
    if os.path.isfile(tp) and os.path.getmtime(tp) >= st.st_mtime:
        return tp
    try:
        with Image.open(target) as im:
            im = im.convert('RGB') if im.mode not in ('RGB', 'L') else im
            im.thumbnail((_THUMB_MAX, _THUMB_MAX))
            im.save(tp, 'JPEG', quality=80)
        return tp
    except Exception as e:
        log.info('[idol thumb] fail %s: %s' % (target, e))
        return None


class MixinIdol(MixinBase):

    # ---------- GET /api/idol/list ----------
    def _handle_idol_list(self):
        try:
            out = []
            if os.path.isdir(_IDOL_ROOT):
                for iid in sorted(os.listdir(_IDOL_ROOT)):
                    if iid.startswith('.'):
                        continue
                    d = os.path.join(_IDOL_ROOT, iid)
                    if not os.path.isdir(d):
                        continue
                    prof = _read_json(os.path.join(d, 'profile.json'), {})
                    media = _read_json(os.path.join(d, 'media.json'), [])
                    img_n = sum(1 for m in media if m.get('type') == 'image')
                    vid_n = sum(1 for m in media if m.get('type') == 'video')
                    out.append({
                        'id': iid,
                        'name': prof.get('name') or iid,
                        'aliases': prof.get('aliases') or [],
                        'tags': prof.get('tags') or [],
                        'avatar': prof.get('avatar') or '',
                        'avatarRel': 'avatar.jpg' if os.path.isfile(os.path.join(d, 'avatar.jpg')) else '',
                        'imageCount': img_n,
                        'videoCount': vid_n,
                        'mediaCount': len(media),
                        'updated': prof.get('updated') or '',
                    })
            self._send_json({'ok': True, 'total': len(out), 'list': out})
        except Exception as e:
            log.info('[GET /api/idol/list] 500: %s' % e)
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- GET /api/idol/detail?id=xxx ----------
    def _handle_idol_detail(self, qs):
        try:
            iid = _safe_id((qs.get('id') or [''])[0])
            if not iid:
                self._send_json({'ok': False, 'err': 'invalid id'}, 400)
                return
            d = _idol_dir(iid)
            if not os.path.isdir(d):
                self._send_json({'ok': False, 'err': 'idol not found'}, 404)
                return
            prof = _read_json(os.path.join(d, 'profile.json'), {})
            media = _read_json(os.path.join(d, 'media.json'), [])
            srcs = _read_json(os.path.join(d, 'sources.json'), [])
            self._send_json({'ok': True, 'id': iid, 'profile': prof,
                             'media': media, 'sources': srcs})
        except Exception as e:
            log.info('[GET /api/idol/detail] 500: %s' % e)
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- GET /api/idol/file?id=xxx&rel=images/xx.jpg ----------
    def _handle_idol_file(self, qs):
        """private 媒体代理读：严格限制在 private/idols/<id>/ 内，../ 越权 403。
        w=<像素> 时按需返回缩略图（缓存 .thumbs/），瀑布流/头像加载提速；不带 w 返回原图。"""
        try:
            iid = _safe_id((qs.get('id') or [''])[0])
            rel = (qs.get('rel') or [''])[0]
            wraw = (qs.get('w') or [''])[0]
            if not iid or not rel:
                self._send_json({'ok': False, 'err': 'need id & rel'}, 400)
                return
            base = _idol_dir(iid)
            target = os.path.normpath(os.path.join(base, rel))
            # 越权校验：解析后绝对路径必须以偶像目录（含分隔符）为前缀
            if not (target == base or target.startswith(base + os.sep)):
                self._send_json({'ok': False, 'err': 'path traversal denied'}, 403)
                return
            if not os.path.isfile(target):
                self._send_json({'ok': False, 'err': 'file not found'}, 404)
                return
            # 缩略图模式：仅图片且 w 合法时走缩略缓存
            serve = target
            try:
                w = int(wraw)
                ext = os.path.splitext(target)[1].lower()
                if 32 <= w <= 1280 and ext in ('.jpg', '.jpeg', '.png', '.webp', '.bmp'):
                    tp = _thumb_for(target)
                    if tp:
                        serve = tp
            except (ValueError, TypeError):
                pass
            with open(serve, 'rb') as f:
                blob = f.read()
            ext = os.path.splitext(serve)[1].lower()
            guess = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
                     'gif': 'image/gif', 'webp': 'image/webp', 'bmp': 'image/bmp',
                     'mp4': 'video/mp4', 'json': 'application/json', 'md': 'text/plain; charset=utf-8'}
            ctype = guess.get(ext.lstrip('.'), 'application/octet-stream')
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(blob)))
            self.send_header('Cache-Control', 'private, max-age=300')
            self.end_headers()
            self.wfile.write(blob)
        except Exception as e:
            log.info('[GET /api/idol/file] 500: %s' % e)
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

    # ---------- POST /api/idol/save ----------
    def _handle_idol_save(self, body):
        try:
            body = body or {}
            if str(body.get('confirmed', '')).lower() != 'true':
                self._send_json({'ok': False, 'need_confirm': True,
                                 'err': '写操作需 confirmed=true（建档/改档须用户确认）'}, 400)
                return
            iid = _safe_id(body.get('id'))
            if not iid:
                self._send_json({'ok': False, 'err': 'invalid id'}, 400)
                return
            prof = body.get('profile') or {}
            prof['name'] = str(prof.get('name') or iid)[:80]
            prof['updated'] = time.strftime('%Y-%m-%d %H:%M:%S')
            d = _idol_dir(iid)
            with _idol_lock:
                exist = _read_json(os.path.join(d, 'profile.json'), {})
                exist.update(prof)
                _write_json(os.path.join(d, 'profile.json'), exist)
                if not os.path.exists(os.path.join(d, 'media.json')):
                    _write_json(os.path.join(d, 'media.json'), [])
                if 'sources' in body:
                    _write_json(os.path.join(d, 'sources.json'), body['sources'] or [])
            self._send_json({'ok': True, 'id': iid})
        except Exception as e:
            log.info('[POST /api/idol/save] 500: %s' % e)
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- POST /api/idol/media/add ----------
    def _handle_idol_media_add(self, body):
        try:
            body = body or {}
            iid = _safe_id(body.get('id'))
            item = body.get('item') or {}
            if not iid or not item.get('type'):
                self._send_json({'ok': False, 'err': 'need id & item.type'}, 400)
                return
            d = _idol_dir(iid)
            if not os.path.isdir(d):
                self._send_json({'ok': False, 'err': 'idol not found（先建档）'}, 404)
                return
            itype = str(item.get('type'))[:16]
            url = str(item.get('url') or '')[:2048]
            rec = {
                'id': str(item.get('id') or ('m%08x' % (int(time.time() * 1000) & 0xffffff))),
                'type': itype,
                'url': url,
                'localPath': None,
                'thumb': str(item.get('thumb') or '')[:2048],
                'title': str(item.get('title') or '')[:200],
                'source_site': str(item.get('source_site') or '')[:60],
                'source_url': str(item.get('source_url') or '')[:2048],
                'collected_by': str(item.get('collected_by') or 'user')[:10],
                'tags': [str(t)[:60] for t in (item.get('tags') or [])[:12]],
                'note': str(item.get('note') or '')[:500],
                'collected_at': time.strftime('%Y-%m-%d %H:%M:%S'),
                'generated': bool(item.get('generated', False)),
            }
            if itype == 'video':
                rec['playVia'] = str(item.get('playVia') or 'ivideo')[:32]
            archived = False
            if itype == 'image' and url.startswith('https://') and not item.get('no_archive'):
                rel, size, aerr = _archive_image(iid, url, referer=str(item.get('source_url') or '') or None)
                if rel:
                    rec['localPath'] = 'private/idols/%s/%s' % (iid, rel)
                    rec['bytes'] = size
                    archived = True
                elif aerr:
                    rec['archive_err'] = aerr[:200]
            with _idol_lock:
                media = _read_json(os.path.join(d, 'media.json'), [])
                # 按 url 去重
                media = [m for m in media if m.get('url') != url or not url]
                media.insert(0, rec)
                _write_json(os.path.join(d, 'media.json'), media)
            self._send_json({'ok': True, 'id': iid, 'item': rec,
                             'archived': archived, 'total': len(media)})
        except Exception as e:
            log.info('[POST /api/idol/media/add] 500: %s' % e)
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- POST /api/idol/avatar/set ----------
    def _handle_idol_avatar_set(self, body):
        """把已归档图片设为偶像头像：复制为 avatar.jpg（列表头像用本地缩略图加载快）。"""
        try:
            body = body or {}
            iid = _safe_id(body.get('id'))
            mid = str(body.get('media_id') or '')
            if not iid or not mid:
                self._send_json({'ok': False, 'err': 'need id & media_id'}, 400)
                return
            d = _idol_dir(iid)
            if not os.path.isdir(d):
                self._send_json({'ok': False, 'err': 'idol not found'}, 404)
                return
            media = _read_json(os.path.join(d, 'media.json'), [])
            hit = next((m for m in media if str(m.get('id')) == mid), None)
            if not hit:
                self._send_json({'ok': False, 'err': 'media not found'}, 404)
                return
            lp = hit.get('localPath')
            if not lp:
                self._send_json({'ok': False, 'err': '该图片未本地归档，无法设为头像'}, 400)
                return
            base = _idol_dir(iid)
            rel = lp.replace('private/idols/%s/' % iid, '').replace('\\', '/')
            src = os.path.normpath(os.path.join(base, rel))
            if not (src.startswith(base + os.sep) and os.path.isfile(src)):
                self._send_json({'ok': False, 'err': 'local file missing'}, 404)
                return
            import shutil
            shutil.copyfile(src, os.path.join(base, 'avatar.jpg'))
            prof = _read_json(os.path.join(base, 'profile.json'), {})
            prof['avatarRel'] = 'avatar.jpg'
            prof['updated'] = time.strftime('%Y-%m-%d %H:%M:%S')
            _write_json(os.path.join(base, 'profile.json'), prof)
            self._send_json({'ok': True, 'id': iid, 'avatarRel': 'avatar.jpg'})
        except Exception as e:
            log.info('[POST /api/idol/avatar/set] 500: %s' % e)
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- POST /api/idol/delete ----------
    def _handle_idol_delete(self, body):
        """删除整个偶像档案：profile/media/sources/avatar/images 全部物理删除（用户确认后才触发）。"""
        try:
            body = body or {}
            iid = _safe_id(body.get('id'))
            if not iid:
                self._send_json({'ok': False, 'err': 'invalid id'}, 400)
                return
            d = _idol_dir(iid)
            if not os.path.isdir(d):
                self._send_json({'ok': False, 'err': 'idol not found'}, 404)
                return
            # 安全校验：目录必须严格位于 _IDOL_ROOT 下
            if not d.startswith(_IDOL_ROOT + os.sep):
                self._send_json({'ok': False, 'err': 'forbidden path'}, 403)
                return
            import shutil
            with _idol_lock:
                shutil.rmtree(d)
            self._send_json({'ok': True, 'id': iid})
        except Exception as e:
            log.info('[POST /api/idol/delete] 500: %s' % e)
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- POST /api/idol/media/remove ----------
    def _handle_idol_media_remove(self, body):
        """按媒体 id 删除条目；有本地落盘文件的一并物理删除（用户明确点删除才触发）。"""
        try:
            body = body or {}
            iid = _safe_id(body.get('id'))
            mid = str(body.get('media_id') or '')
            if not iid or not mid:
                self._send_json({'ok': False, 'err': 'need id & media_id'}, 400)
                return
            d = _idol_dir(iid)
            if not os.path.isdir(d):
                self._send_json({'ok': False, 'err': 'idol not found'}, 404)
                return
            with _idol_lock:
                media = _read_json(os.path.join(d, 'media.json'), [])
                hit = next((m for m in media if str(m.get('id')) == mid), None)
                if not hit:
                    self._send_json({'ok': False, 'err': 'media not found'}, 404)
                    return
                lp = hit.get('localPath')
                if lp:
                    base = _idol_dir(iid)
                    rel = lp.replace('private/idols/%s/' % iid, '').replace('\\', '/')
                    target = os.path.normpath(os.path.join(base, rel))
                    if target.startswith(base + os.sep) and os.path.isfile(target):
                        try:
                            os.remove(target)
                        except Exception:
                            pass
                media = [m for m in media if str(m.get('id')) != mid]
                _write_json(os.path.join(d, 'media.json'), media)
            self._send_json({'ok': True, 'id': iid, 'removed': mid, 'total': len(media)})
        except Exception as e:
            log.info('[POST /api/idol/media/remove] 500: %s' % e)
            self._send_json({'ok': False, 'err': str(e)}, 500)
