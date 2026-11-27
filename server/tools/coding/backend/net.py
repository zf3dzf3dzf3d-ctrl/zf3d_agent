#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""net - 抓取网页内容，自动去HTML标签"""

import sys
import time
import re
import requests

from util_log import get_logger

log = get_logger('net')
# S5: 模块级共享 Session，keep-alive 连接复用（同站多请求免重复握手）
_SESSION = requests.Session()
_SESSION.headers.update({'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'})
from concurrent.futures import ThreadPoolExecutor
try:
    from tools.coding.backend import _egress
except ImportError:
    import _egress

# SSRF 防护模块顶层导入：失败显式标记并打日志，fail-closed（拒绝而非放行）
try:
    from security import is_safe_public_url as _is_safe_public_url
    _SECURITY_OK = True
except Exception as _e:
    _SECURITY_OK = False
    print('[net] 警告: security 模块导入失败(%s)，SSRF 拦截进入 fail-closed 模式（所有请求将被拒绝）' % _e,
          file=sys.stderr)

TOOL_NAME = 'net'


def _check_url_safe(u):
    """SSRF 校验辅助（合并原两处重复内联检查）。
    返回 None=安全可访问；否则返回拦截原因字符串。"""
    if not _SECURITY_OK:
        return 'Blocked: security module unavailable (fail-closed)'
    if not _is_safe_public_url(u):
        return 'Blocked: local/intranet address not allowed'
    return None


def _strip_html(html):
    """去除HTML标签并清理空白"""
    # 提取 title
    title = ''
    m = re.search(r'<title[^>]*>(.*?)</title>', html, re.IGNORECASE | re.DOTALL)
    if m:
        title = re.sub(r'\s+', ' ', m.group(1)).strip()
    # 去掉 script/style 内容
    html = re.sub(r'<script[^>]*>.*?</script>', '', html, re.IGNORECASE | re.DOTALL)
    html = re.sub(r'<style[^>]*>.*?</style>', '', html, re.IGNORECASE | re.DOTALL)
    # 去标签
    text = re.sub(r'<[^>]+>', '', html)
    # HTML 实体
    text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")
    # 清理多余空白
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = text.strip()
    return title, text


def _read_response(resp, url, raw_html, max_chars):
    """读取响应体并解码/清洗/截断，返回结果 dict（从 _fetch_one 拆出的解码段）
    兼容 requests.Response：raw 为 bytes，charset 从 resp.encoding 或 header 推断"""
    final_url = resp.url
    raw = resp.content
    charset = resp.encoding or 'utf-8'
    try:
        html = raw.decode(charset, errors='replace')
    except Exception:
        try:
            html = raw.decode(resp.apparent_encoding or 'utf-8', errors='replace')
        except Exception:
            html = raw.decode('utf-8', errors='replace')

    if raw_html:
        content = html
    else:
        title, content = _strip_html(html)

    truncated = len(content) > max_chars
    content = content[:max_chars]

    return {
        'url': url,
        'final_url': final_url,
        'title': title if not raw_html else '',
        'truncated': truncated,
        'content': content,
        'error': None
    }


def _blocked_result(url, error):
    return {'url': url, 'final_url': url, 'title': '', 'truncated': False,
            'content': '', 'error': error}


def _fetch_one(url, raw_html, max_chars, timeout):
    """抓取单个URL（主骨架：安全检查 → 请求 → 响应处理）"""
    # 安全：拦截本机/内网地址（SSRF 防护），公网网页抓取不受影响
    reason = _check_url_safe(url)
    if reason:
        return _blocked_result(url, reason)
    try:
        # S5: 共享 Session keep-alive 连接复用（requests 自动跟随重定向）
        resp = _SESSION.get(url, timeout=timeout, allow_redirects=True)
        if resp.status_code >= 400:
            return _blocked_result(url, 'HTTP %s' % resp.status_code)
        resp.raise_for_status()
        final_url = resp.url
        # 安全：重定向后的最终地址也要复检（防 302 跳转绕过 SSRF 过滤）
        if final_url and final_url != url:
            reason = _check_url_safe(final_url)
            if reason:
                return _blocked_result(url, 'Blocked: redirect to local/intranet address')
        return _read_response(resp, url, raw_html, max_chars)
    except requests.exceptions.HTTPError as e:
        return _blocked_result(url, 'HTTP error: %s' % e)
    except Exception as e:
        return _blocked_result(url, str(e))


# 重试配置：白名单匹配网络类错误（超时/连接失败），HTTP 4xx/5xx 与安全拦截不重试
_RETRYABLE = ('timed out', 'timeout', 'temporary failure', 'connection', 'getaddrinfo', 'reset', 'unreachable')
_MAX_RETRIES = 2


def _fetch_with_retry(url, raw_html, max_chars, timeout):
    """S2: 网络错误指数退避重试（0.5s/1.5s），最多 2 次额外尝试"""
    result = None
    for attempt in range(_MAX_RETRIES + 1):
        result = _fetch_one(url, raw_html, max_chars, timeout)
        err = (result.get('error') or '').lower()
        if not err or err.startswith('http ') or err.startswith('blocked'):
            return result  # 成功 / HTTP错误 / 安全拦截 → 不重试
        # 只对网络类白名单错误重试（其他未知错误不重试）
        if not any(k in err for k in _RETRYABLE):
            return result
        if attempt < _MAX_RETRIES:
            time.sleep(0.5 * (3 ** attempt))
    return result


def handle(body, ctx):
    """处理工具请求"""
    try:
        url = body.get('url')
        urls = body.get('urls')
        raw_html = body.get('raw_html', False)
        max_chars = body.get('max_chars', 6000)
        timeout = body.get('timeout', 15)

        # 【P2 出域闸门接线】net 抓取=出域通道；URL 本身可能携带敏感数据
        # （如 ?token=xxx 外传），逐 URL 过闸门（批量时仅拦截被拦的那条，其余正常抓取）
        _targets = urls if isinstance(urls, list) else ([url] if url else [])
        _blocked_urls = {}
        for _u in _targets:
            _dec, _reason = _egress.check('net', _u, text=str(_u), actor='net')
            if _dec == 'block':
                _blocked_urls[_u] = '[出域闸门] 抓取请求被拦截: %s' % _reason
        _allowed = [_u for _u in _targets if _u not in _blocked_urls]

        if not _allowed:
            # 全部被拦截
            _err = '; '.join('%s (%s)' % (_blocked_urls[_u], _u) for _u in _targets)
            ctx.send_json({'ok': False, 'error': _err})
            return

        if _allowed and isinstance(urls, list):
            # S1: 多 URL 并行抓取（并发上限 6，避免触发反爬/闸门频控）
            workers = min(6, len(_allowed))
            with ThreadPoolExecutor(max_workers=workers) as _pool:
                pages = list(_pool.map(lambda u: _fetch_with_retry(u, raw_html, max_chars, timeout), _allowed))
            # 被闸门拦截的 URL 以对应 page error 形式回填，保持位置语义
            if _blocked_urls:
                pages = list(pages)
                for _u in _targets:
                    if _u in _blocked_urls:
                        pages.insert(_targets.index(_u), _blocked_result(_u, _blocked_urls[_u]))
            ctx.send_json({'ok': True, 'multi': True, 'pages': pages})
        elif url:
            result = _fetch_with_retry(url, raw_html, max_chars, timeout)
            if result['error']:
                ctx.send_json({'ok': False, 'error': result['error']})
            else:
                ctx.send_json({
                    'ok': True,
                    'url': result['url'],
                    'final_url': result['final_url'],
                    'title': result['title'],
                    'truncated': result['truncated'],
                    'content': result['content']
                })
        else:
            ctx.send_error('需要提供 url 或 urls 参数')
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
