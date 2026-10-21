#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sensitive_file_probe - 自有站点敏感文件/目录暴露自检（探测常见泄漏路径是否可公开访问）"""

import urllib.request
import urllib.error

TOOL_NAME = 'sensitive_file_probe'

# 常见敏感路径（只做存在性检查，不做内容利用）
_COMMON_PATHS = [
    'robots.txt', 'sitemap.xml', '.env', '.git/config', '.git/HEAD',
    '.DS_Store', 'backup.zip', 'backup.sql', 'db.sql', 'dump.sql',
    'config.php.bak', 'wp-config.php.bak', '.htaccess', 'web.config',
    'admin/', 'phpinfo.php', 'test.php', 'debug/', 'actuator/health',
]

_UA = {'User-Agent': 'sensitive_file_probe/1.0'}


def _check(base, path):
    url = base.rstrip('/') + '/' + path
    try:
        req = urllib.request.Request(url, method='HEAD', headers=_UA)
        with urllib.request.urlopen(req, timeout=8) as resp:
            return url, resp.status, int(resp.headers.get('Content-Length') or 0)
    except urllib.error.HTTPError as e:
        # 有些站点禁 HEAD，退回 GET
        if e.code in (405, 501):
            try:
                req = urllib.request.Request(url, headers=_UA)
                with urllib.request.urlopen(req, timeout=8) as resp:
                    return url, resp.status, int(resp.headers.get('Content-Length') or 0)
            except Exception:
                return url, None, 0
        return url, None, 0
    except Exception:
        return url, None, 0


def handle(body, ctx):
    url = (body.get('url') or '').strip()
    if not url:
        ctx.send_json({'ok': False, 'error': 'url required'})
        return
    if not url.startswith(('http://', 'https://')):
        url = 'https://' + url
    paths = body.get('paths') or _COMMON_PATHS
    if not isinstance(paths, list) or not paths:
        paths = _COMMON_PATHS
    paths = paths[:30]
    found = []
    for p in paths:
        u, status, size = _check(url, p)
        if status and 200 <= status < 300:
            found.append({'path': u, 'status': status, 'size': size})
    ctx.send_json({'ok': True, 'base_url': url, 'checked': len(paths),
                   'exposed': found,
                   'exposed_count': len(found),
                   'advice': 'exposed 中出现 .env/.git/backup 等即为高危泄漏，应立即从 Web 目录移除并在服务器配置中屏蔽。仅用于自有/授权站点自检。'})
