# -*- coding: utf-8 -*-
"""Mixin: 内置浏览器同域代理（/api/webproxy）—— iframe 直连真实网页。

原理：
  前端 iframe 加载 /api/webproxy?url=<目标网址>，后端抓取目标页面，
  剥掉 X-Frame-Options / CSP frame-ancestors 等反嵌头，改写页面里的
  URL 继续走本代理（保持同域），让 iframe 能原生渲染并流畅交互。

安全：
  * SSRF 防护：仅允许 http/https，拦截回环/内网地址
  * 响应头剥离：只剥反嵌相关头，其余透传
  * Cookie：服务端 jar 按目标域存储（内存 + data/webproxy_cookies.json 持久化），
    并支持从 Playwright 会话单向同步（登录态共享，AI 可接管）

接口：
  GET/POST /api/webproxy?url=<encoded>&_p=<path?>   页面/资源代理
  GET      /api/webproxy_sync_cookies?session=xxx   Playwright cookies -> 代理 jar
"""
import os
import json
import re
import time
import ipaddress
import socket
import urllib.parse
import urllib.request
import urllib.error

_SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_JAR_PATH = os.path.join(_SERVER_DIR, 'browser_plugin', 'data', 'webproxy_cookies.json')

# 反嵌相关响应头：一律剥掉
_STRIP_HEADERS = {
    'x-frame-options', 'content-security-policy',
    'content-security-policy-report-only',
    'content-encoding', 'content-length', 'transfer-encoding',
    'strict-transport-security', 'cross-origin-opener-policy',
    'cross-origin-embedder-policy', 'cross-origin-resource-policy',
}

# SSRF 防护：拦截回环 / 内网 / 链路本地
_BLOCKED_NETS = [ipaddress.ip_network(n) for n in (
    '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
    '169.254.0.0/16', '0.0.0.0/8', '100.64.0.0/10', '::1/128', 'fc00::/7',
    'fe80::/10',
)]

_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
       '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

_cookie_jar = {}          # host -> {name: {value, path, domain}}
_jar_lock = None          # 惰性建 Lock（import 时建也行，直接建）

import threading
_jar_lock = threading.RLock()

# [20261127 性能] 静态资源磁盘缓存：js/css/图片/字体缓存 TTL 内直接本地回，
# 不出网、不占同域限速。HTML 不缓存（内容易变）。解决 Vue 类 SPA 首屏
# 因代理串行限速慢而长时间露出 {{ }} 裸模板的问题。
_CACHE_DIR = os.path.join(_SERVER_DIR, 'browser_plugin', 'data', 'webproxy_cache')
_CACHE_TTL = 600  # 秒
_STATIC_EXT = {'.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
               '.ico', '.woff', '.woff2', '.ttf', '.eot', '.otf', '.mp4', '.webm'}

def _cache_key(url):
    import hashlib
    return hashlib.md5(url.encode('utf-8')).hexdigest()

def _is_static_url(url):
    try:
        path = urllib.parse.urlparse(url).path or ''
        dot = path.rfind('.')
        if dot < 0:
            return False
        return path[dot:].lower() in _STATIC_EXT
    except Exception:
        return False

def _cache_get(url):
    try:
        p = os.path.join(_CACHE_DIR, _cache_key(url) + '.bin')
        if not os.path.exists(p):
            return None
        if time.time() - os.path.getmtime(p) > _CACHE_TTL:
            return None
        with open(p, 'rb') as f:
            head = f.readline()  # 首行: zfproxy-cache <ctype>\n
            if not head.startswith(b'zfproxy-cache '):
                return None
            ctype = head.split(b' ', 1)[1].strip().decode('utf-8', 'replace')
            body = f.read()
        return {'ctype': ctype, 'body': body}
    except Exception:
        return None

def _cache_put(url, ctype, raw):
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        key = _cache_key(url)
        tmp = os.path.join(_CACHE_DIR, key + '.tmp')
        with open(tmp, 'wb') as f:
            f.write(b'zfproxy-cache ' + ctype.encode('utf-8', 'replace') + b'\n')
            f.write(raw)
        os.replace(tmp, os.path.join(_CACHE_DIR, key + '.bin'))
    except Exception:
        pass


def _jar_load():
    global _cookie_jar
    try:
        with open(_JAR_PATH, 'r', encoding='utf-8') as f:
            _cookie_jar = json.load(f) or {}
    except Exception:
        _cookie_jar = {}


def _jar_save():
    try:
        os.makedirs(os.path.dirname(_JAR_PATH), exist_ok=True)
        with open(_JAR_PATH, 'w', encoding='utf-8') as f:
            json.dump(_cookie_jar, f, ensure_ascii=False)
    except Exception:
        pass


_jar_load()


def _check_ssf(url):
    """SSRF 防护：校验 scheme 与目标 IP，违规返回错误信息，否则返回 None。"""
    p = urllib.parse.urlparse(url)
    if p.scheme not in ('http', 'https'):
        return '仅支持 http/https'
    host = p.hostname or ''
    if not host:
        return '缺少主机名'
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception as e:
        return '域名解析失败: %s' % e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        for net in _BLOCKED_NETS:
            if ip in net:
                return '禁止访问内网/回环地址 (SSRF 防护)'
    return None


# [20261126 安全收口B1] DNS-rebind TOCTOU 收紧：_check_ssf 在请求前校验，
# 但连接时重新解析的 IP 可能已变（DNS rebind）。提供上下文守卫，在
# urlopen 实际连接的解析时刻再做一次内网段校验，命中 _BLOCKED_NETS
# 直接拒绝。守卫为纯校验无共享状态，多线程下各自保存/恢复原函数。
class _SsfDnsGuard:
    def __enter__(self):
        self._orig = socket.getaddrinfo

        def _guarded(host, port, *a, **k):
            infos = self._orig(host, port, *a, **k)
            for info in infos:
                ip = ipaddress.ip_address(info[4][0])
                for net in _BLOCKED_NETS:
                    if ip in net:
                        raise IOError('DNS-rebind 防护: 解析到内网/回环地址 %s 已拦截' % ip)
            return infos
        socket.getaddrinfo = _guarded
        return self

    def __exit__(self, *exc):
        socket.getaddrinfo = self._orig
        return False


def _cookie_header_for(url):
    """按目标 URL 生成 Cookie 请求头。"""
    host = urllib.parse.urlparse(url).hostname or ''
    with _jar_lock:
        jar = _cookie_jar.get(host) or {}
        if not jar:
            return None
        return '; '.join('%s=%s' % (n, c.get('value', '')) for n, c in jar.items())


def _store_set_cookies(url, headers):
    """解析响应 Set-Cookie，存入按目标域分组的 jar。"""
    host = urllib.parse.urlparse(url).hostname or ''
    set_cookies = headers.get_all('Set-Cookie') or []
    if not set_cookies:
        return
    with _jar_lock:
        jar = _cookie_jar.setdefault(host, {})
        for sc in set_cookies:
            parts = sc.split(';')
            kv = parts[0].split('=', 1)
            if len(kv) != 2:
                continue
            name, val = kv[0].strip(), kv[1].strip()
            if not name:
                continue
            if 'expires=Thu, 01 Jan 1970' in sc.lower():
                jar.pop(name, None)
                continue
            jar[name] = {'value': val, 'raw': sc}
        _jar_save()


def _proxify(url, base):
    """把任意 URL 改写为走本代理的形式；非 http(s) 原样返回。"""
    try:
        if not url:
            return url
        u = url.strip()
        if u.startswith('data:') or u.startswith('blob:') or u.startswith('javascript:') \
                or u.startswith('about:') or u.startswith('mailto:') or u.startswith('#'):
            return url
        absu = urllib.parse.urljoin(base, u)
        p = urllib.parse.urlparse(absu)
        if p.scheme not in ('http', 'https'):
            return url
        return '/api/webproxy?url=' + urllib.parse.quote(absu, safe='')
    except Exception:
        return url


_RE_ATTR = re.compile(
    r'(?i)\b(href|src|action|poster)\s*=\s*("([^"]*)"|\'([^\']*)\'|([^\s>]+))')
_RE_CSSURL = re.compile(r'(?i)url\(\s*(\'|")?([^\'")]+)\1?\s*\)')
_RE_SRCSET = re.compile(r'(?i)\bsrcset\s*=\s*"([^"]*)"')


def _rewrite_html(body, base):
    """改写 HTML 里的静态 URL + 注入 fetch/XHR 钩子（动态请求也走代理）。"""
    def _attr(m):
        attr, raw = m.group(1).lower(), (m.group(3) or m.group(4) or m.group(5) or '')
        if attr == 'srcset':
            return m.group(0)
        return '%s="%s"' % (attr, _proxify(raw, base).replace('"', '&quot;'))

    def _srcset(m):
        items = []
        for part in m.group(1).split(','):
            seg = part.strip().split()
            if seg:
                seg[0] = _proxify(seg[0], base)
                items.append(' '.join(seg))
        return 'srcset="%s"' % ', '.join(items)

    def _css(m):
        return 'url(%s"%s")' % (m.group(1) or '', _proxify(m.group(2), base))

    out = _RE_ATTR.sub(_attr, body)
    out = _RE_SRCSET.sub(_srcset, out)
    out = _RE_CSSURL.sub(_css, out)

    # [20261203 兼容] 强制代理页面按亮色 color-scheme 渲染：部分站点（如百度）声明
    # 支持 dark 模式，宿主处于深色主题时页面媒体查询会把背景涂黑，出现"整页发黑"。
    # iframe 底色本就是白，这里统一压回 light，观感与真实浏览器默认一致。
    scheme_fix = '<style data-zf-webproxy>html{color-scheme:light !important;}</style>'

    hook = (
        '<script data-zf-webproxy>(function(){'
        'var P=function(u){try{if(!u)return u;u=new URL(u,location.href).href;'
        'if(/^https?:/.test(u))return "/api/webproxy?url="+encodeURIComponent(u);return u}catch(e){return u}};'
        'var of=window.fetch;window.fetch=function(i,o){try{'
        'if(typeof i==="string")i=P(i);else if(i&&i.url)i.url=P(i.url)}catch(e){}return of.call(this,i,o)};'
        'var ox=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){'
        'arguments[1]=P(u);return ox.apply(this,arguments)};'
        'window.__zfProxyBase=' + json.dumps(base) + ';})();</script>')
    head_i = out.lower().find('<head')
    if head_i >= 0:
        ins = out.find('>', head_i) + 1
        out = out[:ins] + scheme_fix + hook + out[ins:]
    else:
        out = scheme_fix + hook + out
    return out


class MixinWebproxy(object):

    # ---------- 主入口：GET/POST 代理 ----------
    def _handle_webproxy(self, method):
        from urllib.parse import parse_qs, urlparse as _up
        parsed = _up(self.path)
        qs = parse_qs(parsed.query or '')
        target = (qs.get('url') or [''])[0]
        if not target:
            self._send_json({'ok': False, 'error': '缺少 url 参数'}, 400)
            return
        err = _check_ssf(target)
        if err:
            self._send_json({'ok': False, 'error': err}, 403)
            return

        # 构造上游请求
        body = None
        if method == 'POST':
            try:
                body = self._read_body()
            except Exception:
                body = b''
            if isinstance(body, dict):
                body = json.dumps(body).encode('utf-8')

        # [20261126 安全收口A2-FIX] 出域闸门：webproxy 抓取过 egress_gate.check
        # （kill_switch 一律拦截；body 命中 sk-/Bearer 等高敏感模式拦截），fail-open。
        # [20261126 修复] 闸门原置于 body 赋值之前，首次调用必抛 UnboundLocalError
        # 被 except 吞掉导致闸门静默失效（代码师蜂群收口发现）；移到 body 赋值之后。
        try:
            import egress_gate
            eg = egress_gate.check('net', target, text=str(body or '')[:4000],
                                   actor='webproxy')
            if eg.get('decision') == 'block':
                self._send_json({'ok': False, 'error': '出域请求被安全闸门拦截: %s'
                                % eg.get('reason', '')}, 403)
                return
        except Exception:
            pass

        # [20261126 安全收口B2] 同域限速：同 host 最小间隔 0.5s，防止对目标站构成压力
        try:
            import time as _t
            global _LAST_REQ_BY_HOST
            try:
                _LAST_REQ_BY_HOST
            except NameError:
                _LAST_REQ_BY_HOST = {}
            _host = _up(target).netloc or ''
            _now = _t.time()
            # [20261127 性能] 静态资源命中磁盘缓存：直接回，跳过出网与限速
            if _is_static_url(target):
                hit = _cache_get(target)
                if hit is not None:
                    craw = hit.get('body') or b''
                    self.send_response(200)
                    self.send_header('Content-Type', hit.get('ctype') or 'application/octet-stream')
                    self.send_header('Content-Length', str(len(craw)))
                    self.send_header('Cache-Control', 'public, max-age=300')
                    self.end_headers()
                    try:
                        self.wfile.write(craw)
                    except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                        pass
                    return
            _last = _LAST_REQ_BY_HOST.get(_host, 0)
            if _now - _last < 0.5:
                _t.sleep(0.5 - (_now - _last))
            _LAST_REQ_BY_HOST[_host] = _t.time()
        except Exception:
            pass
        req = urllib.request.Request(target, data=body, method=method)
        req.add_header('User-Agent', _UA)
        req.add_header('Accept', self.headers.get('Accept') or '*/*')
        req.add_header('Accept-Language', 'zh-CN,zh;q=0.9,en;q=0.8')
        if body is not None:
            req.add_header('Content-Type',
                           self.headers.get('Content-Type') or 'application/x-www-form-urlencoded')
        ck = _cookie_header_for(target)
        if ck:
            req.add_header('Cookie', ck)

        # 只透传安全相关的请求头（Range 支持视频拖动）
        rng = self.headers.get('Range')
        if rng:
            req.add_header('Range', rng)

        try:
            # [20261106 收口R1] 禁止 urlopen 自动跟随重定向（默认 HTTPRedirectHandler
            # 会在内部跟随 302，使下方逐跳 _check_ssf 分支不可达，SSRF 校验被旁路）。
            # 改用无 RedirectHandler 的 opener，3xx 响应原样返回交由下方校验。
            global _PROXY_OPENER
            try:
                _PROXY_OPENER
            except NameError:
                # [20261106 收口R1] 空 OpenerDirector（仅 HTTP/HTTPSHandler，无
                # HTTPRedirectHandler）：3xx 不自动跟随，交由下方逐跳 _check_ssf 校验。
                # 默认 urlopen 会自动跟随 302，使本分支不可达、SSRF 校验被旁路。
                _PROXY_OPENER = urllib.request.OpenerDirector()
                _PROXY_OPENER.add_handler(urllib.request.HTTPHandler())
                _PROXY_OPENER.add_handler(urllib.request.HTTPSHandler())
            with _SsfDnsGuard():
                resp = _PROXY_OPENER.open(req, timeout=30)
        except urllib.error.HTTPError as e:
            resp = e
        except Exception as e:
            self._send_json({'ok': False, 'error': '代理请求失败: %s' % e}, 502)
            return

        try:
            status = getattr(resp, 'status', resp.code)
            headers = resp.headers

            # 重定向：把 Location 也改写走代理（[20261106 安全收敛] 逐跳 SSRF 校验，
        # 防 302 跳转到内网/回环地址绕过首跳 _check_ssf）
            loc = headers.get('Location')
            if loc and 300 <= status < 400:
                from urllib.parse import urljoin as _uj
                abs_loc = _uj(target, loc)
                err2 = _check_ssf(abs_loc)
                if err2:
                    self._send_json({'ok': False, 'error': '重定向目标被拒绝: ' + err2}, 403)
                    return
                self.send_response(302)
                self.send_header('Location', _proxify(loc, target))
                self.send_header('Content-Length', '0')
                self.end_headers()
                return

            _store_set_cookies(target, headers)

            ctype = (headers.get('Content-Type') or 'application/octet-stream').strip()
            raw = resp.read()

            # [20261127 性能] 静态资源写入磁盘缓存（仅 200 全量响应，不缓存 Range 部分内容）
            if _is_static_url(target) and status == 200 and not rng:
                _cache_put(target, ctype, raw)

            mime = ctype.split(';')[0].strip().lower()
            # HTML 响应需追加 CSP sandbox（P1 攻击链收口）：代理回传的 HTML 原本落在
            # 本服务同源上，恶意页面可借此读宿主 Cookie/localStorage、摸 parent DOM。
            # 加 `sandbox`（不带 allow-same-origin）使其落入不透明源。参考
            # project_fs_thumb.py 对 svg 的既有做法。仅 HTML 类响应加，纯静态资源代理不受影响。
            _csp_sandbox = None
            # HTML/CSS 需要改写 URL；其它（图片/JS/字体...）原样透传
            if mime in ('text/html', 'application/xhtml+xml'):
                _csp_sandbox = 'sandbox'
                charset = 'utf-8'
                m2 = re.search(r'charset=([\w-]+)', ctype)
                if m2:
                    charset = m2.group(1)
                try:
                    text = raw.decode(charset, errors='replace')
                except Exception:
                    text = raw.decode('utf-8', errors='replace')
                text = _rewrite_html(text, target)
                raw = text.encode('utf-8')
                ctype = 'text/html; charset=utf-8'
            elif mime == 'text/css':
                text = raw.decode('utf-8', errors='replace')
                text = _RE_CSSURL.sub(
                    lambda m: 'url(%s"%s")' % (m.group(1) or '', _proxify(m.group(2), target)),
                    text)
                raw = text.encode('utf-8')
                ctype = 'text/css; charset=utf-8'

            self.send_response(status)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(raw)))
            self.send_header('Cache-Control',
                             'public, max-age=300' if (_is_static_url(target) and status == 200)
                             else 'no-store')
            if _csp_sandbox:
                self.send_header('Content-Security-Policy', _csp_sandbox)
            # 放开同域限制：代理页面里的资源一律允许
            self.end_headers()
            # 分块写出（大文件/视频友好）
            try:
                off = 0
                while off < len(raw):
                    self.wfile.write(raw[off:off + (1 << 18)])
                    off += (1 << 18)
            except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
                pass
        finally:
            try:
                resp.close()
            except Exception:
                pass

    # ---------- Playwright cookies -> 代理 jar（单向同步） ----------
    def _handle_webproxy_cookie_sync(self, query):
        from urllib.parse import parse_qs
        qs = parse_qs(query or '')
        session = (qs.get('session') or ['default'])[0]
        try:
            from browser_plugin import engine
            s = engine.get_session(session)

            def _do():
                _ctx, _page = s._ensure()
                return _ctx.cookies()

            cookies = s.run(_do)
            if isinstance(cookies, dict) and cookies.get('ok') is False:
                self._send_json({'ok': False,
                                 'error': '读取 cookies 失败: %s' % cookies.get('error', '未知')}, 500)
                return
            if not isinstance(cookies, list):
                self._send_json({'ok': False, 'error': '读取 cookies 失败'}, 500)
                return
            n = 0
            with _jar_lock:
                for c in cookies:
                    host = c.get('domain') or ''
                    if host.startswith('.'):
                        host = host[1:]
                    if not host:
                        continue
                    jar = _cookie_jar.setdefault(host, {})
                    jar[c.get('name')] = {'value': c.get('value', ''), 'synced': True,
                                          'ts': time.time()}
                    n += 1
                _jar_save()
            self._send_json({'ok': True, 'synced': n, 'hosts': len(_cookie_jar)})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
