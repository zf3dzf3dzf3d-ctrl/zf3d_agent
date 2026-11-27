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

from util_log import get_logger

log = get_logger('docs')
_DOCS_ROOTS = {
    'sheets': (os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '表格')), 'sheets', '.sheet.json'),
    'docs':   (os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '文档')), 'docs', '.doc.json'),
    'minds':  (os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '思维导图')), 'maps', '.mind.json'),
    'psds':   (os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '设计')), 'psds', '.psd.json'),
    'boards': (os.path.normpath(os.path.join(BASE_DIR, 'public', 'canvas', '板块')), 'boards', '.board.json'),
}


class MixinDocs(MixinBase):
    # ---------- /api/appdocs：设置面板文档映射（动态扫描 docs/，升版本零改码） ----------
    _APPDOCS_CACHE = {'key': None, 'data': None}

    def get_appdocs(self):
        try:
            docs_dir = os.path.normpath(os.path.join(BASE_DIR, 'docs'))
            ver_path = os.path.join(BASE_DIR, 'private', 'version.json')
            version = VERSION  # 真源兜底：config.VERSION（模块加载时已从 private/version.json 校验非空，零硬编码）
            try:
                with open(ver_path, 'r', encoding='utf-8-sig') as f:
                    version = str((json.load(f) or {}).get('version') or version)
            except Exception:
                pass
            try:
                # 【2026-11-25 修复】缓存 key 取 docs/ 下全部 .md 的最大 mtime（含 version.json）：
                # 旧实现只取目录 mtime，改文件内容不改目录时映射缓存不失效，面板路径更新滞后
                _md_mtime = 0
                try:
                    for _fn in os.listdir(docs_dir):
                        if _fn.lower().endswith('.md'):
                            _t = os.path.getmtime(os.path.join(docs_dir, _fn))
                            if _t > _md_mtime: _md_mtime = _t
                except Exception:
                    pass
                mtime = max(_md_mtime, os.path.getmtime(docs_dir), os.path.getmtime(ver_path))
            except Exception:
                mtime = 0
            cache_key = (version, round(mtime, 1))
            if self._APPDOCS_CACHE.get('key') == cache_key and self._APPDOCS_CACHE.get('data'):
                self._send_json({'ok': True, **self._APPDOCS_CACHE['data']})
                return
            result = {'version': version, 'help': {}, 'intro': {}, 'history': None}
            try:
                for fn in os.listdir(docs_dir):
                    if not fn.lower().endswith('.md'):
                        continue
                    url = 'docs/' + fn
                    # 兼容两种命名：旧版「使用帮助/软件介绍/历史版本」与新版「01-介绍/02-帮助/03-版本更新内容」
                    if fn.startswith('使用帮助') or fn == '02-帮助.md':
                        lang_key = 'en' if fn.lower().endswith('-en.md') else 'zh'
                        result['help'][lang_key] = url
                    elif fn.startswith('软件介绍') or fn == '01-介绍.md':
                        lang_key = 'en' if fn.lower().endswith('-en.md') else 'zh'
                        result['intro'][lang_key] = url
                    elif fn.startswith('历史版本') or fn == '03-版本更新内容.md' or fn.startswith('版本变化'):
                        result['history'] = url
            except Exception:
                pass
            # fallback：当前版本精确文件缺失时取同名前缀最新 mtime 的文件
            for grp in ('help', 'intro'):
                if not result[grp].get('zh'):
                    prefix = '使用帮助' if grp == 'help' else '软件介绍'
                    cands = []
                    try:
                        for fn in os.listdir(docs_dir):
                            if fn.startswith(prefix) and fn.lower().endswith('.md') and not fn.lower().endswith('-en.md'):
                                cands.append((os.path.getmtime(os.path.join(docs_dir, fn)), 'docs/' + fn))
                    except Exception:
                        pass
                    if cands:
                        result[grp]['zh'] = max(cands)[1]
            # 简介文档已并入根目录 README.md（单文档维护）：intro 无文件时指向 /api/readme
            if not result['intro'].get('zh') and os.path.isfile(os.path.join(BASE_DIR, 'README.md')):
                result['intro']['zh'] = '/api/readme'
            self._APPDOCS_CACHE = {'key': cache_key, 'data': result}
            self._send_json({'ok': True, **result})
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

    # ---------- /api/readme：根目录 README 原文（简介面板数据源，单文档维护） ----------
    _README_CACHE = {'mtime': None, 'text': ''}

    def get_readme(self):
        try:
            p = os.path.normpath(os.path.join(BASE_DIR, 'README.md'))
            if not os.path.isfile(p):
                self._send_json({'ok': False, 'err': 'README.md 不存在'}, 404)
                return
            mtime = os.path.getmtime(p)
            if self._README_CACHE.get('mtime') != mtime:
                with open(p, 'r', encoding='utf-8-sig') as f:
                    self._README_CACHE['text'] = f.read()
                self._README_CACHE['mtime'] = mtime
            self._send_text(self._README_CACHE['text'])
        except Exception as e:
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass

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
            log.info(f'[GET /api/{kind}/list] 500: {e}')
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
            log.info(f'[GET /api/{kind}/get] 500: {e}')
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
            if os.path.isfile(p) and not os.path.isdir(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.git')):
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
            log.info(f'[POST /api/{kind}/save] 500: {e}')
            try:
                self._send_json({'ok': False, 'err': str(e)}, 500)
            except Exception:
                pass
