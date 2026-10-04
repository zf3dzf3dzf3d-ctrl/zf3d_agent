# -*- coding: utf-8 -*-
"""Mixin: 组件下载（设置面板 - 首次安装可选组件，替代旧版 .安装依赖.bat）"""
import json
import os
import shutil as _shutil
import subprocess
import threading

from routes._shared import *
from routes.mixin_base import MixinBase


class MixinComponents(MixinBase):

    # v5.3.5 安装实时进度共享状态（/api/components/progress 轮询）
    INSTALL_PROGRESS = {'running': False, 'running_flag': False, 'pct': 0,
                        'phase': 'idle', 'msg': '', 'key': '', 'ok': None, 'error': ''}

    # 组件组定义：key -> (显示名, 说明, 待检测 import 名, pip 包名, 是否需要 playwright install)
    COMPONENT_GROUPS = [
        {'key': 'base', 'name': '基础运行依赖', 'desc': '程序运行的最小依赖（numpy、pillow、lxml 等），首次使用必须安装（约 70MB）',
         'imports': ['numpy', 'PIL', 'lxml'],
         'pip': 'numpy pillow requests bottle psutil websockets aiohttp httpx pyyaml jinja2 cryptography pycryptodomex lxml certifi urllib3 charset-normalizer packaging python-dateutil pytz regex tqdm beautifulsoup4 ephem tifffile narwhals'},
        {'key': 'browser', 'name': '内置浏览器引擎', 'desc': '内置浏览器 / 网页抓取功能依赖（Playwright + Chromium，约 150MB）',
         'imports': ['playwright'], 'pip': 'playwright greenlet', 'playwright': True},
        {'key': 'media', 'name': '音视频 / 图像处理', 'desc': '视频剪辑、转码、录屏等功能依赖（av、opencv 等）',
         'imports': ['av', 'cv2'],
         'pip': 'av imageio opencv-python-headless scenedetect py7zr brotli cffi webview pythonnet clr_loader jieba safetensors huggingface_hub'},
        {'key': 'science', 'name': '科学计算', 'desc': '数据分析、批处理等高级功能依赖（scipy、sklearn、numba 等）',
         'imports': ['scipy', 'sklearn', 'numba'],
         'pip': 'scipy scikit-learn scikit-image numba llvmlite sympy mpmath networkx joblib'},  # networkx/mpmath/joblib 在 science 组装回
        {'key': 'office', 'name': 'Office 文档支持', 'desc': '读写 Word/Excel/PPT/PDF 等文档功能依赖',
         'imports': ['openpyxl', 'pptx', 'fitz'],
         'pip': 'openpyxl python-pptx xlsxwriter pymupdf'},
        {'key': 'torch', 'name': 'PyTorch (CPU版)', 'desc': '本地 AI 推理功能依赖（较大，约 200MB，不需要可跳过）',
         'imports': ['torch'], 'pip': 'torch --index-url https://download.pytorch.org/whl/cpu'},
    ]

    def _components_py_exe(self):
        try:
            from platform_compat import py_exe as _compat_py_exe
            return _compat_py_exe(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
        except Exception:
            base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            return os.path.join(base, 'python', 'python.exe')

    # ---- v5.4.5 Chromium 断点下载（复用 mixin_download 的 _DlTask，失败返回 False 走原路径）----
    _CHROMIUM_ZIP_NAMES = ('chromium-win64.zip', 'chromium-win32.zip', 'chromium-win64.jar', 'chrome-win.zip')

    def _chromium_browsers_json(self):
        """从 playwright 包内读 browsers.json，返回 chromium 的 revision 与下载目录名"""
        try:
            import importlib.util as _iu
            import glob as _glob
            py_dir = os.path.dirname(self._components_py_exe())
            # 仅 Windows 嵌入式解释器才有 <py_dir>/Lib/site-packages 布局；
            # Linux/mac venv 布局不同，直接跳过该探测路径
            cands = []
            if sys.platform == 'win32':
                cands = _glob.glob(os.path.join(py_dir, 'Lib', 'site-packages', 'playwright', 'driver', 'package', 'browsers.json'))
            for c in cands:
                with open(c, 'r', encoding='utf-8') as fh:
                    data = json.load(fh)
                for b in data.get('browsers', []):
                    if b.get('name') == 'chromium':
                        return b
        except Exception:
            pass
        return None

    def _chromium_fast_download(self, py, env, log_f, _set_progress):
        """用自家断点下载器下载 Chromium zip 并解压到 PLAYWRIGHT_BROWSERS_PATH=0 的包内目录。
        成功返回 True；任何一步失败返回 False（调用方回落 playwright install）。"""
        try:
            from routes.mixin_download import _DlTask, _dl_probe, _DL_TASKS_LOCK
            import time as _t
            import zipfile as _zf

            b = self._chromium_browsers_json()
            if not b:
                return False
            revision = b.get('revision')
            dl_url = None
            for d in b.get('download', []):
                if 'win' in (d.get('name') or '').lower() and str(d.get('platform')) != 'linux':
                    if 'win64' in (d.get('name') or '').lower() or 'win32' in (d.get('name') or '').lower() or 'windows' in str(d.get('platform', '')).lower():
                        dl_url = d.get('url')
                        break
            if not revision or not dl_url:
                return False
            dl_url = dl_url.replace('%s', revision)
            if 'playwright.download.prss.microsoft.com' not in dl_url and dl_url.startswith('/'):
                dl_url = 'https://playwright.azureedge.net' + dl_url

            # PLAYWRIGHT_BROWSERS_PATH=0 → 浏览器装在 playwright 包内 .local-browsers
            import importlib.util as _iu
            spec = _iu.find_spec('playwright')
            if not spec or not spec.submodule_search_locations:
                return False
            pw_pkg = list(spec.submodule_search_locations)[0]
            browsers_dir = os.path.join(pw_pkg, '.local-browsers')
            os.makedirs(browsers_dir, exist_ok=True)

            # 已装好直接成功（幂等）
            exe_cands = [
                os.path.join(browsers_dir, 'chromium-%s' % revision, 'chrome-win64', 'chrome.exe'),
                os.path.join(browsers_dir, 'chromium-%s' % revision, 'chrome-win', 'chrome.exe'),
            ]
            if any(os.path.exists(x) for x in exe_cands):
                return True

            _set_progress(80, 'chromium', '正在断点下载 Chromium（约 150MB）…')
            dest = os.path.join(browsers_dir, 'chromium-%s.zip' % revision)
            tid = 'chromium_%s' % revision
            task = _DlTask(tid, dl_url, os.path.basename(dest), 8, dest)
            with _DL_TASKS_LOCK:
                from routes.mixin_download import _DL_TASKS
                _DL_TASKS[tid] = task
            th = threading.Thread(target=task.run, daemon=True)
            th.start()
            last_pct = -1
            while th.is_alive():
                th.join(timeout=1.0)
                if task.total:
                    pct = 80 + task.done * 18 / task.total   # 80~98
                    if int(pct) != last_pct:
                        last_pct = int(pct)
                        _set_progress(pct, 'chromium', 'Chromium 断点下载 %.0f%%（%.1f/%.0f MB）'
                                      % (task.done * 100.0 / task.total, task.done / 1048576.0, task.total / 1048576.0))
            if task.status != 'done' or not os.path.exists(dest):
                log_f.write('[fast-dl] status=%s err=%s\n' % (task.status, task.error))
                log_f.flush()
                return False

            # 解压：zip 内根目录通常为 chromium-<revision>/ 或 chrome-win/
            _set_progress(98, 'chromium', '正在解压 Chromium…')
            expected_dir = os.path.join(browsers_dir, 'chromium-%s' % revision)
            with _zf.ZipFile(dest, 'r') as z:
                names = z.namelist()
                root = names[0].split('/')[0] if names else ''
                if root == 'chromium-%s' % revision:
                    z.extractall(browsers_dir)
                else:
                    z.extractall(dest + '.ext')
                    src = os.path.join(dest + '.ext', root)
                    if not os.path.isdir(src):
                        src = dest + '.ext'
                    if os.path.exists(expected_dir):
                        _shutil.rmtree(expected_dir, ignore_errors=True)
                    os.rename(src, expected_dir)
                    try:
                        _shutil.rmtree(dest + '.ext', ignore_errors=True)
                    except Exception:
                        pass
            try:
                os.remove(dest)   # 解压成功后清 zip（.zfpart 状态文件由 _DlTask 完成时自清）
            except Exception:
                pass
            ok = any(os.path.exists(x) for x in exe_cands)
            if not ok:
                log_f.write('[fast-dl] 解压后未找到 chrome.exe\n')
                log_f.flush()
            return ok
        except Exception as e:
            try:
                log_f.write('[fast-dl] EXC %r\n' % e)
                log_f.flush()
            except Exception:
                pass
            return False


    def _components_check(self):
        """用嵌入式 Python 试导入各组件组的模块，返回每组的 installed/missing"""
        mods = set()
        for g in self.COMPONENT_GROUPS:
            mods.update(g['imports'])
        py = self._components_py_exe()
        code = ("import importlib,json\n"
                "mods=" + json.dumps(sorted(mods)) + "\n"
                "r={}\n"
                "for m in mods:\n"
                "    try:\n"
                "        importlib.import_module(m); r[m]=True\n"
                "    except Exception:\n"
                "        r[m]=False\n"
                "print(json.dumps(r))")
        res = {}
        try:
            out = subprocess.run([py, '-c', code], capture_output=True, text=True,
                                 timeout=120, cwd=os.path.dirname(py))
            for line in (out.stdout or '').strip().splitlines():
                line = line.strip()
                if line.startswith('{'):
                    res = json.loads(line)
                    break
        except Exception:
            pass
        groups = []
        for g in self.COMPONENT_GROUPS:
            missing = [m for m in g['imports'] if not res.get(m)]
            groups.append({
                'key': g['key'], 'name': g['name'], 'desc': g['desc'],
                'installed': not missing,
                'missing': missing,
                'checking': not res,  # 导入检测完全失败时视为检测中
            })
        return groups

    def _handle_components_status(self):
        """POST /api/components/status — 检测各组件组安装状态"""
        try:
            self._send_json({'ok': True, 'groups': self._components_check()}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_components_install(self):
        """POST /api/components/install — 后台安装指定组件组（body: {key}）"""
        try:
            self._components_install_impl()
        except Exception as e:
            # 兜底：任何异常都不能让连接裸断（否则前端 ERR_EMPTY_RESPONSE）
            import traceback as _tb
            try:
                with open(os.path.join(BASE_DIR, 'private', 'component_install.log'),
                          'a', encoding='utf-8', errors='replace') as _f:
                    _f.write('\n[HANDLER-ERROR] ' + _tb.format_exc())
            except Exception:
                pass
            self.INSTALL_PROGRESS['running'] = False
            self.INSTALL_PROGRESS['ok'] = False
            self.INSTALL_PROGRESS['phase'] = 'error'
            self.INSTALL_PROGRESS['msg'] = '安装接口异常: ' + str(e)
            self.INSTALL_PROGRESS['error'] = str(e)
            try:
                self._send_json({'ok': False, 'error': str(e)}, 500)
            except Exception:
                pass

    def _components_install_impl(self):
        try:
            body = self._read_body()
        except Exception:
            body = {}
        key = str(body.get('key', '') or '').strip()
        group = next((g for g in self.COMPONENT_GROUPS if g['key'] == key), None)
        if not group:
            self._send_json({'ok': False, 'error': '未知组件: ' + key}, 400)
            return
        # 防止重复安装：用内存标志 + 日志文件
        lock_dir = os.path.join(BASE_DIR, 'private')
        os.makedirs(lock_dir, exist_ok=True)
        log_path = os.path.join(lock_dir, 'component_install.log')
        running_flag = os.path.join(lock_dir, 'component_install.running')

        # v5.3.5 共享安装进度状态（前端 /api/components/progress 轮询此结构）
        self.INSTALL_PROGRESS['key'] = group['key']
        self.INSTALL_PROGRESS['running'] = True
        self.INSTALL_PROGRESS['running_flag'] = False
        self.INSTALL_PROGRESS['pct'] = 1
        self.INSTALL_PROGRESS['phase'] = 'start'
        self.INSTALL_PROGRESS['msg'] = '正在准备安装 %s…' % group['name']
        self.INSTALL_PROGRESS['error'] = ''

        def _set_progress(pct, phase, msg):
            self.INSTALL_PROGRESS['pct'] = max(1, min(99, int(pct)))
            self.INSTALL_PROGRESS['phase'] = phase
            self.INSTALL_PROGRESS['msg'] = msg

        # 从 pip 逐行输出解析已下载包数，估算百分比
        def _parse_pip_line(line):
            import re as _re
            m = _re.search(r'(?:Downloading|Using cached|Collecting)\s+([\w\-\[\]\.]+)', line)
            if m:
                return 'Downloading ' + m.group(1).split('[')[0]
            if 'Installing collected packages' in line:
                return '正在安装已下载的包…'
            if 'Downloading' in line and 'MB' in line:
                return line.strip()
            return None

        # pip 输出进度百分比区间：下载 5~70%，安装 70~92%，playwright 内核 92~99%
        def _run():
            try:
                py = self._components_py_exe()
                mirror = ['-i', 'https://pypi.tuna.tsinghua.edu.cn/simple']
                args = [py, '-m', 'pip', 'install', '--progress-bar', 'off'] + mirror + group['pip'].split()
                with open(log_path, 'w', encoding='utf-8', errors='replace') as f:
                    f.write('$ ' + ' '.join(args) + '\n')
                    if group.get('playwright'):
                        f.write('SET PLAYWRIGHT_BROWSERS_PATH=0\n')
                    f.flush()
                    _set_progress(5, 'pip', '开始下载 Python 依赖…')
                    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                         text=True, encoding='utf-8', errors='replace', cwd=os.path.dirname(py))
                    self.INSTALL_PROGRESS['pid'] = p.pid
                    total = max(1, len(group['pip'].split()))
                    done = 0
                    for line in p.stdout:
                        f.write(line)
                        f.flush()
                        tag = _parse_pip_line(line)
                        if tag:
                            done += 1
                            _set_progress(5 + min(60, done * 55.0 / total), 'pip', tag)
                    rc = p.wait()
                    if group.get('playwright') and rc == 0:
                        env = dict(os.environ, PLAYWRIGHT_BROWSERS_PATH='0')
                        _set_progress(70, 'install', '正在安装已下载的包…')
                        p2 = subprocess.run([py, '-m', 'playwright', 'install', 'chromium'],
                                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                            text=True, encoding='utf-8', errors='replace', timeout=3600, env=env)
                        for line in (p2.stdout or '').splitlines():
                            f.write(line + '\n')
                        f.flush()
                        if p2.returncode == 0:
                            # v5.4.5 优先走自家断点下载器（8线程 Range + .zfpart 续传），
                            # 失败自动回落原 playwright install（保证不比现状差）
                            if self._chromium_fast_download(py, env, f, _set_progress):
                                _set_progress(99, 'chromium', 'Chromium 就绪（断点下载）')
                            else:
                                _set_progress(80, 'chromium', '正在下载 Chromium 内核（约 150MB）…')
                                p3 = subprocess.run([py, '-m', 'playwright', 'install', 'chromium-headless-shell'],
                                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                                    text=True, encoding='utf-8', errors='replace', timeout=3600, env=env)
                                for line in (p3.stdout or '').splitlines():
                                    f.write(line + '\n')
                                f.flush()
                                if p3.returncode != 0:
                                    _set_progress(92, 'chromium', 'headless-shell 下载异常，可稍后重试')
                        else:
                            _set_progress(85, 'chromium', 'Chromium 下载异常，详见日志')
                    self.INSTALL_PROGRESS['ok'] = (rc == 0)
                    self.INSTALL_PROGRESS['pct'] = 99 if rc == 0 else 0
                    self.INSTALL_PROGRESS['phase'] = 'done' if rc == 0 else 'error'
                    self.INSTALL_PROGRESS['msg'] = ('安装完成，正在刷新状态…' if rc == 0
                                               else '安装失败（pip 退出码 %d），请到 设置 → 组件下载 查看日志' % rc)
                    if rc != 0:
                        self.INSTALL_PROGRESS['error'] = 'pip 退出码 %d' % rc
            except Exception as e:
                self.INSTALL_PROGRESS['ok'] = False
                self.INSTALL_PROGRESS['phase'] = 'error'
                self.INSTALL_PROGRESS['msg'] = '安装出错: ' + str(e)
                self.INSTALL_PROGRESS['error'] = str(e)
                try:
                    with open(log_path, 'a', encoding='utf-8', errors='replace') as f:
                        f.write('\n[ERROR] ' + str(e))
                except Exception:
                    pass
            finally:
                self.INSTALL_PROGRESS['running'] = False
                try:
                    os.remove(running_flag)
                except Exception:
                    pass

        if os.path.exists(running_flag):
            self._send_json({'ok': False, 'error': '已有安装任务在进行中，请稍候'}, 409)
            return
        with open(running_flag, 'w', encoding='utf-8') as f:
            f.write(group['key'])
        threading.Thread(target=_run, daemon=True).start()
        self._send_json({'ok': True, 'message': '安装已开始，请稍候…安装完成后可点击「重新检测」确认'}, 200)

    def _handle_components_progress(self):
        """POST /api/components/progress — 安装实时进度（供右下角迷你进度卡轮询）"""
        prog = dict(self.INSTALL_PROGRESS)
        prog['running_flag'] = os.path.exists(
            os.path.join(BASE_DIR, 'private', 'component_install.running'))
        self._send_json({'ok': True, 'progress': prog}, 200)

    def _handle_components_log(self):
        """GET /api/components/log — 读取安装日志尾部"""
        log_path = os.path.join(BASE_DIR, 'private', 'component_install.log')
        running = os.path.exists(os.path.join(BASE_DIR, 'private', 'component_install.running'))
        text = ''
        try:
            if os.path.isfile(log_path):
                with open(log_path, 'r', encoding='utf-8-sig', errors='replace') as f:
                    text = f.read()[-4000:]
        except Exception as e:
            text = '[读取日志失败] ' + str(e)
        self._send_json({'ok': True, 'log': text, 'running': running}, 200)

    # ==================== 插件中心：整合状态 + 磁盘清理 ====================
    # 白名单：只允许清理这些相对目录（防路径穿越，不做任何拼接用户输入的删除）
    CLEAN_TARGETS = [
        {'key': 'trash', 'label': '回收站/测试残留（system/trash）', 'rel': os.path.join('system', 'trash')},
        {'key': 'dbarchive', 'label': '数据库归档（private/db/archive）', 'rel': os.path.join('private', 'db', 'archive')},
        {'key': 'smoke', 'label': '浏览器冒烟测试残留（browser_plugin profiles/shots 的 smoke-icon*）', 'rel': os.path.join('server', 'browser_plugin', 'data')},
        {'key': 'pycache', 'label': 'Python 缓存（__pycache__ / .pyc）', 'rel': None},
    ]

    # v5.3.5 center/status 统计缓存：全盘遍历（回收站 620MB/4410 项）耗时，60s 内复用结果，
    # 避免并发请求触发 ERR_EMPTY_RESPONSE；center/clean 成功后强制失效
    _center_status_cache = {'ts': 0.0, 'data': None}
    _CENTER_STATUS_TTL = 60.0

    def _handle_plugins_center_status(self):
        """POST /api/plugins/center/status — 插件中心总览 + 各清理目标占用统计（带 60s 缓存）"""
        import time as _time
        import shutil as _sh
        try:
            c = self._center_status_cache
            now = _time.time()
            if c['data'] is not None and now - c['ts'] < self._CENTER_STATUS_TTL:
                self._send_json({'ok': True, 'targets': c['data'], 'cached': True}, 200)
                return
            base = BASE_DIR
            # 磁盘占用统计
            targets = []
            for t in self.CLEAN_TARGETS:
                if t['rel'] is None:
                    size, count = self._scan_pycache(base)
                else:
                    d = os.path.normpath(os.path.join(base, t['rel']))
                    if not (os.path.abspath(d) == os.path.abspath(base) or os.path.abspath(d).startswith(os.path.abspath(base) + os.sep)):
                        continue  # 防穿越，双保险
                    size, count = self._scan_dir(d, smoke_only=(t['key'] == 'smoke'))
                targets.append({'key': t['key'], 'label': t['label'], 'size': size, 'count': count})
            c['data'] = targets
            c['ts'] = now
            self._send_json({'ok': True, 'targets': targets}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _scan_dir(self, root, smoke_only=False):
        """统计目录大小与文件数；smoke_only 时只统计 smoke-icon* 前缀"""
        total = 0
        count = 0
        if not os.path.isdir(root):
            return 0, 0
        for cur, dirs, files in os.walk(root):
            if smoke_only:
                dirs[:] = [d for d in dirs if d.startswith('smoke-icon')]
            for fn in files:
                if smoke_only and not cur.startswith('smoke-icon') and 'smoke-icon' not in cur:
                    # 目录层已过滤，文件层只在 smoke 目录内统计
                    if not any(p.startswith('smoke-icon') for p in os.path.normpath(cur).split(os.sep)):
                        continue
                try:
                    total += os.path.getsize(os.path.join(cur, fn))
                    count += 1
                except OSError:
                    pass
        return total, count

    def _scan_pycache(self, base):
        """统计 python 目录外的 __pycache__ 与 .pyc（跳过 python 本体运行时）"""
        total = 0
        count = 0
        skip = os.path.normpath(os.path.join(base, 'python'))
        for cur, dirs, files in os.walk(base):
            if os.path.normpath(cur).startswith(skip):
                dirs[:] = []
                continue
            dirs[:] = [d for d in dirs if d not in ('node_modules', '.git')]
            if '__pycache__' in dirs:
                dirs.remove('__pycache__')
                s, c = self._scan_dir(os.path.join(cur, '__pycache__'))
                total += s
                count += c
            for fn in files:
                if fn.endswith('.pyc'):
                    try:
                        total += os.path.getsize(os.path.join(cur, fn))
                        count += 1
                    except OSError:
                        pass
        return total, count

    def _handle_plugins_center_clean(self):
        """POST /api/plugins/center/clean — 按白名单 key 清理，body: {key}"""
        try:
            body = self._read_body()
        except Exception:
            body = {}
        key = str(body.get('key', '') or '').strip()
        target = next((t for t in self.CLEAN_TARGETS if t['key'] == key), None)
        if not target:
            self._send_json({'ok': False, 'error': '未知清理目标: ' + key}, 400)
            return
        import shutil as _sh
        base = os.path.abspath(BASE_DIR)
        freed = 0
        count = 0
        try:
            if target['rel'] is None:
                # pycache：逐个删除，跳过 python 本体
                skip = os.path.normpath(os.path.join(base, 'python'))
                for cur, dirs, files in os.walk(base):
                    if os.path.normpath(cur).startswith(skip):
                        dirs[:] = []
                        continue
                    dirs[:] = [d for d in dirs if d not in ('node_modules', '.git')]
                    if '__pycache__' in dirs:
                        p = os.path.join(cur, '__pycache__')
                        dirs.remove('__pycache__')
                        s, c = self._scan_dir(p)
                        _sh.rmtree(p, ignore_errors=True)
                        freed += s
                        count += c
                    for fn in list(files):
                        if fn.endswith('.pyc'):
                            fp = os.path.join(cur, fn)
                            try:
                                freed += os.path.getsize(fp)
                                os.remove(fp)
                                count += 1
                            except OSError:
                                pass
            elif key == 'smoke':
                root = os.path.normpath(os.path.join(base, target['rel']))
                data_dir = os.path.join(root)
                for sub in ('profiles', 'shots'):
                    sd = os.path.join(data_dir, sub)
                    if not os.path.isdir(sd):
                        continue
                    for name in os.listdir(sd):
                        if not name.startswith('smoke-icon'):
                            continue
                        p = os.path.join(sd, name)
                        s, c = self._scan_dir(p) if os.path.isdir(p) else (os.path.getsize(p) if os.path.isfile(p) else 0, 1)
                        if os.path.isdir(p):
                            _sh.rmtree(p, ignore_errors=True)
                        else:
                            try:
                                os.remove(p)
                            except OSError:
                                pass
                        freed += s
                        count += c
            else:
                d = os.path.normpath(os.path.join(base, target['rel']))
                if not (os.path.abspath(d) == os.path.abspath(base) or os.path.abspath(d).startswith(os.path.abspath(base) + os.sep)):
                    self._send_json({'ok': False, 'error': '非法路径'}, 400)
                    return
                if os.path.isdir(d):
                    s, c = self._scan_dir(d)
                    _sh.rmtree(d, ignore_errors=True)
                    os.makedirs(d, exist_ok=True)  # 保留目录本身
                    freed += s
                    count += c
            self._send_json({'ok': True, 'key': key, 'freed': freed, 'count': count,
                             'note': '已清理 %.1f MB / %d 个文件' % (freed / 1048576.0, count)}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    # ===== 按需插件：大体积目录剥离为「按需下载 / 可卸载瘦身」 =====
    # 每项: key -> {name, desc, rel(相对根目录), size_hint, url(可选远端zip，缺省走本地打包源 plugins/<key>)}
    ONDEMAND_PLUGINS = [
        {'key': 'study_repos', 'name': '学习资料库', 'desc': 'study_repos 内置学习示例与参考仓库（约 164MB），不影响核心功能，可按需安装',
         'rel': 'study_repos', 'size_hint': 164 * 1024 * 1024},
        {'key': 'tools', 'name': '扩展工具集', 'desc': 'tools 目录辅助脚本与工具（约 5.4MB），可按需安装',
         'rel': 'tools', 'size_hint': 6 * 1024 * 1024},
    ]

    def _plugins_base_dir(self):
        return os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..'))

    def _handle_plugins_ondemand_status(self):
        """POST /api/plugins/ondemand/status — 按需插件安装状态总览"""
        try:
            base = self._plugins_base_dir()
            items = []
            for p in self.ONDEMAND_PLUGINS:
                d = os.path.abspath(os.path.join(base, p['rel']))
                if not d.startswith(base + os.sep):
                    continue
                installed = os.path.isdir(d) and any(os.scandir(d)) if os.path.isdir(d) else False
                src = os.path.join(base, 'plugins', p['key'])
                items.append({'key': p['key'], 'name': p['name'], 'desc': p['desc'],
                              'installed': bool(installed),
                              'size': self._scan_dir(d)[0] if installed else 0,
                              'sizeHint': p['size_hint'],
                              'sourceAvailable': os.path.isdir(src) or bool(p.get('url'))})
            self._send_json({'ok': True, 'plugins': items}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_plugins_ondemand_install(self):
        """POST /api/plugins/ondemand/install — 安装（本地打包源复制 或 远端 zip 下载解压）"""
        try:
            ln = int(self.headers.get('Content-Length', 0) or 0)
            body = json.loads(self.rfile.read(ln).decode('utf-8')) if ln else {}
            key = body.get('key', '')
            plugin = next((p for p in self.ONDEMAND_PLUGINS if p['key'] == key), None)
            if not plugin:
                self._send_json({'ok': False, 'error': '未知插件: %s' % key}, 400)
                return
            base = self._plugins_base_dir()
            dst = os.path.abspath(os.path.join(base, plugin['rel']))
            if not dst.startswith(base + os.sep):
                self._send_json({'ok': False, 'error': '非法路径'}, 400)
                return
            if os.path.isdir(dst) and any(os.scandir(dst)):
                self._send_json({'ok': True, 'note': '已安装，无需重复操作'}, 200)
                return
            src = os.path.join(base, 'plugins', key)
            if os.path.isdir(src):
                _sh.copytree(src, dst, dirs_exist_ok=True)
                self._send_json({'ok': True, 'note': '已从本地插件包安装 %s' % plugin['name']}, 200)
                return
            url = plugin.get('url')
            if not url:
                self._send_json({'ok': False, 'error': '本地无插件包（plugins/%s 缺失）且未配置下载地址' % key}, 400)
                return
            import urllib.request, tempfile, zipfile
            os.makedirs(dst, exist_ok=True)
            tmp = os.path.join(tempfile.gettempdir(), 'zf_plugin_%s.zip' % key)
            urllib.request.urlretrieve(url, tmp)
            with zipfile.ZipFile(tmp) as zf:
                zf.extractall(dst)
            os.remove(tmp)
            self._send_json({'ok': True, 'note': '下载安装完成 %s' % plugin['name']}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_plugins_ondemand_uninstall(self):
        """POST /api/plugins/ondemand/uninstall — 卸载（清空目录内容以瘦身）"""
        try:
            ln = int(self.headers.get('Content-Length', 0) or 0)
            body = json.loads(self.rfile.read(ln).decode('utf-8')) if ln else {}
            key = body.get('key', '')
            plugin = next((p for p in self.ONDEMAND_PLUGINS if p['key'] == key), None)
            if not plugin:
                self._send_json({'ok': False, 'error': '未知插件: %s' % key}, 400)
                return
            base = self._plugins_base_dir()
            d = os.path.abspath(os.path.join(base, plugin['rel']))
            if not d.startswith(base + os.sep):
                self._send_json({'ok': False, 'error': '非法路径'}, 400)
                return
            size, count = self._scan_dir(d) if os.path.isdir(d) else (0, 0)
            if os.path.isdir(d):
                _sh.rmtree(d, ignore_errors=True)
                os.makedirs(d, exist_ok=True)
            self._send_json({'ok': True, 'freed': size, 'count': count,
                             'note': '已卸载 %s，释放 %.1f MB / %d 个文件' % (plugin['name'], size / 1048576.0, count)}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
