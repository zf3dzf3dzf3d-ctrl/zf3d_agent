# -*- coding: utf-8 -*-
"""Mixin: 格式转换 API（市面常用格式 → 朱峰自有大模型格式）
GET  /api/convert/status          -> 转换器支持格式清单 + 收件箱统计
POST /api/convert/upload          -> body: multipart 或 {filename, data_b64}，存入 转换收件箱/ 立即转换
POST /api/convert/inbox/scan      -> 立即扫描一次收件箱（等效 watch.js 一轮）
安全：文件名只取 basename；输出目录由 convert.js 决定（文档/表格/演示）。
"""
import os, json, base64, subprocess, shutil
from routes._shared import *
from routes.mixin_base import MixinBase

_ROOT = os.path.normpath(BASE_DIR)
_INBOX = os.path.join(_ROOT, 'public', 'canvas', '转换收件箱')
_CONVERT_JS = os.path.join(_ROOT, 'public', 'canvas', '演示', 'tools', 'convert', 'convert.js')
_NODE = shutil.which('node') or 'node'

SUPPORTED_EXTS = ['.md', '.markdown', '.txt', '.docx', '.doc', '.csv', '.tsv',
                  '.xlsx', '.xls', '.html', '.htm', '.rtf', '.odt', '.pptx', '.ppt', '.pdf']


class MixinConvert(MixinBase):
    def _convert_safe_name(self, name):
        return os.path.basename(str(name or '').strip().replace('\\', '/').split('/')[-1])

    def _convert_run_file(self, full):
        """对单个收件箱文件跑 convert.js，成功则移动到 已处理/"""
        try:
            r = subprocess.run([_NODE, _CONVERT_JS, full], capture_output=True,
                               text=True, encoding='utf-8', errors='replace', timeout=120, cwd=_ROOT)
            out = (r.stdout or '') + (r.stderr or '')
            ok = r.returncode == 0
        except Exception as e:
            out, ok = str(e), False
        dest = os.path.join(_INBOX, '已处理' if ok else '失败')
        os.makedirs(dest, exist_ok=True)
        try:
            shutil.move(full, os.path.join(dest, os.path.basename(full)))
        except Exception:
            pass
        return {'ok': ok, 'file': os.path.basename(full), 'output': out.strip()[:2000]}

    def _handle_convert_status(self):
        try:
            items = []
            if os.path.isdir(_INBOX):
                for f in os.listdir(_INBOX):
                    p = os.path.join(_INBOX, f)
                    if os.path.isfile(p):
                        items.append({'name': f, 'supported': os.path.splitext(f)[1].lower() in SUPPORTED_EXTS})
            self._send_json({'ok': True, 'supported': SUPPORTED_EXTS,
                             'inbox': items, 'convert_js': os.path.relpath(_CONVERT_JS, _ROOT)})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_convert_upload(self, body):
        try:
            name = self._convert_safe_name(body.get('filename') or body.get('name') or '')
            data_b64 = body.get('data_b64') or ''
            if not name or not data_b64:
                self._send_json({'ok': False, 'err': '需要 filename 和 data_b64'}, 400)
                return
            ext = os.path.splitext(name)[1].lower()
            if ext not in SUPPORTED_EXTS:
                self._send_json({'ok': False, 'err': f'不支持的格式: {ext}'}, 400)
                return
            os.makedirs(_INBOX, exist_ok=True)
            full = os.path.join(_INBOX, name)
            with open(full, 'wb') as f:
                f.write(base64.b64decode(data_b64))
            res = self._convert_run_file(full)
            self._send_json(res)
        except Exception as e:
            print(f'[POST /api/convert/upload] 500: {e}')
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

    def _handle_convert_scan(self):
        try:
            results = []
            if os.path.isdir(_INBOX):
                for f in sorted(os.listdir(_INBOX)):
                    p = os.path.join(_INBOX, f)
                    if os.path.isfile(p):
                        results.append(self._convert_run_file(p))
            self._send_json({'ok': True, 'results': results})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)
