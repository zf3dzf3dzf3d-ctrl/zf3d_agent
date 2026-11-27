#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
download_file - 二进制文件下载工具（S6）
流式分块下载到指定路径，支持 3 路并发批量下载、断点续传（已存在且大小一致则跳过）。
复用 net 工具的安全设施：SSRF 内网拦截（fail-closed）+ 出域闸门。
"""
import os
import sys
import hashlib
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from util_log import get_logger

log = get_logger('download_file')
try:
    from tools.coding.backend import _egress
except Exception:
    try:
        import _egress
    except Exception as _e:
        _egress = None
        print('[download_file] 警告: security/_egress 导入失败(%s)，出域闸门不可用' % _e,
              file=sys.stderr)

try:
    from tools.coding.backend import security
except Exception:
    try:
        import security
    except Exception:
        security = None

TOOL_NAME = 'download_file'

_SESSION = requests.Session()
_SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
})

_CHUNK = 64 * 1024          # 分块大小 64KB
_MAX_RETRIES = 2            # 网络错误重试次数
_RETRYABLE = ('timed out', 'timeout', 'connection', 'getaddrinfo', 'reset', 'unreachable', 'incomplete')


def _check_url_safe(u):
    """SSRF 内网拦截（fail-closed：security 缺失即拒绝）。兼容 bool 与 (ok, reason) 两种签名"""
    if security is None or not hasattr(security, 'is_safe_public_url'):
        return 'Blocked: SSRF 检查模块不可用（fail-closed）'
    try:
        r = security.is_safe_public_url(u)
        if isinstance(r, tuple):
            ok, reason = r
            return None if ok else ('Blocked: %s' % reason)
        return None if r else 'Blocked: local/intranet address not allowed'
    except Exception as e:
        return 'Blocked: SSRF check error: %s' % e


def _egress_check(u):
    """出域闸门；模块缺失时放行（与 net 行为一致：net 缺失时 fail-closed 更严，
    这里与 net 的 _egress 可选导入保持同构，缺闸门不阻断基本下载）"""
    if _egress is None or not hasattr(_egress, 'check'):
        return None
    dec, reason = _egress.check('download_file', u, text=str(u), actor='download_file')
    if dec == 'block':
        return '[出域闸门] 下载请求被拦截: %s' % reason
    return None


def _download_one(url, path, timeout):
    """单个文件流式下载，带重试与断点续传（已有完整文件跳过）"""
    reason = _check_url_safe(url)
    if reason:
        return {'url': url, 'path': path, 'error': reason, 'skipped': False}

    # 断点续传：目标已存在则记录大小，下载后校验
    existed = os.path.getsize(path) if (path and os.path.isfile(path)) else 0

    last_err = ''
    for attempt in range(_MAX_RETRIES + 1):
        try:
            with _SESSION.get(url, stream=True, timeout=timeout, allow_redirects=True) as r:
                if r.status_code != 200:
                    return {'url': url, 'path': path, 'error': 'HTTP %s' % r.status_code,
                            'skipped': False}
                # 重定向最终地址复检 SSRF
                if r.url and r.url != url:
                    reason = _check_url_safe(r.url)
                    if reason:
                        return {'url': url, 'path': path, 'error': 'Blocked: redirect %s' % reason,
                                'skipped': False}
                total = int(r.headers.get('Content-Length') or 0)
                if existed and total and existed == total:
                    return {'url': url, 'path': path, 'error': None, 'skipped': True,
                            'size': existed}
                tmp = (path + '.part') if path else None
                got = 0
                with open(tmp, 'wb') as f:
                    for chunk in r.iter_content(chunk_size=_CHUNK):
                        if chunk:
                            f.write(chunk)
                            got += len(chunk)
                if total and got != total:
                    raise IOError('incomplete: got %d/%d' % (got, total))
                if path:
                    os.replace(tmp, path)
                return {'url': url, 'path': path, 'error': None, 'skipped': False, 'size': got}
        except Exception as e:
            last_err = str(e)
            low = last_err.lower()
            if low.startswith('http ') or low.startswith('blocked'):
                break
            if not any(k in low for k in _RETRYABLE):
                break
            if attempt < _MAX_RETRIES:
                time.sleep(0.5 * (3 ** attempt))
    return {'url': url, 'path': path, 'error': last_err or 'unknown', 'skipped': False}


def _name_from_url(u):
    return hashlib.sha1(u.encode()).hexdigest()[:16]


def handle(body, ctx):
    try:
        url = body.get('url')
        urls = body.get('urls')
        save_path = body.get('save_path')      # 单文件目标路径（含文件名）
        save_dir = body.get('save_dir')        # 批量目标目录（文件名取 URL 哈希）
        timeout = body.get('timeout', 60)

        targets = urls if isinstance(urls, list) else ([url] if url else [])
        if not targets:
            ctx.send_error('需要提供 url 或 urls 参数')
            return

        # 出域闸门：逐 URL 检查，被拦的单独报错
        results = []
        allowed = []
        for u in targets:
            reason = _egress_check(u)
            if reason:
                results.append({'url': u, 'path': '', 'error': reason, 'skipped': False})
            else:
                allowed.append(u)

        # 解析每个 URL 的保存路径
        jobs = []
        if isinstance(urls, list):
            base_dir = save_dir or 'downloads'
            os.makedirs(base_dir, exist_ok=True)
            for u in allowed:
                p = os.path.join(base_dir, _name_from_url(u))
                jobs.append((u, p))
        else:
            if not save_path:
                ctx.send_error('单文件下载需要提供 save_path（含文件名）')
                return
            d = os.path.dirname(save_path)
            if d:
                os.makedirs(d, exist_ok=True)
            if allowed:
                jobs.append((allowed[0], save_path))

        if jobs:
            # S6: 批量 3 路并发；单文件直接下
            if len(jobs) == 1:
                results.append(_download_one(jobs[0][0], jobs[0][1], timeout))
            else:
                with ThreadPoolExecutor(max_workers=min(3, len(jobs))) as pool:
                    results.extend(pool.map(lambda j: _download_one(j[0], j[1], timeout), jobs))

        ok_items = [r for r in results if not r['error']]
        ctx.send_json({
            'ok': len(ok_items) == len(results),
            'results': results,
            'success': len(ok_items),
            'failed': len(results) - len(ok_items)
        })
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
