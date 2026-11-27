# -*- coding: utf-8 -*-
"""net_guard — 出站抓取公共安全模块（i图片案新增收敛，2026-11-11 v1.1 裁决）

背景：全仓曾有 6 处分散 proxy/SSRF 实现（api_dispatch_get/post 各处各自复制
_iv_is_private_host）。本模块为「新增收敛、不动旧代码」的第一个公共实现：
- is_private_host：SSRF 拦截（内网/回环/链路本地/组播），IPv4 优先判定
  （规避 Python3.13 将 Teredo 2001::/23 误判 private 杀公网站点的坑，i视频案实测）
- guard_fetch：出站抓取统一入口，默认 verify=True（证书校验，禁止降级）
- 白名单模式：allow_domains 非空时仅放行名单内域名（i图片 proxy 用）
验收钩子（课题池 pending）：旧 6 处迁移以「全仓 grep 出站 requests/urlopen
调用点指向本模块的数量」为验收标准，非本文件存在本身。

【锁审计】无锁。_REGISTRY 兼容：本模块为纯函数集，无共享可变状态，无线程安全问题。
"""
import ipaddress
import socket
import ssl
import urllib.parse
import urllib.request

_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
# i图片专用上下文：证书必须校验（v1.1 裁决硬规则，S6 门禁 grep verify=False 须 0 命中）
_CTX = ssl.create_default_context()


def is_private_host(hostname):
    """拦截内网/回环/链路本地/组播地址，防 SSRF。解析失败一律拒绝。
    IPv4 优先判定：存在任一 IPv4 地址即以 IPv4 结论为准（忽略 IPv6 保留段误杀）。"""
    try:
        infos = socket.getaddrinfo(hostname, None)
    except Exception:
        return True
    has_v4 = False
    v4_bad = False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return True
        if ip.version == 4:
            has_v4 = True
            if (ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_multicast):
                v4_bad = True
    if has_v4:
        return v4_bad
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return True
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast):
            return True
    return False


def _get_proxy():
    """出站代理（2026-11-16 新增）：国内直连 wallhaven/yande.re/e621 等图源会被墙，
    走本机代理（如 Clash 7897）即可通。优先级：环境变量 ZF_HTTP_PROXY > private/net_proxy.json >
    默认探测本机 7897 端口（Clash 常用）。返回 None 表示直连。"""
    import os, json as _json
    p = os.environ.get('ZF_HTTP_PROXY')
    if p:
        return p
    try:
        cfg = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..', 'private', 'net_proxy.json')
        if os.path.exists(cfg):
            d = _json.load(open(cfg, encoding='utf-8'))
            if d.get('proxy'):
                return d['proxy']
    except Exception:
        pass
    # 默认探测 127.0.0.1:7897（Clash Verge 常用混合端口），探测超时 300ms，失败即直连
    try:
        import socket
        s = socket.create_connection(('127.0.0.1', 7897), timeout=0.3)
        s.close()
        return 'http://127.0.0.1:7897'
    except Exception:
        return None


def guard_fetch(url, timeout=12, max_bytes=16 * 1024 * 1024,
                allow_domains=None, require_https=True, referer=None):
    """安全出站抓取。返回 (data, content_type)。
    - SSRF：is_private_host 拦截
    - 白名单：allow_domains 非空时域名（含子域）必须在名单内
    - verify=True：默认 SSL 上下文，证书错误直接抛 SSLError（不许 verify=False 绕）
    - 大小上限：max_bytes（默认 16MB）
    - require_https=True 时仅放行 https（i图片图源全部 https）
    - 代理：URL 本身仍做 SSRF/白名单校验，代理只做出口转发（2026-11-16 新增）
    """
    sp = urllib.parse.urlsplit(url)
    if sp.scheme not in (('https', 'http') if not require_https else ('https',)):
        raise ValueError('scheme not allowed: %r' % sp.scheme)
    host = sp.hostname
    if not host or is_private_host(host):
        raise ValueError('blocked host')
    if allow_domains is not None:
        host_l = host.lower()
        if not any(host_l == d or host_l.endswith('.' + d) for d in allow_domains):
            raise ValueError('domain not in whitelist: %s' % host)
    # referer 可选：防盗链站需带源页 Referer 才放行（i采集案新增，默认 None 不带，行为不变）
    _hdrs = {'User-Agent': _UA}
    if referer:
        _hdrs['Referer'] = referer
    req = urllib.request.Request(url, headers=_hdrs)
    # [20261118 兼容性修复] 出网策略：先试探测到的代理，URLError 时自动降级直连
    # 兜底（直连用空 ProxyHandler 屏蔽环境变量代理，避免服务进程残留失效代理
    # 导致百度等国内站全部 fetch failed）。最后一层的异常带 reason 透出。
    proxy = _get_proxy()
    attempts = ([proxy] if proxy else []) + [None]
    last_err = None
    resp = None
    for p in attempts:
        try:
            handlers = [urllib.request.ProxyHandler({} if p is None else
                        {'http': p, 'https': p}),
                        urllib.request.HTTPSHandler(context=_CTX)]
            _opener = urllib.request.build_opener(*handlers)
            resp = _opener.open(req, timeout=timeout)
            break
        except Exception as e:
            last_err = e
            continue
    if resp is None:
        reason = getattr(last_err, 'reason', None) or last_err
        raise last_err if last_err is not None else IOError('fetch failed')
    ctype = (resp.headers.get('Content-Type') or '').split(';')[0].strip().lower()
    data = resp.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError('response too large')
    return data, ctype
