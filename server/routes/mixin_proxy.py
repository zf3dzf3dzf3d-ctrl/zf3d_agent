# -*- coding: utf-8 -*-
"""Mixin: API 代理（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase


from routes.mixin_proxy_stream import MixinProxyStream


class MixinProxy(MixinProxyStream, MixinBase):
    # ===== 【掩码密钥修复】前端拿到的 key 是脱敏掩码（••••xxxx），发请求前换回真实 key =====
    @staticmethod
    def _unmask_auth_headers(headers):
        """若 Authorization 含掩码格式密钥（•••• 前缀或 **** 前缀），按末4位匹配 api_keys.json 换回真实密钥。"""
        import re
        try:
            from model_config import mask_key, _load_keys_map
        except Exception:
            return
        auth_k = None
        for k in headers:
            if k.lower() == 'authorization':
                auth_k = k
                break
        if not auth_k:
            return
        val = headers.get(auth_k) or ''
        sval = str(val)
        is_masked = ('••••' in sval) or bool(re.match(r'^Bearer .{0,8}\*{4}', sval))
        if not is_masked:
            return
        tail = sval[-4:]
        try:
            from model_config import find_key_by_tail
            real = find_key_by_tail(tail)
            if real:
                headers[auth_k] = 'Bearer ' + real
        except Exception:
            pass
        if headers.get(auth_k) != val:
            return

    def _handle_proxy(self):
        try:
            body = self._read_body()
            target_url = body.get('_target_url', '')
            method = body.get('_method', 'POST')
            headers = body.get('_headers', {})
            payload = body.get('_body', {})

            if not target_url:
                # ===== 详细诊断：记录原始请求体 + headers 摘要，便于排查 endpoint 丢失问题 =====
                try:
                    body_keys = list(body.keys()) if isinstance(body, dict) else []
                    body_preview = json.dumps(body, ensure_ascii=False)[:500] if isinstance(body, dict) else str(body)[:500]
                except Exception:
                    body_keys = []
                    body_preview = '<无法序列化>'
                header_names = list(headers.keys()) if isinstance(headers, dict) else []
                auth_hdr = headers.get('Authorization', '') if isinstance(headers, dict) else ''
                diag = 'Missing _target_url | body_keys=%s | headers=%s | auth_len=%d | body_preview=%s' % (
                    body_keys, header_names, len(auth_hdr), body_preview
                )
                print('[PROXY_DIAG] ' + diag)
                self._send_error(diag, 400)
                return

            # ===== 安全：SSRF 防护，禁止代理到内网地址 =====
            if not _ssrf_check_url(target_url):
                print('[Security] blocked SSRF attempt -> %s' % target_url[:100])
                self._send_json({'ok': False, 'error': 'Forbidden: 内网地址不允许通过代理访问'}, 403)
                return

            # ===== 底层引擎预处理（server/engines/ 可插拔，默认 zf_core）=====
            _eng_id = ''
            try:
                import engines_loader
                _eng_id = str(body.get('_engine') or '') or engines_loader.DEFAULT_ENGINE
                try:
                    from routes.mixin_base import db_write_log
                    db_write_log('info', str(body.get('_box_id') or ''), 'engine-request',
                                 '请求进入引擎: %s | target=%s' % (_eng_id, str(target_url)[:80]))
                except Exception:
                    pass
                _eng_ctx = {'payload': payload, 'headers': headers,
                            'target_url': target_url, 'project_path': body.get('_project_path')}
                _eng_ret = engines_loader.run_engine(_eng_id, (payload or {}).get('messages'), _eng_ctx)
                if isinstance(_eng_ret, dict):
                    if isinstance(_eng_ret.get('payload'), dict):
                        payload = _eng_ret['payload']
                    if isinstance(_eng_ret.get('headers'), dict):
                        headers = _eng_ret['headers']
                    if _eng_ret.get('target_url'):
                        target_url = _eng_ret['target_url']
            except Exception as _ee:
                print('[Engine] preprocess error (fallback passthrough): %s' % _ee)

            # ===== local_loop 引擎：服务端 agent 循环（codex 式单步节奏）=====
            # 引擎带自有工具集时，由 common/agent_loop 驱动「调模型→执行工具→回填→再调模型」
            # 直到无工具调用或 MAX_TURNS，直接把最终 OpenAI 兼容响应返回前端。
            if isinstance(payload, dict) and engines_loader.engine_owns_tools(_eng_id):
                try:
                    # own_tools 风格引擎：只认引擎自有工具集，前端全局工具分类的工具必须清掉
                    # 【修复】先备份，agent_loop 失败回退透传时必须还原，否则模型收不到任何工具定义
                    _saved_tools = payload.pop('tools', None)
                    _saved_choice = payload.pop('tool_choice', None)
                    _eng_mod = engines_loader.get_module(_eng_id)
                    if _eng_mod is not None:
                        try:
                            from engines.common import agent_loop as _agent_loop
                        except ImportError:
                            import agent_loop as _agent_loop
                        _headers = dict(headers)
                        # 还原掩码密钥供循环内上游调用
                        try:
                            self._unmask_auth_headers(_headers)
                        except Exception:
                            pass
                        if not any(k.lower() == 'user-agent' for k in _headers):
                            _headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                        _loop_ctx = {'payload': payload, 'headers': _headers,
                                     'target_url': target_url,
                                     'project_path': body.get('_project_path')}
                        _final = _agent_loop.run_agent_loop(
                            _eng_id, _eng_mod, (payload or {}).get('messages'), _loop_ctx)
                        # ===== 引擎循环审计日志：把每轮工具调用写入 app_logs 便于排查 =====
                        try:
                            from routes.mixin_base import db_write_log
                            _turns = []
                            for _m in (payload or {}).get('messages') or []:
                                if isinstance(_m, dict) and _m.get('role') == 'tool':
                                    _turns.append(str(_m.get('content') or '')[:120])
                            db_write_log('info', str(body.get('_box_id') or ''), 'engine-loop-done',
                                         '引擎 %s agent循环完成 | 工具结果数=%d' % (_eng_id, len(_turns)))
                        except Exception:
                            pass
                        self._send_json({'ok': True, 'status': 200, 'data': _final})
                        return
                except Exception as _le:
                    print('[Engine] agent_loop error (fallback to passthrough): %s' % _le)
                    try:
                        from routes.mixin_base import db_write_log
                        db_write_log('error', str(body.get('_box_id') or ''), 'engine-loop-error',
                                     '引擎 %s agent循环异常回退透传: %s' % (_eng_id, str(_le)[:200]))
                    except Exception:
                        pass
                    # 失败回退普通转发（payload 已被引擎预处理，仍可直连一次）
                    # 【修复】还原被清掉的前端全局工具定义，否则回退后模型收不到任何工具
                    if _saved_tools is not None:
                        payload['tools'] = _saved_tools
                    if _saved_choice is not None:
                        payload['tool_choice'] = _saved_choice

            # ===== 注入 system prompt(根据 _loop_mode 读 public/prompts/模式X/ 下的 .txt)=====
            loop_mode = body.get('_loop_mode', None)
            if loop_mode is not None and isinstance(payload, dict) and 'messages' in payload:
                # {PROJECT_ROOT} 用对话关联项目的真实路径(前端附带 _project_path)替换
                sys_content = self._load_loop_mode_system(str(loop_mode), body.get('_project_path'))
                if sys_content:
                    msgs = payload['messages']
                    if isinstance(msgs, list):
                        if msgs and isinstance(msgs[0], dict) and msgs[0].get('role') == 'system':
                            msgs[0]['content'] = sys_content
                        else:
                            msgs.insert(0, {'role': 'system', 'content': sys_content})

            # 鏋勯€犺浆鍙戣姹?
                        # ===== 对话模式限制规则（private/chat_mode_rules.json，按模式强制执行）=====
            # 插件模式 limits 覆盖：插件 manifest 的 limits 段优先级最高
            _plugin_limits = None
            try:
                import mode_loader as _ml
                _plugin_limits = _ml.get_limits(loop_mode)
            except Exception:
                _plugin_limits = None
            if chat_mode_rules is not None:
                try:
                    payload = chat_mode_rules.enforce_request_rules(loop_mode, payload, overrides=_plugin_limits)
                except chat_mode_rules.RulesReject as _rr:
                    print('[ModeRules] rejected mode=%s: %s' % (_rr.mode, _rr))
                    self._send_json({
                        'ok': False,
                        'status': 400,
                        'error': '【模式规则限制】' + str(_rr),
                        'data': None
                    })
                    return
                except Exception as _re:
                    # 规则模块自身异常不阻断请求，退回原始 payload
                    print('[ModeRules] enforce error (skip): %s' % _re)

            # 剥离对话级私有字段 _engine（不发给上游模型 API）
            if isinstance(payload, dict):
                try: payload.pop('_engine', None)
                except Exception: pass

            data = json.dumps(payload, ensure_ascii=True).encode('utf-8')
            req = urllib.request.Request(target_url, data=data, method=method)

            # 安全：请求头值必须可编码为 latin-1（HTTP 标准）。
            # 先尝试将掩码密钥（••••xxxx）还原为真实密钥，仍无法编码才报错。
            try:
                self._unmask_auth_headers(headers)
            except Exception as _um:
                print('[Proxy] unmask headers error: %s' % _um)
            for hk, hv in headers.items():
                try:
                    str(hv).encode('latin-1')
                except UnicodeEncodeError:
                    self._send_json({
                        'ok': False, 'status': 0, 'data': None,
                        'error': ('请求头「%s」包含中文或特殊字符，无法发送。'
                                  '请到「设置大模型」检查该模型的 API Key / 接口地址是否误粘贴了中文说明文字。') % hk
                    })
                    return
                req.add_header(hk, hv)

            # 娴忚鍣?UA 鍏滃簳锛歶rllib 榛樿 UA (Python-urllib/3.x) 浼氳 Cloudflare 1010 鎷︽埅
            # 锛堝疄娴?miaomio.net 403 error code: 1010锛屽姞娴忚鍣?UA 鍚?200 OK锛?
            if not any(k.lower() == 'user-agent' for k in headers):
                req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
                req.add_header('Accept', 'application/json, text/plain, */*')

            # 鍙戦€佽姹傦紙甯﹁秴鏃讹級
            try:
                resp = urllib.request.urlopen(req, timeout=(chat_mode_rules.get_request_timeout(loop_mode) if chat_mode_rules is not None else 300), context=_SSL_CTX)
                resp_body = resp.read().decode('utf-8', errors='replace')
                resp_status = resp.getcode()

                # 解析 JSON；若为 SSE 流式响应则逐行聚合
                try:
                    resp_data = json.loads(resp_body)
                    # 非 SSE 响应：检测 finish_reason=length 并标记 _truncated
                    if isinstance(resp_data, dict) and isinstance(resp_data.get('choices'), list) and resp_data['choices']:
                        _c0 = resp_data['choices'][0]
                        if isinstance(_c0, dict) and _c0.get('finish_reason') == 'length':
                            resp_data['_truncated'] = True
                            _c0_msg = _c0.get('message') or {}
                            _c0_content = (_c0_msg.get('content') or '').strip() if isinstance(_c0_msg, dict) else ''
                            print('[Proxy][WARN] 非SSE 输出被截断 finish_reason=length，content_len=%d' % len(_c0_content))
                except json.JSONDecodeError:
                    if resp_status == 200 and ('data:' in resp_body or 'data:' in resp_body.replace('\r', '')):
                        # 流式 SSE 响应：聚合 data: 行
                        sse_choices = []
                        content_parts = []
                        reasoning_parts = []  # 【修复5.1】GLM思考模式 reasoning_content 逐块拼接
                        tool_calls_acc = {}
                        finish_reason = None
                        for line in resp_body.replace('\r', '').split('\n'):
                            line = line.strip()
                            if not line.startswith('data:'):
                                continue
                            payload = line[5:].strip()
                            if not payload or payload == '[DONE]':
                                continue
                            try:
                                chunk = json.loads(payload)
                            except json.JSONDecodeError:
                                continue
                            if not isinstance(chunk, dict):
                                continue
                            if 'choices' in chunk and isinstance(chunk['choices'], list):
                                for c in chunk['choices']:
                                    if not isinstance(c, dict):
                                        continue
                                    if c.get('finish_reason'):
                                        finish_reason = c.get('finish_reason')
                                    delta = c.get('delta') or c.get('message') or {}
                                    if not isinstance(delta, dict):
                                        continue
                                    for _rk in ('reasoning_content', 'reasoning', 'thinking', 'thought'):
                                        if delta.get(_rk):
                                            reasoning_parts.append(delta[_rk])
                                            break
                                    if delta.get('content'):
                                        content_parts.append(delta['content'])
                                    tc = delta.get('tool_calls')
                                    if tc:
                                        for t in tc:
                                            idx = t.get('index', 0)
                                            if idx not in tool_calls_acc:
                                                tool_calls_acc[idx] = {'id': t.get('id') or '', 'type': t.get('type') or 'function', 'function': {'name': '', 'arguments': ''}}
                                            if t.get('id'):
                                                tool_calls_acc[idx]['id'] = t['id']
                                            if t.get('function'):
                                                if t['function'].get('name'):
                                                    tool_calls_acc[idx]['function']['name'] += t['function']['name']
                                                if t['function'].get('arguments'):
                                                    tool_calls_acc[idx]['function']['arguments'] += t['function']['arguments']
                        message = {'role': 'assistant', 'content': ''.join(content_parts)}
                        if reasoning_parts:
                            message['reasoning_content'] = ''.join(reasoning_parts)  # 【修复5.1】思考内容带回前端
                        if tool_calls_acc:
                            message['tool_calls'] = [tool_calls_acc[k] for k in sorted(tool_calls_acc)]
                        if finish_reason == 'length':
                            print('[Proxy][WARN] SSE 输出被截断 finish_reason=length，content_len=%d' % len(message.get('content') or ''))
                        resp_data = {
                            'id': 'chatcmpl-sse',
                            '_sse_aggregated': True,  # 【修复5.1】标记经 SSE 聚合
                            'object': 'chat.completion',
                            'choices': [{'index': 0, 'message': message, 'finish_reason': finish_reason or 'stop'}],
                            '_truncated': finish_reason == 'length',  # 前端据此提示用户输出被截断
                        }
                    else:
                        resp_data = {'raw': resp_body}

                self._send_json({
                    'ok': resp_status == 200,
                    'status': resp_status,
                    'data': resp_data,
                    'raw': resp_body if resp_status != 200 else None
                })
            except urllib.error.HTTPError as e:
                err_body = e.read().decode('utf-8', errors='replace')
                print(f'[Proxy] HTTP {e.code}: {err_body[:500]}')
                self._send_json({
                    'ok': False,
                    'status': e.code,
                    'error': err_body[:2000],
                    'data': None
                })
            except urllib.error.URLError as e:
                print(f'[Proxy] URL Error: {e}')
                self._send_json({
                    'ok': False,
                    'status': 0,
                    'error': f'杩炴帴澶辫触: {e.reason}',
                    'data': None
                })
            except socket.timeout as e:
                print(f'[Proxy] Timeout: {e}')
                self._send_json({
                    'ok': False,
                    'status': 0,
                    'error': '璇锋眰瓒呮椂锛屽凡缁堟',
                    'data': None
                })

        except Exception as e:
            print(f'[Proxy] 寮傚父: {e}')
            self._send_json({'ok': False, 'error': str(e), 'status': 0})

    # ===== 真实流式代理（/api/proxy_stream）：逐行读上游 SSE → 透传浏览器 =====

