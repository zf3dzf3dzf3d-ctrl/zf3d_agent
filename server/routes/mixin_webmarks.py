# -*- coding: utf-8 -*-
"""Mixin: i网页 书签 + proxy 阅读抓取 API（S1+S2 垂直切片，2026-11-11）
GET  /api/webmarks           -> 书签清单（server/data/webmarks.json）
POST /api/webmarks           -> 新增/删除书签 {action:'add'|'del', item|id}
GET  /api/webpage/fetch?url=xx -> proxy 抓取（黑名单拦截+SSRF 防护，返回原始 HTML 供 iframe srcdoc 渲染）
安全（2026-11-12 v2 裁决：白名单→黑名单，默认放行绝大多数站点）：
- 抓取黑名单真源=private/i-web-blocked.json domains[]；private/ 缺失时回退模板 server/config/i-web-blocked.example.json（domains=[] 即默认全放行）
- 黑名单路径每次调用实时解析（_blocked_path），含子域匹配；仅命中黑名单才 403
- 出站一律 net_guard.guard_fetch：verify=True 强制证书校验（S6 门禁 grep verify=False 须 0 命中）
- 上限 8MB（正文场景用不到大文件）；SSRF 复用 net_guard
- 缓存：同一 URL 10 分钟内存缓存（策划案 §九 裁决：缓存是一期能力，防重复抓+限流）
【锁审计】_wm_lock 仅保护书签 json 读写，无嵌套获取，无死锁风险。
"""
import os, json, re, html, urllib.parse, threading, time
from routes._shared import *
import logging
from util_net_guard import guard_fetch

from util_log import get_logger

log = get_logger('webmarks')
_WM_PATH = os.path.normpath(os.path.join(BASE_DIR, 'server', 'data', 'webmarks.json'))
_wm_lock = threading.Lock()
_FETCH_MAX_BYTES = 8 * 1024 * 1024
_CACHE_TTL = 600  # 秒
_fetch_cache = {}  # url -> (ts, {ok,title,text})  内存缓存，重启即清

_DEFAULT_BOOKMARKS = [
    {'id': 'baidu', 'name': '百度搜索', 'url': 'https://www.baidu.com'},
    {'id': 'google', 'name': '谷歌搜索', 'url': 'https://www.google.com'},
    {'id': 'bing', 'name': '必应搜索', 'url': 'https://www.bing.com'},
    {'id': 'yandex', 'name': '俄罗斯搜索(Yandex)', 'url': 'https://yandex.com'},
    {'id': 'ukr', 'name': '乌克兰搜索(ukr.net)', 'url': 'https://search.ukr.net'},
    {'id': 'gh-trending', 'name': 'GitHub Trending', 'url': 'https://github.com/trending'},
    {'id': 'wiki', 'name': '维基百科', 'url': 'https://zh.wikipedia.org/wiki/Wikipedia:%E9%A6%96%E9%A1%B5'},
]


# 黑名单路径实时解析（2026-11-12 v2 裁决：白名单→黑名单，默认放行绝大多数站点）
def _blocked_path():
    p = os.path.normpath(os.path.join(BASE_DIR, 'private', 'i-web-blocked.json'))
    if os.path.exists(p):
        return p
    return os.path.normpath(os.path.join(BASE_DIR, 'server', 'config', 'i-web-blocked.example.json'))


def _wm_load():
    try:
        with open(_WM_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return list(_DEFAULT_BOOKMARKS)


def _wm_save(marks):
    tmp = _WM_PATH + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(marks, f, ensure_ascii=False, indent=1)
    try: os.replace(tmp, _WM_PATH)
    except Exception:
        with open(_WM_PATH, 'w', encoding='utf-8') as f:
            json.dump(marks, f, ensure_ascii=False, indent=1)


def _web_blocked_domains():
    """黑名单（2026-11-12 v2：白名单→黑名单，默认全部放行，仅拦名单内域名）。"""
    try:
        with open(_blocked_path(), 'r', encoding='utf-8-sig') as f:
            return [d.lower() for d in json.load(f).get('domains', [])]
    except Exception:
        return []


def _host_blocked(host):
    host_l = (host or '').lower()
    return any(host_l == d or host_l.endswith('.' + d) for d in _web_blocked_domains())


def _extract_readable(raw_html, max_chars=20000):
    """轻量净化：去 script/style/nav 等，抽 <title>，正文转纯文本。"""
    try:
        title_m = re.search(r'<title[^>]*>(.*?)</title>', raw_html, re.S | re.I)
        title = html.unescape(re.sub(r'<[^>]+>', '', title_m.group(1))).strip()[:200] if title_m else ''
    except Exception:
        title = ''
    txt = raw_html
    # 去掉非正文区块
    txt = re.sub(r'(?is)<(script|style|noscript|svg|head|nav|footer|header|form|iframe)[^>]*>.*?</\1>', ' ', txt)
    txt = re.sub(r'(?is)<!--.*?-->', ' ', txt)
    # 块级标签换行，行内标签去壳
    txt = re.sub(r'(?i)</(p|div|li|h[1-6]|tr|br|section|article)>', '\n', txt)
    txt = re.sub(r'(?i)<br[^>]*>', '\n', txt)
    txt = re.sub(r'<[^>]+>', '', txt)
    txt = html.unescape(txt)
    txt = re.sub(r'[ \t\r\f\v]+', ' ', txt)
    txt = re.sub(r'\n\s*\n+', '\n\n', txt).strip()
    lines = [ln.strip() for ln in txt.split('\n') if len(ln.strip()) >= 2]
    return title, '\n'.join(lines)[:max_chars]


class _WebmarksMixin(object):
    def _handle_webmarks_get(self):
        try:
            self._send_json({'ok': True, 'list': _wm_load()})
        except Exception as e:
            log.info(f'[GET /api/webmarks] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_webmarks_post(self, body):
        try:
            action = body.get('action') or 'add'
            with _wm_lock:
                marks = _wm_load()
                if action == 'add':
                    name = str(body.get('name') or '')[:100].strip()
                    url = str(body.get('url') or '')[:2048].strip()
                    if not name or not url.startswith(('http://', 'https://')):
                        self._send_json({'ok': False, 'err': 'invalid name or url'}, 400)
                        return
                    marks.append({'id': 'wm-%d' % int(time.time() * 1000), 'name': name, 'url': url})
                elif action == 'del':
                    wid = str(body.get('id') or '')
                    marks = [m for m in marks if m.get('id') != wid]
                else:
                    self._send_json({'ok': False, 'err': 'unknown action'}, 400)
                    return
                _wm_save(marks)
            self._send_json({'ok': True, 'list': marks})
        except Exception as e:
            log.info(f'[POST /api/webmarks] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_webpage_fetch(self, qs):
        url = (qs.get('url') or [''])[0].strip()[:2048]
        if not url.startswith(('http://', 'https://')):
            self._send_json({'ok': False, 'err': 'invalid url'}, 400)
            return
        host = urllib.parse.urlparse(url).hostname or ''
        if _host_blocked(host):
            self._send_json({'ok': False, 'err': 'domain in blacklist'}, 403)
            return
        # 内存缓存（策划案裁决：缓存是一期能力）
        now = time.time()
        hit = _fetch_cache.get(url)
        if hit and now - hit[0] < _CACHE_TTL:
            self._send_json(dict(hit[1], cached=True))
            return
        try:
            # 2026-11-12 v2：黑名单裁决（不再传 allow_domains）；require_https=False 兼容 http 站
            data, ctype = guard_fetch(url, timeout=10, max_bytes=_FETCH_MAX_BYTES,
                                      allow_domains=None, require_https=False)
            if 'html' not in ctype and 'text' not in ctype and 'xml' not in ctype:
                self._send_json({'ok': False, 'err': 'unsupported content-type: ' + ctype}, 400)
                return
            raw = data.decode('utf-8', errors='replace')
            title, text = _extract_readable(raw)
            # 2026-11-17 v3：HTML 走 webproxy 的 URL 改写（CSS/JS/图片/链接全部改写为
            # /api/webproxy 代理路径），修复沙箱 iframe 直连源站被防盗链/CSP 拦 =「不带 CSS/JS」。
            # 局部 import 防循环依赖（mixin_webproxy 不依赖本模块）。
            try:
                from routes.mixin_webproxy import _rewrite_html
                raw = _rewrite_html(raw, url)
            except Exception as _re:
                logging.warning('[webpage/fetch] rewrite skipped: %s' % _re)
            # v2：额外返回原始 HTML（含 JS/CSS/图片引用），前端走沙箱 iframe 完整渲染
            result = {'ok': True, 'title': title, 'text': text, 'html': raw,
                      'url': url, 'bytes': len(data), 'chars': len(text)}
            if len(_fetch_cache) > 100:
                _fetch_cache.clear()
            _fetch_cache[url] = (now, result)
            self._send_json(result)
        except Exception as e:
            log.info(f'[GET /api/webpage/fetch] err: {e}')
            # 2026-11-18：透出异常类型+摘要（内部诊断接口，不含敏感信息），修复"笼统502无法定位"问题
            # URLError 的关键信息在 .reason（str(e) 常为空），补全透出便于定位
            _msg = str(getattr(e, 'reason', '') or e)
            self._send_json({'ok': False, 'err': 'fetch failed: %s: %s' % (type(e).__name__, _msg[:200])}, 502)
