# -*- coding: utf-8 -*-
"""Mixin: API 代理（自动拆分自 handler_routes.py，方法体未改动）"""
from routes._shared import *
from routes.mixin_base import MixinBase
import logging


# ==== 以下方法体原样搬移（无改动），仅按职责拆分文件 ====


class MixinProxyStream:
    def _handle_proxy_stream_impl(self):
        try:
            body = self._read_body()
            target_url = body.get('_target_url', '')
            method = body.get('_method', 'POST')
            headers = body.get('_headers', {})
            payload = body.get('_body', {})

            # ===== 朱峰通道计费网关：预检身份+余额（2026-09-20）=====
            try:
                import zf_proxy_billing as _zpb
                _reject = _zpb.precheck(target_url, headers, payload)
                if _reject:
                    self._send_json({'ok': False, 'error': _reject['err']}, status=_reject['status'])
                    return
            except Exception as _zpb_e:
                logging.debug('[zf_proxy_billing] precheck skip: %s' % _zpb_e)

            # ===== 角色注入：把本对话选中角色的提示词作为 system 消息注入（每次请求跟随上下文）=====
            try:
                import roles_db as _rdb
                _rdb.inject_role_into_payload(payload, str(body.get('_box_id') or body.get('box_id') or payload.get('_box_id') or payload.get('box_id') or ''))
            except Exception as _re_err:
                print('[RolesDB] stream inject skip: %s' % _re_err)

            if not target_url:
                self._send_error('Missing _target_url', 400)
                return

            # ===== 安全：SSRF 防护 =====
            if not _ssrf_check_url(target_url):
                print('[Security] blocked SSRF attempt (stream) -> %s' % target_url[:100])
                self._send_json({'ok': False, 'error': 'Forbidden: 内网地址不允许通过代理访问'}, 403)
                return

            # ===== 底层引擎预处理（流式路径，与 /api/proxy 保持一致）=====
            # 【P1-2 施工队】先做 race worktree 强绑定（在 project_ctx 之前，防 DB 权威覆盖回主线）
            try:
                from engines.common.project_ctx import resolve_race_worktree as _rrw
                _rrw(body)
            except RuntimeError as _rw_err:
                print('[Security][race] worktree 校验失败: %s' % _rw_err)
                self._send_json({'ok': False, 'error': str(_rw_err)}, 400)
                return
            # ===== 底层引擎预处理（流式路径，与 /api/proxy 保持一致）=====
            # 【阶段C步骤2】先按 body._project_id 从 DB 查权威项目根，覆盖 _project_path（工具路径白名单基点）
            try:
                from engines.common.project_ctx import resolve_project_root_from_body as _rp
                _rp(body)
            except Exception as _pe:
                logging.debug('project_ctx skip: %s' % _pe)
            try:
                import engines_loader
                _eng_id = str(body.get('_engine') or '') or engines_loader.DEFAULT_ENGINE
                try:
                    from routes.mixin_base import db_write_log
                    db_write_log('info', str(body.get('_box_id') or ''), 'engine-request-stream',
                                 '流式请求进入引擎: %s | target=%s' % (_eng_id, str(target_url)[:80]))
                except Exception: logging.debug("swallow", exc_info=True)
                _eng_ctx = {'payload': payload, 'headers': headers,
                            'target_url': target_url, 'project_path': body.get('_project_path')}
                _eng_ret = engines_loader.run_engine(_eng_id, (payload or {}).get('messages'), _eng_ctx)
                # ===== 自动派发：对端版本的修复请求注入到本次 AI 对话（流式路径） =====
                try:
                    import repair_inject as _rinj
                    _rinj.inject_into_payload(payload)
                except Exception as _rinj_err:
                    print('[RepairInject] 流式路径注入异常: %s' % _rinj_err)
                if isinstance(_eng_ret, dict):
                    if isinstance(_eng_ret.get('payload'), dict):
                        payload = _eng_ret['payload']
                    if isinstance(_eng_ret.get('headers'), dict):
                        headers = _eng_ret['headers']
                    if _eng_ret.get('target_url'):
                        target_url = _eng_ret['target_url']
            except Exception as _ee:
                print('[Engine] stream preprocess error (fallback passthrough): %s' % _ee)

            # ===== local_loop 引擎（流式路径）：服务端 agent 循环 =====
            # 循环内为非流式调用；结束后把最终文本包装成一次 SSE chunk 回给前端，
            # 前端无需改动即可收到完整回答。
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
                        try:
                                                        self._unmask_auth_headers(_headers)
                        except Exception:
                            logging.debug("swallow", exc_info=True)
                        if not any(k.lower() == 'user-agent' for k in _headers):
                            _headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                        _loop_ctx = {'payload': payload, 'headers': _headers,
                                     'target_url': target_url,
                                     'project_path': body.get('_project_path'),
                                     'turbo': bool(body.get('_turbo')),
                                     '_session_id': str(body.get('_session_id') or body.get('session_id') or body.get('_box_id') or ''),
                                     '_box_id': str(body.get('_box_id') or '')}
                        # 【新增】敏感工具等引擎事件实时转发：先发 SSE 头，再以 on_event 回调
                        # 把 tool_event 事件逐条推给前端（自定义 event: tool_event 行）
                        _sse_headers_sent = [False]
                        _ev_buf = []
                        def _eng_on_event(ev):
                            try:
                                if not isinstance(ev, dict):
                                    return
                                # 暂不支持提前 flush（引擎循环是同步的），先缓存，
                                # 循环结束后随最终 chunk 一起发（对提示类事件足够）
                                _ev_buf.append(ev)
                            except Exception: logging.debug("swallow", exc_info=True)
                        _final = _agent_loop.run_agent_loop(
                            _eng_id, _eng_mod, (payload or {}).get('messages'), _loop_ctx, on_event=_eng_on_event)
                        _msg = ((_final or {}).get('choices') or [{}])[0].get('message') or {}
                        _content = _msg.get('content') or ''
                        # 【新增】把循环中收集的 tool_event（如 sensitive_tool 提示）以 SSE 事件发给前端
                        if _ev_buf:
                            try:
                                _send_sse_headers()
                                _sse_headers_sent[0] = True
                                for _ev in _ev_buf:
                                    _line = ('event: tool_event\ndata: %s\n\n' % json.dumps(_ev, ensure_ascii=False)).encode('utf-8')
                                    self.wfile.write(_line)
                                    self.wfile.flush()
                            except Exception: logging.debug("swallow", exc_info=True)
                        try:
                            from routes.mixin_base import db_write_log
                            _n_tool = sum(1 for _m in (payload or {}).get('messages') or []
                                          if isinstance(_m, dict) and _m.get('role') == 'tool')
                            db_write_log('info', str(body.get('_box_id') or ''), 'engine-loop-done-stream',
                                         '引擎 %s 流式agent循环完成 | 工具结果数=%d | 最终文本=%d字' % (_eng_id, _n_tool, len(_content)))
                        except Exception: logging.debug("swallow", exc_info=True)
                        _sse = ('data: ' + json.dumps({
                            'id': 'chatcmpl-agent-loop',
                            'object': 'chat.completion.chunk',
                            'choices': [{'index': 0, 'delta': {'role': 'assistant', 'content': _content},
                                         'finish_reason': 'stop'}],
                        }, ensure_ascii=False) + '\n\ndata: [DONE]\n\n')
                        if _sse_headers_sent[0]:
                            # 头已发过（前面写了 tool_event），直接追加，避免重复发响应头
                            self.wfile.write(_sse.encode('utf-8'))
                            self.wfile.flush()
                        else:
                            self._send_sse_raw(_sse)
                        return
                except Exception as _le:
                    print('[Engine] stream agent_loop error (fallback to passthrough): %s' % _le)
                    try:
                        from routes.mixin_base import db_write_log
                        db_write_log('error', str(body.get('_box_id') or ''), 'engine-loop-error-stream',
                                     '引擎 %s 流式agent循环异常回退透传: %s' % (_eng_id, str(_le)[:200]))
                    except Exception: logging.debug("swallow", exc_info=True)
                    # 【修复】还原被清掉的前端全局工具定义，否则回退后模型收不到任何工具
                    if _saved_tools is not None:
                        payload['tools'] = _saved_tools
                    if _saved_choice is not None:
                        payload['tool_choice'] = _saved_choice

            # 强制 stream=true（payload 是 _body 内层）
            try:
                if isinstance(payload, dict):
                    payload['stream'] = True
            except Exception: logging.debug("swallow", exc_info=True)
            # 剥离对话级私有字段（下划线开头：_engine/_project_id/_project_path 等，不发给上游模型 API）
            if isinstance(payload, dict):
                try:
                    for _k in [k for k in payload if k.startswith('_')]:
                        payload.pop(_k, None)
                except Exception:
                    logging.debug("swallow", exc_info=True)
            # 先尝试将掩码密钥（••••xxxx）还原为真实密钥，仍无法编码才报错。
            try:
                self._unmask_auth_headers(headers)
            except Exception as _um:
                print('[Proxy] unmask headers error: %s' % _um)

            # 【v5.1.3】Anthropic 协议线路：转换请求体 + 换协议头
            _anth_hit = False
            try:
                from common.anthropic_adapter import adapt_proxy_request
                target_url, payload, headers, _anth_hit = adapt_proxy_request(target_url, payload, headers)
                if _anth_hit:
                    print('[ProxyStream] anthropic adapter -> %s' % target_url)
            except ImportError: logging.debug("swallow", exc_info=True)
            except Exception as _anth_e:
                print('[ProxyStream] anthropic adapter error: %r' % _anth_e)

            # 【2026-09-30 修复】官方中转线路（zf_models_relay）需要 X-ZF-Key + X-ZF-User 鉴权，
            # 流式直转路径原先未注入，导致 relay 返回 401 unauthorized [diag] no-key
            if 'zf_models_relay' in str(target_url or ''):
                try:
                    import os as _os, sys as _sys
                    _srv = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
                    if _srv not in _sys.path:
                        _sys.path.insert(0, _srv)
                    from zf3d_commands import _get_api_key as _zf_gk
                    _zf_key = _zf_gk() or ''
                    if _zf_key:
                        headers['X-ZF-Key'] = _zf_key
                        try:
                            from zf3d_heartbeat import _get_login_status as _zf_gls
                            _ls, _lu, _zf_uid = _zf_gls()
                            if _zf_uid and int(_zf_uid) > 0:
                                headers['X-ZF-User'] = str(_zf_uid)
                        except Exception:
                            pass
                except Exception as _zf_e:
                    print('[ProxyStream] relay header inject failed: %r' % _zf_e)

            data = json.dumps(payload, ensure_ascii=True).encode('utf-8')
            req = urllib.request.Request(target_url, data=data, method=method)
            for hk, hv in headers.items():
                try:
                    str(hv).encode('latin-1')
                except UnicodeEncodeError:
                    self._send_json({'ok': False, 'status': 0, 'error':
                        '请求头「%s」包含中文或特殊字符，无法发送。请到「设置大模型」检查该模型的 API Key 是否误粘贴了中文。' % hk})
                    return
                req.add_header(hk, hv)
            if not any(k.lower() == 'user-agent' for k in headers):
                req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
                req.add_header('Accept', 'text/event-stream, application/json, */*')
            # 默认补 Content-Type（上游 API 一律 JSON；缺失会被部分平台 500 拒绝）
            if not any(k.lower() == 'content-type' for k in headers):
                req.add_header('Content-Type', 'application/json')

            sock_errs = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError)

            def _send_sse_raw(raw_text):
                """agent_loop 路径用：直接发一段 SSE 原文。"""
                _send_sse_headers()
                self.wfile.write(raw_text.encode('utf-8'))
                self.wfile.flush()

            def _send_sse_headers():
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Connection', 'keep-alive')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('X-Accel-Buffering', 'no')
                self.end_headers()

            def _write_event(event, obj):
                line = ('event: %s\ndata: %s\n\n' % (event, json.dumps(obj, ensure_ascii=False))).encode('utf-8')
                self.wfile.write(line)
                self.wfile.flush()

            try:
                _mls_t0 = time.time()   # 【链路统计】起点
                _mls_ttft = None        # 【链路统计】首字延迟（局部变量，避免并发串数据）
                resp = _urlopen_retry(req, timeout=300, tag='ProxyStream')
            except urllib.error.HTTPError as e:
                err_body = ''
                try:
                                        err_body = e.read().decode('utf-8', errors='replace')[:2000]
                except Exception:
                    logging.debug("swallow", exc_info=True)
                print(f'[ProxyStream] HTTP {e.code}: {err_body[:500]}')
                try:
                    import model_link_stats as _mls
                    _mls.record(str(payload.get('model') or 'unknown'), False,
                                dur_ms=(time.time() - _mls_t0) * 1000.0,
                                err='HTTP %d' % e.code)
                except Exception:
                    logging.debug('[model_link_stats] skip', exc_info=True)
                try:
                    import network_guard
                    network_guard.report(True)  # HTTP 有响应 = 网络通
                except Exception: logging.debug("swallow", exc_info=True)
                _send_sse_headers()
                _write_event('error', {'ok': False, 'status': e.code, 'error': err_body})
                return
            except Exception as e:
                print(f'[ProxyStream] connect error: {e}')
                self._gate_net_err = str(e)   # 【v4.2让道】打标：闸门据此记账触发休整让道
                try:
                    import model_link_stats as _mls
                    _mls.record(str(payload.get('model') or 'unknown'), False,
                                dur_ms=(time.time() - _mls_t0) * 1000.0,
                                err='connect: %s' % str(e)[:80])
                except Exception:
                    logging.debug('[model_link_stats] skip', exc_info=True)
                try:
                    import network_guard
                    network_guard.report(False, str(e))  # 连接失败 → 断网计时
                except Exception: logging.debug("swallow", exc_info=True)
                _send_sse_headers()
                _write_event('error', {'ok': False, 'status': 0, 'error': str(e)})
                return

            try:
                import network_guard
                network_guard.report(True)  # 连接成功 → 计时清零
            except Exception: logging.debug("swallow", exc_info=True)
            status = resp.getcode()
            ctype = (resp.headers.get('Content-Type') or '').lower()
            is_sse = ('text/event-stream' in ctype) or ('event-stream' in ctype)

            _send_sse_headers()
            _zpb_sse_lines = []   # 朱峰计费：累积 SSE 行用于结算

            # 非 SSE 上游：一次性读完，包装成 done 事件发回（前端按聚合 JSON 处理）
            if not is_sse:
                try:
                    body_txt = resp.read().decode('utf-8', errors='replace')
                    try:
                        resp_data = json.loads(body_txt)
                        # 【v5.1.3】Anthropic JSON 响应转回 OpenAI 格式
                        if _anth_hit and isinstance(resp_data, dict) and isinstance(resp_data.get('content'), list):
                            try:
                                from common.anthropic_adapter import from_anthropic_response
                                resp_data = from_anthropic_response(resp_data)
                            except Exception as _cve2:
                                print('[ProxyStream] anthropic convert error: %r' % _cve2)
                    except Exception:
                        resp_data = {'raw': body_txt}
                    # ===== 朱峰通道计费：非SSE上游结算 =====
                    try:
                        import zf_proxy_billing as _zpb3
                        _uid, _ = _zpb3.identify_user(headers, payload)
                        _usage = _zpb3.extract_usage(resp_data)
                        if _usage is None:
                            _usage = _zpb3.estimate_usage_fallback(payload, resp_data)
                        _zpb3.settle(_uid, _usage, model=str(payload.get('model') or ''),
                                     request_id=str(body.get('_request_id') or ''), meta={'via': 'proxy_stream'})
                    except Exception as _zpb_e:
                        logging.debug('[zf_proxy_billing] nonsse settle skip: %s' % _zpb_e)
                    _write_event('done', {'ok': status == 200, 'status': status, 'data': resp_data})
                except sock_errs: logging.debug("swallow", exc_info=True)
                finally:
                    try:
                        resp.close()
                    except Exception:
                        logging.debug("swallow", exc_info=True)
                return

            # SSE 上游：逐块透传（尽量保真转发 data 行；每写必 flush）
            buf = b''
            try:
                while True:
                    # read1: 有多少读多少、立即返回（read(4096) 会等凑满才返回，导致 SSE 攒批卡顿）
                    try:
                        chunk = resp.read1(4096)
                    except AttributeError:
                        chunk = resp.read(4096)
                    if not chunk:
                        break
                    buf += chunk
                    # 按空行切分完整 SSE 事件转发
                    while b'\n' in buf:
                        idx = buf.find(b'\n')
                        line_b = buf[:idx]
                        buf = buf[idx + 1:]
                        line = line_b.decode('utf-8', errors='replace').rstrip('\r')
                        if line.strip() == '':
                            continue
                        # 【v5.1.3】Anthropic SSE -> OpenAI SSE 逐行转换
                        if _anth_hit and line.startswith('data:'):
                            try:
                                from common.anthropic_adapter import anthropic_sse_line_to_openai_chunk
                                _ck = anthropic_sse_line_to_openai_chunk(line)
                                if _ck is None or _ck == 'DONE':
                                    continue
                                line = 'data: ' + json.dumps(_ck, ensure_ascii=False)
                            except Exception as _sae:
                                print('[ProxyStream] anthropic sse convert error: %r' % _sae)
                        self.wfile.write((line + '\n').encode('utf-8'))
                        if line.startswith('data:'):
                            self.wfile.write(b'\n')
                            self.wfile.flush()
                            _zpb_sse_lines.append(line)
                            # 【链路统计】首个 data 块到达 = 首字时间
                            if '_mls_first' not in dir():
                                _mls_first = True
                                _mls_ttft = (time.time() - _mls_t0) * 1000.0
                # 冲刷残余
                rest = buf.decode('utf-8', errors='replace').strip()
                if rest:
                    self.wfile.write((rest + '\n\n').encode('utf-8'))
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()
                # ===== 朱峰通道计费：流结束后按 usage 结算（2026-09-20）=====
                try:
                    import zf_proxy_billing as _zpb2
                    _uid, _ = _zpb2.identify_user(headers, payload)
                    _usage = _zpb2.extract_usage_from_sse('\n'.join(_zpb_sse_lines))
                    if _usage is None:
                        # 流式无 usage：按最后聚合 chunk 粗估回复长度
                        _zpb2.settle(_uid, {'prompt_tokens': 0, 'completion_tokens': min(200000, len(''.join(_zpb_sse_lines)) // 40)},
                                     model=str(payload.get('model') or ''),
                                     request_id=str(body.get('_request_id') or ''), meta={'via': 'proxy_stream', 'est': True})
                    else:
                        _zpb2.settle(_uid, _usage, model=str(payload.get('model') or ''),
                                     request_id=str(body.get('_request_id') or ''), meta={'via': 'proxy_stream'})
                except Exception as _zpb_e:
                    logging.debug('[zf_proxy_billing] stream settle skip: %s' % _zpb_e)
                # 【链路统计】流式完成：记录首字延迟 + 完成速率
                try:
                    import model_link_stats as _mls
                    _mls_ctok = None
                    try:
                        _mls_u = _zpb2.extract_usage_from_sse('\n'.join(_zpb_sse_lines))
                        if isinstance(_mls_u, dict):
                            _mls_ctok = _mls_u.get('completion_tokens')
                    except Exception:
                        pass
                    if _mls_ctok is None:
                        _mls_ctok = max(1, len(''.join(_zpb_sse_lines)) // 40)
                    _mls.record(str(payload.get('model') or 'unknown'), True,
                                ttft_ms=_mls_ttft,
                                dur_ms=(time.time() - _mls_t0) * 1000.0,
                                completion_tokens=_mls_ctok)
                except Exception:
                    logging.debug('[model_link_stats] stream skip', exc_info=True)
            except sock_errs: logging.debug("swallow", exc_info=True)
            except Exception as e:
                print(f'[ProxyStream] stream error: {e}')
            finally:
                try:
                    resp.close()
                except Exception:
                    logging.debug("swallow", exc_info=True)
        except Exception as e:
            print(f'[ProxyStream] 异常: {e}')
            try:
                                self._send_json({'ok': False, 'error': str(e), 'status': 0})
            except Exception:
                logging.debug("swallow", exc_info=True)
    # ===== 鍋ュ悍妫€鏌?=====

    def _load_loop_mode_system(self, loop_mode, project_root=None):
        """根据 loop_mode 读取 public/prompts/模式X_XXX/ 下所有 .txt 拼接成 system prompt。
        返回 None 表示不注入。带 mtime 缓存,文件改动自动失效。
        project_root: 对话关联项目的真实路径(projects.folder_path),
                      用于把提示词模板里的 {PROJECT_ROOT} 替换为项目路径;缺省回落 BASE_DIR。"""
        mode_key = str(loop_mode).strip()

        # ===== 插件模式优先：modes/<id>/ 的 manifest 注册了系统提示词 =====
        try:
            import mode_loader
            _p = mode_loader.get_prompt(mode_key)
            if _p:
                root_for_prompt = (project_root or BASE_DIR).replace('\\', '\\\\')
                _p = _p.replace('{PROJECT_ROOT}', root_for_prompt)
                base_for_prompt = BASE_DIR.replace('\\\\', '\\\\\\\\')
                return _p.replace('{BASE_ROOT}', base_for_prompt)
        except Exception as _me:
            print('[ModeLoader] prompt lookup failed for %s: %s' % (mode_key, _me))

        mode_dir_name = _LOOP_MODE_DIR.get(mode_key)
        if not mode_dir_name:
            return None
        mode_dir = os.path.join(_PUBLIC_DIR, 'prompts', mode_dir_name)
        if not os.path.isdir(mode_dir):
            return None

        # 收集所有 .txt 文件,按文件名排序保证顺序稳定
        try:
            files = sorted(f for f in os.listdir(mode_dir) if f.lower().endswith('.txt'))
        except OSError:
            return None
        if not files:
            return None

        # 计算提示词指纹(所有 .txt 的 mtime+size)。
        # 修复:原实现用目录 mtime 做缓存键,Windows 上修改文件内容不更新目录 mtime,
        # 导致改提示词后不重启服务器缓存永不失效
        fingerprint_parts = []
        for fname in files:
            fpath = os.path.join(mode_dir, fname)
            try:
                st = os.stat(fpath)
                fingerprint_parts.append('%s:%d:%d' % (fname, int(st.st_mtime), st.st_size))
            except OSError:
                continue
        fingerprint = '|'.join(fingerprint_parts)

        # 缓存键加入项目路径:不同项目 {PROJECT_ROOT} 替换结果不同,
        # 只按 mode_key 缓存会导致第二个项目复用第一个项目的替换结果(错路径 bug)
        cache_key = mode_key + '::' + str(project_root or '')
        with _PROMPTS_CACHE_LOCK:
            cached = _PROMPTS_CACHE.get(cache_key)
            if cached and cached[0] == fingerprint:
                return cached[1]

        # 拼装所有 .txt,用文件名作为小标题分隔
        parts = []
        for fname in files:
            fpath = os.path.join(mode_dir, fname)
            try:
                with open(fpath, 'r', encoding='utf-8-sig') as f:
                    content = f.read().strip()
            except (OSError, UnicodeDecodeError):
                continue
            if not content:
                continue
            # 提取文件名主名作为小标题(去掉 .txt 和数字前缀)
            title = os.path.splitext(fname)[0]
            if len(title) > 3 and title[2] == '_' and title[:2].isdigit():
                title = title[3:]
            parts.append(f"【{title}】\n{content}")

        if not parts:
            return None
        full = "\n\n---\n\n".join(parts)

        # ===== {PROJECT_ROOT} 替换:用对话关联项目的真实路径,缺省回落 BASE_DIR =====
        root_for_prompt = (project_root or BASE_DIR).replace('\\', '\\\\')
        full = full.replace('{PROJECT_ROOT}', root_for_prompt)
        # ===== {BASE_ROOT} 替换:恒为软件安装根目录(含盘符),不随项目变化 =====
        base_for_prompt = BASE_DIR.replace('\\\\', '\\\\\\\\')
        full = full.replace('{BASE_ROOT}', base_for_prompt)

        with _PROMPTS_CACHE_LOCK:
            _PROMPTS_CACHE[cache_key] = (fingerprint, full)
        return full


