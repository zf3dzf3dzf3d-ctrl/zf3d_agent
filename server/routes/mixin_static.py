# -*- coding: utf-8 -*-
"""Mixin: 静态/健康/版本（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase
import logging


from util_log import get_logger
from util_http_safety import static_safety_headers

log = get_logger('static')
class MixinStatic(MixinBase):
    # ===== gzip 压缩出口（仅静态文本类，排除 SSE/二进制流）=====
    _GZIP_MIMES = ('text/', 'application/json', 'application/javascript',
                   'image/svg+xml', 'application/xml')
    _GZIP_MIN = 1024  # 小于 1KB 不压缩（压缩比差还费 CPU）

    def _gzip_encode(self, content, mime):
        """按 Accept-Encoding/类型/大小决定是否 gzip。返回 (body, 是否压缩)。"""
        try:
            if self.command not in ('GET', 'HEAD'):
                return content, False
            ae = (self.headers.get('Accept-Encoding') or '')
            if 'gzip' not in ae.lower():
                return content, False
            if not mime or not any(mime.startswith(m) for m in self._GZIP_MIMES):
                return content, False
            if 'event-stream' in mime:  # SSE 绝不压缩（会破坏流式语义）
                return content, False
            if not content or len(content) < self._GZIP_MIN:
                return content, False
            import gzip as _gzip
            buf = _gzip.compress(content, compresslevel=6)
            if len(buf) >= len(content):  # 没变小就不压
                return content, False
            return buf, True
        except Exception:
            logging.debug("gzip prepare failed, fallback raw", exc_info=True)
            return content, False

    def _send_static_body(self, status, content, mime, extra_headers=None):
        """统一静态出口：自动 gzip（发送前决定，Content-Length 用压缩后长度）。"""
        body, gz = self._gzip_encode(content, mime)
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        if gz:
            self.send_header('Content-Encoding', 'gzip')
            self.send_header('Vary', 'Accept-Encoding')
        # 带 ?v= 内容hash版本号的静态资源 → 允许长期缓存（号变即URL变，不会读到旧缓存）；
        # 无版本号（如 index.html）保持 no-store 防注入内容/端口meta 被缓存。
        # 修复：此前一刀切 no-store 导致 dock 动态挂载的 App js（计算器/记事本等）每次打开都重新下载，
        # prefetch 预取全部失效，远程访问时打开轻App极慢。
        if '?v=' in (self.path or ''):
            self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
        else:
            self.send_header('Cache-Control', 'no-store')
        # 安全响应头（唯一出口统一附加，规则见 util_http_safety 模块说明）：防嵌入 / nosniff /
        # 用户上传的可执行内容隔离。分支自带同名头（如 /plugins-ui/ 的 nosniff + 沙箱 CSP）不重复发。
        _have = [k for k, _v in (extra_headers or [])]
        _dest = self.headers.get('Sec-Fetch-Dest') if self.headers else ''
        for k, v in static_safety_headers(self.path, mime, _dest, skip=_have):
            self.send_header(k, v)
        for k, v in (extra_headers or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_GET_health(self):
        self._send_json({'ok': True, 'service': 'zf3d-sqlite', 'port': PORT})

    # ===== [2026-11-23 视频卡停修复] 媒体文件 Range 流式出口 =====
    # 背景：背景轮播视频播几秒即静止——旧 _serve_static 整文件 read() 后 200 全量回包，
    # 不支持 Range：Chrome 媒体栈只能靠前缀缓冲播放，缓冲耗尽即卡死且无法 seek/续播。
    # 媒体类扩展名改走 _send_file_with_range：206 分块流式 + Accept-Ranges，seek/loop/续播正常。
    _MEDIA_EXTS = ('.mp4', '.m4v', '.webm', '.mov', '.mkv', '.avi',
                   '.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac')

    def _send_file_with_range(self, file_path, mime, extra_headers=None):
        """媒体文件出口：支持单区间 HTTP Range，256KB 分块流式发送（不整读进内存）。"""
        try:
            total = os.path.getsize(file_path)
        except OSError:
            self.send_error(404)
            return
        rng = (self.headers.get('Range') or '').strip()
        start, end, status = 0, max(total - 1, 0), 200
        if rng and total > 0:
            import re as _re
            m = _re.match(r'^bytes=(\d*)-(\d*)$', rng)
            # 仅处理单区间；多区间/畸形区间按 RFC 允许忽略（回 200 全量）
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), total - 1)
                    else:
                        end = total - 1
                else:  # bytes=-N 后缀区间（最后 N 字节）
                    n = int(m.group(2))
                    if n <= 0:
                        self.send_error(416)
                        return
                    start = max(0, total - n)
                    end = total - 1
                if start >= total or end < start:
                    self.send_response(416)
                    self.send_header('Content-Range', 'bytes */%d' % total)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                status = 206
        length = (end - start + 1) if total > 0 else 0
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        if status == 206:
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, total))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra_headers or []):
            self.send_header(k, v)
        self.end_headers()
        if self.command == 'HEAD':
            return
        try:
            with open(file_path, 'rb') as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(256 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            # 浏览器按需取块时会主动断开（取够即停），属正常；须断 keep-alive 防残留污染连接
            self.close_connection = True
        except Exception:
            logging.debug("range stream failed", exc_info=True)


    def do_GET_version(self):
        # 从 version.json 实时读取；失败时回落到 config.VERSION
        try:
            vp = os.path.join(BASE_DIR, 'private', 'version.json')
            with open(vp, 'r', encoding='utf-8-sig') as f:
                vj = json.load(f)
            ver = vj.get('version') or VERSION
        except Exception:
            ver = VERSION
        self._send_json({'ok': True, 'version': ver})

    # ===== 璺敱鍒嗗彂 =====

    def _serve_static(self, path):
        """鎻愪緵闈欐€佹枃浠舵湇鍔?"""
        """提供静态文件服务"""
        from urllib.parse import unquote
        # 若是带请求体的方法（POST 等）走到静态兜底（多为 404），
        # 必须先读掉请求体，否则残留 body 会污染 keep-alive 连接，
        # 导致后续请求报 400/501 "Unsupported method ('{...}')"
        if self.command not in ('GET', 'HEAD', 'OPTIONS'):
            try:
                self._read_body()
            except Exception:
                try:
                    self.close_connection = True
                except Exception:
                    logging.debug("swallow", exc_info=True)
        # 安全：阻止目录穿越
        if '..' in path:
            self.send_error(403)
            return
        # 根路径 -> index.html
        if path == '/' or path == '':
            path = '/index.html'
        # ===== 帮助/介绍文档联动（受控只读访问 .md）=====
        # /README.md -> 项目根 README.md；/docs/xxx.md -> 项目 docs/ 目录
        # 仅放行 .md 后缀，禁止目录穿越；供设置面板简介/帮助动态渲染
        if path == '/README.md' or path.startswith('/docs/'):
            _rel = unquote(path.lstrip('/'))
            if '..' in _rel:
                self.send_error(403)
                return
            _mdfile = os.path.normpath(os.path.join(PUBLIC_DIR, '..', _rel))
            if not _mdfile.startswith(os.path.normpath(os.path.join(PUBLIC_DIR, '..'))) or not os.path.isfile(_mdfile):
                self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
                return
            ext_ok = os.path.splitext(_mdfile)[1].lower()
            if ext_ok != '.md' and ext_ok not in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'):
                self.send_error(403)
                return
            try:
                with open(_mdfile, 'rb') as f:
                    _mdcontent = f.read()
                _mimes_md = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                              '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'}
                try:
                    from security import auth_cookie_header
                    _ck = auth_cookie_header(self)
                except Exception:
                    _ck = None; logging.debug("swallow", exc_info=True)
                self._send_static_body(200, _mdcontent, _mimes_md.get(ext_ok, 'text/markdown; charset=utf-8'),
                                       extra_headers=[('Set-Cookie', _ck)] if _ck else None)
            except Exception as e:
                self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
            return
        # ===== B1 插件前端静态资源（/plugins-ui/<plugin-id>/<相对路径> -> plugins/<id>/ 下，8种白名单扩展名）=====
        # 【2026-11-17 B1 ui-mounts 装载器配套】供插件 ui.mount(slot, assets) 声明的前端资源经 HTTP 下发；
        # 约定：assets 相对路径含 ui/ 前缀（如 ui/panel.js），单路径解析不做回退拼接；
        # 安全：白名单扩展名 + realpath 终检，禁止穿越（模式照抄 /modes/ 分支）
        if path.startswith('/plugins-ui/'):
            _prel = unquote(path[len('/plugins-ui/'):].lstrip('/'))
            if '..' in _prel:
                self.send_error(403)
                return
            _proot = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'plugins'))
            _pfile = os.path.normpath(os.path.join(_proot, _prel))
            if not _pfile.startswith(os.path.join(_proot, '')) or not os.path.isfile(_pfile):
                self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
                return
            # realpath 终检：必须仍在 plugins/ 目录内
            try:
                if not os.path.realpath(_pfile).startswith(os.path.realpath(_proot) + os.sep):
                    self.send_error(403)
                    return
            except Exception:
                self.send_error(403)
                return
            _pext = os.path.splitext(_pfile)[1].lower()
            if _pext not in ('.js', '.css', '.json', '.md', '.html', '.svg', '.png', '.webp'):
                self.send_error(403)
                return
            _pmimes = {'.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
                       '.md': 'text/markdown; charset=utf-8', '.html': 'text/html; charset=utf-8',
                       '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp'}
            try:
                with open(_pfile, 'rb') as f:
                    _pcontent = f.read()
                self._send_static_body(200, _pcontent, _pmimes.get(_pext, 'application/octet-stream'),
                                       extra_headers=[('X-Content-Type-Options', 'nosniff'),
                                                      ('Content-Security-Policy', 'sandbox')])
            except Exception as e:
                self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
            return
        # ===== 插件模式静态资源（/modes/xxx/... -> modes/ 目录，仅允许 .js/.json/.css/.md）=====
        if path.startswith('/modes/'):
            _mrel = unquote(path[len('/modes/'):].lstrip('/'))
            if '..' in _mrel:
                self.send_error(403)
                return
            _mroot = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'modes'))
            _mfile = os.path.normpath(os.path.join(_mroot, _mrel))
            if not _mfile.startswith(_mroot) or not os.path.isfile(_mfile):
                self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
                return
            _mext = os.path.splitext(_mfile)[1].lower()
            if _mext not in ('.js', '.json', '.css', '.md'):
                self.send_error(403)
                return
            _mmime = MIME_TYPES.get(_mext, 'application/octet-stream')
            try:
                with open(_mfile, 'rb') as f:
                    _mcontent = f.read()
                try:
                    from security import auth_cookie_header
                    _ck = auth_cookie_header(self)
                except Exception:
                    _ck = None; logging.debug("swallow", exc_info=True)
                self._send_static_body(200, _mcontent, _mmime,
                                       extra_headers=[('Set-Cookie', _ck)] if _ck else None)
            except Exception as e:
                self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
            return
        # ===== 内置 2D 游戏引擎 API（画布游戏引擎节点用 iframe 内嵌 /engine2d/index.html，
        # 页面以主服务为源，fetch("/api/assets") 等请求会打到主服务，
        # 这里补齐 engine2d/server.py 独立运行时的同款路由）=====
        if path == '/api/assets' or path.startswith('/api/assets/'):
            _root2d = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'public', 'canvas', 'engine2d'))
            _assets2d = os.path.join(_root2d, 'assets')
            if path == '/api/assets':
                try:
                    _names2d = sorted(os.listdir(_assets2d))
                except Exception:
                    _names2d = []
                self._send_json({'ok': True, 'engine': 'py-browser-2d v0.1', 'assets': _names2d})
                return
            _name2d = os.path.basename(unquote(path[len('/api/assets/'):].split('?')[0]))
            _afile2d = os.path.normpath(os.path.join(_assets2d, _name2d))
            if _name2d and os.path.isfile(_afile2d):
                try:
                    with open(_afile2d, 'r', encoding='utf-8-sig') as _af2d:
                        self._send_json(json.load(_af2d))
                except Exception as _ae2d:
                    self._send_json({'ok': False, 'error': str(_ae2d)}, 500)
            else:
                self._send_json({'ok': False, 'error': 'not found'}, 404)
            return
        # /演示/*、/pres/* -> 项目根 演示/（HTML 演示播放器，画布演示节点 iframe 用）
        # 注意：self.path 是原始百分号编码，中文「演示」直接匹配不上，先解码再判断
        _pres_head = unquote(path.split('?')[0])
        if _pres_head == '/演示' or _pres_head.startswith('/演示/') \
                or _pres_head == '/pres' or _pres_head.startswith('/pres/'):
            _proot = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'public', 'canvas', '演示'))
            _prel = _pres_head[len('/演示/'):] if _pres_head.startswith('/演示/') else _pres_head[len('/pres/'):]
            if '..' in _prel:
                self.send_error(403)
                return
            if not _prel:
                _prel = 'viewer.html'
            _pfile = os.path.normpath(os.path.join(_proot, _prel.replace('/', os.sep)))
            if not _pfile.startswith(_proot) or not os.path.isfile(_pfile):
                # 兜底：无后缀的演示名自动补 .pres.json（如 /pres/slides/zf_agent_intro）
                if not _pfile.endswith('.json') and os.path.isfile(_pfile + '.pres.json'):
                    _pfile += '.pres.json'
                elif not os.path.isfile(_pfile):
                    self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
                    return
            _pext = os.path.splitext(_pfile)[1].lower()
            _pmime = MIME_TYPES.get(_pext, 'application/octet-stream')
            try:
                with open(_pfile, 'rb') as _pf:
                    _pcontent = _pf.read()
                self._send_static_body(200, _pcontent, _pmime)
            except Exception as e:
                self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
            return
        # /表格/* -> 项目根 表格/；/文档/* -> 项目根 文档/（大模型 Excel/Word 查看器，画布 iframe 用，含百分号解码）
        _docs_head = unquote(path.split('?')[0])
        for _dname in ('表格', '文档', '思维导图', '设计'):
            if _docs_head == '/' + _dname or _docs_head.startswith('/' + _dname + '/'):
                _droot = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'public', 'canvas', _dname))
                _drel = _docs_head[len('/' + _dname + '/'):] or 'viewer.html'
                if not _drel:
                    _drel = 'viewer.html'
                if '..' in _drel:
                    self.send_error(403)
                    return
                _dfile = os.path.normpath(os.path.join(_droot, _drel.replace('/', os.sep)))
                if not _dfile.startswith(_droot) or not os.path.isfile(_dfile):
                    self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
                    return
                _dmime = MIME_TYPES.get(os.path.splitext(_dfile)[1].lower(), 'application/octet-stream')
                try:
                    with open(_dfile, 'rb') as _df:
                        _dcontent = _df.read()
                    self._send_static_body(200, _dcontent, _dmime)
                except Exception as e:
                    self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
                return
        # /game -> private/engine2d（本机游戏内容）；/games/<名字>/ -> 项目根 games/
        if path == '/game' or path == '/game/':
            self.send_response(302)
            self.send_header('Location', '/game/game.html')
            self.end_headers()
            return
        if path.startswith('/game/') or path.startswith('/games/'):
            if path.startswith('/game/'):
                # [安全] /game/* 是隐私区游戏内容，仅允许本机访问，外网/局域网一律拒绝
                _cli = (self.client_address[0] if self.client_address else '')
                _xfwd = (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
                if _cli not in ('127.0.0.1', '::1', 'localhost') or (_xfwd and _xfwd not in ('127.0.0.1', '::1')):
                    self.send_error(403, b'Private area: local access only')
                    return
                _groot = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'private', 'engine2d'))
                _grel = unquote(path[len('/game/'):].split('?')[0])
            else:
                # /games/<名字>/ -> 优先 engine2d/games/（AI 生成规范目录），回落 public/canvas/games/ 与旧根目录 games/（兼容）
                _grel = unquote(path[len('/games/'):].split('?')[0])
                _gfile = None
                for _groot in (os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'public', 'canvas', 'engine2d', 'games')),
                               os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'public', 'canvas', 'games')),
                               os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'games'))):
                    _gf = os.path.normpath(os.path.join(_groot, _grel.replace('/', os.sep)))
                    if _gf.startswith(_groot) and os.path.isfile(_gf):
                        _gfile = _gf
                        break
                if _gfile is None:
                    self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
                    return
                _groot = os.path.dirname(_gfile)
            if '..' in _grel:
                self.send_error(403)
                return
            if _gfile is None:
                _gfile = os.path.normpath(os.path.join(_groot, _grel.replace('/', os.sep)))
            if not _gfile.startswith(_groot) or not os.path.isfile(_gfile):
                self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
                return
            _gext = os.path.splitext(_gfile)[1].lower()
            _gmime = MIME_TYPES.get(_gext, 'application/octet-stream')
            try:
                with open(_gfile, 'rb') as _gf:
                    _gcontent = _gf.read()
                try:
                    from security import auth_cookie_header
                    _ck = auth_cookie_header(self)
                except Exception:
                    _ck = None; logging.debug("swallow", exc_info=True)
                self._send_static_body(200, _gcontent, _gmime,
                                       extra_headers=[('Set-Cookie', _ck)] if _ck else None)
            except Exception as e:
                self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
            return
        # ===== 内置 2D 游戏引擎（public/canvas/engine2d/，只读静态服务）=====
        if path == '/engine2d' or path.startswith('/engine2d/'):
            _rel = unquote(path.lstrip('/'))
            if '..' in _rel:
                self.send_error(403)
                return
            _file = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'public', 'canvas', _rel))
            _root2d = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'public', 'canvas', 'engine2d'))
            if not _file.startswith(_root2d) or not os.path.isfile(_file):
                self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
                return
            _ext = os.path.splitext(_file)[1].lower()
            _mime = MIME_TYPES.get(_ext, 'application/octet-stream')
            if _ext == '.md':
                _mime = 'text/markdown; charset=utf-8'
            try:
                with open(_file, 'rb') as f:
                    _content = f.read()
                try:
                    from security import auth_cookie_header
                    _ck = auth_cookie_header(self)
                except Exception:
                    _ck = None; logging.debug("swallow", exc_info=True)
                self._send_static_body(200, _content, _mime,
                                       extra_headers=[('Set-Cookie', _ck)] if _ck else None)
            except Exception as e:
                self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
            return
        # ===== 自动 2D 角色流水线（public/canvas/auto2d/，只读静态服务；URL 不变）=====
        if path == '/auto2d' or path.startswith('/auto2d/'):
            _arel = unquote(path.lstrip('/'))
            if '..' in _arel:
                self.send_error(403)
                return
            _afile = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'public', 'canvas', _arel))
            _aroot = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'public', 'canvas', 'auto2d'))
            if not _afile.startswith(_aroot) or not os.path.isfile(_afile):
                self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
                return
            _aext = os.path.splitext(_afile)[1].lower()
            _amime = MIME_TYPES.get(_aext, 'application/octet-stream')
            if _aext == '.md':
                _amime = 'text/markdown; charset=utf-8'
            try:
                with open(_afile, 'rb') as f:
                    _acontent = f.read()
                try:
                    from security import auth_cookie_header
                    _ck = auth_cookie_header(self)
                except Exception:
                    _ck = None; logging.debug("swallow", exc_info=True)
                self._send_static_body(200, _acontent, _amime,
                                       extra_headers=[('Set-Cookie', _ck)] if _ck else None)
            except Exception as e:
                self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
            return
        # URL 解码（支持中文文件名锛屽 捐赠_寰俊.gif锛?
        path = unquote(path)
        # [安全 2026-11-08] 漫画柜本地库：版权/隐私内容，仅本机可访问，禁止局域网/外网直链外传
        if path.startswith('/canvas/漫画柜/本地库/'):
            _cli2 = (self.client_address[0] if self.client_address else '')
            _xfwd2 = (self.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
            if _cli2 not in ('127.0.0.1', '::1', 'localhost') or (_xfwd2 and _xfwd2 not in ('127.0.0.1', '::1')):
                self.send_error(403, b'Private area: local access only')
                return
        # [安全修复 2026-11-03 issue#20] unquote 后二次校验：编码穿越(%2e%2e)在前置原始检查中不可见
        if '..' in path or '\\..' in path:
            self.send_error(403)
            return
        # 映射到 public 目录
        # ===== 素材清单（动态）：/promo2/manifest.json 列出已生成的 shots/final/audio =====
        # 审片台据此只给已渲染素材挂 src，避免未生成镜头/成片在控制台刷 404
        if path.endswith('/manifest.json'):
            _mrel = path[1:-len('manifest.json')].rstrip('/')
            _mroot = os.path.join(PUBLIC_DIR, _mrel) if _mrel else ''
            if _mrel and '..' not in _mrel and os.path.isdir(_mroot):
                def _mlist(sub, ext):
                    _d = os.path.join(_mroot, sub)
                    if not os.path.isdir(_d):
                        return []
                    return sorted(_x for _x in os.listdir(_d)
                                  if not _x.startswith('.') and _x.lower().endswith(ext))
                _mbody = json.dumps({
                    'shots': _mlist('shots', '.mp4'),
                    'final': _mlist('final', '.mp4'),
                    'audio': _mlist('audio', '.mp3'),
                }, ensure_ascii=False).encode('utf-8')
                try:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Length', str(len(_mbody)))
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    if self.command == 'GET':
                        self.wfile.write(_mbody)

                except Exception as e:
                    self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
                return
        file_path = os.path.normpath(os.path.join(PUBLIC_DIR, path.lstrip('/')))
        # [安全修复 2026-11-03 issue#20] realpath 终检：最终路径必须仍在 public 目录内
        try:
            _fp_real = os.path.realpath(file_path)
            _pd_real = os.path.realpath(PUBLIC_DIR)
            if not (_fp_real == _pd_real or _fp_real.startswith(_pd_real + os.sep)):
                self.send_error(403)
                return
        except Exception:
            self.send_error(403)
            return
        # 鐩綍鍒欒ˉ index.html
        if os.path.isdir(file_path):
            file_path = os.path.join(file_path, 'index.html')
        if not os.path.isfile(file_path):
            self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
            return
        # 纭畾 MIME 类型
        ext = os.path.splitext(file_path)[1].lower()
        mime = MIME_TYPES.get(ext, 'application/octet-stream')
        # [2026-11-23 视频卡停修复] 媒体文件走 Range 流式出口（此前整读+200全量无 Range，
        # 浏览器播完前缀缓冲即卡死）。必须在整读/文本注入之前分流；安全校验均已在此前完成
        if ext in self._MEDIA_EXTS:
            try:
                from security import auth_cookie_header
                _ckm = auth_cookie_header(self)
            except Exception:
                _ckm = None; logging.debug("swallow", exc_info=True)
            self._send_file_with_range(file_path, mime,
                                       extra_headers=[('Set-Cookie', _ckm)] if _ckm else None)
            return
        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            # ---- 动态注入：极简分类工具清单来自 public/js/tools/minimal/ 文件夹（文件夹有多少就用多少）----
            if file_path.endswith('tools-definitions.js'):
                try:
                    import re
                    _jj_dir = os.path.join(PUBLIC_DIR, 'js', 'tools', 'minimal')
                    _jj_files = sorted([f[:-3] for f in os.listdir(_jj_dir) if f.endswith('.js')])
                    # switch_tool_category 是元工具（定义在 tools-definitions.js，无物理文件），
                    # 动态注入必须保留它，否则极简模式下 AI 无法调用它切换分类
                    if 'switch_tool_category' not in _jj_files:
                        _jj_files.insert(0, 'switch_tool_category')
                    _inner = ", ".join("'" + f + "'" for f in _jj_files)
                    _text = content.decode('utf-8')
                    _new = re.sub(r"('极简'\s*:\s*\{[^}]*?tools:\s*\[)[^\]]*(\])",
                                  lambda x: x.group(1) + _inner + x.group(2), _text, count=1)
                    content = _new.encode('utf-8')
                except Exception:
                    pass  # 注入失败则返回原文件，不影响服务
            # ---- 动态注入：峰控信令端口 meta（app-remote.js 靠 meta[name=remote-port] 取真实 ws 端口）----
            if ext in ('.html', '.htm'):
                try:
                    _rp = None
                    try:
                        import json as _json
                        _pjf = os.path.join(os.path.dirname(PUBLIC_DIR), 'private', 'port.json')
                        _pj_cfg = _json.load(open(_pjf, 'r', encoding='utf-8-sig'))
                        _rp = _pj_cfg.get('remote_ws_port') or _pj_cfg.get('remote_port')  # 优先新键名
                    except Exception:
                        _rp = None
                    if not _rp:
                        try:
                            import config as _cfg
                            # config 无 REMOTE_PORT 常量（PORTS 字典也不存在）；兜底与 6.2.0 端口段一致
                            _rp = getattr(_cfg, 'REMOTE_PORT', None) or 8623
                        except Exception:
                            _rp = 8623
                    _text = content.decode('utf-8', 'replace')
                    # ---- 动态注入：本地 js/css 缓存号自动升级（课题18 收口：内容变→hash 变→?v 自动变）----
                    try:
                        import re as _re
                        import hashlib as _hl
                        def _ver_of(_m):
                            _rel = _m.group(2).lstrip('/')
                            _fp = os.path.join(PUBLIC_DIR, _rel.replace('/', os.sep))
                            if os.path.isfile(_fp):
                                return _m.group(1) + _m.group(2) + '?v=' + _hl.md5(open(_fp, 'rb').read()).hexdigest()[:8] + _m.group(3)
                            return _m.group(0)
                        _text = _re.sub(r'((?:src|href)=["\'])(/?(?:js|css)/[^"\'?]+)(?:\?v=[^"\']*)?(["\'])',
                                       _ver_of, _text)
                    except Exception:
                        pass  # 注入失败返回原文，不影响服务
                    # ---- 动态注入：window.ZF_ASSET_VER（课题池：dock 动态挂载 App js 自动缓存号）----
                    # 注入 js 目录文件 md5 前8位映射（与课题18 hash 口径一致，防 mtime 复制盲区），
                    # 内容变→mtime变→映射值变→浏览器缓存自动失效，杜绝手工升号遗忘（进化师建议②）
                    try:
                        _js_dir_av = os.path.join(PUBLIC_DIR, 'js')
                        _ver_map = {}
                        for _fn in os.listdir(_js_dir_av):
                            if _fn.endswith('.js'):
                                try:
                                    _fp = os.path.join(_js_dir_av, _fn)
                                    with open(_fp, 'rb') as _fh:
                                        _ver_map[_fn] = _hl.md5(_fh.read()).hexdigest()[:8]
                                except Exception:
                                    pass
                        _av_script = ('<script>window.ZF_ASSET_VER='
                                      + json.dumps(_ver_map, separators=(',', ':')) + ';</script>')
                        if '<head>' in _text:
                            _text = _text.replace('<head>', '<head>' + _av_script, 1)
                        else:
                            _text = _av_script + _text
                    except Exception as _av_err:
                        logging.warning("[ZF_ASSET_VER] 注入失败，回退固定缓存号: %s", _av_err)  # 观测性：防静默吞错（代码师建议）
                    if 'name="remote-port"' not in _text and "name='remote-port'" not in _text:
                        _meta = '<meta name="remote-port" content="' + str(_rp) + '">'
                        if '<head>' in _text:
                            _text = _text.replace('<head>', '<head>' + _meta, 1)
                        else:
                            _text = _meta + _text
                    content = _text.encode('utf-8')
                except Exception:
                    pass  # 注入失败则返回原文件，不影响服务
            try:
                from security import auth_cookie_header
                _ck = auth_cookie_header(self)
            except Exception:
                _ck = None; logging.debug("swallow", exc_info=True)
            self._send_static_body(200, content, mime,
                                   extra_headers=[('Set-Cookie', _ck)] if _ck else None)
        except Exception as e:
            self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))



    def _handle_monitor_poll(self, query=None):

        allowed_ids = {
            chat_id for chat_id in (query or {}).get('chat_id', [])
            if isinstance(chat_id, str) and chat_id
        }
        if not allowed_ids:
            self._send_json({'ok': False, 'error': 'missing chat_id'}, 400)
            return

        conn = None
        try:
            # 【v8.3 B方案】前端真实 poll 即心跳：通知 daemon 哨兵「眼模式仍在线」，
            # daemon 心跳断供（35s 无 poll）+ 队列积压时才开无头页接管消费（monitor_daemon.py）。
            # 无头页 poll 带 daemon=1 标记，不计心跳（防接管抖动：无头页自己把自己救活）
            try:
                if 'daemon=1' not in (self.path or ''):
                    import monitor_daemon
                    monitor_daemon.touch()
            except Exception:
                logging.debug("swallow", exc_info=True)
            # DB 锁内快速完成：连接加短 busy_timeout，锁竞争时快速失败而非挂死
            with _db_lock:
                conn = get_db()
                try:
                    conn.execute("PRAGMA busy_timeout=3000")
                except Exception:
                    pass
                cur = conn.cursor()
                placeholders = ','.join('?' for _ in allowed_ids)
                cur.execute(
                    "SELECT key, value FROM app_data "
                    "WHERE category='monitor_queue' "
                    "AND json_extract(value, '$.chat_id') IN (" + placeholders + ") "
                    "ORDER BY created_at",
                    tuple(allowed_ids)
                )

                rows = cur.fetchall()
                items = []
                import re as _re_wake
                for r in rows:
                    try:
                        data = json.loads(r['value'])
                        if data.get('chat_id', '') not in allowed_ids:
                            continue
                        # 【v7.5 常驻值守】协作唤醒/自救消息的 key 含 team+codename
                        # （collab_wake_(team)_(codename)_(ts) / collab_watchdog_(team)_(codename)_(ts)），
                        # 解析出来随 item 下发——目标窗已关时前端按此身份自动重建协作窗
                        _wk = _re_wake.match(r'^collab_(?:wake|watchdog)_(collab_[0-9]+_[0-9a-z]+)_([a-z]+)_', str(r['key']))
                        items.append({
                            'key': r['key'],
                            'chat_id': data.get('chat_id', ''),
                            'message': data.get('message', ''),
                            'wake_team': _wk.group(1) if _wk else '',
                            'wake_codename': _wk.group(2) if _wk else ''
                        })
                    except Exception: logging.debug("swallow", exc_info=True)
                conn.close()
                conn = None
            self._send_json({'ok': True, 'items': items, 'count': len(items)})
        except Exception as e:
            log.info(f'[GET /api/monitor/poll] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try:
                    conn.close()
                except Exception:
                    logging.debug("swallow", exc_info=True)
            self._send_error(str(e), 500)


