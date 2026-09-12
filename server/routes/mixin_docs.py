# -*- coding: utf-8 -*-
"""Mixin: 大模型表格/文档工作台 API（与 mixin_demo 同一套方法）
GET  /api/sheets/list            -> 列出所有表格（读 表格/index.json）
GET  /api/sheets/get?file=xx     -> 读单个 .sheet.json 全文
POST /api/sheets/save            -> 保存 .sheet.json（body: {file, data}，原子写，自动 .bak）
GET  /api/docs/list              -> 列出所有文档（读 文档/index.json）
GET  /api/docs/get?file=xx       -> 读单个 .doc.json 全文
POST /api/docs/save              -> 保存 .doc.json（body: {file, data}，原子写，自动 .bak）
安全：file 只取 basename，限制在对应数据目录内；自动备份旧文件。
"""
import os, json, time
from routes._shared import *
from routes.mixin_base import MixinBase

_DOCS_ROOTS = {
    'sheets': (os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '表格')), 'sheets', '.sheet.json'),
    'docs':   (os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '文档')), 'docs', '.doc.json'),
    'minds':  (os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '思维导图')), 'maps', '.mind.json'),
    'psds':   (os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '设计')), 'psds', '.psd.json'),
    'boards': (os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '板块')), 'boards', '.board.json'),
}


class MixinDocs(MixinBase):
    def _docs_safe_path(self, kind, name):
        root, sub, ext = _DOCS_ROOTS[kind]
        name = os.path.basename(str(name or '').strip())
        if not name:
            return None
        if not name.endswith('.json'):
            name += ext
        p = os.path.normpath(os.path.join(root, sub, name))
        if not p.startswith(os.path.join(root, sub)):
            return None
        return p

    def _docs_read_index(self, kind):
        root, _, _ = _DOCS_ROOTS[kind]
        idx_path = os.path.join(root, 'index.json')
        items = []
        if os.path.isfile(idx_path):
            with open(idx_path, 'r', encoding='utf-8-sig') as f:
                raw = json.load(f)
            if isinstance(raw, list):
                items = raw
            elif isinstance(raw, dict):
                items = raw.get('files') or raw.get('list') or raw.get('items') or []
        return items

    def _handle_docs_list(self, kind):
        try:
            self._send_json({'ok': True, 'items': self._docs_read_index(kind)})
        except Exception as e:
            print(f'[GET /api/{kind}/list] 500: {e}')
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

    def _handle_docs_get(self, kind, qs):
        try:
            name = (qs.get('file') or [''])[0]
            p = self._docs_safe_path(kind, name)
            if not p or not os.path.isfile(p):
                self._send_json({'ok': False, 'err': '文件不存在: ' + name}, 404)
                return
            with open(p, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            self._send_json({'ok': True, 'file': os.path.basename(p), 'data': data})
        except Exception as e:
            print(f'[GET /api/{kind}/get] 500: {e}')
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

    def _handle_docs_save(self, kind):
        root, sub, ext = _DOCS_ROOTS[kind]
        try:
            body = self._read_body()
            name = body.get('file', '')
            data = body.get('data')
            p = self._docs_safe_path(kind, name)
            if not p or not isinstance(data, dict):
                self._send_json({'ok': False, 'err': '参数不合法'}, 400)
                return
            os.makedirs(os.path.dirname(p), exist_ok=True)
            if os.path.isfile(p):
                bak = p + '.bak.' + time.strftime('%Y%m%d_%H%M%S')
                with open(p, 'r', encoding='utf-8-sig') as f:
                    old = f.read()
                with open(bak, 'w', encoding='utf-8') as f:
                    f.write(old)
            tmp = p + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, p)
            self._send_json({'ok': True, 'file': os.path.basename(p)})
        except Exception as e:
            print(f'[POST /api/{kind}/save] 500: {e}')
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass
