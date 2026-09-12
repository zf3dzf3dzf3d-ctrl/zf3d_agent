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
                self.send_response(200)
                self.send_header('Content-Type', _pmime)
                self.send_header('Content-Length', str(len(_pcontent)))
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(_pcontent)
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
                    self.send_response(200)
                    self.send_header('Content-Type', _dmime)
                    self.send_header('Content-Length', str(len(_dcontent)))
                    self.send_header('Cache-Control', 'no-cache')
                    self.end_headers()
                    self.wfile.write(_dcontent)
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
                self.send_response(200)
                self.send_header('Content-Type', _gmime)
                self.send_header('Content-Length', str(len(_gcontent)))
                self.send_header('Cache-Control', 'no-cache')
                try:
                    from security import auth_cookie_header
                    _ck = auth_cookie_header()
                    if _ck:
                        self.send_header('Set-Cookie', _ck)
                except Exception:
                    pass
                self.end_headers()
                self.wfile.write(_gcontent)
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
                self.send_response(200)
                self.send_header('Content-Type', _amime)
                self.send_header('Content-Length', str(len(_acontent)))
                self.send_header('Cache-Control', 'no-cache')
                try:
                    from security import auth_cookie_header
                    _ck = auth_cookie_header()
                    if _ck:
                        self.send_header('Set-Cookie', _ck)
                except Exception:
                    pass
                self.end_headers()
                self.wfile.write(_acontent)
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


