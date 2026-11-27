# -*- coding: utf-8 -*-
"""mixin_tvproxy.py —— i电视 HLS 跨域代理（M-TV2）
GET /api/tvproxy?u=<urlencode(直链)> -> 307 转发拉流（m3u8/TS 均走）
背景：免费 IPTV 直链多无 CORS 头且带防盗链，浏览器 hls.js 直连拉不到，
统一由 server 侧转发。（20261123 安全收敛：不再补 ACAO:*——hls.js 与页面
同源加载，XHR 同源无需 CORS，与 20261106 收敛口径一致。）
安全：仅 GET、仅 http(s) 绝对地址、6MB/请求封顶、不带本地 cookie。
"""
import os
import threading
import time
import urllib.parse
import urllib.request

_UA = "VLC/3.0.20"
_MAX = 6 * 1024 * 1024

# v2.1 防开放代理：域名白名单取自本地镜像 m3u（只读，不接受外部注入），
# 命中放行；miss 仅重载本地镜像再判一次（兼容频道表刷新出的新流域名），
# 不在镜像中的域名一律拒绝，阻止白名单外的任意 URL 代理滥用。
_m3u_path = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data', 'iptv-cn.m3u'))
_allow = set()
_allow_lock = threading.Lock()
_reload_min_gap = 60.0  # v2.2 收口：miss 重载节流——1619 频道 398KB m3u，每次 miss 都全量重读太重；60s 内复用上次重载结果
_last_reload = [0.0]
_last_hit = {}          # 域 -> [窗口起点, 计数] 固定窗口限频：同域 >20次/秒 视为滥用
                        # 阈值 20/s：hls.js 正常拉分片约 2-5 次/秒，留足余量；可拦脚本化滥用
_LAST_HIT_TTL = 600     # 超 10 分钟未命中的域从 _last_hit 清除，防状态表无界增长


def _load_allow():
    try:
        with open(_m3u_path, 'r', encoding='utf-8') as f:
            for ln in f:
                ln = ln.strip()
                if ln and not ln.startswith('#'):
                    n = urllib.parse.urlparse(ln).netloc
                    if n:
                        _allow.add(n)
    except Exception:
        pass


def _check_domain(netloc):
    """白名单命中放行；miss 时先重载镜像（频道表可能已刷新出新流域名）再判一次，
    仍 miss 才拒绝。返回错误信息或 None"""
    with _allow_lock:
        if not _allow:
            _load_allow()
        if netloc in _allow:
            return None
        if time.time() - _last_reload[0] >= _reload_min_gap:  # v2.2：60s 节流，miss 时不再每次重读 398KB 镜像
            _last_reload[0] = time.time()
            _load_allow()  # miss 重载，兼容运行时刷新频道表带来的新域名
        if netloc in _allow:
            return None
        return 'domain not allowed'


def _rate_ok(key, limit=20, window=1.0):
    now = time.time()
    # 顺手清理：TTL 外的域删掉，防 _last_hit 无界增长（代码师②复审建议）
    if len(_last_hit) > 64:
        for k in [k for k, v in _last_hit.items() if now - v[0] > _LAST_HIT_TTL]:
            _last_hit.pop(k, None)
    item = _last_hit.get(key)
    if not item or now - item[0] >= window:
        _last_hit[key] = [now, 1]
        return True
    item[1] += 1
    return item[1] <= limit


class MixinTvproxy:

    def _handle_tvproxy_get(self):
        q = urllib.parse.urlparse(self.path)
        u = urllib.parse.parse_qs(q.query).get("u", [""])[0]
        pu = urllib.parse.urlparse(u)
        if pu.scheme not in ("http", "https") or not pu.netloc:
            return self._send_json({"ok": False, "err": "bad url"}, 400)
        err = _check_domain(pu.netloc)
        if err:
            return self._send_json({"ok": False, "err": err}, 403)
        if not _rate_ok(pu.netloc):
            return self._send_json({"ok": False, "err": "rate limited"}, 429)
        try:
            req = urllib.request.Request(u, headers={"User-Agent": _UA, "Referer": pu.scheme + "://" + pu.netloc + "/"})
            with urllib.request.urlopen(req, timeout=15) as r:
                data = r.read(_MAX)
                ctype = r.headers.get("Content-Type", "application/vnd.apple.mpegurl")
        except Exception as e:
            return self._send_json({"ok": False, "err": str(e)[:120]}, 502)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        # [20261123 安全收敛] 移除 Access-Control-Allow-Origin: *：本端点与前端同源，无需 CORS 放行
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
