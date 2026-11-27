# -*- coding: utf-8 -*-
"""Mixin: i图片 多源聚合图库 API（M1）
GET  /api/iimage/sites          -> 站点清单（白名单真源 i-image-sites.json）
GET  /api/iimage/search?wd=xx&page=1 -> 聚合搜索（并发各源，字段归一化）
GET  /api/iimage/proxy?url=xx   -> 图片中转代理（防 CORS/防盗链）
安全（v1.1 裁决）：
- proxy 域名白名单=server/config/i-image-sites.json sites[].domain（单点真源）
- 出站一律 net_guard.guard_fetch：verify=True 强制证书校验（禁止 verify=False）
- Content-Type 仅 image/*，上限 16MB；SSRF 内网拦截复用 net_guard.is_private_host
"""
import os, json, urllib.parse, xml.etree.ElementTree as ET
from routes._shared import *
from routes.mixin_base import MixinBase
import logging
from util_net_guard import guard_fetch  # 出站统一走公共安全模块（收敛第1站）
import threading

from util_log import get_logger

log = get_logger('image')
def _sites_path():
    """白名单路径实时解析（2026-11-11 同构修复，对齐 mixin_webmarks._sites_path）：
    消除 import 期锁死——进程活得比配置久时也能自愈切换 private/ ↔ example 兜底。"""
    p = os.path.normpath(os.path.join(BASE_DIR, 'private', 'i-image-sites.json'))
    if not os.path.exists(p):
        # 分发版兜底：private/ 不随 MIT 分发时，回退到脱敏模板 server/config/i-image-sites.example.json
        p = os.path.normpath(os.path.join(BASE_DIR, 'server', 'config', 'i-image-sites.example.json'))
    return p
_FAVS_PATH = os.path.normpath(os.path.join(BASE_DIR, 'server', 'data', 'favs-image.json'))
_favs_lock = threading.Lock()  # 收藏落盘互斥（与 i漫画/i视频 套路对齐）
_DEFAULT_UA_HEADERS = {'User-Agent': 'ZFImageAgent/1.0 (polite; e621 requires UA)'}
_IMG_MAX_BYTES = 16 * 1024 * 1024

# ===== 提速（2026-11-11 v1.2）：proxy 磁盘缓存 + search 内存缓存 =====
_CACHE_DIR = os.path.normpath(os.path.join(BASE_DIR, 'server', 'data', 'iimg-cache'))
os.makedirs(_CACHE_DIR, exist_ok=True)
_cache_lock = threading.Lock()
_SEARCH_TTL = 60  # 秒
_search_cache = {}  # {cache_key: (monotonic_ts, payload)}

def _img_proxy_cache_get(url):
    """命中返回 (data, ctype)，未命中返回 None"""
    import hashlib
    key = hashlib.sha256(url.encode('utf-8')).hexdigest()[:32]
    path = os.path.join(_CACHE_DIR, key + '.bin')
    try:
        with open(path, 'rb') as f:
            blob = f.read()
        # 头 4 字节存 ctype 长度 + ctype + 数据
        n = int.from_bytes(blob[:4], 'big')
        return blob[4:4+n].decode('utf-8', 'ignore'), blob[4+n:]
    except Exception:
        return None

def _img_proxy_cache_put(url, ctype, data):
    import hashlib
    key = hashlib.sha256(url.encode('utf-8')).hexdigest()[:32]
    path = os.path.join(_CACHE_DIR, key + '.bin')
    try:
        with _cache_lock:
            if not os.path.exists(path):
                head = len(ctype.encode('utf-8')).to_bytes(4, 'big') + ctype.encode('utf-8')
                with open(path, 'wb') as f:
                    f.write(head + data)
    except Exception:
        logging.debug("swallow", exc_info=True)


def _img_load_sites(only_enabled=True):
    try:
        with open(_sites_path(), 'r', encoding='utf-8-sig') as f:
            raw = json.load(f)
        sites = raw.get('sites', [])
        # pollinations AI 生图源代码级内置（2026-11-17）：配置文件会被外部同步回写，
        # 为避免丢源，这里在内存中强制补挂，不落盘
        if not any(s.get('id') == 'pollinations' for s in sites):
            sites.insert(0, {'id': 'pollinations', 'name': 'Pollinations AI生图',
                             'domain': 'image.pollinations.ai',
                             'api': 'https://image.pollinations.ai/prompt/{kw}?width=768&height=512&nologo=true&seed={page}',
                             'status': 'verified', 'need_key': False,
                             'rating_map': {'default': 'sfw'},
                             'note': 'AI生图，免key原生中文；代码内置（配置同步会回写丢弃）',
                             'verified_date': '2026-11-17'})
        # Bing 图片代码级内置（2026-11-18）：质量高、mkt=zh-CN，接口为 images/async HTML
        if not any(s.get('id') == 'bing' for s in sites):
            sites.insert(0, {'id': 'bing', 'name': 'Bing 图片',
                             'domain': 'cn.bing.com',
                             'api': 'https://cn.bing.com/images/async?q={kw}&first={page}&count=35&mkt=zh-CN&mmasync=1',
                             'status': 'verified', 'need_key': False,
                             'rating_map': {'default': 'sfw'},
                             'note': '微软必应图片，质量高；代码内置', 'verified_date': '2026-11-18'})
        # 百度图片代码级内置（2026-11-18）：原生中文搜索、质量与百度图片看齐，
        # 不依赖机翻；配置文件被外部同步回写也不会丢，仅内存补挂
        if not any(s.get('id') == 'baidu' for s in sites):
            sites.insert(0, {'id': 'baidu', 'name': '百度图片',
                             'domain': 'image.baidu.com',
                             'api': 'https://image.baidu.com/search/acjson?tn=resultjson_com&word={kw}&pn={page}&rn=30',
                             'status': 'verified', 'need_key': False,
                             'rating_map': {'default': 'sfw'},
                             'note': '原生中文搜索；代码内置（配置同步会回写丢弃）',
                             'verified_date': '2026-11-18'})
        if only_enabled:
            sites = [s for s in sites if s.get('status') == 'verified' and not s.get('need_key') and s.get('api')]
        return sites
    except Exception:
        logging.debug("swallow", exc_info=True)
        return []


def _img_allowed_domains():
    domains = [s.get('domain') for s in _img_load_sites(only_enabled=False) if s.get('domain')]
    # 图源 CDN 补充（搜索结果的图片实际托管在这些域名，2026-11-11 提速扩源）
    domains += ['live.staticflickr.com', 'upload.wikimedia.org', 'thumb.wikimedia.org',
                'commons.wikimedia.org', 'api.openverse.org', 'image.pollinations.ai',
                'image.baidu.com', 'bdimg.com', 'baidu.com',
                'cn.bing.com', 'bing.com', 'tse2.mm.bing.net', 'mm.bing.net']
    return [d for d in domains if d]


def _norm_rating(site, raw_rating):
    rmap = site.get('rating_map') or {}
    v = str(raw_rating)
    if v in rmap:
        return rmap[v]
    return rmap.get('default', 'sfw')


_norm_rating_done = None  # placeholder marker
# ===== 中英翻译（2026-11-17）：源站全是英文标签站，中文关键词需先译成英文 =====
_trans_cache = {}
_trans_lock = threading.Lock()

def _has_cjk(s):
    return any('\u4e00' <= ch <= '\u9fff' for ch in s)

def _translate_wd(wd):
    """中文关键词→英文（MyMemory 免费接口），失败原样返回"""
    if not wd or not _has_cjk(wd):
        return wd
    with _trans_lock:
        hit = _trans_cache.get(wd)
    if hit is not None:
        return hit
    try:
        api = ('https://api.mymemory.translated.net/get?q='
               + urllib.parse.quote(wd) + '&langpair=zh-CN|en')
        from util_net_guard import guard_fetch as _gf
        data, _ = _gf(api, timeout=5, max_bytes=2 * 1024 * 1024)
        j = json.loads(data.decode('utf-8', 'ignore'))

        def _clean(t):
            t = str(t or '').strip().lower()
            if not t or not t.isascii() or _has_cjk(t):
                return ''
            return t

        candidates = []
        # 优先：matches 里的其它候选（人工翻译条目 usage-count 高更可信，
        # 机翻 responseData 常出 "Beauty Map" 这类怪串导致图源 0 结果）
        for m in (j.get('matches') or []):
            t = _clean((m or {}).get('translation'))
            if t and t != wd.lower():
                candidates.append((int(m.get('usage-count') or 0), t))
        candidates.sort(reverse=True)
        if candidates:
            en = candidates[0][1]
        else:
            en = _clean((j.get('responseData') or {}).get('translatedText'))
        # 只收单词或简单词组，超长机翻串（>3词）拒收防怪词
        if en and en != wd.lower() and len(en.split()) <= 3:
            with _trans_lock:
                _trans_cache[wd] = en
            return en
    except Exception:
        logging.debug('translate fail', exc_info=True)
    return wd


def _img_parse_site(site, wd, page):
    """逐源抓取并归一化为 {id,url,thumb,w,h,source,tags,rating}；单源失败返回 []"""
    sid = site['id']
    out = []
    if sid == 'baidu':
        # 百度图片（2026-11-18）：原生中文搜索。pn 为偏移量=（页码-1)*30
        from util_net_guard import guard_fetch as _gf
        offset = (page - 1) * 60
        req_url = ('https://image.baidu.com/search/acjson?tn=resultjson_com'
                   '&ipn=r&ct=201326592&islist=&fp=result'
                   '&word=' + urllib.parse.quote(wd) +
                   '&pn=%d&rn=60&ie=utf-8&oe=utf-8' % offset)
        data, _ = _gf(req_url, timeout=8, max_bytes=4 * 1024 * 1024,
                      referer='https://image.baidu.com/')
        txt = data.decode('utf-8', 'ignore').strip()
        if txt.endswith(','):
            txt = txt[:-1]
        # acjson 偶发 jsonp 包裹，剥掉
        if txt.startswith('{') is False:
            import re as _re
            m = _re.search(r'\{.*\}', txt, _re.S)
            txt = m.group(0) if m else txt
        try:
            items = json.loads(txt)
        except Exception:
            return []
        # 百度反爬重试（2026-11-18）：偶发 antiFlag=1 "Forbid spider access"，
        # 补 queryWord+gsm 参数带浏览器语义重试一次
        if items.get('antiFlag'):
            import time as _t
            _t.sleep(0.6)
            req_url2 = (req_url.replace('&islist=&', '&gsm=1e&') +
                        '&queryWord=' + urllib.parse.quote(wd) + '&face=0')
            data2, _ = _gf(req_url2, timeout=8, max_bytes=4 * 1024 * 1024,
                           referer='https://image.baidu.com/')
            txt2 = data2.decode('utf-8', 'ignore').strip()
            if txt2.endswith(','):
                txt2 = txt2[:-1]
            if not txt2.startswith('{'):
                import re as _re2
                m2 = _re2.search(r'\{.*\}', txt2, _re2.S)
                txt2 = m2.group(0) if m2 else txt2
            try:
                items = json.loads(txt2)
            except Exception:
                return []
            if items.get('antiFlag'):
                return []
        for it in (items.get('data') or []):
            thumb = it.get('thumbURL') or ''
            url = (it.get('middleURL') or it.get('hoverURL') or it.get('objURL') or thumb)
            if not url:
                continue
            out.append({
                'id': str(it.get('sign') or it.get('ad') or len(out)),
                'source': sid,
                'url': url, 'thumb': thumb,
                'w': int(it.get('width') or 0), 'h': int(it.get('height') or 0),
                'tags': [(it.get('fromPageTitleExt') or it.get('fromPageTitle') or '')[:40]],
                'rating': 'sfw',
            })
        return out
    if sid == 'bing':
        # Bing images/async 返回 HTML，m="..." 内嵌 JSON（2026-11-18 新增）
        import re as _re_b
        from util_net_guard import guard_fetch as _gf
        first = (page - 1) * 35 + 1
        req_url = ('https://cn.bing.com/images/async?q=' + urllib.parse.quote(wd)
                   + '&first=%d&count=35&mkt=zh-CN&mmasync=1' % first)
        data, _ = _gf(req_url, timeout=8, max_bytes=4 * 1024 * 1024)
        html = data.decode('utf-8', 'ignore')
        for mstr in _re_b.findall(r'm="(\{[^"]+?\})"', html)[:35]:
            try:
                it = json.loads(mstr.replace('&quot;', '"').replace('&amp;', '&'))
            except Exception:
                continue
            murl = it.get('murl') or ''
            if not murl:
                continue
            if murl.startswith('http://'):
                murl = 'https://' + murl[len('http://'):]
            tid = it.get('turl') or ''
            if tid.startswith('http'):
                thumb = tid  # turl 本身已是完整缩略图 URL，不再包一层
            elif tid:
                thumb = 'https://tse2.mm.bing.net/th?id=' + urllib.parse.quote(tid, safe='') + '&w=400'
            else:
                thumb = murl
            out.append({
                'id': it.get('hash', '') or murl[:80], 'source': sid,
                'url': murl, 'thumb': thumb,
                'w': int(it.get('mw') or 0), 'h': int(it.get('mh') or 0),
                'tags': [(it.get('t') or '')[:60]], 'rating': 'sfw',
            })
        return out
    api = site['api'].replace('{kw}', urllib.parse.quote(wd)).replace('{page}', str(page))
    headers = _DEFAULT_UA_HEADERS if sid == 'e621' else {}
    if sid == 'pollinations':
        # AI 生图源（2026-11-17 新增）：免 key、原生支持中文、质量高。
        # 每页固定 6 张：seed = kw哈希 + 页码 + 序号，翻页出新图
        import hashlib as _hl
        base_seed = int(_hl.md5(wd.encode('utf-8')).hexdigest()[:8], 16) % 1000000
        for i in range(6):
            seed = base_seed + page * 10 + i
            u = ('https://image.pollinations.ai/prompt/'
                 + urllib.parse.quote(wd)
                 + '?width=768&height=512&nologo=true&seed=%d' % seed)
            out.append({'id': 'pol-%d' % seed, 'source': sid, 'url': u, 'thumb': u,
                        'w': 768, 'h': 512, 'tags': [wd], 'rating': 'sfw'})
        return out
    if sid == 'safebooru':
        # XML dapi
        req_url = api
        from util_net_guard import guard_fetch as _gf
        data, _ = _gf(req_url, timeout=6, max_bytes=4 * 1024 * 1024)
        root = ET.fromstring(data.decode('utf-8', 'ignore'))
        for p in root.iter('post'):
            img = p.get('image') or ''
            if not img:
                continue
            out.append({
                'id': p.get('id'), 'source': sid,
                'url': 'https://safebooru.org/images/' + (p.get('directory') or '') + '/' + img,
                'thumb': 'https://safebooru.org/thumbnails/' + (p.get('directory') or '') + '/' + (p.get('preview') or ''),
                'w': int(p.get('width') or 0), 'h': int(p.get('height') or 0),
                'tags': (p.get('tags') or '').split(' ')[:8],
                'rating': 'sfw',
            })
        return out
    # JSON 源
    from util_net_guard import guard_fetch as _gf
    data, _ = _gf(api, timeout=6, max_bytes=4 * 1024 * 1024)
    items = json.loads(data.decode('utf-8', 'ignore'))
    if sid == 'wallhaven':
        for it in items.get('data', [])[:8]:
            out.append({
                'id': it.get('id'), 'source': sid,
                'url': it.get('path'), 'thumb': it.get('thumbs', {}).get('small') or it.get('thumbs', {}).get('original'),
                'w': it.get('dimension_x'), 'h': it.get('dimension_y'),
                'tags': [t.get('name') for t in (it.get('colors') and [] or it.get('tags') or [])][:8],
                'rating': _norm_rating(site, it.get('purity')),
            })
    elif sid == 'yandere':
        for it in items[:8]:
            out.append({
                'id': it.get('id'), 'source': sid,
                'url': it.get('file_url'), 'thumb': it.get('preview_url'),
                'w': it.get('width'), 'h': it.get('height'),
                'tags': (it.get('tags') or [])[:8],
                'rating': _norm_rating(site, it.get('rating')),
            })
    elif sid == 'e621':
        for it in (items.get('posts') or [])[:8]:
            out.append({
                'id': it.get('id'), 'source': sid,
                'url': (it.get('file') or {}).get('url'), 'thumb': (it.get('preview') or {}).get('url'),
                'w': (it.get('file') or {}).get('width'), 'h': (it.get('file') or {}).get('height'),
                'tags': (it.get('tags') or {}).get('general', [])[:8],
                'rating': _norm_rating(site, it.get('rating')),
            })
    elif sid == 'konachan_net':
        for it in items[:8]:
            out.append({
                'id': it.get('id'), 'source': sid,
                'url': it.get('file_url'), 'thumb': it.get('preview_url'),
                'w': it.get('width'), 'h': it.get('height'),
                'tags': (it.get('tags') or [])[:8],
                'rating': 'sfw',
            })
    elif sid == 'openverse':
        for it in (items.get('results') or [])[:8]:
            out.append({
                'id': it.get('id'), 'source': sid,
                'url': it.get('url'), 'thumb': it.get('thumbnail'),
                'w': it.get('width'), 'h': it.get('height'),
                'tags': [], 'rating': 'sfw',
            })
    elif sid == 'wikimedia':
        pages = ((items.get('query') or {}).get('pages') or {})
        for it in pages.values():
            infos = it.get('imageinfo') or []
            if not infos:
                continue
            info = infos[0]
            thumburl = info.get('thumburl') or info.get('url')
            if not thumburl:
                continue
            out.append({
                'id': it.get('pageid'), 'source': sid,
                'url': info.get('url'), 'thumb': thumburl,
                'w': info.get('width'), 'h': info.get('height'),
                'tags': [it.get('title', '')[:40]], 'rating': 'sfw',
            })
    elif sid == 'iconify':
        for it in (items.get('icons') or [])[:8]:
            svg = 'https://api.iconify.design/' + it + '.svg?height=256'
            out.append({
                'id': it, 'source': sid,
                'url': svg, 'thumb': 'https://api.iconify.design/' + it + '.svg?height=128',
                'w': 256, 'h': 256,
                'tags': [it.split(':')[0]], 'rating': 'sfw',
            })
    elif sid == 'bing':
        # Bing images/async 返回 HTML，m="..." 内嵌 JSON（2026-11-18 新增）
        import re as _re_b
        from util_net_guard import guard_fetch as _gf
        first = (page - 1) * 35 + 1
        req_url = ('https://cn.bing.com/images/async?q=' + urllib.parse.quote(wd)
                   + '&first=%d&count=35&mkt=zh-CN&mmasync=1' % first)
        data, _ = _gf(req_url, timeout=8, max_bytes=4 * 1024 * 1024)
        html = data.decode('utf-8', 'ignore')
        for mstr in _re_b.findall(r'm="(\{[^"]+?\})"', html)[:35]:
            try:
                it = json.loads(mstr.replace('&quot;', '"').replace('&amp;', '&'))
            except Exception:
                continue
            murl = it.get('murl') or ''
            if not murl:
                continue
            if murl.startswith('http://'):
                murl = 'https://' + murl[len('http://'):]
            turl = 'https://cn.bing.com/th?id=' + urllib.parse.quote(it.get('turl') or '', safe='') if it.get('turl') else murl
            out.append({
                'id': it.get('hash', '') or murl[:80], 'source': sid,
                'url': murl,
                'thumb': 'https://tse2.mm.bing.net/th?id=' + urllib.parse.quote(it.get('turl') or murl, safe='') + '&w=400' if it.get('turl') else murl,
                'w': int(it.get('mw') or 0), 'h': int(it.get('mh') or 0),
                'tags': [(it.get('t') or '')[:60]], 'rating': 'sfw',
            })
    elif sid == 'picsum':
        for it in items[:8]:
            out.append({
                'id': it.get('id'), 'source': sid,
                'url': it.get('download_url'), 'thumb': it.get('download_url') + '?w=400',
                'w': it.get('width'), 'h': it.get('height'),
                'tags': [it.get('author', '')], 'rating': 'sfw',
            })
    return out


class MixinImage(MixinBase):

    def _handle_iimage_sites(self):
        try:
            sites = [{'id': s['id'], 'name': s.get('name', s['id']),
                      'status': s.get('status', ''), 'needKey': s.get('need_key', False),
                      'verifiedDate': s.get('verified_date', '')}
                     for s in _img_load_sites(only_enabled=False) if s.get('domain')]
            self._send_json({'ok': True, 'sites': sites})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_iimage_search(self, qs):
        try:
            wd = (qs.get('wd') or [''])[0].strip()
            page = int((qs.get('page') or ['1'])[0] or 1)
            if len(wd) > 60:
                self._send_json({'ok': False, 'err': 'invalid wd'}, 400)
                return
            site_filter = (qs.get('site') or [''])[0].strip()
            sites = _img_load_sites()
            # 【2026-11-18 相关性修复】picsum 是随机图（完全无视关键词），
            # 混在常规源里导致"搜美女出山水/笔记本"。摘出：仅在正经源全空时兜底
            _is_fallback_only = lambda s: s['id'] in ('picsum',)
            sites = [s for s in sites if not _is_fallback_only(s)]
            if site_filter:
                sites = [s for s in sites if s['id'] == site_filter]
            if not sites:
                # picsum 不需要关键词也可兜底出图
                sites = [s for s in _img_load_sites() if s['id'] == 'picsum']
            _fallback_picsum = False  # 标记：正经源全空后补 picsum 兜底
            results = []
            cache_key = 'wd=%s|p=%d|s=%s' % (wd, page, site_filter)
            import time as _time
            now = _time.monotonic()
            with _cache_lock:
                hit = _search_cache.get(cache_key)
                if hit and now - hit[0] < _SEARCH_TTL:
                    self._send_json(hit[1]); return

            en_wd0 = _translate_wd(wd)  # 中文先译英文再搜（2026-11-17）

            def _fetch_one(s):
                try:
                    # 百度图片原生中文（2026-11-18）：直接用原词，不做英文翻译
                    kw = wd if s['id'] == 'baidu' else (en_wd0 or 'landscape')
                    return _img_parse_site(s, kw, page)
                except Exception as e:
                    logging.warning('[iimage/search] site %s fail: %s', s['id'], e)
                    return []

            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=min(8, max(1, len(sites)))) as pool:
                for out in pool.map(_fetch_one, sites):
                    results.extend(out)
            # 【2026-11-18 排序】百度原生中文结果置顶（相关度最高），其余源跟后
            results.sort(key=lambda it: 0 if it.get('source') == 'baidu' else 1)
            # 【2026-11-17 中文兜底】翻译词搜不到时，用中文原词再搜一轮（部分源兼容中文标签），
            # 仍搜不到再回落 'landscape'，避免"美女"这类词因机翻怪串或站不收中文而 0 结果
            if not results and en_wd0 != wd:
                try:
                    with ThreadPoolExecutor(max_workers=min(8, max(1, len(sites)))) as pool2:
                        for out in pool2.map(lambda s: _img_parse_site(s, wd, page), sites):
                            results.extend(out)
                    en_wd0 = wd  # 展示真实生效的关键词
                except Exception:
                    pass
            # 【2026-11-18 兜底延迟】正经源（baidu/bing/wallhaven/...）全空才补随机图，
            # 杜绝"搜美女出来山水/笔记本"这类毫不相关结果
            if not results and not site_filter:
                try:
                    _ps = [s for s in _img_load_sites() if s['id'] == 'picsum']
                    if _ps:
                        results = _img_parse_site(_ps[0], en_wd0 or wd, page)
                except Exception:
                    pass
            en_wd = en_wd0
            payload = {'ok': True, 'wd': wd, 'wd_en': en_wd, 'page': page,
                       'total': len(results), 'list': results}
            with _cache_lock:
                _search_cache[cache_key] = (now, payload)
                # 简单防膨胀：超 200 条清最旧一半
                if len(_search_cache) > 200:
                    for k in sorted(_search_cache, key=lambda k: _search_cache[k][0])[:100]:
                        _search_cache.pop(k, None)
            self._send_json(payload)
        except Exception as e:
            log.info(f'[GET /api/iimage/search] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ===== S5 收藏双写：GET 列表 / POST 增删（落盘 server/data/favs-image.json）=====
    def _handle_iimage_favs_get(self):
        try:
            with _favs_lock:
                favs = []
                if os.path.exists(_FAVS_PATH):
                    with open(_FAVS_PATH, 'r', encoding='utf-8') as f:
                        favs = json.load(f)
            self._send_json({'ok': True, 'list': favs})
        except Exception as e:
            log.info(f'[GET /api/iimage/favs] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_iimage_favs_post(self, body):
        try:
            action = body.get('action') or 'add'
            item = body.get('item') or {}
            # 归一化收藏条目：仅保留展示所需字段，url 必须为 https 白名单内图片
            url = str(item.get('url') or '')[:2048]
            if not url.startswith('https://'):
                self._send_json({'ok': False, 'err': 'invalid url'}, 400)
                return
            rec = {
                'id': str(item.get('id') or '')[:200],
                'url': url,
                'thumb': str(item.get('thumb') or '')[:2048],
                'w': item.get('w'), 'h': item.get('h'),
                'source': str(item.get('source') or '')[:50],
                'tags': [str(t)[:60] for t in (item.get('tags') or [])[:8]],
                'ts': __import__('time').time(),
            }
            with _favs_lock:
                favs = []
                if os.path.exists(_FAVS_PATH):
                    with open(_FAVS_PATH, 'r', encoding='utf-8') as f:
                        favs = json.load(f)
                if action == 'del':
                    favs = [x for x in favs if x.get('url') != url]
                elif action == 'add':
                    if not any(x.get('url') == url for x in favs):
                        favs.insert(0, rec)
                    if len(favs) > 500:
                        favs = favs[:500]
                else:
                    self._send_json({'ok': False, 'err': 'invalid action'}, 400)
                    return
                os.makedirs(os.path.dirname(_FAVS_PATH), exist_ok=True)
                tmp = _FAVS_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(favs, f, ensure_ascii=False)
                os.replace(tmp, _FAVS_PATH)
            self._send_json({'ok': True, 'total': len(favs)})
        except Exception as e:
            log.info(f'[POST /api/iimage/favs] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_iimage_proxy(self, qs):
        """图片中转代理：白名单域名 + Content-Type 仅 image/* + 16MB 上限"""
        try:
            raw = (qs.get('url') or [''])[0]
            if not raw.startswith('https://'):
                self._send_json({'ok': False, 'err': 'only https'}, 400)
                return
            # 先查磁盘缓存（提速 v1.2：缩略图重复加载不再出网）
            cached = _img_proxy_cache_get(raw)
            if cached:
                ctype, data = cached
                if ctype.startswith('image/'):
                    self.send_response(200)
                    self.send_header('Content-Type', ctype)
                    self.send_header('Content-Length', str(len(data)))
                    # [20261123 安全收敛] 移除 Access-Control-Allow-Origin: *：本端点与前端同源，无需 CORS 放行
                    self.send_header('Cache-Control', 'max-age=86400')
                    self.end_headers()
                    self.wfile.write(data)
                    return
            data, ctype = guard_fetch(raw, timeout=(30 if 'pollinations' in raw else 12),
                                      max_bytes=_IMG_MAX_BYTES,
                                      allow_domains=_img_allowed_domains())
            if not ctype.startswith('image/'):
                self._send_json({'ok': False, 'err': 'not an image: ' + ctype}, 400)
                return
            _img_proxy_cache_put(raw, ctype, data)
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            # [20261123 安全收敛] 移除 Access-Control-Allow-Origin: *：本端点与前端同源，无需 CORS 放行
            self.send_header('Cache-Control', 'max-age=86400')
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            log.info(f'[GET /api/iimage/proxy] err: {e}')
            try:
                # 安全裁决：不透传内部异常细节，仅固定文案（2026-11-11 审查）
                self._send_json({'ok': False, 'err': 'proxy fetch failed'}, 502)
            except Exception:
                logging.debug("swallow", exc_info=True)
