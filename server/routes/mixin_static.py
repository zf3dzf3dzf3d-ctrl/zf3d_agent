# -*- coding: utf-8 -*-
"""Mixin: 静态/健康/版本（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinStatic(MixinBase):
    def do_GET_health(self):
        self._send_json({'ok': True, 'service': 'zf3d-sqlite', 'port': PORT})


    def do_GET_version(self):
        # 从 version.json 实时读取；失败时回落到 config.VERSION
        try:
            vp = os.path.join(BASE_DIR, 'private', 'version.json')
            with open(vp, 'r', encoding='utf-8') as f:
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
                try: self.close_connection = True
                except Exception: pass
        # 瀹夊叏锛氶樆姝㈢洰褰曠┛瓒?
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
                self.send_response(200)
                _img_types = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                              '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'}
                self.send_header('Content-Type', _img_types.get(ext_ok, 'text/markdown; charset=utf-8'))
                self.send_header('Content-Length', str(len(_mdcontent)))
                self.send_header('Cache-Control', 'no-cache')
                try:
                    from security import auth_cookie_header
                    _ck = auth_cookie_header()
                    if _ck:
                        self.send_header('Set-Cookie', _ck)
                except Exception:
                    pass
                self.end_headers()
                self.wfile.write(_mdcontent)
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
                self.send_response(200)
                self.send_header('Content-Type', _mmime)
                self.send_header('Content-Length', str(len(_mcontent)))
                self.send_header('Cache-Control', 'no-cache')
                try:
                    from security import auth_cookie_header
                    _ck = auth_cookie_header()
                    if _ck:
                        self.send_header('Set-Cookie', _ck)
                except Exception:
                    pass
                self.end_headers()
                self.wfile.write(_mcontent)
            except Exception as e:
                self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
            return
        # ===== 内置 2D 游戏引擎（项目根 engine2d/，只读静态服务）=====
        if path == '/engine2d' or path.startswith('/engine2d/'):
            _rel = unquote(path.lstrip('/'))
            if '..' in _rel:
                self.send_error(403)
                return
            _file = os.path.normpath(os.path.join(PUBLIC_DIR, '..', _rel))
            _root2d = os.path.normpath(os.path.join(PUBLIC_DIR, '..', 'engine2d'))
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
                self.send_response(200)
                self.send_header('Content-Type', _mime)
                self.send_header('Content-Length', str(len(_content)))
                self.send_header('Cache-Control', 'no-cache')
                try:
                    from security import auth_cookie_header
                    _ck = auth_cookie_header()
                    if _ck:
                        self.send_header('Set-Cookie', _ck)
                except Exception:
                    pass
                self.end_headers()
                self.wfile.write(_content)
            except Exception as e:
                self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))
            return
        # URL 瑙ｇ爜锛堟敮鎸佷腑鏂囨枃浠跺悕锛屽 鎹愯禒_寰俊.gif锛?
        path = unquote(path)
        # 鏄犲皠鍒?public 鐩綍
        file_path = os.path.join(PUBLIC_DIR, path.lstrip('/'))
        # 鐩綍鍒欒ˉ index.html
        if os.path.isdir(file_path):
            file_path = os.path.join(file_path, 'index.html')
        if not os.path.isfile(file_path):
            self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
            return
        # 纭畾 MIME 绫诲瀷
        ext = os.path.splitext(file_path)[1].lower()
        mime = MIME_TYPES.get(ext, 'application/octet-stream')
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
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-cache')
            # 安全：静态页面响应种下认证 Cookie，浏览器后续自动携带（用户零感知）
            try:
                from security import auth_cookie_header
                _ck = auth_cookie_header()
                if _ck:
                    self.send_header('Set-Cookie', _ck)
            except Exception:
                pass
            self.end_headers()
            self.wfile.write(content)
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
            with _db_lock:
                conn = get_db()
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
                for r in rows:
                    try:
                        data = json.loads(r['value'])
                        if data.get('chat_id', '') not in allowed_ids:
                            continue
                        items.append({
                            'key': r['key'],
                            'chat_id': data.get('chat_id', ''),
                            'message': data.get('message', '')
                        })
                    except Exception:
                        pass
                conn.close()
                conn = None
            self._send_json({'ok': True, 'items': items, 'count': len(items)})
        except Exception as e:
            print(f'[GET /api/monitor/poll] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except Exception: pass
            self._send_error(str(e), 500)


