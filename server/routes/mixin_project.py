# -*- coding: utf-8 -*-
"""Mixin: 项目核心（远程ID/打开目录/浏览/文件树/上下文）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinProject(MixinBase):
    def _handle_remote_id(self, parsed):
        """【远程控制】/api/remote/id：获取（首次则生成）本机设备身份。
        device_key 32字节随机存 private/remote_id.json（永不出本机），
        对外只返回 SHA-256(device_key) 前16字节的hex哈希。"""
        import secrets as _secrets
        try:
            id_path = os.path.join(BASE_DIR, 'private', 'remote_id.json')
            data = None
            try:
                with open(id_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                if not data.get('device_key') or len(data.get('device_key', '')) < 32:
                    data = None
            except Exception:
                data = None
            if not data:
                key = _secrets.token_hex(32)   # 32字节 -> 64 hex 字符
                data = {'device_key': key, 'created': int(__import__('time').time())}
                os.makedirs(os.path.dirname(id_path), exist_ok=True)
                with open(id_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                try:
                    os.chmod(id_path, 0o600)   # 权限 600
                except Exception:
                    pass
            id_hash = __import__('hashlib').sha256(
                data['device_key'].encode('utf-8')).hexdigest()[:32]
            self._send_json({'ok': True, 'id_hash': id_hash})
        except Exception as e:
            print(f'[GET /api/remote/id] 500 错误: {e}')
            self._send_error(str(e), 500)

    def _handle_open_project_folder(self, parsed):
        """在系统文件管理器中打开项目关联的文件夹"""
        qs = parse_qs(parsed.query)
        proj_id = (qs.get('proj_id', [''])[0] or '').strip()
        if not proj_id:
            self._send_error('缺少 proj_id 参数', 400)
            return
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute('SELECT folder_path FROM projects WHERE id=?', (proj_id,))
                row = cur.fetchone()
                conn.close()
            if not row or not row['folder_path']:
                self._send_error('该项目尚未关联文件夹', 404)
                return
            folder = row['folder_path']
            if not os.path.isdir(folder):
                self._send_error('文件夹不存在: ' + folder, 404)
                return
            if sys.platform == 'win32':
                os.startfile(folder)
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', folder])
            else:
                subprocess.Popen(['xdg-open', folder])
            self._send_json({'ok': True})
        except Exception as e:
            print(f'[GET /api/project/open-folder] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)


    def _handle_browse_folder(self, parsed):
        """浏览目录（文件夹选择器）：返回子目录列表。
        path 为空 -> 列出所有磁盘（我的电脑）；否则列出该目录的子文件夹。"""
        qs = parse_qs(parsed.query)
        raw_path = (qs.get('path', [''])[0] or '').strip()
        try:
            if not raw_path:
                # ===== 我的电脑：列出所有盘符 =====
                drives = []
                if sys.platform == 'win32':
                    try:
                        import string
                        import ctypes
                        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
                        for i, letter in enumerate(string.ascii_uppercase):
                            if bitmask & (1 << i):
                                drives.append(letter + ':\\')
                    except Exception:
                        # 回退：逐个盘符试探
                        import string
                        for letter in string.ascii_uppercase:
                            p = letter + ':\\'
                            if os.path.isdir(p):
                                drives.append(p)
                else:
                    # Linux/Mac：根目录挂载点
                    drives = [d for d in os.listdir('/') if os.path.isdir(os.path.join('/', d))]
                    drives = ['/'] + [os.path.join('/', d) for d in sorted(drives)][:50]
                self._send_json({'ok': True, 'path': '', 'parent': '', 'dirs': drives})
                return

            # ===== 指定目录：列出子文件夹 =====
            if not os.path.isdir(raw_path):
                self._send_json({'ok': False, 'error': '目录不存在: ' + raw_path})
                return
            dirs = []
            try:
                for name in os.listdir(raw_path):
                    try:
                        full = os.path.join(raw_path, name)
                        if os.path.isdir(full) and not name.startswith('.'):
                            dirs.append(name)
                    except Exception:
                        continue
            except PermissionError:
                self._send_json({'ok': False, 'error': '无权限访问该目录'})
                return
            dirs.sort(key=lambda s: s.lower())
            # 计算上一级目录（盘符根 C: -> 回到"我的电脑"；其余取 dirname）
            norm = raw_path.rstrip('\\').rstrip('/')
            if len(norm) == 2 and norm[1] == ':':
                parent = ''          # 盘符根 -> 我的电脑
            else:
                parent = os.path.dirname(norm) or ''
            self._send_json({'ok': True, 'path': raw_path, 'parent': parent, 'dirs': dirs})
        except Exception as e:
            print(f'[GET /api/project/browse-folder] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)

    IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tif', '.tiff'}
    SKIP_DIRS = {'node_modules', '.git', '__pycache__', '.venv', 'venv', '.svn', 'dist', '.idea', '.vs'}

    STARMAP_TEXT_EXTS = {'.js', '.html', '.css', '.json', '.py', '.md', '.ts', '.txt', '.mjs'}
    STARMAP_DEP_RE = __import__('re').compile(
        r'(?:import\s+[^"\';]*?from\s*|require\s*\(\s*|import\s*\(\s*|from\s+)[\'"]([^\'"]+)[\'"]')
    STARMAP_HTML_RE = __import__('re').compile(r'<script[^>]+src="(js/[^"?]+)')
    STARMAP_PY_RE = __import__('re').compile(r'^\s*(?:from\s+([\w\.]+)\s+)?import\s+([\w\.]+)', __import__('re').M)

    def _handle_project_filetree(self, parsed):
        """项目文件树接口：列出某目录下的子目录和文件（含图片标记），供左侧文件树面板使用。
        参数：path=目录绝对路径（必填，必须是项目 folder_path 或其子目录）
             proj_id=项目ID（用于校验 path 在项目目录内，防止越权浏览）"""
        qs = parse_qs(parsed.query)
        raw_path = (qs.get('path', [''])[0] or '').strip()
        proj_id = (qs.get('proj_id', [''])[0] or '').strip()
        if not raw_path or not proj_id:
            self._send_error('缺少 path 或 proj_id 参数', 400)
            return
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute('SELECT folder_path FROM projects WHERE id=?', (proj_id,))
                row = cur.fetchone()
                conn.close()
            root = (row['folder_path'] if row else '') or ''
            if not root or not os.path.isdir(root):
                self._send_error('该项目尚未关联有效文件夹', 404)
                return
            # 越权防护：path 必须等于 root 或位于 root 内
            rp = os.path.realpath(raw_path)
            rr = os.path.realpath(root)
            if rp != rr and not rp.lower().startswith(rr.lower().rstrip('\\/') + os.sep):
                self._send_error('路径超出项目目录范围', 403)
                return
            if not os.path.isdir(rp):
                self._send_json({'ok': False, 'error': '目录不存在: ' + raw_path})
                return
            dirs, files = [], []
            for name in sorted(os.listdir(rp), key=lambda s: s.lower()):
                if name.startswith('.'):
                    continue
                full = os.path.join(rp, name)
                try:
                    if os.path.isdir(full):
                        if name in self.SKIP_DIRS:
                            continue
                        dirs.append({'name': name, 'path': full})
                    else:
                        ext = os.path.splitext(name)[1].lower()
                        st = os.stat(full)
                        item = {'name': name, 'path': full, 'size': st.st_size, 'mtime': int(st.st_mtime * 1000)}
                        if ext in self.IMAGE_EXTS:
                            item['image'] = True
                        files.append(item)
                except (PermissionError, OSError):
                    continue
            self._send_json({'ok': True, 'path': rp, 'root': rr, 'dirs': dirs, 'files': files})
        except Exception as e:
            print(f'[GET /api/project/filetree] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)


    def _handle_project_context(self):
        """【项目上下文工具】POST {proj_id, selected:[路径]} → 项目信息+选中文件内容预览"""
        try:
            body = self._read_json()
        except Exception:
            body = {}
        proj_id = str(body.get('proj_id', '') or '').strip()
        selected = body.get('selected') or []
        if not isinstance(selected, list):
            selected = []
        try:
            root = ''
            pname = ''
            if proj_id:
                with _db_lock:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute('SELECT name, folder_path FROM projects WHERE id=?', (proj_id,))
                    row = cur.fetchone()
                    conn.close()
                if row:
                    pname = row['name'] or ''
                    root = row['folder_path'] or ''
            rr = os.path.realpath(root) if root else ''
            files_out = []
            MAX_FILE_CHARS = 6000
            MAX_FILES = 10
            for raw in selected[:MAX_FILES]:
                if not root or not raw:
                    continue
                rp = os.path.realpath(str(raw))
                if rp != rr and not rp.lower().startswith(rr.lower().rstrip('\\/') + os.sep):
                    files_out.append({'path': str(raw), 'error': '路径超出项目范围'})
                    continue
                if not os.path.isfile(rp):
                    files_out.append({'path': str(raw), 'error': '文件不存在'})
                    continue
                ext = os.path.splitext(rp)[1].lower()
                if ext in self.IMAGE_EXTS:
                    files_out.append({'path': rp, 'name': os.path.basename(rp), 'type': 'image',
                                      'size': os.path.getsize(rp)})
                    continue
                try:
                    data = open(rp, 'rb').read()
                    for enc in ('utf-8', 'gbk'):
                        try:
                            text = data.decode(enc)
                            break
                        except UnicodeDecodeError:
                            text = None
                    if text is None:
                        files_out.append({'path': rp, 'name': os.path.basename(rp),
                                          'type': 'binary', 'size': len(data)})
                        continue
                    files_out.append({'path': rp, 'name': os.path.basename(rp), 'type': 'text',
                                      'content': text[:MAX_FILE_CHARS],
                                      'truncated': len(text) > MAX_FILE_CHARS})
                except (PermissionError, OSError) as pe:
                    files_out.append({'path': rp, 'error': str(pe)})
            self._send_json({'ok': True, 'project_id': proj_id, 'project_name': pname,
                             'root': root, 'files': files_out})
        except Exception as e:
            print(f'[POST /api/project/context] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)


    def _handle_link_folder(self):
        """关联本地文件夹到项目（POST {proj_id, folder_path}）"""
        try:
            body = self._read_json()
        except Exception:
            body = {}
        proj_id = str(body.get('proj_id', '') or '').strip()
        folder_path = str(body.get('folder_path', '') or '').strip()
        if not proj_id:
            self._send_error('缺少 proj_id', 400)
            return
        if not folder_path or not os.path.isdir(folder_path):
            self._send_error('文件夹不存在: ' + folder_path, 400)
            return
        try:
            now = int(time.time() * 1000)
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute('UPDATE projects SET folder_path=?, updated_at=? WHERE id=?',
                            (folder_path, now, proj_id))
                updated = cur.rowcount
                conn.commit()
                conn.close()
            if not updated:
                self._send_error('项目不存在: ' + proj_id, 404)
                return
            self._send_json({'ok': True, 'folder_path': folder_path})
        except Exception as e:
            print(f'[POST /api/project/link-folder] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)


    def _handle_generate_project_memory(self):
        """生成项目记忆（本地直写，不调大模型）"""
        import sys
        project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        python_path = sys.executable or sys.prefix
        memory_text = '项目目录: {}\nPython路径: {}\n生成时间: {}'.format(
            project_dir, python_path,
            time.strftime('%Y-%m-%d %H:%M:%S')
        )
        memory_path = os.path.join(project_dir, 'private', 'project_memory.txt')
        try:
            os.makedirs(os.path.dirname(memory_path), exist_ok=True)
            with open(memory_path, 'w', encoding='utf-8') as f:
                f.write(memory_text)
        except Exception as e:
            print('[project/memory/generate] 写入失败: {}'.format(e))
        self._send_json({'ok': True, 'memory_text': memory_text})


