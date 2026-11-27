# -*- coding: utf-8 -*-
"""Mixin: 文件系统操作（星图扫描/fs浏览/文件读写/文本保存/fs ops），拆自 mixin_project.py"""
from routes._shared import *
from routes.mixin_base import MixinBase


from util_log import get_logger

zf_log = get_logger('project_fs')
class MixinProjectFs(MixinBase):
    @staticmethod
    def _fs_sensitive_dir(rp):
        """【Phase 3.4 20261123】目录列举敏感防护：private/、.git、cache/thumbs
        不经本组接口浏览（防同源注入页探测隐私资产结构；内容读路由已有同款
        防线）。目录本身即敏感根（如 ...\private 无尾分隔符）同样拦截。"""
        low = (rp or '').lower().replace('/', '\\').rstrip('\\')
        parts = low.split('\\')
        if 'private' in parts or '.git' in parts:
            return True
        return any(parts[i] == 'cache' and parts[i + 1] == 'thumbs'
                   for i in range(len(parts) - 1))
    def _handle_starmap_scan(self, parsed):
        """【星空知识图谱】/api/starmap/scan?path=...：递归扫描项目文件（路径/大小/mtime）
        + 提取 JS/HTML/Py 的 import/require 依赖边。只读元信息不读内容正文，返回体轻量。"""
        qs = parse_qs(parsed.query)
        raw_path = (qs.get('path', [''])[0] or '').strip()
        try:
            rp = os.path.realpath(raw_path) if raw_path else BASE_DIR
            if len(raw_path) == 2 and raw_path[1] == ':':
                rp = os.path.realpath(raw_path + '\\')
            if self._fs_sensitive_dir(rp):
                self._send_json({'ok': False, 'error': '敏感目录禁止浏览'})
                return
            if not os.path.isdir(rp):
                self._send_json({'ok': False, 'error': '目录不存在: ' + raw_path})
                return
            files, deps = [], []
            total_size = 0
            dep_set = set()
            max_files = 8000  # 防超巨目录拖死
            max_dep_src = 1024 * 256  # 单文件读前 256KB 提依赖足够
            for dirpath, dirnames, filenames in os.walk(rp):
                dirnames[:] = [d for d in dirnames if d not in self.SKIP_DIRS and not d.startswith('.')]
                for name in filenames:
                    if name.startswith('.') or name.endswith('.bak'):
                        continue
                    fp = os.path.join(dirpath, name)
                    try:
                        st = os.stat(fp)
                    except OSError:
                        continue
                    files.append({'path': fp.replace('/', '\\'), 'name': name,
                                 'size': st.st_size, 'mtime': int(st.st_mtime * 1000)})
                    total_size += st.st_size
                    ext = os.path.splitext(name)[1].lower()
                    if ext in self.STARMAP_TEXT_EXTS and st.st_size <= max_dep_src and len(deps) < 4000:
                        try:
                            with open(fp, 'r', encoding='utf-8-sig', errors='ignore') as fh:
                                text = fh.read(max_dep_src)
                            if ext == '.html':
                                # 本项目 JS 用 script 标签组装，HTML 引用即依赖边
                                for sm in self.STARMAP_HTML_RE.finditer(text):
                                    dep = sm.group(1)
                                    tgt = os.path.normpath(os.path.join(dirpath, dep))
                                    if os.path.isfile(tgt):
                                        key = (fp, tgt)
                                        if key not in dep_set:
                                            dep_set.add(key)
                                            deps.append({'from': fp.replace('/', '\\'), 'to': tgt.replace('/', '\\')})
                            elif ext == '.py':
                                for pm in self.STARMAP_PY_RE.finditer(text):
                                    dep = (pm.group(1) or pm.group(2) or '').split('.')[0]
                                    if dep in ('os', 'sys', 're', 'json', 'time', 'traceback', 'base64',
                                               'urllib', 'typing', 'collections', 'functools'):
                                        continue
                                    tgt = os.path.normpath(os.path.join(dirpath, dep + '.py'))
                                    tgt2 = os.path.normpath(os.path.join(dirpath, dep, '__init__.py'))
                                    for cand in (tgt, tgt2):
                                        if os.path.isfile(cand):
                                            key = (fp, cand)
                                            if key not in dep_set:
                                                dep_set.add(key)
                                                deps.append({'from': fp.replace('/', '\\'), 'to': cand.replace('/', '\\')})
                                            break
                            else:
                                for m in self.STARMAP_DEP_RE.finditer(text):
                                    dep = m.group(1)
                                    if dep.startswith('.') or dep.startswith('/'):
                                        # 相对引用：解析到真实文件
                                        tgt = os.path.normpath(os.path.join(dirpath, dep))
                                        for cand in (tgt, tgt + '.js', tgt + '.py', tgt + '.html',
                                                     os.path.join(tgt, 'index.js')):
                                            if os.path.isfile(cand):
                                                key = (fp, os.path.abspath(cand))
                                                if key not in dep_set:
                                                    dep_set.add(key)
                                                    deps.append({'from': fp.replace('/', '\\'),
                                                                 'to': os.path.abspath(cand).replace('/', '\\')})
                                                break
                        except OSError:
                            pass
                if len(files) >= max_files:
                    break
            # Git 热力层：近 180 天每个文件的提交次数（无 git / 非 git 仓库则静默为空）
            git_heat = {}
            try:
                import subprocess as _sp
                import time as _time
                since = '--since=' + _time.strftime('%Y-%m-%d', _time.localtime(_time.time() - 180 * 86400))
                out = _sp.run(['git', 'log', since, '--name-only', '--pretty=format:%H'],
                              cwd=rp, capture_output=True, text=True, timeout=15,
                              encoding='utf-8', errors='ignore')
                if out.returncode == 0 and out.stdout:
                    prefix = rp.rstrip('\\') + '\\'
                    for line in out.stdout.splitlines():
                        ln = line.strip().replace('/', '\\')
                        if ln and len(ln) == 40 and set(ln) <= set('0123456789abcdef'):
                            continue  # commit hash 行
                        if ln:
                            git_heat[prefix + ln] = git_heat.get(prefix + ln, 0) + 1
            except Exception:
                git_heat = {}
            self._send_json({'ok': True, 'root': rp, 'files': files, 'totalSize': total_size,
                             'deps': deps, 'count': len(files),
                             'gitHeat': git_heat if git_heat else None})
        except Exception as e:
            zf_log.error(f'[GET /api/starmap/scan] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)

    def _handle_git_commit(self, parsed):
        """【项目Git图谱·提交详情】/api/git/commit?path=...&hash=...：
        返回单次提交的完整信息 + 变更文件统计 + 每文件 patch（截断）。"""
        qs = parse_qs(parsed.query)
        raw_path = (qs.get('path', [''])[0] or '').strip()
        chash = (qs.get('hash', [''])[0] or '').strip()
        if not chash:
            self._send_json({'ok': False, 'error': '缺少 hash 参数'})
            return
        try:
            rp = os.path.realpath(raw_path) if raw_path else BASE_DIR
            if self._fs_sensitive_dir(rp):
                self._send_json({'ok': False, 'error': '敏感目录禁止浏览'})
                return
            if not os.path.isdir(rp):
                self._send_json({'ok': False, 'error': '目录不存在: ' + raw_path})
                return
            import subprocess as _sp
            def _git(args):
                return _sp.run(['git'] + args, cwd=rp, capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=15)
            # 提交元信息
            sep = '\x1f'
            meta = _git(['show', '-s', '--pretty=format:' + sep.join(
                ['%H', '%P', '%an', '%ae', '%at', '%s', '%b', '%D']), chash])
            if meta.returncode != 0 or not meta.stdout.strip():
                self._send_json({'ok': False, 'error': '提交不存在: ' + chash})
                return
            p = meta.stdout.strip().split(sep)
            info = {'hash': p[0], 'parents': (p[1].split() if p[1] else []),
                    'author': p[2], 'email': p[3], 'time': int(p[4]) * 1000,
                    'subject': p[5], 'body': (p[6] if len(p) > 6 else ''),
                    'refs': [r.strip() for r in p[7].split(',') if r.strip()] if len(p) > 7 and p[7] else []}
            # 文件统计（numstat：增/删/文件）
            ns = _git(['show', '--numstat', '--pretty=format:', chash])
            files = []
            for ln in (ns.stdout or '').splitlines():
                seg = ln.split('\t')
                if len(seg) >= 3:
                    files.append({'add': seg[0], 'del': seg[1], 'file': seg[2]})
            # patch（每文件最多 200 行，总量截断）
            pd = _git(['show', '--patch', '--unified=3', '--pretty=format:', chash])
            patch = (pd.stdout or '').splitlines()
            truncated = len(patch) > 1200
            self._send_json({'ok': True, 'commit': info, 'files': files,
                             'patch': '\n'.join(patch[:1200]), 'patchTruncated': truncated})
        except Exception as e:
            zf_log.error(f'[GET /api/git/commit] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)

    # ===== 游戏存档 GET /api/save?key=xxx（读单条）或 ?list=1（列表）=====
    def _handle_game_save_get(self, parsed):
        try:
            import json as _json, sqlite3
            db_path = os.path.join(BASE_DIR, 'data', 'game_saves.db')
            if not os.path.exists(db_path):
                self._send_json({'ok': True, 'data': None, 'list': []})
                return
            qs = parse_qs(parsed.query)
            conn = sqlite3.connect(db_path)
            # 【修复 2026-11-23】读侧补 WAL 开关（journal_mode 持久化，已是 wal 则跳过）
            try:
                if (conn.execute('PRAGMA journal_mode').fetchone() or ('',))[0] != 'wal':
                    conn.execute('PRAGMA journal_mode=WAL')
            except Exception:
                pass
            try:
                if 'list' in qs:
                    rows = conn.execute('SELECT key, updated FROM saves ORDER BY updated DESC').fetchall()
                    self._send_json({'ok': True, 'list': [{'key': r[0], 'updated': r[1]} for r in rows]})
                    return
                key = (qs.get('key') or [''])[0].strip()
                if not key:
                    self._send_json({'ok': False, 'err': '需要 key 或 list=1'})
                    return
                row = conn.execute('SELECT data FROM saves WHERE key=?', (key,)).fetchone()
                self._send_json({'ok': True, 'data': (_json.loads(row[0]) if row else None)})
            finally:
                conn.close()
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

    def _handle_git_graph(self, parsed):
        """【项目Git图谱】/api/git/graph?path=...&limit=200：读取 git 历史并转为图谱数据。
        返回 commits（含 hash/parents/author/date/message/refs/branch 列）+ branches + stats。
        非 git 仓库返回 ok:false。"""
        qs = parse_qs(parsed.query)
        raw_path = (qs.get('path', [''])[0] or '').strip()
        try:
            limit = max(10, min(int(qs.get('limit', ['300'])[0]), 2000))
        except ValueError:
            limit = 300
        try:
            rp = os.path.realpath(raw_path) if raw_path else BASE_DIR
            if len(raw_path) == 2 and raw_path[1] == ':':
                rp = os.path.realpath(raw_path + '\\')
            if self._fs_sensitive_dir(rp):
                self._send_json({'ok': False, 'error': '敏感目录禁止浏览'})
                return
            if not os.path.isdir(rp):
                self._send_json({'ok': False, 'error': '目录不存在: ' + raw_path})
                return
            import subprocess as _sp
            def _git(args):
                return _sp.run(['git'] + args, cwd=rp, capture_output=True, text=True,
                               encoding='utf-8', errors='replace', timeout=15)
            # 确认是 git 仓库
            top = _git(['rev-parse', '--show-toplevel'])
            if top.returncode != 0:
                self._send_json({'ok': False, 'error': '该目录不是 git 仓库'})
                return
            repo_root = top.stdout.strip()
            sep = '\x1f'  # unit separator，避免与消息内容冲突
            fmt = sep.join(['%H', '%P', '%an', '%ae', '%at', '%s', '%D'])
            log = _git(['log', '--all', '--max-count=' + str(limit),
                        '--date-order', '--pretty=format:' + fmt])
            commits, children = [], {}
            for ln in (log.stdout or '').splitlines():
                if not ln.strip():
                    continue
                parts = ln.split(sep)
                if len(parts) < 7:
                    continue
                h, ps, an, ae, at, subj, refs = parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], parts[6]
                parents = ps.split() if ps else []
                commit = {'hash': h[:10], 'parents': [p[:10] for p in parents],
                          'author': an, 'email': ae, 'time': int(at) * 1000,
                          'subject': subj, 'refs': [r.strip() for r in refs.split(',') if r.strip()] if refs else []}
                commits.append(commit)
                for p in parents:
                    children.setdefault(p[:10], []).append(h[:10])
            # 分支列表
            bl = _git(['for-each-ref', '--sort=-committerdate',
                       '--format=%(refname:short)\t%(objectname:short)\t%(committerdate:relative)',
                       'refs/heads', 'refs/remotes'])
            branches = []
            for ln in (bl.stdout or '').splitlines():
                seg = ln.split('\t')
                if len(seg) >= 2:
                    branches.append({'name': seg[0], 'hash': seg[1], 'when': seg[2] if len(seg) > 2 else ''})
            # 统计
            st = _git(['rev-list', '--all', '--count'])
            total = int(st.stdout.strip()) if st.returncode == 0 and st.stdout.strip().isdigit() else len(commits)
            self._send_json({'ok': True, 'root': repo_root,
                             'commits': commits, 'branches': branches,
                             'children': children, 'total': total,
                             'shown': len(commits), 'limit': limit})
        except Exception as e:
            zf_log.error(f'[GET /api/git/graph] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)

    def _handle_fs_browse(self, parsed):
        """【通用文件浏览】/api/fs/browse?path=...：列出任意目录（不再限制在项目内）。
        path 为空时返回磁盘列表和系统快捷目录（桌面/文档/下载/图片/此电脑）。"""
        qs = parse_qs(parsed.query)
        raw_path = (qs.get('path', [''])[0] or '').strip()
        try:
            # 无 path：返回快捷入口 + 磁盘列表
            if not raw_path:
                import string
                # 【性能修复】串行 os.path.exists 遇软驱(A:)/断开的网络盘会每个阻塞数秒~数十秒，
                # 曾把首次打开文件树拖到前端 30 秒超时。改为并发探测 + 单盘 3 秒超时。
                from concurrent.futures import ThreadPoolExecutor, TimeoutError as _TFTimeout
                letters = [l + ':\\' for l in string.ascii_uppercase]
                def _probe(dp):
                    try:
                        if os.path.exists(dp):
                            return {'name': '本地磁盘 (' + dp[0] + ':)', 'path': dp}
                    except Exception:
                        pass
                    return None
                drives = []
                try:
                    with ThreadPoolExecutor(max_workers=8) as _pool:
                        try:
                            for _r in _pool.map(_probe, letters, timeout=3):
                                if _r:
                                    drives.append(_r)
                        except _TFTimeout:
                            pass  # 超时的盘（软驱/断网盘）直接跳过，不再阻塞响应
                except Exception:
                    pass
                if not drives:
                    # 极端兜底：并发探测全军覆没时至少回退串行快查固定盘
                    for l in 'CDEFghijklmnopqrstuvwxyz'.upper():
                        dp = l + ':\\'
                        try:
                            if os.path.exists(dp):
                                drives.append({'name': '本地磁盘 (' + l + ':)', 'path': dp})
                        except Exception:
                            pass
                quick = []
                for label, key in [('🖥 桌面', 'DESKTOP'), ('📂 我的文档', 'DOCUMENTS'),
                                   ('⬇️ 下载', 'DOWNLOAD'), ('🖼 图片', 'PICTURES')]:
                    try:
                        quick.append({'name': label, 'path': self._shell_folder(key)})
                    except Exception:
                        pass
                self._send_json({'ok': True, 'mode': 'shell', 'drives': drives, 'quick': quick})
                return
            rp = os.path.realpath(raw_path)
            # 裸盘符（如 "F:"）realpath 会解析成该盘上的当前工作目录，需还原为盘符根
            if len(rp) >= 2 and rp[1] == ':' and len(rp) == 2:
                rp += '\\'
            elif len(raw_path) == 2 and raw_path[1] == ':':
                rp = os.path.realpath(raw_path + '\\')
            if self._fs_sensitive_dir(rp):
                self._send_json({'ok': False, 'error': '敏感目录禁止浏览'})
                return
            if not os.path.isdir(rp):
                self._send_json({'ok': False, 'error': '目录不存在: ' + raw_path})
                return
            dirs, files = [], []
            limit = 500
            offset = 0
            try:
                limit = max(50, min(2000, int((qs.get('limit', ['200'])[0] or '200'))))
            except Exception:
                limit = 500
            try:
                offset = max(0, int((qs.get('offset', ['0'])[0] or '0')))
            except Exception:
                offset = 0
            total_files = 0
            dir_items = []   # 【性能优化】目录项延迟组装，避免全量 stat
            file_names = []  # 【性能优化】先只收集文件名，排序分页后再对返回的一页做 stat
            with os.scandir(rp) as it:
                for entry in it:
                    name = entry.name
                    if name.startswith('.'):
                        continue
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if name in self.SKIP_DIRS:
                                continue
                            dir_items.append({'name': name, 'path': entry.path})
                        else:
                            file_names.append(name)
                    except (PermissionError, OSError):
                        continue
            dirs = dir_items
            dirs.sort(key=lambda d: d['name'].lower())
            file_names.sort(key=lambda n: n.lower())
            total_files = len(file_names)
            page_names = file_names[offset:offset + limit]
            has_more = (offset + limit) < total_files
            files = []
            for name in page_names:
                fp = os.path.join(rp, name)
                try:
                    st = os.stat(fp)
                    item = {'name': name, 'path': fp, 'size': st.st_size, 'mtime': int(st.st_mtime * 1000)}
                except (PermissionError, OSError):
                    item = {'name': name, 'path': fp, 'size': 0, 'mtime': 0}
                ext = os.path.splitext(name)[1].lower()
                if ext in self.IMAGE_EXTS:
                    item['image'] = True
                files.append(item)
            self._send_json({'ok': True, 'path': rp, 'dirs': dirs, 'files': files,
                             'total_files': total_files, 'has_more': has_more,
                             'limit': limit, 'offset': offset})
        except Exception as e:
            zf_log.error(f'[GET /api/fs/browse] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)

    @staticmethod

    def _shell_folder(key):
        # Windows 用 SHGetFolderPathW；Linux/Mac 用标准 HOME 路径
        import sys
        if sys.platform == 'win32':
            import ctypes.wintypes
            csidl = {'DESKTOP': 0x0000, 'DOCUMENTS': 0x0005, 'DOWNLOAD': 0x000C, 'PICTURES': 0x27}[key]
            buf = ctypes.create_unicode_buffer(ctypes.wintypes.MAX_PATH)
            ctypes.windll.shell32.SHGetFolderPathW(None, csidl, None, 0, buf)
            return buf.value or ''
        home = os.path.expanduser('~')
        sub = {'DESKTOP': 'Desktop', 'DOCUMENTS': 'Documents',
               'DOWNLOAD': 'Downloads', 'PICTURES': 'Pictures'}.get(key, '')
        p = os.path.join(home, sub) if sub else home
        return p if os.path.isdir(p) else home


    def _handle_fs_file(self, parsed):
        """【本地文件代理】/api/fs/file?path=...：返回本地文件内容（绕过浏览器 file:// 限制）。
        仅用于缩略图预览等只读展示，限制在常见图片/文本类型，防止任意文件下载。"""
        qs = parse_qs(parsed.query)
        raw_path = (qs.get('path', [''])[0] or '').strip()
        try:
            if not raw_path:
                self._send_error('缺少 path 参数', 400)
                return
            rp = os.path.realpath(raw_path)
            if not os.path.isfile(rp):
                self._send_error('文件不存在: ' + raw_path, 404)
                return
            # 【安全加固】敏感目录黑名单（与 project_fs_thumb._handle_fs_thumb 同款）：
            # 项目内 private/、.git、cache/thumbs 不允许经本接口读出，
            # 防止被注入页面借此探测/下载本机敏感文件（路径仍保持全盘可用定位）
            _low = rp.lower()
            for _seg in ('\\private\\', '\\.git\\', '\\cache\\thumbs\\'):
                if _seg in _low:
                    self._send_error('敏感目录禁止访问', 403)
                    return
            ext = os.path.splitext(rp)[1].lower()
            # 文本类型（含 *.py.bak 这类“文本扩展名+.bak”组合），限 2MB，防任意二进制下载
            TEXT_MIME = {'.txt': 'text/plain', '.md': 'text/plain', '.log': 'text/plain',
                         '.py': 'text/plain', '.js': 'text/plain', '.json': 'application/json',
                         '.html': 'text/html', '.css': 'text/css', '.xml': 'text/xml',
                         '.csv': 'text/plain', '.ini': 'text/plain', '.cfg': 'text/plain',
                         '.bat': 'text/plain', '.sh': 'text/plain', '.yml': 'text/plain',
                         '.yaml': 'text/plain', '.sql': 'text/plain', '.ts': 'text/plain'}
            base_ext = ext
            if base_ext == '.bak':
                stem_ext = os.path.splitext(os.path.splitext(rp)[0])[1].lower()
                if stem_ext in TEXT_MIME:
                    base_ext = stem_ext
            mime = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp',
                    '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
                    '.tif': 'image/tiff', '.tiff': 'image/tiff'}.get(ext)
            # 视频类型（供文件树缩略图/播放器使用，如录屏 MP4）
            VIDEO_MIME = {'.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
                          '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
                          '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo'}
            is_video = False
            if not mime and ext in VIDEO_MIME:
                mime = VIDEO_MIME[ext]
                is_video = True
            is_text = False
            if not mime and base_ext in TEXT_MIME:
                mime = 'text/plain; charset=utf-8'
                is_text = True
            if not mime:
                self._send_error('不支持的文件类型: ' + ext, 403)
                return
            try:
                size = os.path.getsize(rp)
                if size > (2 * 1024 * 1024 if is_text else (500 * 1024 * 1024 if is_video else 50 * 1024 * 1024)):
                    self._send_error('文件过大', 413)
                    return
                with open(rp, 'rb') as f:
                    content = f.read()
            except (PermissionError, OSError) as e:
                self._send_error('无法读取: ' + str(e), 403)
                return
            # 视频文件：支持 HTTP Range（浏览器 <video> 拖动进度条必需）
            if is_video:
                range_header = self.headers.get('Range') or ''
                total = len(content)
                m = None
                if range_header:
                    import re as _re
                    m = _re.match(r'bytes=(\d*)-(\d*)', range_header.strip())
                if m:
                    start = int(m.group(1)) if m.group(1) else 0
                    end = int(m.group(2)) if m.group(2) else total - 1
                    end = min(end, total - 1)
                    if start > end or start >= total:
                        self.send_response(416)
                        self.send_header('Content-Range', 'bytes */%d' % total)
                        self.end_headers()
                        return
                    self.send_response(206)
                    self.send_header('Content-Type', mime)
                    self.send_header('Content-Length', str(end - start + 1))
                    self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, total))
                    self.send_header('Accept-Ranges', 'bytes')
                    self.send_header('Cache-Control', 'no-store')
                    self.end_headers()
                    self.wfile.write(content[start:end + 1])
                    return
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(total))
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                self.wfile.write(content)
                return
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(content)))
            # 【5.1.3 优化】带版本号(v=文件mtime)的图片请求走长缓存：文件更新→URL 变→自动失效，
            # 重开文件树面板直接命中浏览器本地缓存，不再重复拉取原图
            if not is_video and not is_text and qs.get('v'):
                self.send_header('Cache-Control', 'private, max-age=86400')
            else:
                self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            zf_log.error(f'[GET /api/fs/file] 500 错误: {e}')
            traceback.print_exc()
            try:
                self._send_error(str(e), 500)
            except Exception:
                pass

# ==================== 缩略图首开提速（2026-10-27 策划案施工）====================
# 模块级共享状态：请求侧与预热线程共用，避免重复压缩同一文件
_thumb_inflight = set()      # 正在压缩中的 rp 集合（去重）
_thumb_done = set()          # 本次进程已确认有缓存的 rp 集合
_thumb_inflight_lock = __import__('threading').Lock()
_THUMB_SIZE = 320            # 缩略图最长边（面板显示 160~240px，2x 屏足够）
# 【性能修复 2026-10-29】首开面板并发数百个缩略图请求，每个都同步 Pillow 解码+压缩，
# 曾把 CPU/IO/GIL 打满导致文件树卡死、其他对话请求全部超时。
# 改为：压缩段并发上限 4（信号量）；预热线程检测到用户请求在压时主动让路。
_thumb_sem = __import__('threading').Semaphore(4)
_thumb_user_active = 0       # 用户请求侧正在处理缩略图的计数（预热让路依据）


def _handle_fs_ops(self):
    """【文件写操作】body: {action: delete|move|copy, paths: [...], target: '目录路径'(move/copy)}
    仅操作文件（不递归删除目录树，目录需为空才能删除），目标目录必须存在。"""
    try:
        body = self._read_body()
    except Exception:
        body = {}
    action = str(body.get('action', '') or '').strip()
    paths = body.get('paths') or []
    target = str(body.get('target', '') or '').strip()
    if action not in ('delete', 'move', 'copy', 'rename', 'mkdir'):
        self._send_json({'ok': False, 'error': '未知操作: ' + action}, 400)
        return
    if not isinstance(paths, list) or not paths:
        self._send_json({'ok': False, 'error': '缺少 paths'}, 400)
        return
    results, errors = [], []
    try:
        # =====【2026-10-29 安全加固·fs根白名单】写删通道强制路径白名单 =====
        # 对齐 text-save 既有加固（L900）：允许范围 = 项目根 + 环境变量 ZF_FS_EXTRA_ROOTS 追加根（分号分隔）。
        # 防任意绝对路径 delete/move/copy/rename/mkdir 越权（可伤及 C:\ 系统目录）。
        def _fs_guard(p):
            rp_ = os.path.realpath(str(p))
            _proj = os.path.realpath(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
            _roots = [_proj]
            for _r in (os.environ.get('ZF_FS_EXTRA_ROOTS') or '').split(';'):
                _r = _r.strip()
                if _r:
                    _roots.append(os.path.realpath(_r))
            for _root in _roots:
                if rp_ == _root or rp_.startswith(_root + os.sep):
                    return rp_
            raise PermissionError('路径越出允许根（项目根/ZF_FS_EXTRA_ROOTS）: ' + rp_)
        _gsrc = _fs_guard(str(paths[0])) if paths else None
        if action in ('move', 'copy') and target:
            _fs_guard(target)  # 目标目录同样必须在允许根内
        # =====================================================
        # 【新增】rename：重命名。paths[0]=原路径, target=新名字
        if action == 'rename':
            if not paths or not target:
                self._send_json({'ok': False, 'error': 'rename 需要 paths[0] 和 target(新名字)'}, 400)
                return
            src = os.path.realpath(str(paths[0]))
            if not os.path.exists(src):
                self._send_json({'ok': False, 'error': '源不存在: ' + src}, 400)
                return
            new_name = os.path.basename(target)
            if not new_name or new_name in ('.', '..'):
                self._send_json({'ok': False, 'error': '新名字非法: ' + new_name}, 400)
                return
            dst = os.path.join(os.path.dirname(src), new_name)
            if os.path.exists(dst):
                self._send_json({'ok': False, 'error': '目标已存在: ' + new_name}, 400)
                return
            import shutil as _sh
            _sh.move(src, dst)
            self._send_json({'ok': True, 'done': [new_name], 'errors': []})
            return
        # 【新增】mkdir：新建文件夹。paths[0]=父目录, target=文件夹名
        if action == 'mkdir':
            parent = str(paths[0]) if paths else target
            new_dir = target if (paths and target) else '新建文件夹'
            if not parent or not os.path.isdir(parent):
                self._send_json({'ok': False, 'error': '父目录不存在: ' + parent}, 400)
                return
            dst = os.path.join(parent, os.path.basename(new_dir))
            i = 1
            base = dst
            while os.path.exists(dst):
                dst = base + '_' + str(i)
                i += 1
            os.makedirs(dst)
            self._send_json({'ok': True, 'done': [os.path.basename(dst)], 'errors': []})
            return
        if action in ('move', 'copy'):
            if not target or not os.path.isdir(target):
                self._send_json({'ok': False, 'error': '目标目录不存在: ' + target}, 400)
                return
        for p in paths:
            src = _fs_guard(p)  # 【安全加固】每条路径逐个过白名单，越界直接拒绝该条
            name = os.path.basename(src)
            try:
                if action == 'delete':
                    # 删除 = 移入垃圾箱（system/trash）并登记数据库，可恢复
                    from trash import move_to_trash as _m2t
                    try:
                        _m2t(src, source='fs_ops')
                    except Exception as _te:
                        errors.append(name + ': ' + str(_te))
                        continue
                else:
                    if not os.path.exists(src):
                        errors.append(name + ': 源不存在')
                        continue
                    dst = os.path.join(target, name)
                    if os.path.abspath(dst) == os.path.abspath(src):
                        errors.append(name + ': 源与目标相同')
                        continue
                    if os.path.exists(dst):
                        base, ext = os.path.splitext(name)
                        i = 1
                        while os.path.exists(dst):
                            dst = os.path.join(target, base + '_' + str(i) + ext)
                            i += 1
                    if action == 'move':
                        import shutil as _sh
                        _sh.move(src, dst)
                    else:
                        import shutil as _sh
                        if os.path.isdir(src):
                            _sh.copytree(src, dst)
                        else:
                            _sh.copy2(src, dst)
                results.append(name)
            except (PermissionError, OSError) as e:
                errors.append(name + ': ' + str(e))
        self._send_json({'ok': True, 'done': results, 'errors': errors})
    except Exception as e:
        zf_log.error(f'[POST /api/fs/ops] 500 错误: {e}')
        traceback.print_exc()
        self._send_json({'ok': False, 'error': str(e)}, 500)



# 【2026-10-27 修复】以下方法定义于类体外（类块被模块级辅助函数截断），统一挂载回类
# 【2026-11-06 修复】_handle_fs_text/_handle_fs_text_save 已拆至 routes/project_fs_text.py，
# 在下方 import 后再挂载（此处提前挂载会 NameError 导致服务无法启动），故删除这两行残留
MixinProjectFs._handle_fs_ops = _handle_fs_ops


# ===== 重构 Step4：缩略图/文本读写域拆分至独立文件，方法挂回类（零逻辑改动）=====
from routes.project_fs_thumb import (  # noqa: F401  (start_thumb_warmup 等需再导出)
    _thumb_cache_key, _thumb_cache_path, _make_thumb_bytes,
    start_thumb_warmup, _handle_fs_thumb, _thumb_process)
from routes.project_fs_text import _handle_fs_text, _handle_fs_text_save

MixinProjectFs._handle_fs_thumb = _handle_fs_thumb
MixinProjectFs._handle_fs_text = _handle_fs_text
MixinProjectFs._handle_fs_text_save = _handle_fs_text_save
