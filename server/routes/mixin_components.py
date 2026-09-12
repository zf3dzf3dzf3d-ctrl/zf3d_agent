# -*- coding: utf-8 -*-
"""Mixin: 组件下载（设置面板 - 首次安装可选组件，替代旧版 .安装依赖.bat）"""
import json
import os
import subprocess
import threading

from routes._shared import *
from routes.mixin_base import MixinBase


class MixinComponents(MixinBase):

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
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        return os.path.join(base, 'python', 'python.exe')

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

        def _run():
            py = self._components_py_exe()
            mirror = ['-i', 'https://pypi.tuna.tsinghua.edu.cn/simple']
            args = [py, '-m', 'pip', 'install'] + mirror + group['pip'].split()
            try:
                with open(log_path, 'w', encoding='utf-8', errors='replace') as f:
                    f.write('$ ' + ' '.join(args) + '\n')
                    if group.get('playwright'):
                        f.write('SET PLAYWRIGHT_BROWSERS_PATH=0\n')
                    f.flush()
                    p = subprocess.run(args, capture_output=True, text=True, timeout=3600)
                    f.write(p.stdout or '')
                    f.write(p.stderr or '')
                    if group.get('playwright') and p.returncode == 0:
                        env = dict(os.environ, PLAYWRIGHT_BROWSERS_PATH='0')
                        p2 = subprocess.run([py, '-m', 'playwright', 'install', 'chromium'],
                                            capture_output=True, text=True, timeout=3600, env=env)
                        f.write(p2.stdout or '')
                        f.write(p2.stderr or '')
                        if p2.returncode == 0:
                            subprocess.run([py, '-m', 'playwright', 'install', 'chromium-headless-shell'],
                                           capture_output=True, text=True, timeout=3600, env=env)
            except Exception as e:
                try:
                    with open(log_path, 'a', encoding='utf-8', errors='replace') as f:
                        f.write('\n[ERROR] ' + str(e))
                except Exception:
                    pass
            finally:
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
