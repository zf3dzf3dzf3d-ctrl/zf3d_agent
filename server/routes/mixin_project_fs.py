# -*- coding: utf-8 -*-
"""Mixin: 文件系统操作（星图扫描/fs浏览/文件读写/文本保存/fs ops），拆自 mixin_project.py"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinProjectFs(MixinBase):
    def _handle_starmap_scan(self, parsed):
        """【星空知识图谱】/api/starmap/scan?path=...：递归扫描项目文件（路径/大小/mtime）
        + 提取 JS/HTML/Py 的 import/require 依赖边。只读元信息不读内容正文，返回体轻量。"""
        qs = parse_qs(parsed.query)
        raw_path = (qs.get('path', [''])[0] or '').strip()
        try:
            rp = os.path.realpath(raw_path) if raw_path else BASE_DIR
            if len(raw_path) == 2 and raw_path[1] == ':':
                rp = os.path.realpath(raw_path + '\\')
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
                            with open(fp, 'r', encoding='utf-8', errors='ignore') as fh:
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
            print(f'[GET /api/starmap/scan] 500 错误: {e}')
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
                drives = []
                for letter in string.ascii_uppercase:
                    dp = letter + ':\\'
                    if os.path.exists(dp):
                        try:
                            drives.append({'name': '本地磁盘 (' + letter + ':)', 'path': dp})
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
            if not os.path.isdir(rp):
                self._send_json({'ok': False, 'error': '目录不存在: ' + raw_path})
                return
            dirs, files = [], []
            limit = 500
            offset = 0
            try:
                limit = max(50, min(2000, int((qs.get('limit', ['500'])[0] or '500'))))
            except Exception:
                limit = 500
            try:
                offset = max(0, int((qs.get('offset', ['0'])[0] or '0')))
            except Exception:
                offset = 0
            total_files = 0
            all_files = []
            with os.scandir(rp) as it:
                for entry in it:
                    name = entry.name
                    if name.startswith('.'):
                        continue
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            if name in self.SKIP_DIRS:
                                continue
                            dirs.append({'name': name, 'path': os.path.join(rp, name)})
                        else:
                            ext = os.path.splitext(name)[1].lower()
                            st = entry.stat(follow_symlinks=False)
                            item = {'name': name, 'path': os.path.join(rp, name), 'size': st.st_size, 'mtime': int(st.st_mtime * 1000)}
                            if ext in self.IMAGE_EXTS:
                                item['image'] = True
                            all_files.append(item)
                    except (PermissionError, OSError):
                        continue
            dirs.sort(key=lambda d: d['name'].lower())
            all_files.sort(key=lambda f: f['name'].lower())
            total_files = len(all_files)
            files = all_files[offset:offset + limit]
            has_more = (offset + limit) < total_files
            self._send_json({'ok': True, 'path': rp, 'dirs': dirs, 'files': files,
                             'total_files': total_files, 'has_more': has_more,
                             'limit': limit, 'offset': offset})
        except Exception as e:
            print(f'[GET /api/fs/browse] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)

    @staticmethod

    def _shell_folder(key):
        import ctypes.wintypes
        csidl = {'DESKTOP': 0x0000, 'DOCUMENTS': 0x0005, 'DOWNLOAD': 0x000C, 'PICTURES': 0x27}[key]
        buf = ctypes.create_unicode_buffer(ctypes.wintypes.MAX_PATH)
        ctypes.windll.shell32.SHGetFolderPathW(None, csidl, None, 0, buf)
        return buf.value or ''


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
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print(f'[GET /api/fs/file] 500 错误: {e}')
            traceback.print_exc()
            try:
                self._send_error(str(e), 500)
            except Exception:
                pass

    def _handle_fs_text(self, parsed):
        """【文本文件预览】/api/fs/text?path=...：返回文本文件内容（限常见文本类型，≤2MB）。"""
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
            TEXT_EXTS = {'.txt', '.md', '.log', '.py', '.js', '.json', '.html', '.css',
                         '.xml', '.csv', '.ini', '.cfg', '.bat', '.sh', '.yml', '.yaml',
                         '.sql', '.ts'}
            parts = os.path.splitext(rp)
            ext = parts[1].lower()
            if ext == '.bak':
                stem_ext = os.path.splitext(parts[0])[1].lower()
                if stem_ext in TEXT_EXTS:
                    ext = stem_ext
            if ext not in TEXT_EXTS:
                self._send_error('不支持的文本类型: ' + parts[1], 403)
                return
            size = os.path.getsize(rp)
            if size > 2 * 1024 * 1024:
                self._send_error('文件过大（>2MB）', 413)
                return
            try:
                with open(rp, 'rb') as f:
                    raw = f.read()
            except (PermissionError, OSError) as e:
                self._send_error('无法读取: ' + str(e), 403)
                return
            if raw.startswith(b'\xef\xbb\xbf'):
                raw = raw[3:]
            try:
                text = raw.decode('utf-8')
            except UnicodeDecodeError:
                try:
                    text = raw.decode('gbk')
                except UnicodeDecodeError:
                    text = raw.decode('utf-8', errors='replace')
            self._send_json({'ok': True, 'path': rp, 'text': text})
        except Exception as e:
            print(f'[GET /api/fs/text] 500 错误: {e}')
            traceback.print_exc()
            try:
                self._send_error(str(e), 500)
            except Exception:
                pass

    def _handle_fs_text_save(self):
        """【文本文件保存】POST /api/fs/text-save  body={path, text}：
        将编辑器内容写回本地文本文件（限 /api/fs/text 相同的文本类型，≤2MB）。"""
        try:
            length = int(self.headers.get('Content-Length') or 0)
            body = json.loads(self._cached_body(length).decode('utf-8')) if length else {}
            raw_path = (body.get('path') or '').strip()
            text = body.get('text')
            if text is None or not isinstance(text, str):
                self._send_error('缺少 text 参数', 400)
                return
            if not raw_path:
                self._send_error('缺少 path 参数', 400)
                return
            rp = os.path.realpath(raw_path)
            if not os.path.isfile(rp):
                self._send_error('文件不存在: ' + raw_path, 404)
                return
            TEXT_EXTS = {'.txt', '.md', '.log', '.py', '.js', '.json', '.html', '.css',
                         '.xml', '.csv', '.ini', '.cfg', '.bat', '.sh', '.yml', '.yaml',
                         '.sql', '.ts'}
            parts = os.path.splitext(rp)
            ext = parts[1].lower()
            if ext == '.bak':
                stem_ext = os.path.splitext(parts[0])[1].lower()
                if stem_ext in TEXT_EXTS:
                    ext = stem_ext
            if ext not in TEXT_EXTS:
                self._send_error('不支持的文本类型: ' + parts[1], 403)
                return
            data = text.encode('utf-8')
            if len(data) > 2 * 1024 * 1024:
                self._send_error('内容过大（>2MB）', 413)
                return
            # 写回（保留原编码风格：若原文件是 GBK 则按 GBK 写回，否则 UTF-8）
            try:
                with open(rp, 'rb') as f:
                    old = f.read()
                if old.startswith(b'\xef\xbb\xbf'):
                    old_body = old[3:]
                else:
                    old_body = old
                try:
                    old_body.decode('utf-8')
                    enc = 'utf-8'
                    if old.startswith(b'\xef\xbb\xbf'):
                        data = b'\xef\xbb\xbf' + data
                except UnicodeDecodeError:
                    enc = 'gbk'
                    data = text.encode('gbk', errors='replace')
            except OSError:
                enc = 'utf-8'
            bak = rp + '.bak'
            try:
                with open(rp, 'rb') as f:
                    with open(bak, 'wb') as b:
                        b.write(f.read())
            except OSError:
                pass
            with open(rp, 'wb') as f:
                f.write(data)
            self._send_json({'ok': True, 'path': rp, 'encoding': enc, 'size': len(data)})
        except Exception as e:
            print(f'[POST /api/fs/text-save] 500 错误: {e}')
            traceback.print_exc()
            try:
                self._send_error(str(e), 500)
            except Exception:
                pass


    # ===== 文件操作（删除/移动/复制）：POST /api/fs/ops =====
    # ===== 【画布参考板】保存/载入（PureRef 式参考图布局） =====
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
        if action not in ('delete', 'move', 'copy'):
            self._send_json({'ok': False, 'error': '未知操作: ' + action}, 400)
            return
        if not isinstance(paths, list) or not paths:
            self._send_json({'ok': False, 'error': '缺少 paths'}, 400)
            return
        results, errors = [], []
        try:
            if action in ('move', 'copy'):
                if not target or not os.path.isdir(target):
                    self._send_json({'ok': False, 'error': '目标目录不存在: ' + target}, 400)
                    return
            for p in paths:
                src = os.path.realpath(str(p))
                name = os.path.basename(src)
                try:
                    if action == 'delete':
                        if os.path.isdir(src):
                            if os.listdir(src):
                                errors.append(name + ': 目录非空，拒绝删除')
                                continue
                            os.rmdir(src)
                        else:
                            os.remove(src)
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
            print(f'[POST /api/fs/ops] 500 错误: {e}')
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e)}, 500)

