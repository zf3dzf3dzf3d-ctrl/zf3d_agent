#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""net - 抓取网页内容，自动去HTML标签"""

import os
import json
import time
import re
import urllib.request
import urllib.error
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'net'


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


def _fetch_one(url, raw_html, max_chars, timeout):
    """抓取单个URL"""
    # 安全：拦截本机/内网地址（SSRF 防护），公网网页抓取不受影响
    try:
        from security import is_safe_public_url
        if not is_safe_public_url(url):
            return {'url': url, 'final_url': url, 'title': '', 'truncated': False,
                    'content': '', 'error': 'Blocked: local/intranet address not allowed'}
    except Exception:
        pass
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    })
    try:
        resp = urllib.request.urlopen(req, timeout=timeout)
        final_url = resp.geturl()
        # 安全：重定向后的最终地址也要复检（防 302 跳转绕过 SSRF 过滤）
        if final_url and final_url != url:
            try:
                from security import is_safe_public_url
                if not is_safe_public_url(final_url):
                    return {'url': url, 'final_url': final_url, 'title': '', 'truncated': False,
                            'content': '', 'error': 'Blocked: redirect to local/intranet address'}
            except Exception:
                pass
        raw = resp.read()
        # 尝试解码
        charset = resp.headers.get_content_charset() or 'utf-8'
        try:
            html = raw.decode(charset, errors='replace')
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
    except urllib.error.HTTPError as e:
        return {'url': url, 'final_url': url, 'title': '', 'truncated': False, 'content': '', 'error': f'HTTP {e.code}: {e.reason}'}
    except Exception as e:
        return {'url': url, 'final_url': url, 'title': '', 'truncated': False, 'content': '', 'error': str(e)}


def handle(body, ctx):
    """处理工具请求"""
    try:
        url = body.get('url')
        urls = body.get('urls')
        raw_html = body.get('raw_html', False)
        max_chars = body.get('max_chars', 6000)
        timeout = body.get('timeout', 15)

        if urls and isinstance(urls, list):
            pages = []
            for u in urls:
                pages.append(_fetch_one(u, raw_html, max_chars, timeout))
            ctx.send_json({'ok': True, 'multi': True, 'pages': pages})
        elif url:
            result = _fetch_one(url, raw_html, max_chars, timeout)
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
