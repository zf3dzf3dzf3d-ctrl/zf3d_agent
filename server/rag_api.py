# -*- coding: utf-8 -*-
"""
rag_api.py — RAG HTTP 接口（可插拔，配合 handler_routes.py 挂载）

挂载方式：在 do_GET / do_POST 各加一段 try import rag_api 并分发，缺失则跳过。
接口：
  GET  /api/rag/status                    -> {enabled, stats, config}
  POST /api/rag/config                    -> 改配置 {changes:{...}}
  GET  /api/rag/documents                 -> 文档列表
  POST /api/rag/ingest                    -> 入库 {name, text, source}
  POST /api/rag/search                    -> {query, top_k}
  DELETE 通过 POST /api/rag/delete         -> {doc_id}
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import rag_engine
except Exception:
    rag_engine = None


def _read_body(handler):
    length = int(handler.headers.get('Content-Length', 0) or 0)
    raw = handler._cached_body(length) if length > 0 else b'{}'
    # 【优化 2026-09-24】UTF-8 优先，GBK 回退，兼容中文 Windows 客户端
    try:
        return json.loads(raw.decode('utf-8') or '{}')
    except UnicodeDecodeError:
        return json.loads(raw.decode('gbk', errors='replace') or '{}')


def handle_get(handler, path):
    """返回 True 表示已处理"""
    if path == '/api/rag/status':
        if rag_engine is None:
            handler._send_json({'ok': False, 'error': 'rag_engine 模块不可用'}, 500)
        else:
            cfg = rag_engine.load_config()
            try:
                st = rag_engine.stats()
            except Exception as e:
                st = {'error': str(e)}
            key_ok = bool(rag_engine._get_api_key(cfg))
            handler._send_json({'ok': True, 'enabled': cfg.get('enabled', True),
                                'config': cfg, 'stats': st, 'key_ready': key_ok}, 200)
        return True

    if path == '/api/rag/documents':
        if rag_engine is None:
            handler._send_json({'ok': False, 'error': 'rag_engine 模块不可用'}, 500)
        else:
            try:
                handler._send_json({'ok': True, 'documents': rag_engine.list_documents()}, 200)
            except Exception as e:
                handler._send_json({'ok': False, 'error': str(e)}, 500)
        return True

    return False


def handle_post(handler, path):
    if path not in ('/api/rag/config', '/api/rag/ingest', '/api/rag/search', '/api/rag/delete'):
        return False
    if rag_engine is None:
        handler._send_json({'ok': False, 'error': 'rag_engine 模块不可用'}, 500)
        return True

    if path == '/api/rag/config':
        data = _read_body(handler)
        changes = data.get('changes') if isinstance(data.get('changes'), dict) else data
        cfg = rag_engine.load_config()
        for k in ('enabled', 'chunk_size', 'chunk_overlap', 'embedding_model', 'key_name'):
            if k in changes and changes[k] is not None:
                cfg[k] = changes[k]
        # 【安全收口】embedding_url 校验：仅允许 http/https，且主机经 util_net_guard
        # （兜底 security.is_safe_public_url）判定非私网/回环，拒绝内网与 file: 等地址，
        # 防 SSRF（embedding 请求会携带文档内容出站）与指向内网服务。
        if changes.get('embedding_url') is not None:
            _u = str(changes['embedding_url']).strip()
            _err = None
            try:
                import urllib.parse as _up
                _pu = _up.urlparse(_u)
                _host = (_pu.hostname or '').strip()
                if _pu.scheme not in ('http', 'https'):
                    _err = '仅允许 http/https'
                elif not _host:
                    _err = '缺少主机名'
                else:
                    try:
                        import util_net_guard
                        if util_net_guard.is_private_host(_host):
                            _err = '禁止内网/回环地址'
                    except Exception:
                        try:
                            from security import is_safe_public_url
                            if not is_safe_public_url(_u):
                                _err = '目标地址不安全'
                        except Exception:
                            _err = None  # 校验器均不可用时保持旧行为（不做拦截）
            except Exception:
                _err = 'URL 解析失败'
            if _err:
                handler._send_json({'ok': False, 'error': 'embedding_url 被拒绝: ' + _err}, 400)
                return True
            cfg['embedding_url'] = _u
        rag_engine.save_config(cfg)
        handler._send_json({'ok': True, 'config': cfg}, 200)
        return True

    if path == '/api/rag/ingest':
        cfg = rag_engine.load_config()
        if not cfg.get('enabled', True):
            handler._send_json({'ok': False, 'error': 'RAG 已被禁用'}, 403)
            return True
        data = _read_body(handler)
        name = str(data.get('name') or '').strip() or ('文档-%s' % __import__('time').strftime('%m%d%H%M%S'))
        text = data.get('text') or ''
        source = str(data.get('source') or '')
        try:
            r = rag_engine.ingest_text(name, text, source, cfg)
            handler._send_json(r, 200)
        except Exception as e:
            handler._send_json({'ok': False, 'error': str(e)}, 500)
        return True

    if path == '/api/rag/search':
        data = _read_body(handler)
        query = str(data.get('query') or '').strip()
        top_k = int(data.get('top_k') or 5)
        if not query:
            handler._send_json({'ok': False, 'error': 'query 为空'}, 400)
            return True
        try:
            results = rag_engine.search(query, top_k=top_k)
            handler._send_json({'ok': True, 'results': results}, 200)
        except Exception as e:
            handler._send_json({'ok': False, 'error': str(e)}, 500)
        return True

    # delete
    data = _read_body(handler)
    try:
        doc_id = int(data.get('doc_id'))
    except Exception:
        handler._send_json({'ok': False, 'error': '需提供 doc_id'}, 400)
        return True
    try:
        handler._send_json(rag_engine.delete_document(doc_id), 200)
    except Exception as e:
        handler._send_json({'ok': False, 'error': str(e)}, 500)
    return True
