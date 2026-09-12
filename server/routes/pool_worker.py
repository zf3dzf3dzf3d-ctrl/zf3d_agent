# -*- coding: utf-8 -*-
"""pool_worker：池 Turn 的上游收发（池系统 v1.0）。

本模块把 routes/mixin_proxy.py 的 _handle_proxy_impl（聚合非流式）与
routes/mixin_proxy_stream.py 的 _handle_proxy_stream_impl（SSE 流式）的
"预处理 + 发送 + 解析"逻辑复刻为事件回调（emit）驱动版。

【重要原则】不改 mixin_proxy / mixin_proxy_stream 一行代码（v4.2 刚修稳的关键路径）。
池是平行新路径，出问题关 private/chat_pool.json 的 enabled 即回旧路。
两种模式的行为与旧路径逐字段对齐（响应形状/错误文案/重试语义），保证：
  - 前端现有解析器零改动可消费
  - e2e 对照测试可以锁行为

差异点（有意为之，见设计文档 §6/§10）：
  - 连接池模式：http.client 直连 + keep-alive 复用 + 死连接重建重试一次
  - 取消：Turn.cancel_evt 置位即中止上游读取（旧路径靠浏览器断连被动中止）
  - 观测：解析上游 usage（含 cached_tokens），随 done 事件与 app_logs 落地
"""
import json
import time
import socket

from routes._shared import *   # noqa: F401,F403  _ssrf_check_url/_urlopen_retry/_SSL_CTX/chat_mode_rules 等


def _extract_usage(u):
    """从上游 usage 里抽观测数据（多家字段名防御性兼容）。"""
    if not isinstance(u, dict):
        return {}
    out = {'prompt_tokens': int(u.get('prompt_tokens') or 0),
           'completion_tokens': int(u.get('completion_tokens') or 0)}
    cached = 0
    d = u.get('prompt_tokens_details')
    if isinstance(d, dict):
        cached = d.get('cached_tokens') or 0
    if not cached:
        cached = u.get('cached_tokens') or u.get('prompt_cache_hit_tokens') or 0
    try:
        out['cached_tokens'] = int(cached or 0)
    except Exception:
        out['cached_tokens'] = 0
    if u.get('total_tokens'):
        try:
            out['total_tokens'] = int(u['total_tokens'])
        except Exception:
            pass
    return out


def _unmask(headers):
    """掩码密钥（••••xxxx）还原为真实密钥——复用 MixinProxy 的静态方法。"""
    try:
        from routes.mixin_proxy import MixinProxy
        MixinProxy._unmask_auth_headers(headers)
    except Exception as e:
        print('[ChatPool] unmask headers error: %s' % e)


def _prep_headers(headers, is_stream):
    """latin-1 头校验 + 浏览器 UA 兜底。返回 (ok, err_msg)。"""
    for hk, hv in (headers or {}).items():
        try:
            str(hv).encode('latin-1')
        except UnicodeEncodeError:
            return False, ('请求头「%s」包含中文或特殊字符，无法发送。'
                           '请到「设置大模型」检查该模型的 API Key 是否误粘贴了中文。' % hk)
    if not any(k.lower() == 'user-agent' for k in (headers or {})):
        headers['User-Agent'] = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                                 'AppleWebKit/537.36 (KHTML, like Gecko) '
                                 'Chrome/131.0.0.0 Safari/537.36')
        if is_stream:
            headers['Accept'] = 'text/event-stream, application/json, */*'
        else:
            headers['Accept'] = 'application/json, text/plain, */*'
    if is_stream and not any(k.lower() == 'content-type' for k in (headers or {})):
        headers['Content-Type'] = 'application/json'
    return True, ''


def _engine_preprocess(body, payload, headers, is_stream, box_id):
    """底层引擎预处理（与旧两条路径一致）+ repair_inject。
    own_tools 引擎在 chat_pool.submit 已排除，此处仅常规 zf_core 形态。"""
    target_url = body.get('_target_url', '')
    try:
        import engines_loader
        eng_id = str(body.get('_engine') or '') or engines_loader.DEFAULT_ENGINE
        try:
            from routes.mixin_base import db_write_log
            db_write_log('info', box_id, 'engine-request' if not is_stream else 'engine-request-stream',
                         '[pool] 请求进入引擎: %s | target=%s' % (eng_id, str(target_url)[:80]))
        except Exception:
            pass
        eng_ctx = {'payload': payload, 'headers': headers,
                   'target_url': target_url, 'project_path': body.get('_project_path'),
                   '_box_id': box_id,
                   '_session_id': str(body.get('_session_id') or body.get('box_id') or '')}
        eng_ret = engines_loader.run_engine(eng_id, (payload or {}).get('messages'), eng_ctx)
        try:
            import repair_inject as _rinj
            _rinj.inject_into_payload(payload)
        except Exception as _rinj_err:
            print('[RepairInject] 池路径注入异常: %s' % _rinj_err)
        if isinstance(eng_ret, dict):
            # 【修复401·2026-09-10】zf_core 等引擎返回的就是传入的 ctx 本身：
            # eng_ret['headers'] 与 headers 是同一个对象，先 clear() 会把两者一起
            # 清空，再 update 已被清空的自己 → Authorization 等请求头全丢，
            # 上游一律 401（missing or invalid）。合并前必须排除同一对象。
            _ret_payload = eng_ret.get('payload')
            if isinstance(_ret_payload, dict) and _ret_payload is not payload:
                payload.clear()
                payload.update(_ret_payload)
            _ret_headers = eng_ret.get('headers')
            if isinstance(_ret_headers, dict) and _ret_headers is not headers:
                headers.clear()
                headers.update(_ret_headers)
            if eng_ret.get('target_url'):
                body['_target_url'] = eng_ret['target_url']
    except Exception as _ee:
        print('[ChatPool] engine preprocess error (fallback passthrough): %s' % _ee)


def _loop_mode_inject(body, payload):
    """系统提示词注入（仅非流式路径有此逻辑——与旧路径逐行对齐）。"""
    loop_mode = body.get('_loop_mode', None)
    if loop_mode is None or not isinstance(payload, dict) or 'messages' not in payload:
        return None, None
    try:
        from routes.mixin_proxy_stream import MixinProxyStream
        sys_content = MixinProxyStream._load_loop_mode_system(
            None, str(loop_mode), body.get('_project_path'))
    except Exception as _me:
        print('[ChatPool] loop_mode system load failed: %s' % _me)
        sys_content = None
    if sys_content and isinstance(payload['messages'], list):
        msgs = payload['messages']
        if msgs and isinstance(msgs[0], dict) and msgs[0].get('role') == 'system':
            msgs[0]['content'] = sys_content
        else:
            msgs.insert(0, {'role': 'system', 'content': sys_content})
    return loop_mode, sys_content


def run_upstream(body, turn, emit):
    """执行一轮上游请求。emit(kind, data) 负责落槽位事件缓冲。

    返回 (ok, err, net_err, usage)：
      ok      —— 业务成败（False 且非取消 → worker 判 failed）
      net_err —— 网络级失败描述（非空 → 闸门让道记账，与旧路径同义）
      usage   —— 上游用量观测（含 cached_tokens）
    """
    box_id = str(body.get('_box_id') or '')
    target_url = str(body.get('_target_url', '') or '')
    method = str(body.get('_method', 'POST') or 'POST')
    headers = dict(body.get('_headers', {}) or {})
    payload = body.get('_body', {})
    if not isinstance(payload, dict):
        payload = {}
    is_stream = bool(payload.get('stream'))
    net_err = ''
    usage = {}
    cancel = turn['cancel_evt']

    def _fail_local(msg, status=403):
        # 与旧路径同形错误（SSRF 拦截等）
        if is_stream:
            emit('error', {'ok': False, 'status': status, 'error': msg})
        else:
            emit('result', {'result': {'ok': False, 'status': status,
                                       'error': msg, 'data': None}})
        return False, msg, '', {}

    # ===== 安全：SSRF 防护（照搬旧路径） =====
    if not _ssrf_check_url(target_url):
        print('[ChatPool] blocked SSRF attempt -> %s' % target_url[:100])
        return _fail_local('Forbidden: 内网地址不允许通过代理访问')

    # ===== 引擎预处理（与旧路径一致） =====
    _engine_preprocess(body, payload, headers, is_stream, box_id)
    target_url = str(body.get('_target_url', '') or target_url)

    # ===== 模式分歧点（与旧路径逐行对齐） =====
    loop_mode = None
    if not is_stream:
        # 非流式：loop_mode 系统提示词注入 + 对话模式限制规则
        loop_mode, _ = _loop_mode_inject(body, payload)
        _plugin_limits = None
        try:
            import mode_loader as _ml
            _plugin_limits = _ml.get_limits(loop_mode)
        except Exception:
            _plugin_limits = None
        if chat_mode_rules is not None:
            try:
                payload = chat_mode_rules.enforce_request_rules(
                    loop_mode, payload, overrides=_plugin_limits)
            except chat_mode_rules.RulesReject as _rr:
                print('[ChatPool][ModeRules] rejected mode=%s: %s' % (_rr.mode, _rr))
                emit('result', {'result': {'ok': False, 'status': 400,
                                           'error': '【模式规则限制】' + str(_rr),
                                           'data': None}})
                return False, str(_rr), '', {}
            except Exception as _re:
                print('[ChatPool][ModeRules] enforce error (skip): %s' % _re)
    else:
        # 流式：强制 stream=true
        try:
            payload['stream'] = True
        except Exception:
            pass

    # 剥离对话级私有字段 _engine（不发给上游）
    try:
        payload.pop('_engine', None)
    except Exception:
        pass

    # ===== 头部处理（与旧路径一致：unmask + latin-1 校验 + UA 兜底） =====
    _unmask(headers)
    h_ok, h_err = _prep_headers(headers, is_stream)
    if not h_ok:
        if is_stream:
            emit('error', {'ok': False, 'status': 0, 'error': h_err})
        else:
            emit('result', {'result': {'ok': False, 'status': 0,
                                       'error': h_err, 'data': None}})
        return False, h_err, '', {}

    # 规范化序列化：键排序 + 剔除易变字段 → 字节稳定，前缀缓存更易命中
    try:
        import cache_watch
        data = cache_watch.serialize_payload(payload)
    except Exception:
        data = json.dumps(payload, ensure_ascii=True).encode('utf-8')

    # ===== 超时（与旧路径一致：非流式按模式规则，流式 300s） =====
    if not is_stream and chat_mode_rules is not None:
        timeout = chat_mode_rules.get_request_timeout(loop_mode)
    else:
        timeout = 300

    # ===== 发送：连接池（默认）或 _urlopen_retry（回退模式） =====
    use_pool = False
    try:
        import chat_pool
        use_pool = bool(chat_pool.cfg().get('conn_pool', {}).get('enabled'))
    except Exception:
        use_pool = False

    pooled_resp = None
    resp = None
    try:
        if use_pool:
            import conn_pool
            resp = conn_pool.open_pooled(target_url, method, data, headers,
                                          timeout, _SSL_CTX)
            pooled_resp = resp
        else:
            req = urllib.request.Request(target_url, data=data, method=method)
            for hk, hv in headers.items():
                req.add_header(hk, hv)
            resp = _urlopen_retry(req, timeout=timeout,
                                  tag='PoolStream' if is_stream else 'PoolProxy')
    except urllib.error.HTTPError as e:
        # 仅 urllib 路径会走到这（http.client 不对 4xx/5xx 抛错）
        err_body = ''
        try:
            err_body = e.read().decode('utf-8', errors='replace')
        except Exception:
            pass
        print('[ChatPool] HTTP %s: %s' % (e.code, err_body[:500]))
        try:
            import network_guard
            network_guard.report(True)   # HTTP 有响应 = 网络通（与旧路径同义）
        except Exception:
            pass
        if is_stream:
            emit('error', {'ok': False, 'status': e.code, 'error': err_body[:2000]})
        else:
            emit('result', {'result': {'ok': False, 'status': e.code,
                                       'error': err_body[:2000], 'data': None}})
        return False, 'HTTP %s' % e.code, '', {}
    except (urllib.error.URLError,) as e:
        net_err = str(e)
        try:
            import network_guard
            network_guard.report(False, str(getattr(e, 'reason', e)))
        except Exception:
            pass
        print('[ChatPool] URL Error: %s' % e)
        if is_stream:
            emit('error', {'ok': False, 'status': 0,
                           'error': '连接失败: %s' % getattr(e, 'reason', e)})
        else:
            emit('result', {'result': {'ok': False, 'status': 0,
                                       'error': '连接失败: %s' % getattr(e, 'reason', e),
                                       'data': None}})
        return False, str(e), net_err, {}
    except socket.timeout as e:
        net_err = str(e)
        try:
            import network_guard
            network_guard.report(False, 'timeout')
        except Exception:
            pass
        print('[ChatPool] Timeout: %s' % e)
        if is_stream:
            emit('error', {'ok': False, 'status': 0, 'error': '请求超时，已终止'})
        else:
            emit('result', {'result': {'ok': False, 'status': 0,
                                       'error': '请求超时，已终止', 'data': None}})
        return False, 'timeout', net_err, {}
    except Exception as e:
        # 连接池路径的连接类错误（http.client 直连：拒连/重置/TLS 等）。
        # 包成 URLError 形状（'<urlopen error ...>'），让闸门 _is_net_error
        # 的让道识别器能认出来（旧路径天然带此前缀，池必须对齐）。
        net_err = str(urllib.error.URLError(e))
        try:
            import network_guard
            network_guard.report(False, str(e))
        except Exception:
            pass
        print('[ChatPool] connect error: %s' % e)
        if is_stream:
            emit('error', {'ok': False, 'status': 0, 'error': '连接失败: %s' % e})
        else:
            emit('result', {'result': {'ok': False, 'status': 0,
                                       'error': '连接失败: %s' % e, 'data': None}})
        return False, str(e), net_err, {}

    # ===== http.client 路径的 4xx/5xx（urllib 路径在上面已抛 HTTPError 处理） =====
    if pooled_resp is not None and resp.status >= 400:
        err_body = ''
        try:
            err_body = resp.read().decode('utf-8', errors='replace')
            resp._pool_eof = True   # 错误体也读到流尾：连接可复用
        except Exception:
            pass
        try:
            import conn_pool
            conn_pool.release_pooled(resp, healthy=True)
        except Exception:
            pass
        print('[ChatPool] HTTP %s: %s' % (resp.status, err_body[:500]))
        try:
            import network_guard
            network_guard.report(True)
        except Exception:
            pass
        if is_stream:
            emit('error', {'ok': False, 'status': resp.status,
                           'error': err_body[:2000]})
        else:
            emit('result', {'result': {'ok': False, 'status': resp.status,
                                       'error': err_body[:2000], 'data': None}})
        return False, 'HTTP %s' % resp.status, '', {}

    try:
        import network_guard
        network_guard.report(True)   # 连接成功 → 计时清零
    except Exception:
        pass

    status = resp.getcode() if hasattr(resp, 'getcode') else resp.status
    ctype = ''
    try:
        ctype = (resp.headers.get('Content-Type') or '').lower()
    except Exception:
        ctype = ''

    # ================================================================
    # 非流式模式：整读 + 解析（SSE 响应则聚合——照搬 _handle_proxy_impl）
    # ================================================================
    if not is_stream:
        try:
            resp_body = resp.read().decode('utf-8', errors='replace')
            resp._pool_eof = True   # 自然读到流尾：连接可归还复用
            resp_status = status
            if resp_status == 200:
                try:
                    import network_guard
                    network_guard.report(True)
                except Exception:
                    pass
            if pooled_resp is not None:
                try:
                    import conn_pool
                    conn_pool.release_pooled(resp, healthy=True)
                except Exception:
                    pass
            try:
                resp_data = json.loads(resp_body)
                if isinstance(resp_data, dict):
                    u = resp_data.get('usage')
                    if u:
                        usage = _extract_usage(u)
                    if isinstance(resp_data.get('choices'), list) and resp_data['choices']:
                        _c0 = resp_data['choices'][0]
                        if isinstance(_c0, dict) and _c0.get('finish_reason') == 'length':
                            resp_data['_truncated'] = True
            except json.JSONDecodeError:
                if resp_status == 200 and 'data:' in resp_body:
                    # 流式 SSE 响应：聚合（照搬旧逻辑）
                    content_parts = []
                    reasoning_parts = []
                    tool_calls_acc = {}
                    finish_reason = None
                    for line in resp_body.replace('\r', '').split('\n'):
                        line = line.strip()
                        if not line.startswith('data:'):
                            continue
                        chunk_str = line[5:].strip()
                        if not chunk_str or chunk_str == '[DONE]':
                            continue
                        try:
                            chunk = json.loads(chunk_str)
                        except json.JSONDecodeError:
                            continue
                        if not isinstance(chunk, dict):
                            continue
                        if chunk.get('usage'):
                            usage = _extract_usage(chunk['usage'])
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
                                            tool_calls_acc[idx] = {'id': t.get('id') or '',
                                                                   'type': t.get('type') or 'function',
                                                                   'function': {'name': '', 'arguments': ''}}
                                        if t.get('id'):
                                            tool_calls_acc[idx]['id'] = t['id']
                                        if t.get('function'):
                                            if t['function'].get('name'):
                                                tool_calls_acc[idx]['function']['name'] += t['function']['name']
                                            if t['function'].get('arguments'):
                                                tool_calls_acc[idx]['function']['arguments'] += t['function']['arguments']
                    message = {'role': 'assistant', 'content': ''.join(content_parts)}
                    if reasoning_parts:
                        message['reasoning_content'] = ''.join(reasoning_parts)
                    if tool_calls_acc:
                        message['tool_calls'] = [tool_calls_acc[k] for k in sorted(tool_calls_acc)]
                    resp_data = {
                        'id': 'chatcmpl-sse',
                        '_sse_aggregated': True,
                        'object': 'chat.completion',
                        'choices': [{'index': 0, 'message': message,
                                     'finish_reason': finish_reason or 'stop'}],
                        '_truncated': finish_reason == 'length',
                    }
                else:
                    resp_data = {'raw': resp_body}
            emit('result', {'result': {'ok': resp_status == 200,
                                       'status': resp_status,
                                       'data': resp_data,
                                       'raw': resp_body if resp_status != 200 else None}})
            return (resp_status == 200), '', net_err, usage
        except Exception as e:
            print('[ChatPool] 非流式读取异常: %s' % e)
            emit('result', {'result': {'ok': False, 'status': 0,
                                       'error': str(e), 'data': None}})
            return False, str(e), net_err, {}

    # ================================================================
    # 流式模式：上游 SSE 逐行转发（照搬 _handle_proxy_stream_impl 的切行逻辑）
    # ================================================================
    is_sse = ('text/event-stream' in ctype) or ('event-stream' in ctype)
    if not is_sse:
        # 非 SSE 上游：一次性读完包成 result（对应旧路径 done 事件）
        try:
            body_txt = resp.read().decode('utf-8', errors='replace')
            resp._pool_eof = True   # 自然读到流尾：连接可归还复用
            try:
                resp_data = json.loads(body_txt)
            except Exception:
                resp_data = {'raw': body_txt}
            if isinstance(resp_data, dict) and resp_data.get('usage'):
                usage = _extract_usage(resp_data['usage'])
            emit('result', {'result': {'ok': status == 200, 'status': status,
                                       'data': resp_data}})
            if pooled_resp is not None:
                try:
                    import conn_pool
                    conn_pool.release_pooled(resp, healthy=True)
                except Exception:
                    pass
            return (status == 200), '', net_err, usage
        except Exception as e:
            print('[ChatPool] 流式非SSE读取异常: %s' % e)
            emit('error', {'ok': False, 'status': 0, 'error': str(e)})
            return False, str(e), net_err, {}

    buf = b''
    sock_errs = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError)
    try:
        while True:
            if cancel.is_set():
                # 主动取消：关上游（丢弃连接），由 worker 落 done(cancelled)
                try:
                    if pooled_resp is not None:
                        import conn_pool
                        conn_pool.release_pooled(resp, healthy=False)
                    resp.close()
                except Exception:
                    pass
                return False, 'cancelled', net_err, usage
            try:
                chunk = resp.read1(4096)
            except AttributeError:
                chunk = resp.read(4096)
            if not chunk:
                resp._pool_eof = True   # 自然读到流尾：连接可归还复用
                break
            buf += chunk
            while b'\n' in buf:
                idx = buf.find(b'\n')
                line_b = buf[:idx]
                buf = buf[idx + 1:]
                line = line_b.decode('utf-8', errors='replace').rstrip('\r')
                if line.strip() == '':
                    continue
                # 逐行转发（data: 行同时窥探 usage 供观测）
                emit('chunk', {'text': line})
                if line.startswith('data:'):
                    payload_str = line[5:].strip()
                    if payload_str and payload_str != '[DONE]':
                        try:
                            obj = json.loads(payload_str)
                            if isinstance(obj, dict) and obj.get('usage'):
                                usage = _extract_usage(obj['usage'])
                        except Exception:
                            pass
    except sock_errs:
        pass
    except Exception as e:
        print('[ChatPool] stream error: %s' % e)
    finally:
        try:
            if pooled_resp is not None:
                import conn_pool
                conn_pool.release_pooled(resp, healthy=not cancel.is_set())
            resp.close()
        except Exception:
            pass
    return True, '', net_err, usage
