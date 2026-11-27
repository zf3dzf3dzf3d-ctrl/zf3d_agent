#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""util_http_safety.py - HTTP 响应安全头（纯函数，零 I/O，零第三方依赖）

职责：给定「请求路径 / 响应 MIME / 浏览器请求目的」，算出应当附加的安全响应头。
只算头、不发头——发送由静态出口 _send_static_body 统一完成（唯一出口，不逐分支手写）。

为什么需要（2026-11-23）：
- 全后端没有 X-Frame-Options：应用页面可被任意网站嵌入做点击劫持。被嵌入页面里
  发出的"同源"请求照样带用户凭据，而回环请求免 token。
- 聊天附件保留原始扩展名落在 public/uploads/chat/：上传的 HTML/SVG 按扩展名以
  text/html 原样返回，在应用自己的源下执行，等于一条存储型 XSS 路径。
  /plugins-ui/ 与缩略图两个分支早已加了 nosniff + 沙箱 CSP，缺的是统一出口。

三类规则：
1. 用户可控内容（/uploads/**）——文件名与内容都来自用户或智能体，不可信：
   - 一律 X-Content-Type-Options: nosniff
   - 可执行内容（HTML / XHTML / SVG / XML）一律 Content-Security-Policy: sandbox allow-scripts
     脚本可跑，但运行在不透明源里：读不到本应用的 Cookie / 存储，也调不通本应用 API
   - HTML 被直接导航打开（地址栏 / 新标签页，Sec-Fetch-Dest 为 document 或缺失）
     时强制下载，不在应用源下渲染；被应用自己的预览框（iframe）加载时照常渲染
2. 文档类响应（HTML / XHTML / SVG）：X-Frame-Options: SAMEORIGIN + Referrer-Policy
3. 不带内容哈希版本号（非 ?v=）的静态响应：X-Content-Type-Options: nosniff
   带 ?v= 的响应是 immutable 长缓存，头部一旦下发一年内收不回，故不碰

失败语义：本模块只做加固、不做授权，调用方 import/计算失败时跳过并记日志，不影响出文件。
"""
from urllib.parse import unquote

USER_CONTENT_PREFIXES = ('/uploads',)
_DOCUMENT_MIMES = frozenset(('text/html', 'application/xhtml+xml', 'image/svg+xml'))
_USER_ACTIVE_MIMES = frozenset(('text/html', 'application/xhtml+xml', 'image/svg+xml',
                                'application/xml', 'text/xml'))
_USER_DOWNLOAD_MIMES = frozenset(('text/html', 'application/xhtml+xml'))


def _split(path):
    """'/a/b.html?v=1#x' -> ('/a/b.html', 'v=1#x')：分离路径与查询串 / 片段。"""
    p = str(path or '')
    cut = len(p)
    for sep in ('?', '#'):
        i = p.find(sep)
        if i >= 0:
            cut = min(cut, i)
    return p[:cut], p[cut:]


def _mime_key(mime):
    """'text/html; charset=utf-8' -> 'text/html'。"""
    return str(mime or '').split(';', 1)[0].strip().lower()


def _norm(path):
    """百分号解码 + 正反斜杠归一 + 小写，用于目录前缀判定（宁可多判，不可漏判）。"""
    return unquote(str(path or '')).replace('\\', '/').lower()


def is_user_content(path):
    """请求路径是否落在用户可控内容目录下。"""
    p, _ = _split(path)
    p = _norm(p)
    return any(p == x or p.startswith(x + '/') for x in USER_CONTENT_PREFIXES)


def is_versioned(path):
    """是否带内容哈希版本号（?v=…）——与静态出口的缓存判定同口径。"""
    return '?v=' in str(path or '')


def user_content_headers(path, mime, sec_fetch_dest=''):
    """规则 1：用户可控内容。返回 [(头名, 值)]，非用户内容返回 []。"""
    if not is_user_content(path):
        return []
    m = _mime_key(mime)
    out = [('X-Content-Type-Options', 'nosniff')]
    if m in _USER_ACTIVE_MIMES:
        out.append(('Content-Security-Policy', 'sandbox allow-scripts'))
    dest = str(sec_fetch_dest or '').strip().lower()
    # 无 Sec-Fetch-Dest 的客户端（老浏览器 / 工具）按"直接导航"处理，走更保守的下载
    if m in _USER_DOWNLOAD_MIMES and dest in ('', 'document'):
        out.append(('Content-Disposition', 'attachment'))
    return out


def document_headers(mime):
    """规则 2：文档类响应防嵌入。返回 [(头名, 值)]。"""
    if _mime_key(mime) in _DOCUMENT_MIMES:
        return [('X-Frame-Options', 'SAMEORIGIN'),
                ('Referrer-Policy', 'strict-origin-when-cross-origin')]
    return []


def static_safety_headers(path, mime, sec_fetch_dest='', skip=()):
    """静态出口统一入口：合成三类规则。

    skip：调用方已自行发送的头名集合（如 /plugins-ui/ 分支自带的 nosniff），同名不重复发。
    返回 [(头名, 值)]，顺序稳定。"""
    out = list(user_content_headers(path, mime, sec_fetch_dest))
    out += document_headers(mime)
    if not is_versioned(path):
        out.append(('X-Content-Type-Options', 'nosniff'))
    res = []
    seen = set(str(k).lower() for k in skip)
    for k, v in out:
        if k.lower() in seen:
            continue
        seen.add(k.lower())
        res.append((k, v))
    return res
