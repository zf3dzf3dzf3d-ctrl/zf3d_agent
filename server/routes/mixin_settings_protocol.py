# -*- coding: utf-8 -*-
"""Mixin: Agent 双协议/上下文保留挡位（由 mixin_settings.py 拆出，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


class MixinSettingsProtocol(MixinBase):
    # ==================== Agent 双协议/上下文保留挡位 (dual_protocol) ====================
    def _handle_agent_protocol_get(self):
        """GET /api/agent/protocol — 读取协议与挡位配置（不含 key）"""
        try:
            import json as _json
            cfg_path = os.path.join(BASE_DIR, 'private', 'agent_protocol.json')
            value = {'protocol': 'auto', 'ctx_mode': 'truncate'}
            try:
                with open(cfg_path, 'r', encoding='utf-8-sig') as f:
                    data = _json.load(f)
                if isinstance(data, dict):
                    p = str(data.get('protocol') or '').strip().lower()
                    if p in ('auto', 'responses', 'chat'):
                        value['protocol'] = p
                    m = str(data.get('ctx_mode') or '').strip().lower()
                    if m in ('truncate', 'minimal', 'full'):
                        value['ctx_mode'] = m
            except (OSError, ValueError):
                pass
            value['protocol_options'] = ['auto', 'responses', 'chat']
            value['ctx_mode_options'] = ['truncate', 'minimal', 'full']
            self._send_json({'ok': True, 'config': value})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_agent_protocol_post(self):
        """POST /api/agent/protocol — 保存协议/挡位，并清适配层配置缓存使其立即生效"""
        try:
            import json as _json, sys as _sys
            body = self._read_body()
            cfg_path = os.path.join(BASE_DIR, 'private', 'agent_protocol.json')
            value = {}
            try:
                with open(cfg_path, 'r', encoding='utf-8-sig') as f:
                    data = _json.load(f)
                if isinstance(data, dict):
                    value.update({k: data[k] for k in ('protocol', 'ctx_mode') if k in data})
            except (OSError, ValueError):
                pass
            p = str(body.get('protocol') or '').strip().lower()
            m = str(body.get('ctx_mode') or '').strip().lower()
            bad = []
            if 'protocol' in body and p not in ('auto', 'responses', 'chat'):
                bad.append('protocol')
            if 'ctx_mode' in body and m not in ('truncate', 'minimal', 'full'):
                bad.append('ctx_mode')
            if bad:
                self._send_json({'ok': False, 'error': '非法字段: ' + ', '.join(bad)
                                 + '（可选 protocol=auto/responses/chat, ctx_mode=truncate/minimal/full）'}, 400)
                return
            if p in ('auto', 'responses', 'chat'):
                value['protocol'] = p
            if m in ('truncate', 'minimal', 'full'):
                value['ctx_mode'] = m
            tmp = cfg_path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                _json.dump(value, f, ensure_ascii=False, indent=2)
            os.replace(tmp, cfg_path)
            try:  # 清 dual_protocol 5s 配置缓存
                _sys.path.insert(0, os.path.join(BASE_DIR, 'server', 'engines'))
                from common import dual_protocol as _dp
                _dp._cfg_cache['ts'] = 0.0
            except Exception:
                pass
            self._send_json({'ok': True, 'config': value})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_agent_protocol_last(self):
        """GET /api/agent/protocol/last — 最近 N 轮实际协议记录（协议状态徽章数据源）"""
        try:
            import sys as _sys
            _sys.path.insert(0, os.path.join(BASE_DIR, 'server', 'engines'))
            from common import dual_protocol as _dp
            items = _dp.get_last_protocols(20)
            self._send_json({'ok': True, 'items': items})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_agent_protocol_probe(self):
        """POST /api/agent/protocol/probe — 探测 endpoint 是否支持 Responses API
        body 可选 {urls:[...]}；不传则只返回已缓存的探测记录（不发上游请求）"""
        try:
            import sys as _sys
            body = {}
            try:
                body = self._read_body() or {}
            except Exception:
                pass
            urls = body.get('urls') or []
            if isinstance(urls, str):
                urls = [urls]
            results = []
            try:
                _sys.path.insert(0, os.path.join(BASE_DIR, 'server', 'engines'))
                from common import dual_protocol as _dp
                seen = set()
                for u in urls:
                    if not isinstance(u, str) or not u.strip():
                        continue
                    u = u.strip()
                    try:
                        proto = _dp.probe_endpoint(u)
                    except Exception:
                        proto = 'unknown'
                    results.append({'url': u, 'protocol': proto})
                    try:
                        seen.add(_dp._base_of(u))
                    except Exception:
                        seen.add(u)
                for item in _dp.probe_summary():  # 合并历史缓存（含 agent 运行时自动探测的）
                    b = item.get('base')
                    if b and b not in seen:
                        results.append({'url': b, 'protocol': item.get('protocol') or 'unknown',
                                        'age_s': item.get('age_s')})
            except Exception as e:
                self._send_json({'ok': False, 'error': str(e)}, 500)
                return
            self._send_json({'ok': True, 'results': results[:12]})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)
