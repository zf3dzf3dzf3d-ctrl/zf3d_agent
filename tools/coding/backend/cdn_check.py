#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""cdn_check - CDN/真实 IP 检测：多解析对比 + 常见 CDN CNAME 识别（自有域名排障用）"""

import socket
import re

TOOL_NAME = 'cdn_check'

# 常见 CDN CNAME 特征
_CDN_SIGNS = {
    'cloudflare': 'Cloudflare', 'akamai': 'Akamai', 'cloudfront': 'AWS CloudFront',
    'cdn.dnsv1': '腾讯云 CDN', 'cdn20': '又拍云', 'kunlun': '阿里云 CDN',
    'wscdns': '网宿', 'lxdns': '网宿', 'alikunlun': '阿里云', 'qiniudns': '七牛',
    'fastly': 'Fastly', 'cdngslb': '阿里云', 'ourwebpic': '又拍云',
}

# 多公共 DNS 对比解析
_DNS_SERVERS = ['8.8.8.8', '1.1.1.1', '223.5.5.5', '114.114.114.114']


def _resolve(host, server=None):
    try:
        if server:
            import subprocess
            is_win = __import__('platform').system().lower() == 'windows'
            cmd = ['nslookup', '-timeout=3', host, server]
            p = subprocess.run(cmd, capture_output=True, timeout=10)
            out = p.stdout.decode('gbk' if is_win else 'utf-8', 'replace')
            ips = re.findall(r'\b(\d{1,3}(?:\.\d{1,3}){3})\b', out)
            # 过滤 DNS 服务器自身地址
            ips = [i for i in ips if i != server]
            return sorted(set(ips))
        return sorted(set(i[4][0] for i in socket.getaddrinfo(host, None, socket.AF_INET)))
    except Exception:
        return []


def handle(body, ctx):
    domain = (body.get('domain') or '').strip().lower()
    if not domain or '/' in domain:
        ctx.send_json({'ok': False, 'error': 'domain required（如 example.com）'})
        return
    results = {'local': _resolve(domain)}
    for s in _DNS_SERVERS:
        results[s] = _resolve(domain, s)
    all_ips = set()
    for v in results.values():
        all_ips.update(v)
    # CNAME 检测
    cname = ''
    try:
        import subprocess
        is_win = __import__('platform').system().lower() == 'windows'
        p = subprocess.run(['nslookup', '-type=cname', '-timeout=3', domain],
                           capture_output=True, timeout=10)
        out = p.stdout.decode('gbk' if is_win else 'utf-8', 'replace')
        m = re.search(r'canonical name\s*=\s*(\S+)', out, re.I)
        if m:
            cname = m.group(1).rstrip('.')
    except Exception:
        pass
    cdn_guess = None
    hint_src = (cname + ' ' + ' '.join(all_ips)).lower()
    for sig, name in _CDN_SIGNS.items():
        if sig in hint_src:
            cdn_guess = name
            break
    # 多 DNS 结果差异大 → 很可能走智能 DNS/CDN
    distinct = {tuple(v) for v in results.values() if v}
    likely_cdn = cdn_guess is not None or len(distinct) > 1
    ctx.send_json({'ok': True, 'domain': domain,
                   'resolutions': results,
                   'cname': cname or None,
                   'cdn_guess': cdn_guess,
                   'likely_cdn': likely_cdn,
                   'unique_ips': sorted(all_ips)})
