# -*- coding: utf-8 -*-
"""Mixin: 模型配置（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinModels(MixinBase):
    def _handle_get_last_model(self):
        try:
            data = self._read_json()
        except Exception:
            data = None
        model_id = None
        if isinstance(data, dict):
            model_id = data.get('model_id') or data.get('modelId')
        if not model_id and self.server and hasattr(self.server, 'last_model_id'):
            model_id = getattr(self.server, 'last_model_id', None)
        if not model_id:
            try:
                from config import LAST_MODEL_FILE
                import os, json
                if os.path.exists(LAST_MODEL_FILE):
                    with open(LAST_MODEL_FILE, 'r', encoding='utf-8') as f:
                        cache = json.load(f)
                        if isinstance(cache, dict):
                            model_id = cache.get('model_id') or cache.get('last_model_id')
            except Exception:
                pass
        self._send_json({'ok': True, 'model_id': model_id})


    def _handle_report_last_model(self):
        try:
            data = self._read_json() or {}
        except Exception:
            data = {}
        model_id = data.get('model_id') or data.get('modelId')
        if model_id and self.server:
            try:
                self.server.last_model_id = model_id
            except Exception:
                pass
        try:
            from config import LAST_MODEL_FILE
            import os, json
            os.makedirs(os.path.dirname(LAST_MODEL_FILE), exist_ok=True)
            with open(LAST_MODEL_FILE, 'w', encoding='utf-8') as f:
                json.dump({'model_id': model_id, 'updated_at': __import__('time').time()}, f, ensure_ascii=False)
        except Exception:
            pass
        self._send_json({'ok': True, 'model_id': model_id})


    def _handle_get_zf3d_status(self):
        # 转发到 mixin_zf3d 的完整状态实现
        self._handle_zf3d_status()


    def _handle_get_update_status(self):
        # 更新模块已剥离，返回静态空状态以兼容前端
        self._send_json({'ok': True, 'updating': False, 'version': '5.0.0', 'latest': '5.0.0', 'has_update': False})

    # ===== 大模型统一配置 =====

    def _handle_models_config_get(self):
        from model_config import load_models_config
        cfg = load_models_config()
        if cfg is None:
            self._send_json({'ok': False, 'err': 'models.json 不存在，请通过 POST /api/models/config 初始化'}, 404)
            return
        self._send_json({'ok': True, 'config': cfg})


    def _handle_prompt_gen(self):
        """POST /api/prompt-gen - 根据对话历史调用大模型生成提示词。
        body: { history: [{role, content}, ...] }
        返回: { ok, prompt } 或 { ok:false, error }
        """
        import json as _json
        import urllib.request
        try:
            body = self._read_body()
        except Exception:
            self._send_json({'ok': False, 'error': 'Invalid JSON body'}, 400)
            return

        from model_config import load_models_config
        cfg = load_models_config(include_key=True) or {}
        models = [m for m in (cfg.get('list') or [])
                  if m.get('enabled', True) and m.get('modelType', 'language') == 'language'
                  and (m.get('baseUrl') or m.get('endpoint')) and not m.get('imageGen')]
        # 优先默认模型，否则第一个可用的
        model = next((m for m in models if m.get('isDefault')), None) or (models[0] if models else None)
        if not model:
            self._send_json({'ok': False, 'error': '没有可用的语言模型配置（models.json）'}, 503)
            return

        endpoint = model.get('endpoint') or model.get('baseUrl')
        api_key = model.get('apiKey') or model.get('key') or ''
        model_id = model.get('modelId') or model.get('version') or ''

        # 组装消息：系统指令 + 用户上下文
        sys_prompt = ('你是提示词工程师。根据用户提供的对话历史，提炼生成一段高质量的绘图/创作提示词。'
                      '只输出提示词本身（中文），不要解释、不要引号、不要多余前缀。')
        raw = body.get('history') if isinstance(body, dict) else None
        msgs = []
        for h in (raw or [])[-6:]:
            c = h.get('content') if isinstance(h, dict) else h
            if isinstance(c, list):  # 多模态数组 → 取文本片段
                c = ' '.join(p.get('text', '') for p in c if isinstance(p, dict))
            c = str(c or '').strip()
            if c:
                msgs.append({'role': str((h.get('role') if isinstance(h, dict) else 'user') or 'user'), 'content': c[:500]})
        ctx = '\n'.join(('[%s] %s' % (m['role'], m['content'])) for m in msgs)
        payload = {
            'model': model_id,
            'messages': [
                {'role': 'system', 'content': sys_prompt},
                {'role': 'user', 'content': ctx or '（对话为空，请生成一个通用的精美场景提示词）'},
            ],
            'max_tokens': 800,
            'temperature': 0.7,
            'stream': False,
        }

        req = urllib.request.Request(
            endpoint,
            data=_json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api_key},
            method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = _json.loads(resp.read().decode('utf-8'))
            content = ''
            choices = data.get('choices') or []
            if choices:
                content = str(((choices[0].get('message') or {}).get('content')) or '').strip()
                # 部分 reasoning 模型返回 reasoning_content，兜底拼接
                if not content:
                    content = str((choices[0].get('message') or {}).get('reasoning_content') or '').strip()
            if not content:
                self._send_json({'ok': False, 'error': '模型返回为空'}, 502)
                return
            self._send_json({'ok': True, 'prompt': content})
        except Exception as e:
            print('[POST /api/prompt-gen] error: %s' % e)
            self._send_json({'ok': False, 'error': str(e)}, 502)


    def _handle_models_config_post(self):
        from model_config import save_models_config, load_models_config, import_from_legacy_json
        try:
            body = self._read_body()
        except Exception:
            self._send_json({'ok': False, 'err': 'Invalid JSON body'}, 400)
            return
        if not isinstance(body, dict):
            self._send_json({'ok': False, 'err': 'body 必须是 JSON 对象'}, 400)
            return
        if 'config' in body and isinstance(body['config'], dict):
            payload = body['config']
        elif 'list' in body and isinstance(body['list'], list):
            payload = import_from_legacy_json(body['list'])
        else:
            payload = body
        if save_models_config(payload):
            cfg = load_models_config()
            self._send_json({'ok': True, 'config': cfg})
        else:
            import model_config as _mc
            self._send_json({'ok': False, 'err': '写盘失败', 'detail': getattr(_mc, '_LAST_SAVE_ERROR', None)}, 500)

    # ============================================================
    # 备份管理（项目快照）
    # ============================================================

    _BACKUP_EXCLUDE_DIRS = {'.git', 'backups', 'node_modules', '__pycache__', '.venv', 'venv', '.codely-cli'}
    _BACKUP_EXCLUDE_EXTS = {'.pyc'}


