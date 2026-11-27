# -*- coding: utf-8 -*-
"""i音乐 API 域（策划案-i音乐 v1.0）
GET  /api/music/search?kw=&type=1   -> 网易云公开搜索（元数据/列表）
GET  /api/music/song?kw=&type=1     -> 同 search（语义别名，前端主用）
GET  /api/music/lyric?id=           -> 网易云歌词(LRC)
GET  /api/music/play?id=&kw=        -> 播放链接：B站搜索->选视频->音频流直通(302到代理)
GET  /api/music/bstream?kw=         -> B站搜索+ffmpeg转MP3流（核心验证链路，带磁盘LRU缓存）
GET  /api/music/local               -> 本地音乐扫描(public/music/local/，真源已统一到项目根 public)
说明：网易云 player/url 实测对免费歌也返回 url:null（反驳师/突破师双验证），
故播放链路唯一在线源为 B 站音频流 -> ffmpeg 转 MP3；本地 mp3 为保守兜底。
缓存：server/data/music_cache/ 200MB LRU（复用漫画柜 LRU 模式）。
"""
import hashlib
import json
import os
import re
import subprocess
import threading
import urllib.parse
import urllib.request

from routes.dispatcher import route_get_prefix

# 插件路径适配（T2.4 批量）：副本位于 plugins/route.music/，重指 __file__ 到源路径，
# 使全部 dirname 链（server/routes → server → 项目根）与源文件语义一致，逻辑零改动
__file__ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'server', 'routes', 'domain_music.py')
from routes._shared import *  # noqa: F401,F403

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_CACHE_DIR = os.path.join(_BASE, 'server', 'data', 'music_cache')
# 【双副本消灭 2026-11-10】server/public 已退役为构建产物，本地音乐真源改为项目根 public/music/local
_LOCAL_DIR = os.path.join(_BASE, 'public', 'music', 'local')
_CACHE_MAX = 200 * 1024 * 1024  # 200MB LRU（进化师建议：必须有上限，防爆盘）
_FFMPEG = r'C:\ffmpeg\bin\ffmpeg.exe'

_cache_lock = threading.Lock()
_bs_jobs = {}  # bstream 后台转码防重：{cache_key: True}
UA_HEADERS = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
              'Referer': 'https://music.163.com'}
# B站风控要求：Referer 必须是 bilibili 域 + 游客 cookie（真实 buvid3/ticket 从浏览器提取）
_BILI_COOKIE_FILE = os.path.join(_BASE, 'server', 'data', 'bili_cookie.txt')
def _load_bili_cookie():
    """每次调用读 cookie 文件（mtime 变化才重读）→ 免重启换登录态。"""
    global _BILI_COOKIE, _BILI_COOKIE_MTIME
    try:
        m = os.path.getmtime(_BILI_COOKIE_FILE)
        if m != _BILI_COOKIE_MTIME:
            _BILI_COOKIE_MTIME = m
            _BILI_COOKIE = open(_BILI_COOKIE_FILE, encoding='utf-8').read().strip()
    except Exception:
        pass
    return _BILI_COOKIE

_BILI_COOKIE_MTIME = 0.0
_BILI_COOKIE = 'buvid3=ZFMusic; b_nut=1730000000'
_BILI_COOKIE = _load_bili_cookie()

def _bili_headers():
    """动态 B站 headers（cookie 热更新）。
    【2026-11-10 四修·根因】B站风控按 Referer 分级：Referer=www.bilibili.com 的
    服务端请求一律返回 5427 字节风控 HTML；Referer=search.bilibili.com 直接放行
    （同机同 cookie 实测对比）。CDN 拉流则必须带浏览器 UA（缺 UA 返回 403）。"""
    return {'User-Agent': UA_HEADERS['User-Agent'],
            'Referer': 'https://search.bilibili.com/',
            'Accept': 'application/json, text/plain, */*',
            'Cookie': _load_bili_cookie()}
BILI_HEADERS = {'User-Agent': UA_HEADERS['User-Agent'],
                'Referer': 'https://www.bilibili.com',
                'Cookie': _BILI_COOKIE}  # 注意：调用方请改用 _bili_headers()

# ---- B站 wbi 签名（search API 必须带 w_rid，否则返回风控 HTML 页）----
_WBI_MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
              33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
              61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
              36, 20, 34, 44, 52]
_wbi_cache = {'keys': None, 'ts': 0}


def _wbi_keys():
    """从 nav 接口取 wbi img/sub key，缓存 12h。"""
    import time as _time
    now = _time.time()
    if _wbi_cache['keys'] and now - _wbi_cache['ts'] < 12 * 3600:
        return _wbi_cache['keys']
    d = _http_json('https://api.bilibili.com/x/web-interface/nav', headers=_bili_headers())
    img = d['data']['wbi_img']
    ik = img['img_url'].rsplit('/', 1)[1].split('.')[0]
    sk = img['sub_url'].rsplit('/', 1)[1].split('.')[0]
    _wbi_cache['keys'] = (ik, sk)
    _wbi_cache['ts'] = now
    return ik, sk


def _wbi_sign(params):
    """wbi 签名：加 wts、按 key 排序、md5(q + mixin(key)) 得 w_rid。"""
    import time as _time
    ik, sk = _wbi_keys()
    p = dict(params)
    p['wts'] = str(int(_time.time()))
    p = dict(sorted(p.items()))
    q = urllib.parse.urlencode(p)
    p['w_rid'] = hashlib.md5((q + ik + sk).encode()).hexdigest()
    return urllib.parse.urlencode(p)


def _http_json(url, timeout=10, headers=None):
    # 【2026-11-10 修】B站对 python-urllib 的 TLS 指纹风控（返回5464字节HTML页非JSON），
    # 实测 curl 同参数返回正常 JSON——统一改走 curl 子进程。
    import subprocess as _sp, shutil as _sh
    _curl = _sh.which('curl') or r'C:\Windows\System32\curl.exe'
    # 【2026-11-10 二修】本机 curl(libcurl 无 zlib) 不支持 --compressed，传了直接
    # 报错退出、stdout 为空——去掉该参数，改显式 Accept-Encoding: identity。
    cmd = [_curl, '-s', '-m', str(timeout),
           '-H', 'Accept-Encoding: identity',
           '-H', 'User-Agent: ' + (headers or UA_HEADERS)['User-Agent']]
    for k, v in (headers or UA_HEADERS).items():
        if k.lower() != 'user-agent':
            cmd += ['-H', '%s: %s' % (k, v)]
    cmd.append('--')
    cmd.append(url)
    p = _sp.run(cmd, stdout=_sp.PIPE, stderr=_sp.DEVNULL, timeout=timeout + 5)
    return json.loads(p.stdout.decode('utf-8', 'replace'))


def _http_raw(url, timeout=30, headers=None):
    """二进制下载（音频流），同样走 curl 防指纹风控。"""
    import subprocess as _sp, shutil as _sh
    _curl = _sh.which('curl') or r'C:\Windows\System32\curl.exe'
    # 【2026-11-10 二修】本机 curl(libcurl 无 zlib) 不支持 --compressed，传了直接
    # 报错退出、stdout 为空——去掉该参数，改显式 Accept-Encoding: identity。
    cmd = [_curl, '-s', '-m', str(timeout),
           '-H', 'Accept-Encoding: identity',
           '-H', 'User-Agent: ' + (headers or UA_HEADERS)['User-Agent']]
    for k, v in (headers or UA_HEADERS).items():
        if k.lower() != 'user-agent':
            cmd += ['-H', '%s: %s' % (k, v)]
    cmd.append('--')
    cmd.append(url)
    p = _sp.run(cmd, stdout=_sp.PIPE, stderr=_sp.DEVNULL, timeout=timeout + 30)
    if not p.stdout:
        raise RuntimeError('curl empty: %s' % url[:80])
    return p.stdout


def _safe_audio_url(url):
    """【2026-11-10 安全修】SSRF 防护：音频流直链必须属 B站 CDN 域（安全师建议）。"""
    host = (urllib.parse.urlparse(url).hostname or '').lower()
    if not any(host == d or host.endswith('.' + d)
               for d in ('bilivideo.com', 'bilivideo.cn', 'bilibili.com', 'akamaized.net')):
        raise RuntimeError('audio host not allowed: %s' % host)
    return url


def _fmt_song(s):
    try:
        return {
            'id': s.get('id'),
            'name': s.get('name'),
            'artist': '/'.join(a.get('name', '') for a in s.get('artists', [])),
            'album': (s.get('album') or {}).get('name', ''),
            'pic': (s.get('album') or {}).get('picUrl', ''),
            'duration': s.get('duration', 0),
            'fee': s.get('fee', 0),
        }
    except Exception:
        return None


def _cache_touch(key):
    with _cache_lock:
        try:
            os.utime(os.path.join(_CACHE_DIR, key), None)
        except Exception:
            pass


def _cache_evict():
    with _cache_lock:
        try:
            files = [(os.path.getmtime(os.path.join(_CACHE_DIR, f)),
                      os.path.getsize(os.path.join(_CACHE_DIR, f)), f)
                     for f in os.listdir(_CACHE_DIR)
                     if os.path.isfile(os.path.join(_CACHE_DIR, f))]
            total = sum(s for _, s, _ in files)
            if total <= _CACHE_MAX:
                return
            files.sort()  # 最旧优先
            for _, size, f in files:
                if total <= _CACHE_MAX:
                    break
                try:
                    os.remove(os.path.join(_CACHE_DIR, f))
                    total -= size
                except Exception:
                    pass
        except Exception:
            pass


def _netease_search(kw, limit=20):
    q = urllib.parse.urlencode({'s': kw, 'type': 1, 'limit': limit, 'offset': 0})
    d = _http_json('https://music.163.com/api/search/get?%s' % q)
    songs = [x for x in (_fmt_song(s) for s in d.get('result', {}).get('songs', [])) if x]
    return songs


def _bilibili_search(kw):
    """B站网页搜索 API（带 wbi 签名，游客 cookie 即可）。"""
    q = _wbi_sign({
        'search_type': 'video', 'keyword': kw, 'page': 1, 'page_size': 10,
        'order': 'totalrank', 'duration': 0})
    d = _http_json('https://api.bilibili.com/x/web-interface/search/type?%s' % q, headers=_bili_headers())
    if d.get('code') != 0:
        raise RuntimeError('bilibili api code=%s' % d.get('code'))
    out = []
    for v in (d.get('data', {}).get('result') or [])[:10]:
        # 优先选时长 60~500s 的（接近歌曲长度）
        out.append({'bvid': v.get('bvid'), 'title': re.sub(r'<[^>]+>', '', v.get('title', '')),
                    'duration': v.get('duration', 0), 'author': v.get('author', ''),
                    'play': v.get('play', 0)})
    return out


def _bilibili_audio_url(bvid):
    """取 B站视频首选音频流直链（不带 CDN cookie 的 dash 音频）。"""
    cid_api = 'https://api.bilibili.com/x/web-interface/view?bvid=%s' % urllib.parse.quote(bvid)
    v = _http_json(cid_api, headers=_bili_headers())
    if v.get('code') != 0:
        raise RuntimeError('view code=%s' % v.get('code'))
    cid = v['data']['cid']
    # 【2026-11-10 三修】playurl 需 wbi 签名；游客态 dash 被软拒(v_voucher)，
    # 实测 platform=html5 + high_quality=1 返回 durl mp4 直链（浏览器上下文验证 code=0）
    q = _wbi_sign({'bvid': bvid, 'cid': cid, 'qn': 64, 'fnval': 4048, 'fnver': 0,
                   'platform': 'html5', 'high_quality': 1})
    p = _http_json('https://api.bilibili.com/x/player/wbi/playurl?%s' % q, headers=_bili_headers())
    if p.get('code') != 0:
        raise RuntimeError('playurl code=%s' % p.get('code'))
    data = p.get('data') or {}
    if not data or data.get('v_voucher'):
        raise RuntimeError('playurl soft-block(v_voucher): 需登录态')
    dash = data.get('dash') or {}
    audios = dash.get('audio') or []
    if audios:
        return audios[0]['baseUrl'] or audios[0]['base_url']
    durl = data.get('durl') or []
    if durl:
        return durl[0].get('url') or durl[0].get('first_url')
    raise RuntimeError('no audio stream')


def _bilibili_video_url(bvid):
    """取 B站视频 durl mp4 直链（platform=html5，可直接 video 播放，i视频用）。"""
    cid_api = 'https://api.bilibili.com/x/web-interface/view?bvid=%s' % urllib.parse.quote(bvid)
    v = _http_json(cid_api, headers=_bili_headers())
    if v.get('code') != 0:
        raise RuntimeError('view code=%s' % v.get('code'))
    cid = v['data']['cid']
    q = _wbi_sign({'bvid': bvid, 'cid': cid, 'qn': 64, 'fnval': 4048, 'fnver': 0,
                   'platform': 'html5', 'high_quality': 1})
    p = _http_json('https://api.bilibili.com/x/player/wbi/playurl?%s' % q, headers=_bili_headers())
    if p.get('code') != 0:
        raise RuntimeError('playurl code=%s' % p.get('code'))
    data = p.get('data') or {}
    if not data or data.get('v_voucher'):
        raise RuntimeError('playurl soft-block(v_voucher): 需登录态')
    durl = data.get('durl') or []
    if durl:
        return durl[0].get('url') or durl[0].get('first_url')
    dash = data.get('dash') or {}
    vids = dash.get('video') or []
    if vids:
        return vids[0]['baseUrl'] or vids[0]['base_url']
    raise RuntimeError('no video stream')


@route_get_prefix('/api/music/')
def _h_music(handler, path, parsed):
    # 【2026-11-10 修】实测 dispatcher 传来的 parsed 可能是：原始 query 字符串、urlparse
    # 结果（.query 为字符串）、或已解析 dict——三种形态统一归一为 {k: [v]}。
    _p = parsed
    if isinstance(_p, str):
        _p = urllib.parse.urlparse(_p if '?' in _p or '/' in _p else '?' + _p)
    _q = getattr(_p, 'query', None)
    qs = urllib.parse.parse_qs(_q) if isinstance(_q, str) else (_q or {})
    if path == '/api/music/search' or path == '/api/music/song':
        kw = (qs.get('kw') or [''])[0].strip()
        if not kw:
            return handler._send_json({'ok': False, 'err': 'kw required'}, 400)
        try:
            songs = _netease_search(kw)
            handler._send_json({'ok': True, 'songs': songs, 'kw': kw})
        except Exception as e:
            handler._send_json({'ok': False, 'err': str(e)}, 502)
        return
    if path == '/api/music/lyric':
        sid = (qs.get('id') or [''])[0]
        if not sid.isdigit():
            return handler._send_json({'ok': False, 'err': 'id required'}, 400)
        try:
            d = _http_json('https://music.163.com/api/song/lyric?id=%s&lv=1&kv=1&tv=-1' % sid)
            handler._send_json({'ok': True,
                                'lrc': (d.get('lrc') or {}).get('lyric', ''),
                                'tlrc': (d.get('tlyric') or {}).get('lyric', '')})
        except Exception as e:
            handler._send_json({'ok': False, 'err': str(e)}, 502)
        return
    if path == '/api/music/bstream':
        kw = (qs.get('kw') or [''])[0].strip()
        bvid = (qs.get('bvid') or [''])[0].strip()
        if not kw:
            return handler._send_json({'ok': False, 'err': 'kw required'}, 400)
        _handle_bstream(handler, kw, bvid)
        return
    if path == '/api/music/resolve':
        kw = (qs.get('kw') or [''])[0].strip()
        if not kw:
            return handler._send_json({'ok': False, 'err': 'kw required'}, 400)
        _handle_resolve(handler, kw)
        return
    if path == '/api/music/local':
        try:
            items = []
            if os.path.isdir(_LOCAL_DIR):
                for f in sorted(os.listdir(_LOCAL_DIR)):
                    if f.lower().endswith(('.mp3', '.m4a', '.wav', '.flac', '.ogg')):
                        items.append({'name': f, 'url': '/music/local/' + urllib.parse.quote(f)})
            handler._send_json({'ok': True, 'songs': items})
        except Exception as e:
            handler._send_json({'ok': False, 'err': str(e)}, 500)
        return
    handler._send_json({'ok': False, 'err': 'not found: %s' % path}, 404)


def _handle_resolve(handler, kw):
    """按 kw 现搜返回锁定 bvid（队列入队时调用，保证连播确定性——反驳师②修）。"""
    try:
        vids = _bilibili_search(kw)
        if not vids:
            return handler._send_json({'ok': False, 'err': 'B站无结果'}, 404)
        def _dur_s(v):
            d = v.get('duration')
            if isinstance(d, str) and ':' in d:
                try:
                    parts = [int(x) for x in d.split(':')]
                    return sum(p * 60 ** i for i, p in enumerate(reversed(parts)))
                except Exception:
                    return 0
            try:
                return int(d or 0)
            except Exception:
                return 0
        vids.sort(key=lambda v: 0 if 60 <= _dur_s(v) <= 400 else 1)
        handler._send_json({'ok': True, 'bvid': vids[0]['bvid'], 'name': vids[0].get('title', kw)})
    except Exception as e:
        handler._send_json({'ok': False, 'err': str(e)[:60]}, 502)


def _handle_bstream(handler, kw, bvid=None):
    """B站搜索 -> 音频流 -> ffmpeg 转 MP3（磁盘LRU缓存命中直接回文件）。
    bvid 可选：队列连播时锁定指定视频，保证同一首歌确定性命中同一缓存。
    未命中缓存时后台线程转码，先回 202 + retry，避免阻塞单线程 server 的搜索/切歌 API。
    """
    key = hashlib.sha1(('bs:' + kw).encode('utf-8')).hexdigest() + '.mp3'
    os.makedirs(_CACHE_DIR, exist_ok=True)
    path = os.path.join(_CACHE_DIR, key)
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        _cache_touch(key)
        handler.send_response(200)
        handler.send_header('Content-Type', 'audio/mpeg')
        handler.send_header('Content-Length', str(os.path.getsize(path)))
        handler.end_headers()
        with open(path, 'rb') as f:
            while True:
                chunk = f.read(64 * 1024)
                if not chunk:
                    break
                handler.wfile.write(chunk)
        return
    try:
        # bvid 锁定：队列传来的 bvid 优先；否则按 kw 现搜取最优（与历史行为一致）
        if bvid:
            chosen_bvid = bvid
        else:
            vids = _bilibili_search(kw)
            if not vids:
                return handler._send_json({'ok': False, 'err': 'B站无结果'}, 404)
            # 选时长最接近 60~400s 的第一个（B站 duration 可能是秒数或 "m:ss" 字符串）
            def _dur_s(v):
                d = v.get('duration')
                if isinstance(d, str) and ':' in d:
                    try:
                        parts = [int(x) for x in d.split(':')]
                        return sum(p * 60 ** i for i, p in enumerate(reversed(parts)))
                    except Exception:
                        return 0
                try:
                    return int(d or 0)
                except Exception:
                    return 0
            vids.sort(key=lambda v: 0 if 60 <= _dur_s(v) <= 400 else 1)
            chosen_bvid = vids[0]['bvid']
        audio_url = _safe_audio_url(_bilibili_audio_url(chosen_bvid))

        # 【反驳师④修】未命中缓存：回 202 让前端稍后重试，后台线程转码写缓存，不阻塞主线程 API
        if not _bs_jobs.get(key):
            _bs_jobs[key] = True

            def _bg():
                try:
                    audio2 = _http_raw(audio_url, timeout=60, headers=_bili_headers())
                    if not os.path.isfile(_FFMPEG):
                        raise RuntimeError('ffmpeg not found')
                    p2 = subprocess.run([_FFMPEG, '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
                                         '-vn', '-acodec', 'libmp3lame', '-b:a', '128k', '-f', 'mp3',
                                         'pipe:1'], input=audio2, stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE, timeout=120)
                    if p2.returncode != 0 or not p2.stdout:
                        raise RuntimeError('ffmpeg fail')
                    tmp = path + '.part'
                    with open(tmp, 'wb') as f:
                        f.write(p2.stdout)
                    os.replace(tmp, path)  # 原子改名，防半截缓存
                    _cache_touch(key)
                    _cache_evict()
                except Exception:
                    pass
                finally:
                    _bs_jobs.pop(key, None)

            threading.Thread(target=_bg, daemon=True).start()
        handler.send_response(202)
        handler.send_header('Content-Type', 'application/json')
        handler.end_headers()
        handler.wfile.write(b'{"ok":true,"pending":true}')
    except Exception as e:
        # 【2026-11-10 安全修】不回显内部错误详情（可能泄漏 URL 片段），只给简短原因码
        msg = str(e)
        brief = 'B站风控拦截' if ('5464' in msg or 'code=' in msg or 'Expecting' in msg) else msg[:60]
        try:
            handler._send_json({'ok': False, 'err': '播放失败: %s' % brief}, 502)
        except Exception:
            pass
