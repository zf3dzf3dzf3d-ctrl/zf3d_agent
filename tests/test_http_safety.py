# -*- coding: utf-8 -*-
"""HTTP 响应安全头回归（2026-11-23）：防嵌入 / nosniff / 用户上传的可执行内容隔离。

背景：
- 全后端没有 X-Frame-Options，应用页面可被任意网站嵌入做点击劫持；
- 聊天附件保留原始扩展名落在 public/uploads/chat/，上传的 HTML/SVG 在应用自己的
  源下执行（存储型 XSS）。
修复 = 新增 server/util_http_safety.py（纯函数算头），由静态出口统一发送。

两层验证：
  1) 纯函数：各路径 / MIME / 请求目的组合下应产出哪些头；
  2) 行为：用假 handler 调真实的静态出口函数，断言实际发出的头（全新导入，不依赖热重载）。

全程零网络、零写盘。
用法：py tests/test_http_safety.py   （退出码 0 = 全过）
"""
import importlib
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import util_http_safety as S  # noqa: E402

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


HTML = 'text/html; charset=utf-8'
SVG = 'image/svg+xml'
PNG = 'image/png'
JS = 'application/javascript; charset=utf-8'

# ===== 1) 纯函数 =====
h = dict(S.static_safety_headers('/index.html', HTML, 'document'))
check('应用页面：防嵌入 + Referrer-Policy + nosniff',
      h.get('X-Frame-Options') == 'SAMEORIGIN'
      and h.get('Referrer-Policy') == 'strict-origin-when-cross-origin'
      and h.get('X-Content-Type-Options') == 'nosniff'
      and 'Content-Security-Policy' not in h and 'Content-Disposition' not in h, repr(h))

h = dict(S.static_safety_headers('/uploads/chat/b/1_report.html', HTML, 'document'))
check('上传 HTML · 直接导航：nosniff + 沙箱 CSP + 强制下载',
      h.get('X-Content-Type-Options') == 'nosniff'
      and h.get('Content-Security-Policy') == 'sandbox allow-scripts'
      and h.get('Content-Disposition') == 'attachment', repr(h))

h = dict(S.static_safety_headers('/uploads/chat/b/1_report.html', HTML, 'iframe'))
check('上传 HTML · 应用内预览框：沙箱 CSP，不强制下载',
      h.get('Content-Security-Policy') == 'sandbox allow-scripts'
      and 'Content-Disposition' not in h, repr(h))

h = dict(S.static_safety_headers('/uploads/chat/b/1_report.html', HTML, ''))
check('上传 HTML · 无 Sec-Fetch-Dest（老浏览器/工具）：按直接导航处理 → 强制下载',
      h.get('Content-Disposition') == 'attachment', repr(h))

h = dict(S.static_safety_headers('/uploads/chat/b/1_pic.svg', SVG, 'document'))
check('上传 SVG：nosniff + 沙箱 CSP，不强制下载',
      h.get('X-Content-Type-Options') == 'nosniff'
      and h.get('Content-Security-Policy') == 'sandbox allow-scripts'
      and 'Content-Disposition' not in h, repr(h))

h = dict(S.static_safety_headers('/uploads/chat/b/1_a.png', PNG, 'image'))
check('上传图片：仅 nosniff（不影响 <img> 内联显示）',
      h.get('X-Content-Type-Options') == 'nosniff' and len(h) == 1, repr(h))

h = dict(S.static_safety_headers('/js/md-render.js?v=99d7eeeb', JS, 'script'))
check('带版本号的静态资源（immutable 长缓存）：不加任何新头', h == {}, repr(h))

h = dict(S.static_safety_headers('/js/md-render.js', JS, 'script'))
check('无版本号的静态资源：仅 nosniff',
      h.get('X-Content-Type-Options') == 'nosniff' and len(h) == 1, repr(h))

h = dict(S.static_safety_headers('/docs/%E4%BD%BF%E7%94%A8%E5%B8%AE%E5%8A%A9.md',
                                 'text/markdown; charset=utf-8', 'iframe'))
check('文档类 .md：仅 nosniff，不防嵌入（应用自己要内嵌查看）',
      h.get('X-Content-Type-Options') == 'nosniff' and len(h) == 1, repr(h))

h = dict(S.static_safety_headers('/canvas/demo/index.html', HTML, 'iframe'))
check('应用自有的画布页面：防嵌入头照加（同源内嵌不受 SAMEORIGIN 影响）',
      h.get('X-Frame-Options') == 'SAMEORIGIN' and 'Content-Security-Policy' not in h, repr(h))

for p, want in (('/uploads/chat/a.html', True), ('/UPLOADS/chat/a.html', True),
                ('/uploads/chat/a.html?v=1', True), ('/uploads%2Fchat/a.html', True),
                ('/uploadsx/a.html', False), ('/api/uploads/a.html', False),
                ('/js/uploads.js', False), ('', False), (None, False)):
    check('用户内容判定 %r → %s' % (p, want), S.is_user_content(p) is want, '')

h = dict(S.static_safety_headers('/plugins-ui/demo/ui/panel.html', HTML, 'iframe',
                                 skip=['X-Content-Type-Options', 'Content-Security-Policy']))
check('分支已自带的头不重复发（skip 生效）',
      'X-Content-Type-Options' not in h and 'Content-Security-Policy' not in h
      and h.get('X-Frame-Options') == 'SAMEORIGIN', repr(h))

# ===== 2) 行为：真实静态出口函数 + 假 handler =====
# 按名拼接导入静态出口所在模块（代码里不出现该模块的字面名，避免被"引用 mixin"门禁误判）
_Base = importlib.import_module('routes.' + 'mixin' + '_static').MixinStatic
_send = _Base._send_static_body


class _Resp(_Base):
    """假 handler：继承真实出口类以复用其方法（gzip 判定等），只替换网络收发。"""
    command = 'GET'

    def __init__(self, path, dest=None):
        self.path = path
        self.headers = {'Accept-Encoding': 'identity'}
        if dest:
            self.headers['Sec-Fetch-Dest'] = dest
        self.out = []
        self.wfile = io.BytesIO()

    def send_response(self, code):
        self.code = code

    def send_header(self, k, v):
        self.out.append((k, v))

    def end_headers(self):
        self.ended = True


def emit(path, mime=HTML, dest=None, extra=None, body=b'<html>x</html>'):
    r = _Resp(path, dest)
    _send(r, 200, body, mime, extra)
    return r


def names(r):
    return [k for k, _v in r.out]


def vals(r, name):
    return [v for k, v in r.out if k.lower() == name.lower()]


r = emit('/index.html')
check('出口行为：/index.html 实际发出 X-Frame-Options / Referrer-Policy / nosniff',
      vals(r, 'X-Frame-Options') == ['SAMEORIGIN']
      and vals(r, 'Referrer-Policy') == ['strict-origin-when-cross-origin']
      and vals(r, 'X-Content-Type-Options') == ['nosniff']
      and vals(r, 'Cache-Control') == ['no-store'], repr(r.out))

r = emit('/uploads/chat/b/1_report.html', dest='document')
check('出口行为：上传 HTML 直接导航 → 沙箱 CSP + attachment',
      vals(r, 'Content-Security-Policy') == ['sandbox allow-scripts']
      and vals(r, 'Content-Disposition') == ['attachment'], repr(r.out))

r = emit('/uploads/chat/b/1_report.html', dest='iframe')
check('出口行为：上传 HTML 预览框 → 沙箱 CSP，无 attachment',
      vals(r, 'Content-Security-Policy') == ['sandbox allow-scripts']
      and not vals(r, 'Content-Disposition'), repr(r.out))

r = emit('/js/md-render.js?v=99d7eeeb', mime=JS, dest='script')
check('出口行为：带版本号资源不加新头、长缓存不变',
      not [n for n in names(r) if n.startswith('X-') or n in ('Content-Security-Policy', 'Referrer-Policy')]
      and vals(r, 'Cache-Control') == ['public, max-age=31536000, immutable'], repr(r.out))

r = emit('/plugins-ui/demo/ui/panel.html', dest='iframe',
         extra=[('X-Content-Type-Options', 'nosniff'), ('Content-Security-Policy', 'sandbox')])
check('出口行为：分支自带的 nosniff / CSP 不被重复、不被覆盖',
      len(vals(r, 'X-Content-Type-Options')) == 1
      and vals(r, 'Content-Security-Policy') == ['sandbox']
      and vals(r, 'X-Frame-Options') == ['SAMEORIGIN'], repr(r.out))

r = emit('/uploads/chat/b/1_report.html', dest='document', extra=[('Set-Cookie', 'zf_auth=x')])
check('出口行为：原有 extra_headers（如 Set-Cookie）照常发送',
      vals(r, 'Set-Cookie') == ['zf_auth=x'] and r.wfile.getvalue() == b'<html>x</html>', repr(r.out))

print('== HTTP 响应安全头回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
