# -*- coding: utf-8 -*-
"""i视频 独立端口流媒体代理（v2 提速版）

目标：
1. 与主服务不同端口（默认 8626，配置在 server/config/i-video-sites.json 的 proxy_port），
   主服务繁忙/重启时不影响播放；浏览器端 ts 请求直连该端口，绕开主服务请求队列。
2. ts 分片磁盘 LRU 缓存（默认 2GB，在 server/data/ivideo_cache/）：
   缓存命中不再回源站，网络断开/慢速时继续播放（缓冲保连通）。
3. m3u8 不落盘但短内存缓存（10s TTL），减少重复回源解析。
安全：沿用 mixin_video 的内网拦截（SSRF 防护）+ 仅 http(s) 外链。
"""
import os, json, ssl, socket, hashlib, threading, urllib.request, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from util_log import get_logger

log = get_logger('ivideo_stream')
_BASE = os.path.dirname(os.path.abspath(__file__))
# 【修复·配置路径】对齐 routes/mixin_video.py：配置统一放项目根 private/（原误指向 server/private/）
_SITES_PATH = os.path.normpath(os.path.join(_BASE, '..', 'private', 'i-video-sites.json'))
if not os.path.exists(_SITES_PATH):
    _SITES_PATH = os.path.normpath(os.path.join(_BASE, 'config', 'i-video-sites.example.json'))  # 分发版兜底模板
_CACHE_DIR = os.path.join(_BASE, 'data', 'ivideo_cache')
CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024  # 2GB LRU 上限

_IV_CTX = ssl.create_default_context()
_IV_CTX.check_hostname = False
_IV_CTX.verify_mode = ssl.CERT_NONE  # 公开资源站证书不正规，单机自用已知妥协（同 mixin_video 豁免说明）
_IV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
_IV_MAX_BYTES = 32 * 1024 * 1024

_cache_lock = threading.Lock()
_m3u8_mem = {}  # url -> (ts, bytes) 短 TTL 内存缓存


def _load_port():
    try:
        with open(_SITES_PATH, 'r', encoding='utf-8-sig') as f:
            return int(json.load(f).get('proxy_port', 8626))
    except Exception:
        return 8626


def _is_private_host(hostname):
    """与 mixin_video._iv_is_private_host 同款 SSRF 拦截（IPv4 优先判定）"""
    import ipaddress
    try:
        infos = socket.getaddrinfo(hostname, None)
    except Exception:
        return True
    has_v4, v4_bad = False, False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return True
        if ip.version == 4:
            has_v4 = True
            if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast):
                v4_bad = True
    if has_v4:
        return v4_bad
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast):
            return True
    return False


def _fetch(url):
    host = urllib.parse.urlsplit(url).hostname
    if not host or _is_private_host(host):
        raise ValueError('blocked host')
    req = urllib.request.Request(url, headers={'User-Agent': _IV_UA})
    with urllib.request.urlopen(req, timeout=12, context=_IV_CTX) as resp:
        data = resp.read(_IV_MAX_BYTES + 1)
    if len(data) > _IV_MAX_BYTES:
        raise ValueError('response too large')
    return data


def _rewrite_m3u8(text, base, port):
    def rewrite(u):
        return 'http://127.0.0.1:%d/api/ivideo/proxy?url=' % port + urllib.parse.quote(u, safe='')
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith('#'):
            if 'URI="' in line:
                pre, rest = line.split('URI="', 1)
                uri, _, post = rest.partition('"')
                if uri and not uri.startswith('#'):
                    absu = urllib.parse.urljoin(base, uri)
                    lines.append(pre + 'URI="' + rewrite(absu) + '"' + post)
                else:
                    lines.append(line)
            else:
                lines.append(line)
        else:
            lines.append(rewrite(urllib.parse.urljoin(base, line)))
    return ('\n'.join(lines) + '\n').encode('utf-8')


def _cache_get(key):
    path = os.path.join(_CACHE_DIR, key)
    if key.endswith('.tmp'):   # 【防御】tmp 半成品文件不作为命中
        return None
    if os.path.isfile(path) and os.path.getsize(path) > 0:
        try:
            os.utime(path)  # LRU touch
            with open(path, 'rb') as f:
                return f.read()
        except Exception:
            return None
    return None


def _cache_put(key, data):
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        path = os.path.join(_CACHE_DIR, key)
        # 【修复·原子写】tmp + os.replace，避免并发读到写一半的 ts 分片
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, path)
        # 异步 LRU 清理：超限按时钟淘汰
        def _evict():
            try:
                with _cache_lock:
                    items = []
                    total = 0
                    for fn in os.listdir(_CACHE_DIR):
                        if fn.endswith('.tmp'):   # tmp 半成品不参与 LRU 统计/淘汰
                            continue
                        fp = os.path.join(_CACHE_DIR, fn)
                        try:
                            st = os.stat(fp)
                            items.append((st.st_atime, st.st_size, fp))
                            total += st.st_size
                        except Exception:
                            pass
                    items.sort()
                    while total > CACHE_LIMIT_BYTES and items:
                        atime, size, fp = items.pop(0)
                        try:
                            os.remove(fp)
                            total -= size
                        except Exception:
                            pass
            except Exception:
                pass
        threading.Thread(target=_evict, daemon=True).start()
    except Exception:
        pass


def _m3u8_mem_get(url):
    import time
    e = _m3u8_mem.get(url)
    if e and time.time() - e[0] < 10:
        return e[1]
    if e:
        _m3u8_mem.pop(url, None)
    return None


class StreamHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        if parsed.path != '/api/ivideo/proxy':
            self.send_response(404); self.end_headers(); return
        raw = (qs.get('url') or [''])[0]
        if not raw.startswith(('http://', 'https://')):
            self.send_response(400); self.end_headers(); return
        try:
            cur = raw
            is_m3u8 = cur.split('?')[0].endswith('.m3u8')
            port = self.server.server_address[1]
            if is_m3u8:
                body = _m3u8_mem_get(cur)
                if body is None:
                    body = _rewrite_m3u8(_fetch(cur).decode('utf-8', 'ignore'), cur, port)
                    _m3u8_mem[cur] = (__import__('time').time(), body)
                    if len(_m3u8_mem) > 200:
                        for k in list(_m3u8_mem)[:100]:
                            _m3u8_mem.pop(k, None)
                ctype = 'application/vnd.apple.mpegurl'
                cache_ctl = 'no-store'
            else:
                key = hashlib.sha1(cur.encode('utf-8')).hexdigest() + '.ts'
                body = _cache_get(key)
                if body is None:
                    body = _fetch(cur)
                    _cache_put(key, body)
                ctype = 'video/mp2t'
                cache_ctl = 'public, max-age=3600'
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            # [20261123 安全收敛] 移除 Access-Control-Allow-Origin: *：本端点与前端同源，无需 CORS 放行
            self.send_header('Cache-Control', cache_ctl)
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            try:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'ok': False, 'err': str(e)}).encode('utf-8'))
            except Exception:
                pass


def start_stream_server():
    """启动独立端口流媒体代理；失败不抛（主服务照常跑，前端回退主服务代理）。"""
    port = _load_port()
    try:
        srv = ThreadingHTTPServer(('127.0.0.1', port), StreamHandler)
        t = threading.Thread(target=srv.serve_forever, daemon=True, name='ivideo-stream')
        t.start()
        log.info('[ivideo-stream] 独立流媒体代理已启动: http://127.0.0.1:%d' % port)
        return srv
    except Exception as e:
        log.error('[ivideo-stream] 启动失败(端口%d占用?): %s —— 播放将回退主服务代理' % (port, e))
        return None
