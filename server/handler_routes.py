#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HTTP 璺敱澶勭悊
"""

import os
import sys
import json
import ssl
import socket
import time
import shutil
import subprocess
import threading

# 循环模式配置 json 路径（前端可读可写）
_LOOP_MODE_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'private', 'chat_loop_mode.json'
)
_LOOP_MODE_CONFIG_LOCK = threading.Lock()

# 健康守护配置 json 路径（前端可读可写）
_HEALTH_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'private', 'health_guard.json'
)
_HEALTH_CONFIG_LOCK = threading.Lock()

# 工具结果出口限额配置 json 路径（统一限制规则入口，前端可读可写）
_TOOL_RESULT_LIMITS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'private', 'tool_result_limits.json'
)
_TOOL_RESULT_LIMITS_LOCK = threading.Lock()

# ===== 用户设置（private/用户设置/user_settings.json）=====
_USER_SETTINGS_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'private', '用户设置', 'user_settings.json'
)
_USER_SETTINGS_LOCK = threading.Lock()
_USER_SETTINGS_MAX_KEYS = 500

# Independent user preferences: chat box size and per-chat compression defaults.
_USER_PREFERENCES_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'private', '用户设置', 'user_preferences.json')
_USER_PREFERENCES_LOCK = threading.Lock()

# 提示词注入相关路径与缓存（提示词已迁移到 public/）
_PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
_PROMPTS_CACHE = {}  # {mode_id_str: (mtime, content)}
_PROMPTS_CACHE_LOCK = threading.Lock()
_LOOP_MODE_DIR = {
    '1': '模式1_直接聊天',
    '2': '模式2_工具循环',
}
import traceback
import urllib.request
import urllib.error
from urllib.parse import urlparse, parse_qs

# 全局复用 SSL 上下文（避免每次请求都重新创建，提升代理性能）
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE

from config import BASE_DIR, DB_PATH, CONFIG_PATH, PUBLIC_DIR, MIME_TYPES, HOST, PORT, _db_lock, VERSION
from db import get_db, init_db

# ===== 对话模式限制规则（按模式 1/2 分组的强制限制，配置在 private/chat_mode_rules.json）=====
try:
    import chat_mode_rules
except Exception as _e:
    print('[ModeRules] import failed: %s' % _e)
    chat_mode_rules = None

class HandlerRoutes:
    """璺敱澶勭悊 Mixin"""

    def do_OPTIONS(self):
        self._send_json({'ok': True})

    # ===== API 浠ｇ悊锛氳浆鍙戣姹傚埌绗笁鏂?AI 鏈嶅姟锛堣В鍐?CORS锛?=====
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
            if chat_mode_rules is not None:
                try:
                    payload = chat_mode_rules.enforce_request_rules(loop_mode, payload)
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

            data = json.dumps(payload, ensure_ascii=True).encode('utf-8')
            req = urllib.request.Request(target_url, data=data, method=method)

            # 璁剧疆璇锋眰澶?
            for hk, hv in headers.items():
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
    def _handle_proxy_stream(self):
        try:
            body = self._read_body()
            target_url = body.get('_target_url', '')
            method = body.get('_method', 'POST')
            headers = body.get('_headers', {})
            payload = body.get('_body', {})

            if not target_url:
                self._send_error('Missing _target_url', 400)
                return

            # 强制 stream=true（payload 是 _body 内层）
            try:
                if isinstance(payload, dict):
                    payload['stream'] = True
            except Exception:
                pass

            data = json.dumps(payload, ensure_ascii=True).encode('utf-8')
            req = urllib.request.Request(target_url, data=data, method=method)
            for hk, hv in headers.items():
                req.add_header(hk, hv)
            if not any(k.lower() == 'user-agent' for k in headers):
                req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')
                req.add_header('Accept', 'text/event-stream, application/json, */*')

            sock_errs = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError)

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
                resp = urllib.request.urlopen(req, timeout=300, context=_SSL_CTX)
            except urllib.error.HTTPError as e:
                err_body = ''
                try:
                    err_body = e.read().decode('utf-8', errors='replace')[:2000]
                except Exception:
                    pass
                print(f'[ProxyStream] HTTP {e.code}: {err_body[:500]}')
                _send_sse_headers()
                _write_event('error', {'ok': False, 'status': e.code, 'error': err_body})
                return
            except Exception as e:
                print(f'[ProxyStream] connect error: {e}')
                _send_sse_headers()
                _write_event('error', {'ok': False, 'status': 0, 'error': str(e)})
                return

            status = resp.getcode()
            ctype = (resp.headers.get('Content-Type') or '').lower()
            is_sse = ('text/event-stream' in ctype) or ('event-stream' in ctype)

            _send_sse_headers()

            # 非 SSE 上游：一次性读完，包装成 done 事件发回（前端按聚合 JSON 处理）
            if not is_sse:
                try:
                    body_txt = resp.read().decode('utf-8', errors='replace')
                    try:
                        resp_data = json.loads(body_txt)
                    except Exception:
                        resp_data = {'raw': body_txt}
                    _write_event('done', {'ok': status == 200, 'status': status, 'data': resp_data})
                except sock_errs:
                    pass
                finally:
                    try: resp.close()
                    except Exception: pass
                return

            # SSE 上游：逐块透传（尽量保真转发 data 行；每写必 flush）
            buf = b''
            try:
                while True:
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
                        self.wfile.write((line + '\n').encode('utf-8'))
                        if line.startswith('data:'):
                            self.wfile.write(b'\n')
                            self.wfile.flush()
                # 冲刷残余
                rest = buf.decode('utf-8', errors='replace').strip()
                if rest:
                    self.wfile.write((rest + '\n\n').encode('utf-8'))
                self.wfile.write(b'data: [DONE]\n\n')
                self.wfile.flush()
            except sock_errs:
                pass
            except Exception as e:
                print(f'[ProxyStream] stream error: {e}')
            finally:
                try: resp.close()
                except Exception: pass

        except Exception as e:
            print(f'[ProxyStream] 异常: {e}')
            try:
                self._send_json({'ok': False, 'error': str(e), 'status': 0})
            except Exception:
                pass

    # ===== 鍋ュ悍妫€鏌?=====
    def _load_loop_mode_system(self, loop_mode, project_root=None):
        """根据 loop_mode 读取 public/prompts/模式X_XXX/ 下所有 .txt 拼接成 system prompt。
        返回 None 表示不注入。带 mtime 缓存,文件改动自动失效。
        project_root: 对话关联项目的真实路径(projects.folder_path),
                      用于把提示词模板里的 {PROJECT_ROOT} 替换为项目路径;缺省回落 BASE_DIR。"""
        mode_key = str(loop_mode).strip()
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
                with open(fpath, 'r', encoding='utf-8') as f:
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

    def do_GET_health(self):
        self._send_json({'ok': True, 'service': 'zf3d-sqlite', 'port': PORT})

    def do_GET_version(self):
        # 从 version.json 实时读取；失败时回落到 config.VERSION
        try:
            vp = os.path.join(BASE_DIR, 'private', 'version.json')
            with open(vp, 'r', encoding='utf-8') as f:
                vj = json.load(f)
            ver = vj.get('version') or VERSION
        except Exception:
            ver = VERSION
        self._send_json({'ok': True, 'version': ver})

    # ===== 璺敱鍒嗗彂 =====
    def _serve_static(self, path):
        """鎻愪緵闈欐€佹枃浠舵湇鍔?"""
        from urllib.parse import unquote
        # 瀹夊叏锛氶樆姝㈢洰褰曠┛瓒?
        if '..' in path:
            self.send_error(403)
            return
        # 鏍硅矾寰?-> index.html
        if path == '/' or path == '':
            path = '/index.html'
        # URL 瑙ｇ爜锛堟敮鎸佷腑鏂囨枃浠跺悕锛屽 鎹愯禒_寰俊.gif锛?
        path = unquote(path)
        # 鏄犲皠鍒?public 鐩綍
        file_path = os.path.join(PUBLIC_DIR, path.lstrip('/'))
        # 鐩綍鍒欒ˉ index.html
        if os.path.isdir(file_path):
            file_path = os.path.join(file_path, 'index.html')
        if not os.path.isfile(file_path):
            self.send_error(404, ('File not found: ' + path).encode('latin-1', 'replace').decode('latin-1'))
            return
        # 纭畾 MIME 绫诲瀷
        ext = os.path.splitext(file_path)[1].lower()
        mime = MIME_TYPES.get(ext, 'application/octet-stream')
        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            # ---- 动态注入：极简分类工具清单来自 public/js/tools/minimal/ 文件夹（文件夹有多少就用多少）----
            if file_path.endswith('tools-definitions.js'):
                try:
                    import re
                    _jj_dir = os.path.join(PUBLIC_DIR, 'js', 'tools', 'minimal')
                    _jj_files = sorted([f[:-3] for f in os.listdir(_jj_dir) if f.endswith('.js')])
                    # switch_tool_category 是元工具（定义在 tools-definitions.js，无物理文件），
                    # 动态注入必须保留它，否则极简模式下 AI 无法调用它切换分类
                    if 'switch_tool_category' not in _jj_files:
                        _jj_files.insert(0, 'switch_tool_category')
                    _inner = ", ".join("'" + f + "'" for f in _jj_files)
                    _text = content.decode('utf-8')
                    _new = re.sub(r"('极简'\s*:\s*\{[^}]*?tools:\s*\[)[^\]]*(\])",
                                  lambda x: x.group(1) + _inner + x.group(2), _text, count=1)
                    content = _new.encode('utf-8')
                except Exception:
                    pass  # 注入失败则返回原文件，不影响服务
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, str(e).encode('latin-1', 'replace').decode('latin-1'))


    def _handle_pixel_display_poll(self):
        """GET /api/pixel/display - return the latest pixel display data."""
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_data WHERE category='pixel_display' AND key='latest' ORDER BY id DESC LIMIT 1")
                row = cur.fetchone()
                conn.close()
            conn = None
            if row:
                d = json.loads(row['value'])
                self._send_json({
                    'ok': True,
                    'has_data': True,
                    'data': d.get('data', ''),
                    'title': d.get('title', ''),
                    'timestamp': d.get('timestamp', 0)
                })
            else:
                self._send_json({'ok': True, 'has_data': False})
        except Exception as e:
            print(f'[GET /api/pixel/display] 500: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_error(str(e), 500)

    # PXL 璋冭壊鏉匡紙RGB 鍏冪粍锛?
    _PXL_PALETTES = {
        'B': [(0,0,0), (255,255,255)],
        'C16': [
            (0,0,0),(29,43,83),(126,37,83),(0,135,81),
            (171,82,52),(95,87,79),(194,195,199),(255,241,232),
            (255,0,77),(255,163,0),(255,236,39),(0,228,54),
            (41,173,255),(131,56,236),(255,119,168),(255,204,170)
        ]
    }

    def _handle_pixel_export_gif(self):
        """GET /api/pixel/export_gif - 瀵煎嚭褰撳墠鍍忕礌鍔ㄧ敾涓篏IF"""
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("SELECT value FROM app_data WHERE category='pixel_display' AND key='latest' ORDER BY id DESC LIMIT 1")
                row = cur.fetchone()
                conn.close()
                conn = None

            if not row:
                self._send_json({'ok': False, 'error': 'no data'})
                return

            d = json.loads(row['value'])
            pxl_data = d.get('data', '')
            if not pxl_data:
                self._send_json({'ok': False, 'error': 'no pxl data'})
                return

            # 瑙ｆ瀽PXL鏁版嵁
            import re as _re
            colon_idx = pxl_data.index(':')
            header = pxl_data[:colon_idx].strip()
            body = pxl_data[colon_idx + 1:].strip()

            header_parts = header.split()
            size_mode = header_parts[0]
            frame_info = header_parts[1] if len(header_parts) > 1 else ''

            m = _re.match(r'^(\d+)x(\d+)(B|C\d+)$', size_mode, _re.I)
            if not m:
                self._send_json({'ok': False, 'error': 'invalid PXL header'})
                return

            width = int(m.group(1))
            height = int(m.group(2))
            mode = m.group(3).upper()

            frame_count = 1
            fps = 4
            if frame_info:
                fm = _re.match(r'^F(\d+)(?:@(\d+))?$', frame_info, _re.I)
                if fm:
                    frame_count = int(fm.group(1))
                    if fm.group(2):
                        fps = int(fm.group(2))

            # 璋冭壊鏉?
            palette = _PXL_PALETTES.get(mode, _PXL_PALETTES['B'])

            # 瑙ｇ爜RLE锛圔妯″紡=浜ゆ浛璁℃暟锛孋16妯″紡=棰滆壊.鏁伴噺瀵癸級
            def decode_rle(rle_str, total_pixels):
                pixels = []
                if mode == 'B':
                    nums = rle_str.split(',')
                    current_color = 0
                    for num in nums:
                        count = int(num.strip())
                        if count <= 0: continue
                        for _ in range(count):
                            pixels.append(current_color)
                        current_color = 1 - current_color
                else:
                    # C16: token = 棰滆壊.鏁伴噺 鎴?棰滆壊(榛樿1), X=閫忔槑
                    tokens = rle_str.split(',')
                    for tok in tokens:
                        tok = tok.strip()
                        if not tok: continue
                        # 閫忔槑鑹?
                        if tok[0].upper() == 'X':
                            parts = tok.split('.')
                            cnt = int(parts[1]) if len(parts) > 1 and parts[1] else 1
                            for _ in range(cnt):
                                pixels.append(-1)  # -1 = 閫忔槑
                            continue
                        if '.' in tok:
                            parts = tok.split('.')
                            ci = int(parts[0])
                            cnt = int(parts[1]) if len(parts) > 1 and parts[1] else 1
                        else:
                            ci = int(tok)
                            cnt = 1
                        ci = max(0, min(ci, len(palette) - 1))
                        for _ in range(cnt):
                            pixels.append(ci)
                while len(pixels) < total_pixels:
                    pixels.append(0)
                return pixels[:total_pixels]

            frame_strs = body.split('|')
            frames = []
            for i in range(min(len(frame_strs), frame_count)):
                pixels = decode_rle(frame_strs[i].strip(), width * height)
                frames.append(pixels)

            if not frames:
                self._send_json({'ok': False, 'error': 'no frames decoded'})
                return

            # 鐢≒illow鐢熸垚GIF
            from PIL import Image

            pixel_size = 16  # 姣忎釜鍍忕礌鏀惧ぇ鍒?6x16
            img_w = width * pixel_size
            img_h = height * pixel_size

            images = []
            for frame_pixels in frames:
                img = Image.new('RGBA', (img_w, img_h), (0, 0, 0, 0))
                pixels_obj = img.load()
                for y in range(height):
                    for x in range(width):
                        idx = y * width + x
                        color_idx = frame_pixels[idx] if idx < len(frame_pixels) else 0
                        if color_idx == -1:
                            continue  # 閫忔槑锛岃烦杩?
                        color = palette[color_idx] if color_idx < len(palette) else palette[0]
                        rgba = (color[0], color[1], color[2], 255)
                        for py in range(pixel_size):
                            for px in range(pixel_size):
                                pixels_obj[x * pixel_size + px, y * pixel_size + py] = rgba
                images.append(img)

            # 淇濆瓨涓篏IF
            exports_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'exports')
            os.makedirs(exports_dir, exist_ok=True)
            gif_path = os.path.join(exports_dir, 'pixel_animation.gif')

            duration_ms = int(1000 / fps)
            if len(images) == 1:
                images[0].save(gif_path, 'GIF', transparency=0)
            else:
                images[0].save(
                    gif_path, 'GIF',
                    save_all=True,
                    append_images=images[1:],
                    duration=duration_ms,
                    loop=0,
                    disposal=2,
                    transparency=0
                )

            gif_url = '/exports/pixel_animation.gif?t=' + str(int(time.time()))
            self._send_json({'ok': True, 'url': gif_url, 'frames': len(images), 'size': str(img_w) + 'x' + str(img_h)})

        except Exception as e:
            print(f'[GET /api/pixel/export_gif] 500: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_json({'ok': False, 'error': str(e)})



    def _handle_monitor_poll(self, query=None):

        allowed_ids = {
            chat_id for chat_id in (query or {}).get('chat_id', [])
            if isinstance(chat_id, str) and chat_id
        }
        if not allowed_ids:
            self._send_json({'ok': False, 'error': 'missing chat_id'}, 400)
            return

        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                placeholders = ','.join('?' for _ in allowed_ids)
                cur.execute(
                    "SELECT key, value FROM app_data "
                    "WHERE category='monitor_queue' "
                    "AND json_extract(value, '$.chat_id') IN (" + placeholders + ") "
                    "ORDER BY created_at",
                    tuple(allowed_ids)
                )

                rows = cur.fetchall()
                items = []
                for r in rows:
                    try:
                        data = json.loads(r['value'])
                        if data.get('chat_id', '') not in allowed_ids:
                            continue
                        items.append({
                            'key': r['key'],
                            'chat_id': data.get('chat_id', ''),
                            'message': data.get('message', '')
                        })
                    except Exception:
                        pass
                conn.close()
                conn = None
            self._send_json({'ok': True, 'items': items, 'count': len(items)})
        except Exception as e:
            print(f'[GET /api/monitor/poll] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_error(str(e), 500)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # API 璺敱
        if path == '/api/health':
            self.do_GET_health()
            return

        if path == '/api/health/config':
            self._handle_health_config_get()
            return

        if path == '/api/version':
            self.do_GET_version()
            return
        if path == '/api/app-root':
            # 返回软件真实安装根目录（含盘符），前端动态注入 system prompt，禁止硬编码
            self._send_json({'ok': True, 'base_root': BASE_DIR.replace('/', '\\')}, 200)
            return
            return

        if path.startswith('/api/db/'):
            self._handle_db_get(path)
            return

        # ===== 像素显示器面板轮询 =====
        if path == '/api/pixel/display':
            self._handle_pixel_display_poll()
            return

        # ===== 鍍忕礌鏄剧ず鍣ㄥ鍑篏IF =====
        if path == '/api/pixel/export_gif':
            self._handle_pixel_export_gif()
            return

        # ===== 鐩戞帶闃熷垪杞 =====
        if path == '/api/monitor/poll':
            self._handle_monitor_poll(parse_qs(parsed.query))
            return

        # ===== 备份管理 =====
        if path == '/api/backup/list':
            self._handle_backup_list()
            return
        if path == '/api/backup/open-folder':
            self._handle_backup_open_folder()
            return

        # ===== 大模型统一配置 =====
        if path == '/api/models/config':
            self._handle_models_config_get()
            return

        # ===== 提示词生成：拉线小圈 → 由大模型根据对话历史生成提示词 =====
        if path == '/api/prompt-gen' and self.command == 'POST':
            self._handle_prompt_gen()
            return

        # ===== 热更新：SSE 实时推送 =====
        if path == '/api/hot-reload/sse':
            self._handle_hot_reload_sse()
            return

        # ===== 获取/上报最后使用的模型 =====
        if path == '/api/chat/last-model' and self.command == 'GET':
            self._handle_get_last_model()
            return
        if path == '/api/chat/last-model' and self.command == 'POST':
            self._handle_report_last_model()
            return

        # ===== zf3d 项目状态 =====
        if path == '/api/zf3d/status':
            self._handle_get_zf3d_status()
            return

        # ===== 更新状态 =====
        if path == '/api/update-status':
            self._handle_get_update_status()
            return

        # ===== 热更新：状态查询 =====
        if path == '/api/hot-reload/status':
            self._handle_hot_reload_status()
            return

        # 闈濧PI璺緞 -> 闈欐€佹枃浠舵湇鍔?
        # ===== 对话循环模式配置（GET/POST） =====
        if path == '/api/loop-mode-config':
            if self.command == 'POST':
                self._handle_loop_mode_config_post()
            else:
                self._handle_loop_mode_config_get()
            return

        # ===== 打开项目文件夹（系统文件管理器） =====
        if path.startswith('/api/project/open-folder'):
            self._handle_open_project_folder(parsed)
            return

        # ===== 浏览目录（文件夹选择器） =====
        if path.startswith('/api/project/browse-folder'):
            self._handle_browse_folder(parsed)
            return

        # ===== 对话模式限制规则（GET 读 / POST 写，private/chat_mode_rules.json） =====
        if path == '/api/chat-mode-rules':
            if self.command == 'POST':
                self._handle_chat_mode_rules_post()
            else:
                self._handle_chat_mode_rules_get()
            return

        # ===== 工具结果出口限额（GET 读 / POST 写，private/tool_result_limits.json） =====
        if path == '/api/tool-result-limits':
            if self.command == 'POST':
                self._handle_tool_result_limits_post()
            else:
                self._handle_tool_result_limits_get()
            return

        # ===== 用户设置（GET 读 / POST 写，private/用户设置/user_settings.json） =====
        if path == '/api/user-settings':
            if self.command == 'POST':
                self._handle_user_settings_post()
            else:
                self._handle_user_settings_get()
            return

        if path == '/api/user-preferences':
            if self.command == 'POST':
                self._handle_user_preferences_post()
            else:
                self._handle_user_preferences_get()
            return

        self._serve_static(path)

    # ===== 项目文件夹相关：打开文件夹 / 浏览目录 / 关联文件夹 =====
    def _handle_open_project_folder(self, parsed):
        """在系统文件管理器中打开项目关联的文件夹"""
        qs = parse_qs(parsed.query)
        proj_id = (qs.get('proj_id', [''])[0] or '').strip()
        if not proj_id:
            self._send_error('缺少 proj_id 参数', 400)
            return
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute('SELECT folder_path FROM projects WHERE id=?', (proj_id,))
                row = cur.fetchone()
                conn.close()
            if not row or not row['folder_path']:
                self._send_error('该项目尚未关联文件夹', 404)
                return
            folder = row['folder_path']
            if not os.path.isdir(folder):
                self._send_error('文件夹不存在: ' + folder, 404)
                return
            if sys.platform == 'win32':
                os.startfile(folder)
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', folder])
            else:
                subprocess.Popen(['xdg-open', folder])
            self._send_json({'ok': True})
        except Exception as e:
            print(f'[GET /api/project/open-folder] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)

    def _handle_browse_folder(self, parsed):
        """浏览目录（文件夹选择器）：返回子目录列表。
        path 为空 -> 列出所有磁盘（我的电脑）；否则列出该目录的子文件夹。"""
        qs = parse_qs(parsed.query)
        raw_path = (qs.get('path', [''])[0] or '').strip()
        try:
            if not raw_path:
                # ===== 我的电脑：列出所有盘符 =====
                drives = []
                if sys.platform == 'win32':
                    try:
                        import string
                        import ctypes
                        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
                        for i, letter in enumerate(string.ascii_uppercase):
                            if bitmask & (1 << i):
                                drives.append(letter + ':\\')
                    except Exception:
                        # 回退：逐个盘符试探
                        import string
                        for letter in string.ascii_uppercase:
                            p = letter + ':\\'
                            if os.path.isdir(p):
                                drives.append(p)
                else:
                    # Linux/Mac：根目录挂载点
                    drives = [d for d in os.listdir('/') if os.path.isdir(os.path.join('/', d))]
                    drives = ['/'] + [os.path.join('/', d) for d in sorted(drives)][:50]
                self._send_json({'ok': True, 'path': '', 'parent': '', 'dirs': drives})
                return

            # ===== 指定目录：列出子文件夹 =====
            if not os.path.isdir(raw_path):
                self._send_json({'ok': False, 'error': '目录不存在: ' + raw_path})
                return
            dirs = []
            try:
                for name in os.listdir(raw_path):
                    try:
                        full = os.path.join(raw_path, name)
                        if os.path.isdir(full) and not name.startswith('.'):
                            dirs.append(name)
                    except Exception:
                        continue
            except PermissionError:
                self._send_json({'ok': False, 'error': '无权限访问该目录'})
                return
            dirs.sort(key=lambda s: s.lower())
            # 计算上一级目录（盘符根 C: -> 回到"我的电脑"；其余取 dirname）
            norm = raw_path.rstrip('\\').rstrip('/')
            if len(norm) == 2 and norm[1] == ':':
                parent = ''          # 盘符根 -> 我的电脑
            else:
                parent = os.path.dirname(norm) or ''
            self._send_json({'ok': True, 'path': raw_path, 'parent': parent, 'dirs': dirs})
        except Exception as e:
            print(f'[GET /api/project/browse-folder] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)

    def _handle_link_folder(self):
        """关联本地文件夹到项目（POST {proj_id, folder_path}）"""
        try:
            body = self._read_json()
        except Exception:
            body = {}
        proj_id = str(body.get('proj_id', '') or '').strip()
        folder_path = str(body.get('folder_path', '') or '').strip()
        if not proj_id:
            self._send_error('缺少 proj_id', 400)
            return
        if not folder_path or not os.path.isdir(folder_path):
            self._send_error('文件夹不存在: ' + folder_path, 400)
            return
        try:
            now = int(time.time() * 1000)
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()
                cur.execute('UPDATE projects SET folder_path=?, updated_at=? WHERE id=?',
                            (folder_path, now, proj_id))
                updated = cur.rowcount
                conn.commit()
                conn.close()
            if not updated:
                self._send_error('项目不存在: ' + proj_id, 404)
                return
            self._send_json({'ok': True, 'folder_path': folder_path})
        except Exception as e:
            print(f'[POST /api/project/link-folder] 500 错误: {e}')
            traceback.print_exc()
            self._send_error(str(e), 500)

    def _handle_generate_project_memory(self):
        """生成项目记忆（本地直写，不调大模型）"""
        import sys
        project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        python_path = sys.executable or sys.prefix
        memory_text = '项目目录: {}\nPython路径: {}\n生成时间: {}'.format(
            project_dir, python_path,
            time.strftime('%Y-%m-%d %H:%M:%S')
        )
        memory_path = os.path.join(project_dir, 'private', 'project_memory.txt')
        try:
            os.makedirs(os.path.dirname(memory_path), exist_ok=True)
            with open(memory_path, 'w', encoding='utf-8') as f:
                f.write(memory_text)
        except Exception as e:
            print('[project/memory/generate] 写入失败: {}'.format(e))
        self._send_json({'ok': True, 'memory_text': memory_text})

    def _handle_health_config_get(self):
        defaults = {
            'intervalMinutes': 30,
            'forceLockHours': 4,
            'forceLockMinutes': 10,
        }
        try:
            with _HEALTH_CONFIG_LOCK:
                if os.path.exists(_HEALTH_CONFIG_PATH):
                    with open(_HEALTH_CONFIG_PATH, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    if isinstance(data, dict):
                        defaults.update({k: data[k] for k in defaults if k in data})
            self._send_json({'ok': True, 'config': defaults}, 200)
        except Exception as e:
            self._send_json({'ok': True, 'config': defaults, '_error': str(e)}, 200)

    def _handle_health_config_post(self):
        try:
            data = self._read_body()
            if not isinstance(data, dict):
                raise ValueError('配置必须是 JSON 对象')
            defaults = {
                'intervalMinutes': 30,
                'forceLockHours': 4,
                'forceLockMinutes': 10,
            }
            with _HEALTH_CONFIG_LOCK:
                existing = dict(defaults)
                if os.path.exists(_HEALTH_CONFIG_PATH):
                    try:
                        with open(_HEALTH_CONFIG_PATH, 'r', encoding='utf-8') as f:
                            loaded = json.load(f)
                        if isinstance(loaded, dict):
                            existing.update({k: loaded[k] for k in defaults if k in loaded})
                    except Exception:
                        pass
                for key in defaults:
                    if key in data:
                        value = int(data[key])
                        if value <= 0:
                            raise ValueError(key + ' 必须大于 0')
                        existing[key] = value
                os.makedirs(os.path.dirname(_HEALTH_CONFIG_PATH), exist_ok=True)
                tmp = _HEALTH_CONFIG_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(existing, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _HEALTH_CONFIG_PATH)
            self._send_json({'ok': True, 'config': existing}, 200)
        except ValueError as e:
            self._send_json({'ok': False, 'error': str(e)}, 400)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写健康配置失败: ' + str(e)}, 500)

    def _handle_loop_mode_config_get(self):
        try:
            with _LOOP_MODE_CONFIG_LOCK:
                if not os.path.exists(_LOOP_MODE_CONFIG_PATH):
                    self._send_json({'default_mode': 1, 'per_chat': {}}, 200)
                    return
                with open(_LOOP_MODE_CONFIG_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            self._send_json(data, 200)
        except Exception as e:
            self._send_json({'default_mode': 1, 'per_chat': {}, '_error': str(e)}, 200)

    def _handle_loop_mode_config_post(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        try:
            with _LOOP_MODE_CONFIG_LOCK:
                existing = {}
                if os.path.exists(_LOOP_MODE_CONFIG_PATH):
                    try:
                        with open(_LOOP_MODE_CONFIG_PATH, 'r', encoding='utf-8') as f:
                            existing = json.load(f) or {}
                    except Exception:
                        existing = {}
                if 'default_mode' in data:
                    try:
                        existing['default_mode'] = int(data['default_mode'])
                    except Exception:
                        existing['default_mode'] = 1
                if 'per_chat' in data and isinstance(data['per_chat'], dict):
                    existing['per_chat'] = data['per_chat']
                os.makedirs(os.path.dirname(_LOOP_MODE_CONFIG_PATH), exist_ok=True)
                tmp = _LOOP_MODE_CONFIG_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(existing, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _LOOP_MODE_CONFIG_PATH)
            self._send_json({'ok': True, 'config': existing}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)

    def _handle_tool_result_limits_get(self):
        # 工具结果出口限额：读取 private/tool_result_limits.json
        try:
            with _TOOL_RESULT_LIMITS_LOCK:
                if not os.path.exists(_TOOL_RESULT_LIMITS_PATH):
                    self._send_json({'exit_limits': {}}, 200)
                    return
                with open(_TOOL_RESULT_LIMITS_PATH, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            self._send_json(data, 200)
        except Exception as e:
            self._send_json({'exit_limits': {}, '_error': str(e)}, 200)

    def _handle_tool_result_limits_post(self):
        # 工具结果出口限额：整包写入 private/tool_result_limits.json（替换式保存）
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        try:
            with _TOOL_RESULT_LIMITS_LOCK:
                os.makedirs(os.path.dirname(_TOOL_RESULT_LIMITS_PATH), exist_ok=True)
                tmp = _TOOL_RESULT_LIMITS_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _TOOL_RESULT_LIMITS_PATH)
            self._send_json({'ok': True, 'config': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)

    # ===== 用户设置：GET/POST（private/用户设置/user_settings.json） =====
    def _user_settings_read(self):
        """读取用户设置 JSON（不存在则返回空对象）"""
        if not os.path.exists(_USER_SETTINGS_PATH):
            return {}
        with open(_USER_SETTINGS_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}

    def _handle_user_settings_get(self):
        try:
            with _USER_SETTINGS_LOCK:
                data = self._user_settings_read()
            self._send_json({'ok': True, 'settings': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'settings': {}, 'error': str(e)}, 200)

    def _handle_user_settings_post(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        changes = data.get('changes') if isinstance(data, dict) else None
        if not isinstance(changes, dict):
            self._send_json({'ok': False, 'error': '请提交 {changes: {key: value, ...}}'}, 400)
            return
        try:
            with _USER_SETTINGS_LOCK:
                current = self._user_settings_read()
                for k, v in changes.items():
                    if v is None:
                        current.pop(k, None)
                    else:
                        current[str(k)] = v
                # 防膨胀：最多保留 _USER_SETTINGS_MAX_KEYS 个键
                if len(current) > _USER_SETTINGS_MAX_KEYS:
                    current = dict(list(current.items())[-_USER_SETTINGS_MAX_KEYS:])
                os.makedirs(os.path.dirname(_USER_SETTINGS_PATH), exist_ok=True)
                tmp = _USER_SETTINGS_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(current, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _USER_SETTINGS_PATH)
            self._send_json({'ok': True, 'settings': current}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)

    # ===== 用户习惯：GET/POST（独立 JSON） =====
    def _user_preferences_read(self):
        if not os.path.exists(_USER_PREFERENCES_PATH):
            return {}
        with open(_USER_PREFERENCES_PATH, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}

    def _handle_user_preferences_get(self):
        try:
            with _USER_PREFERENCES_LOCK:
                data = self._user_preferences_read()
            self._send_json({'ok': True, 'preferences': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'preferences': {}, 'error': str(e)}, 200)

    def _handle_user_preferences_post(self):
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        changes = data.get('changes') if isinstance(data, dict) else None
        if not isinstance(changes, dict):
            self._send_json({'ok': False, 'error': '请提交 {changes: {...}}'}, 400)
            return
        try:
            with _USER_PREFERENCES_LOCK:
                current = self._user_preferences_read()
                for k, v in changes.items():
                    if v is None:
                        current.pop(str(k), None)
                    else:
                        current[str(k)] = v
                os.makedirs(os.path.dirname(_USER_PREFERENCES_PATH), exist_ok=True)
                tmp = _USER_PREFERENCES_PATH + '.tmp'
                with open(tmp, 'w', encoding='utf-8') as f:
                    json.dump(current, f, ensure_ascii=False, indent=2)
                os.replace(tmp, _USER_PREFERENCES_PATH)
            self._send_json({'ok': True, 'preferences': current}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写 json 失败: ' + str(e)}, 500)

    # ===== 对话模式限制规则：GET/POST =====
    def _handle_chat_mode_rules_get(self):
        if chat_mode_rules is None:
            self._send_json({'ok': False, 'error': 'chat_mode_rules 模块不可用'}, 500)
            return
        try:
            data = chat_mode_rules.load_rules_cache()
            if not data:
                self._send_json({'ok': True, 'rules': None, 'hint': '规则文件缺失或为空，当前使用内置宽容默认值'}, 200)
            else:
                self._send_json({'ok': True, 'rules': data}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 500)

    def _handle_chat_mode_rules_post(self):
        if chat_mode_rules is None:
            self._send_json({'ok': False, 'error': 'chat_mode_rules 模块不可用'}, 500)
            return
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: ' + str(e)}, 400)
            return
        # 接受两种提交格式：{rules: {...}} 整体替换，或直接提交规则对象本身
        rules = data.get('rules') if isinstance(data.get('rules'), dict) else (data if isinstance(data, dict) and 'modes' in data else None)
        if rules is None:
            self._send_json({'ok': False, 'error': '请提交 {rules: {...}}（含 modes 字段）或规则对象本身'}, 400)
            return
        try:
            saved = chat_mode_rules.save_rules(rules)
            self._send_json({'ok': True, 'rules': saved}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': '写规则失败: ' + str(e)}, 500)

    def _chat_history_content_prefix(self, cur, session_id, created_at, max_len=200):
        """取某条 user 历史记录的内容前缀（避免读取超大文本整段内容）"""
        try:
            cur.execute('''SELECT substr(content, 1, ?) AS prefix FROM chat_history
                           WHERE session_id=? AND created_at=? AND role='user' ''', (max_len, session_id, created_at))
            row = cur.fetchone()
            if row and row['prefix'] is not None:
                return row['prefix']
            cur.execute('''SELECT substr(content, 1, ?) AS prefix FROM chat_history_archive
                           WHERE session_id=? AND created_at=? AND role='user' ''', (max_len, session_id, created_at))
            row = cur.fetchone()
            if row and row['prefix'] is not None:
                return row['prefix']
        except Exception:
            pass
        return ''

    def _handle_db_get(self, path):
        """澶勭悊 /api/db/* 鐨?GET 璇锋眰"""
        parsed = urlparse(self.path)
        parts = path[len('/api/db/'):].split('/')
        resource = parts[0] if parts else ''

        # 鍏堟煡璇㈡暟鎹紝鍏抽棴杩炴帴锛屽啀鍙戦€佸搷搴旓紙閬垮厤杩炴帴娉勬紡锛?
        result = None
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()

                if resource == 'nodes':
                    cur.execute('SELECT * FROM canvas_nodes ORDER BY z_index')
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'canvas' and len(parts) > 1 and parts[1] == 'view':
                    cur.execute('SELECT * FROM canvas_view WHERE id=1')
                    row = cur.fetchone()
                    result = {'ok': True, 'data': dict(row) if row else {}}

                elif resource == 'kv' and len(parts) > 1:
                    key = parts[1]
                    cur.execute('SELECT value FROM kv_store WHERE key=?', (key,))
                    row = cur.fetchone()
                    result = {'ok': True, 'data': row['value'] if row else None}

                elif resource == 'chat-history' and len(parts) > 1 and parts[1] == 'all':
                    # 性能优化版：默认仅返回每一天的前 N 条对话（含对话数统计），
                    # 完整内容按需通过 ?day=YYYY-MM-DD&offset=&limit= 分页加载。
                    # 旧的全量接口数据量可达数 MB（单条 30 万字符），导致面板打开极慢。
                    cur.execute('''
                        CREATE TABLE IF NOT EXISTS chat_history_archive (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            session_id TEXT NOT NULL,
                            session_name TEXT,
                            role TEXT,
                            content TEXT,
                            model_id TEXT,
                            created_at INTEGER
                        )
                    ''')
                    cur.execute("PRAGMA table_info(chat_history_archive)")
                    archive_columns = {row['name'] for row in cur.fetchall()}
                    if 'model_id' not in archive_columns:
                        cur.execute('ALTER TABLE chat_history_archive ADD COLUMN model_id TEXT')
                    qs = parse_qs(parsed.query)
                    req_day = qs.get('day', [''])[0]
                    offset = int(qs.get('offset', ['0'])[0] or 0)
                    limit = int(qs.get('limit', ['5'])[0] or 5)
                    limit = max(1, min(limit, 50))

                    # ===== 对话完成率 MVP：按会话聚合 task_stats（成功数/总数）=====
                    # 前端据此在历史面板每条对话上显示 ✅/⚠️/❌ 完成率徽标
                    try:
                        # 只统计 task_complete 写入的有效任务；旧版每次模型请求留下的空 task_title 记录不参与完成率。
                        cur.execute("SELECT session_id, COUNT(*) AS total, SUM(success) AS done FROM task_stats WHERE COALESCE(task_title, '') <> '' GROUP BY session_id")
                        _task_stats_map = {}
                        for _r in cur.fetchall():
                            _task_stats_map[_r['session_id']] = {'task_done': int(_r['done'] or 0), 'task_total': int(_r['total'] or 0)}
                    except Exception:
                        _task_stats_map = {}

                    # 仅读取元信息列（不 SELECT content，避免读取超大文本）
                    meta_sql = '''
                        SELECT session_id, session_name, model_id, created_at, LENGTH(content) AS content_len
                        FROM (
                            SELECT ch.session_id, COALESCE(s.name, ch.session_id) AS session_name,
                                   ch.model_id, ch.created_at, ch.content
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE ch.role = 'user'
                            UNION ALL
                            SELECT session_id, COALESCE(session_name, session_id) AS session_name,
                                   model_id, created_at, content
                            FROM chat_history_archive
                            WHERE role = 'user'
                        ) all_history
                    '''

                    if req_day:
                        # ---- 按天分页：返回某一天[offset, offset+limit)的对话 + 内容摘要 ----
                        # day 形如 2024-05-01（本地时区）
                        try:
                            day_start = int(time.mktime(time.strptime(req_day, '%Y-%m-%d'))) * 1000
                        except ValueError:
                            day_start = None
                        if day_start is None:
                            result = {'ok': False, 'error': 'day 参数格式应为 YYYY-MM-DD'}
                        else:
                            day_end = day_start + 24 * 60 * 60 * 1000
                            full_sql = '''
                                SELECT session_id, session_name, model_id, created_at,
                                       SUBSTR(content, 1, 200) AS content
                                FROM (
                                    SELECT ch.session_id, COALESCE(s.name, ch.session_id) AS session_name,
                                           ch.model_id, ch.created_at, ch.content
                                    FROM chat_history ch
                                    LEFT JOIN sessions s ON s.id = ch.session_id
                                    WHERE ch.role = 'user'
                                    UNION ALL
                                    SELECT session_id, COALESCE(session_name, session_id) AS session_name,
                                           model_id, created_at, content
                                    FROM chat_history_archive
                                    WHERE role = 'user'
                                ) all_history
                            '''
                            # 逐条消息返回（保留 model_id + 内容前缀），供“历史加载更多”和大模型面板统计使用。
                            # total = 当天 user 消息总条数，offset/limit 按 message 分页。
                            cur.execute('SELECT COUNT(*) AS c FROM (' + full_sql + ' WHERE created_at >= ? AND created_at < ?)', (day_start, day_end))
                            total = int(cur.fetchone()['c'] or 0)
                            cur.execute(full_sql + ' WHERE created_at >= ? AND created_at < ? ORDER BY created_at ASC LIMIT ? OFFSET ?', (day_start, day_end, limit, offset))
                            rows = cur.fetchall()
                            data = []
                            for r in rows:
                                d = dict(r)
                                d['content'] = (d.get('content') or '')[:200]
                                # 对话完成率徽标数据
                                _ts = _task_stats_map.get(d['session_id'])
                                if _ts:
                                    d['task_total'] = _ts['task_total']
                                    d['task_done'] = _ts['task_done']
                                    d['task_rate'] = int(round(_ts['task_done'] / _ts['task_total'] * 100)) if _ts['task_total'] else 0
                                data.append(d)
                            result = {'ok': True, 'data': data, 'total': total, 'offset': offset, 'limit': limit}
                    else:
                        # ---- 默认：按天统计 + 每天前 N 个会话（一个会话=一个对话）----
                        # 先把全部 user 记录按会话归组，再按会话最后活跃时间落到对应“天”
                        cur.execute(meta_sql + ' ORDER BY created_at ASC')
                        rows = cur.fetchall()
                        # 按会话归组
                        sess_map = {}
                        for r in rows:
                            sid = r['session_id']
                            if sid not in sess_map:
                                sess_map[sid] = {'session_id': sid, 'session_name': r['session_name'] or sid,
                                                 'content': '', 'firstTs': r['created_at'] or 0, 'lastTs': r['created_at'] or 0}
                            else:
                                if (r['created_at'] or 0) > sess_map[sid]['lastTs']:
                                    sess_map[sid]['lastTs'] = r['created_at'] or 0
                        session_list = list(sess_map.values())
                        # 本地时区按“最后活跃时间”分组
                        day_groups = {}
                        for s in session_list:
                            day_str = time.strftime('%Y-%m-%d', time.localtime((s['lastTs'] or 0) / 1000))
                            if day_str not in day_groups:
                                day_groups[day_str] = []
                            day_groups[day_str].append(s)
                        days = []
                        initial_per_day = int(qs.get('initial', ['5'])[0] or 5)
                        initial_per_day = max(1, min(initial_per_day, 50))
                        for day_str in sorted(day_groups.keys(), reverse=True):
                            group = sorted(day_groups[day_str], key=lambda s: s['lastTs'], reverse=True)
                            day_start_ms = int(time.mktime(time.strptime(day_str, '%Y-%m-%d'))) * 1000
                            # 给每天前 N 个会话补上内容前缀（供前端直接显示）
                            head_records = []
                            for s in group[:initial_per_day]:
                                d = dict(s)
                                d['created_at'] = s['lastTs']
                                d['content'] = self._chat_history_content_prefix(cur, d['session_id'], s['firstTs']) or s['content']
                                # 对话完成率徽标数据
                                _ts = _task_stats_map.get(d['session_id'])
                                if _ts:
                                    d['task_total'] = _ts['task_total']
                                    d['task_done'] = _ts['task_done']
                                    d['task_rate'] = int(round(_ts['task_done'] / _ts['task_total'] * 100)) if _ts['task_total'] else 0
                                head_records.append(d)
                            days.append({
                                'day': day_str,
                                'total': len(group),            # 当天会话总数
                                'records': head_records,        # 当天前 N 个会话（含内容前缀）
                                'dayStart': day_start_ms,
                            })
                        result = {'ok': True, 'data': {'days': days, 'initialPerDay': initial_per_day}, 'total': sum(d['total'] for d in days)}

                elif resource == 'chat-history' and len(parts) > 1 and parts[1] == 'prefix':
                    # 单条历史内容前缀（供旧版兼容 / 调试）
                    sid = parse_qs(parsed.query).get('session_id', [''])[0]
                    ts = parse_qs(parsed.query).get('created_at', ['0'])[0]
                    prefix = self._chat_history_content_prefix(cur, sid, int(ts or 0))
                    result = {'ok': True, 'data': prefix}

                elif resource == 'sessions':
                    cur.execute('SELECT * FROM sessions ORDER BY created_at DESC')
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'projects':
                    cur.execute('SELECT * FROM projects ORDER BY created_at DESC')
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'chat' and len(parts) > 1:
                    sid = parts[1]
                    # 历史面板点击标题展开时拉取某会话的完整消息。
                    # 注意：已归档的对话（如 cb1/cb10 等）记录在 chat_history_archive 表中，
                    # 若只查 chat_history 会返回空，导致历史面板点击标题“不展开其他问题”。
                    # 因此这里合并两张表：先查当前表，再补归档表（两者用 created_at 归并排序）。
                    rows = []
                    cur.execute('SELECT * FROM chat_history WHERE session_id=? ORDER BY created_at', (sid,))
                    rows += [dict(r) for r in cur.fetchall()]
                    try:
                        cur.execute('SELECT * FROM chat_history_archive WHERE session_id=? ORDER BY created_at', (sid,))
                        rows += [dict(r) for r in cur.fetchall()]
                    except Exception:
                        pass
                    # 按 created_at 稳定归并排序（当前表优先，避免顺序抖动）
                    rows.sort(key=lambda r: r.get('created_at') or 0)
                    result = {'ok': True, 'data': rows}

                elif resource == 'data' and len(parts) > 1:
                    category = parts[1]
                    if len(parts) > 2:
                        key = parts[2]
                        cur.execute('SELECT value FROM app_data WHERE category=? AND key=?', (category, key))
                        row = cur.fetchone()
                        result = {'ok': True, 'data': row['value'] if row else None}
                    else:
                        cur.execute('SELECT * FROM app_data WHERE category=?', (category,))
                        result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'logs':
                    limit = 200
                    qs = parse_qs(parsed.query)
                    if 'limit' in qs:
                        limit = min(int(qs['limit'][0]), 2000)
                    cur.execute('SELECT * FROM app_logs ORDER BY ts DESC LIMIT ?', (limit,))
                    result = {'ok': True, 'data': [dict(r) for r in cur.fetchall()]}

                elif resource == 'stats':
                    # ===== 鐢ㄦ埛淇℃伅鍒楄〃闈㈡澘锛氭寜浼氳瘽鍒嗙粍鐨勯棶棰樼骇鎴愯触鏁版嵁 =====
                    qs = parse_qs(parsed.query)
                    if qs.get('view', [''])[0] == 'userlist':
                        # 鏁版嵁婧愶細sessions + chat_history锛堢敤鎴烽棶棰橈級+ task_stats锛堟垚鍔熶笌鍚︼級
                        today_start = int(time.mktime(time.strptime(time.strftime('%Y-%m-%d', time.localtime()), '%Y-%m-%d')) * 1000)

                        # 1) 姣忎釜浼氳瘽鐨勭敤鎴烽棶棰樺強鏃堕棿
                        cur.execute('SELECT session_id, content, created_at FROM chat_history WHERE role=? ORDER BY created_at ASC', ('user',))
                        user_msgs = cur.fetchall()

                        # 2) 浠诲姟鎴愯触璁板綍锛坰ession_id, task_title, success锛?
                        cur.execute('SELECT session_id, task_title, success, created_at FROM task_stats ORDER BY created_at ASC')
                        stats_rows = cur.fetchall()

                        # 鎸?session 鍒嗙粍
                        sess_map = {}
                        for r in user_msgs:
                            sid = r['session_id']
                            if sid not in sess_map:
                                sess_map[sid] = {'sid': sid, 'questions': [], 'firstTs': r['created_at'], 'lastTs': r['created_at']}
                            q = {'ts': r['created_at'], 'text': (r['content'] or '')[:120], 'ok': None}
                            sess_map[sid]['questions'].append(q)
                        for r in stats_rows:
                            sid = r['session_id']
                            if sid in sess_map:
                                # 鍖归厤闂鏂囨湰鏈€杩戠殑 user 娑堟伅锛堝湪 stats 璁板綍涔嬪墠銆佷笖鏂囨湰鍚?task_title 鎴栨渶鎺ヨ繎鏃堕棿锛?
                                matched = False
                                t_title = (r['task_title'] or '').strip()
                                if t_title:
                                    for q in sess_map[sid]['questions']:
                                        if q['ts'] <= (r['created_at'] or 0) and (q['text'] and t_title in q['text'] or q['text'] in t_title):
                                            q['ok'] = 1 if r['success'] else 0
                                            matched = True
                                            break
                                if not matched:
                                    # 鏃犱汉璁ら 鈫?璁颁负鈥滄湭鍥炵瓟闂鈥濓紙浠呰渚ф爮鏉℃暟锛?
                                    sess_map[sid]['questions'].append({'ts': r['created_at'], 'text': t_title, 'ok': (1 if r['success'] else 0), 'unclaimed': 1})
                        # lastTs 鏇存柊涓烘渶鍚庝竴鏉℃秷鎭椂闂?
                        cur.execute('SELECT session_id, MAX(created_at) AS mx FROM chat_history GROUP BY session_id')
                        for r in cur.fetchall():
                            if r['session_id'] in sess_map:
                                sess_map[r['session_id']]['lastTs'] = r['mx']

                        sessions = list(sess_map.values())
                        for s in sessions:
                            ok_n = sum(1 for q in s['questions'] if q.get('ok') == 1)
                            fa_n = sum(1 for q in s['questions'] if q.get('ok') == 0)
                            un_n = sum(1 for q in s['questions'] if q.get('unclaimed'))
                            s['okCount'] = ok_n; s['failCount'] = fa_n
                            s['qCount'] = len(s['questions'])
                        sessions.sort(key=lambda x: x['lastTs'] or 0, reverse=True)
                        result = {'ok': True, 'data': {'sessions': sessions, 'todayStart': today_start}}
                    else:
                        date_range = qs.get('range', ['all'])[0]
                        if date_range == 'today':
                            today_start = int(time.mktime(time.strptime(time.strftime('%Y-%m-%d', time.localtime()), '%Y-%m-%d')) * 1000)
                            cur.execute('SELECT * FROM task_stats WHERE created_at >= ? ORDER BY created_at DESC', (today_start,))
                        elif date_range == 'month':
                            month_start = int(time.mktime(time.strptime(time.strftime('%Y-%m-01', time.localtime()), '%Y-%m-%d')) * 1000)
                            cur.execute('SELECT * FROM task_stats WHERE created_at >= ? ORDER BY created_at DESC', (month_start,))
                        else:
                            cur.execute('SELECT * FROM task_stats ORDER BY created_at DESC LIMIT 500')
                        rows = [dict(r) for r in cur.fetchall()]
                        total_tasks = len(rows)
                        success_tasks = sum(1 for r in rows if r.get('success'))
                        total_tokens = sum(r.get('tokens_used', 0) or 0 for r in rows)
                        avg_tokens = int(total_tokens / total_tasks) if total_tasks > 0 else 0
                        daily_map = {}
                        for r in rows:
                            day_str = time.strftime('%Y-%m-%d', time.localtime(r.get('created_at', 0) / 1000))
                            if day_str not in daily_map:
                                daily_map[day_str] = {'date': day_str, 'tasks': 0, 'tokens': 0, 'success': 0}
                            daily_map[day_str]['tasks'] += 1
                            daily_map[day_str]['tokens'] += r.get('tokens_used', 0) or 0
                            if r.get('success'):
                                daily_map[day_str]['success'] += 1
                        daily = sorted(daily_map.values(), key=lambda x: x['date'])
                        result = {'ok': True, 'data': {
                            'tasks': rows,
                            'summary': {
                                'total_tasks': total_tasks,
                                'success_tasks': success_tasks,
                                'fail_tasks': total_tasks - success_tasks,
                                'total_tokens': total_tokens,
                                'avg_tokens': avg_tokens
                            },
                            'daily': daily
                        }}

                else:
                    result = None  # 404

                conn.close()
                conn = None
        except Exception as e:
            print(f'[GET /api/db] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_error(str(e), 500)
            return

        # 杩炴帴宸插叧闂紝瀹夊叏鍙戦€佸搷搴?
        if result is not None:
            self._send_json(result)
        else:
            self._send_error('Unknown GET route: ' + path, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # ===== 健康守护配置 =====
        if path == '/api/health/config':
            self._handle_health_config_post()
            return

        # ===== 大模型统一配置 =====
        if path == '/api/models/config':
            self._handle_models_config_post()
            return

        # ===== API 代理（解决 CORS）=====
        if path == '/api/proxy':
            self._handle_proxy()
            return

        # ===== 真实流式代理：透传上游 SSE 到浏览器（逐块 flush）=====
        if path == '/api/proxy_stream':
            self._handle_proxy_stream()
            return

        # ===== 基础工具：读取 / 写入 / 运行 =====
        if path.startswith('/api/tools/'):
            self._handle_tools_post(path)
            return

        # ===== 免费生图（暂未开放，保留 image_gen 模块供后续恢复）=====
        if path == '/api/image-gen':
            try:
                body = self._read_body()
                action = body.get('action', 'generate')
                # 视觉模型联动：统一走 tool 注册表的 image_gen 后端（支持 models.json 中的 imageGen 模型）
                if action == 'status':
                    from tool import get_handler
                    from tool.coding.backend.base import ToolContext
                    _mod = get_handler('image_gen')
                    _status = {}
                    class _StatusCap(ToolContext):
                        def send_json(self, obj, *a, **kw):
                            _status.update(obj or {})
                    _mod.handle({'action': 'status'}, _StatusCap(self))
                    self._send_json({'ok': True, 'data': {'channels': [], 'providers': _status.get('providers', {}), 'total_today': 0, 'hint': '视觉模型与免费渠道已接入'}})
                    return
                elif action in ('set_key', 'clear_key'):
                    self._send_json({'ok': False, 'data': {'error': '请通过模型配置管理视觉模型密钥'}})
                    return
                else:
                    prompt = str(body.get('prompt', '') or '').strip()
                    if action == 'edit':
                        source_prompt = str(body.get('source_prompt', '') or '').strip()
                        instruction = str(body.get('instruction', '') or prompt).strip()
                        source_image = str(body.get('source_image', '') or '').strip()
                        prompt = (source_prompt + '\n修改要求：' + instruction).strip() if source_prompt else instruction
                    if not prompt:
                        self._send_json({'ok': False, 'data': {'error': '请输入图片描述或修改要求'}}, 400)
                        return
                    from tool import get_handler
                    from tool.coding.backend.base import ToolContext as _TC
                    _mod = get_handler('image_gen')
                    _captured = {}
                    class _CtxCap(_TC):
                        def send_json(self, obj, *a, **kw):
                            _captured.update(obj or {})
                    _mod.handle({'action': 'generate', 'prompt': prompt,
                                 'size': body.get('size', '1024x1024'),
                                 'model': body.get('model') or None,
                                 'image_url': (body.get('source_image') if action == 'edit' else None) or None}, _CtxCap(self))
                    result = _captured
                    if result.get('url'):
                        self._send_json({'ok': True, 'data': {'tool': 'image_gen', 'images': [{'url': result.get('url')}], 'url': result.get('url'), 'provider': result.get('provider'), 'model': result.get('model'), 'channel': result.get('provider'), 'channel_name': result.get('provider'), 'size': result.get('size'), 'bytes': result.get('bytes', '')}})
                    else:
                        self._send_json({'ok': False, 'data': {'error': result.get('error', '图片生成失败')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return

        # ===== 鍏嶈垂鐢熷浘锛堟殏鏈紑鏀撅紝淇濈暀 image_gen 妯″潡渚涘悗缁仮澶嶏級 =====
        if path == '/api/video-gen':
            try:
                _tool_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'tool')
                if _tool_dir not in sys.path:
                    sys.path.insert(0, _tool_dir)
                import video_gen_engine as _vgen
                body = self._read_body()
                act = body.get('action', 'generate')
                if act == 'status':
                    self._send_json({'ok': True, 'data': _vgen.video_status()})
                else:
                    r = _vgen.generate_video(
                        body.get('prompt', ''),
                        key=body.get('key', '') or '',
                        size=body.get('size', '832x480'),
                        duration=body.get('duration') or 5,
                        model=body.get('model', ''),
                        negative_prompt=body.get('negative_prompt', '') or '',
                        seed=body.get('seed'))
                    # 统一返回格式（含 videos 数组，兼容前端画布节点）
                    if r.get('ok'):
                        self._send_json({
                            'ok': True,
                            'data': {
                                'tool': 'video_gen',
                                'videos': (r.get('videos') or ([{'url': r.get('url'), 'provider': r.get('provider', ''), 'task_id': r.get('task_id', '')}] if r.get('url') else [])),

                                'model': r.get('model'),
                                'duration': r.get('duration'),
                                'provider': r.get('provider')
                            }
                        })
                    else:
                        self._send_json({'ok': False, 'data': {'error': r.get('error', '\u89c6\u9891\u751f\u6210\u5931\u8d25'),
                                                                  'provider': r.get('provider')}})
            except Exception as e:
                self._send_json({'ok': False, 'data': {'error': str(e)}})
            return


        # ===== 璁颁綇鐢ㄦ埛鏈€鍚庝娇鐢ㄧ殑澶фā鍨嬶紙鍓嶇姣忔鍙戞秷鎭椂涓婃姤锛?====
        if path == '/api/chat/report-model':
            self._handle_report_last_model()
            return
        if path == '/api/chat/last-model':
            self._handle_report_last_model()
            return

        # ===== Conversation loop mode config (POST write) =====
        if path == '/api/loop-mode-config':
            self._handle_loop_mode_config_post()
            return

        # ===== Chat mode restriction rules (POST write, private/chat_mode_rules.json) =====
        if path == '/api/chat-mode-rules':
            self._handle_chat_mode_rules_post()
            return

        # ===== Tool result exit limits (POST write, private/tool_result_limits.json) =====
        if path == '/api/tool-result-limits':
            self._handle_tool_result_limits_post()
            return

        # ===== 用户设置（POST 写，private/用户设置/user_settings.json） =====
        if path == '/api/user-settings':
            self._handle_user_settings_post()
            return

        # ===== 用户习惯（POST 写，private/用户设置/user_preferences.json） =====
        if path == '/api/user-preferences':
            self._handle_user_preferences_post()
            return

        if path == '/api/hot-reload/reload':
            self._handle_hot_reload_manual()
            return

        # ===== 关联本地文件夹到项目 =====
        if path == '/api/project/link-folder':
            self._handle_link_folder()
            return

        # ===== 生成项目记忆 =====
        if path == '/api/project/memory/generate':
            self._handle_generate_project_memory()
            return

        # ===== 备份管理 =====
        if path == '/api/backup/create':
            self._handle_backup_create()
            return
        if path == '/api/backup/restore':
            self._handle_backup_restore()
            return

        if not path.startswith('/api/db/'):
            self._send_error('Unknown path: ' + path, 404)
            return

        parts = path[len('/api/db/'):].split('/')
        resource = parts[0] if parts else ''

        result = None
        conn = None
        try:
            body = self._read_body()
            now = int(__import__('time').time() * 1000)

            with _db_lock:
                conn = get_db()
                cur = conn.cursor()

                if resource == 'nodes' and len(parts) > 2 and parts[2] == 'project':
                    # POST /nodes/{id}/project 鈥?璁剧疆鑺傜偣鐨勯」鐩綊灞?
                    node_id = parts[1]
                    proj_id = body.get('projectId', None)
                    cur.execute('UPDATE canvas_nodes SET project_id=?, updated_at=? WHERE id=?', (proj_id, now, node_id))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'nodes':
                    node_id = body.get('id', 'n' + str(now))
                    cur.execute('''
                        INSERT OR REPLACE INTO canvas_nodes
                        (id, title, model_id, x, y, w, h, collapsed, z_index, scroll_pos, project_id, created_at, updated_at,
                         session_total_tokens, session_total_api_calls, session_total_duration,
                         session_total_prompt_tokens, session_total_completion_tokens,
                         session_total_cache_hit_tokens, session_total_cache_miss_tokens,
                         model_id_override, reasoning_effort)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                                ?, ?, ?, ?, ?, ?, ?,
                                ?, ?)
                    ''', (
                        node_id, body.get('title', ''), body.get('modelId', ''),
                        body.get('x', 0), body.get('y', 0),
                        body.get('w', 320), body.get('h', 420),
                        1 if body.get('collapsed') else 0,
                        body.get('z', 50),
                        body.get('scrollPos', 0),
                        body.get('projectId', None),
                        body.get('createdAt', now), now,
                        body.get('sessionTotalTokens', 0), body.get('sessionTotalApiCalls', 0),
                        body.get('sessionTotalDuration', 0), body.get('sessionTotalPromptTokens', 0),
                        body.get('sessionTotalCompletionTokens', 0),
                        body.get('sessionTotalCacheHitTokens', 0), body.get('sessionTotalCacheMissTokens', 0),
                        body.get('modelIdOverride', '') or '', body.get('reasoningEffort', '') or ''
                    ))
                    conn.commit()
                    result = {'ok': True, 'id': node_id}

                elif resource == 'canvas' and len(parts) > 1 and parts[1] == 'view':
                    cur.execute('''
                        UPDATE canvas_view SET x=?, y=?, scale=?, updated_at=? WHERE id=1
                    ''', (body.get('x', 0), body.get('y', 0), body.get('scale', 1), now))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'kv':
                    key = body.get('key', '')
                    value = json.dumps(body.get('value'), ensure_ascii=False)
                    cur.execute('''
                        INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
                    ''', (key, value, now))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'chat-history' and len(parts) > 1 and parts[1] == 'sessions':
                    # Existing installations may predate the archive table.
                    cur.execute('''
                        CREATE TABLE IF NOT EXISTS chat_history_archive (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            session_id TEXT NOT NULL,
                            session_name TEXT,
                            role TEXT,
                            content TEXT,
                            model_id TEXT,
                            created_at INTEGER
                        )
                    ''')
                    cur.execute("PRAGMA table_info(chat_history_archive)")
                    archive_columns = {row['name'] for row in cur.fetchall()}
                    if 'model_id' not in archive_columns:
                        cur.execute('ALTER TABLE chat_history_archive ADD COLUMN model_id TEXT')
                    cur.execute('''
                        SELECT session_id, session_name, role, content, model_id, created_at
                        FROM (
                            SELECT ch.session_id, COALESCE(s.name, ch.session_id) AS session_name,
                                   ch.role, ch.content, ch.model_id, ch.created_at
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE ch.role = 'user'
                            UNION ALL
                            SELECT session_id, COALESCE(session_name, session_id) AS session_name,
                                   role, content, model_id, created_at
                            FROM chat_history_archive
                            WHERE role = 'user'
                        ) all_history
                        ORDER BY created_at DESC
                    ''')
                    result = {'ok': True, 'data': [dict(row) for row in cur.fetchall()]}

                elif resource == 'sessions':
                    sid = body.get('id', 's' + str(now))
                    cur.execute('''
                        INSERT OR REPLACE INTO sessions (id, name, created_at, updated_at)
                        VALUES (?, ?, ?, ?)
                    ''', (sid, body.get('name', ''), now, now))
                    conn.commit()
                    result = {'ok': True, 'id': sid}

                elif resource == 'projects' and len(parts) > 1:
                    # POST /projects/{id} 鈥?閲嶅懡鍚?
                    proj_id = parts[1]
                    new_name = body.get('name', '')
                    cur.execute('UPDATE projects SET name=?, updated_at=? WHERE id=?', (new_name, now, proj_id))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'projects':
                    proj_id = body.get('id', 'proj_' + str(now))
                    proj_name = body.get('name', '新项目')
                    cur.execute('''
                        INSERT OR REPLACE INTO projects (id, name, created_at, updated_at)
                        VALUES (?, ?, ?, ?)
                    ''', (proj_id, proj_name, now, now))
                    conn.commit()
                    result = {'ok': True, 'id': proj_id}

                elif resource == 'chat' and len(parts) > 1:
                    sid = parts[1]
                    parent_id = body.get('parentId', None)
                    # 支持客户端传入原始时间戳 ts（恢复已关闭对话时保留原时间，避免伪重复归档）
                    msg_ts = body.get('ts')
                    try:
                        if msg_ts is not None and int(msg_ts) > 0:
                            msg_ts = int(msg_ts)
                        else:
                            msg_ts = now
                    except (TypeError, ValueError):
                        msg_ts = now
                    cur.execute('''
                        INSERT INTO chat_history (session_id, role, content, model_id, created_at, parent_id)
                        VALUES (?, ?, ?, ?, ?, ?)
                    ''', (sid, body.get('role', 'user'), body.get('content', ''), body.get('modelId', ''), msg_ts, parent_id))
                    conn.commit()
                    result = {'ok': True, 'id': cur.lastrowid}

                elif resource == 'data' and len(parts) > 1:
                    category = parts[1]
                    key = body.get('key', '')
                    value = json.dumps(body.get('value'), ensure_ascii=False)
                    cur.execute('''
                        INSERT OR REPLACE INTO app_data (category, key, value, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (category, key, value, now, now))
                    conn.commit()
                    result = {'ok': True}

                elif resource == 'app_data':
                    # POST /api/db/app_data - 鏀寔 action: delete (app-zf3d.js 閫€鍑虹櫥褰曟椂璋冪敤)
                    action = body.get('action', '')
                    filt = body.get('filter', {})
                    cat = filt.get('category', '')
                    if action == 'delete' and cat:
                        cur.execute('DELETE FROM app_data WHERE category=?', (cat,))
                        conn.commit()
                        result = {'ok': True, 'deleted': cur.rowcount}
                    elif action == 'delete' and len(parts) > 1:
                        cat = parts[1]
                        cur.execute('DELETE FROM app_data WHERE category=?', (cat,))
                        conn.commit()
                        result = {'ok': True, 'deleted': cur.rowcount}
                    else:
                        result = None  # 404

                elif resource == 'logs':
                    cur.execute('''
                        INSERT INTO app_logs (ts, level, box_id, action, detail)
                        VALUES (?, ?, ?, ?, ?)
                    ''', (now, body.get('level', 'info'), body.get('boxId', ''),
                          body.get('action', ''), body.get('detail', '')))
                    conn.commit()
                    result = {'ok': True, 'id': cur.lastrowid}

                elif resource == 'stats':
                    cur.execute('''
                        INSERT INTO task_stats (session_id, model_id, task_title, success, tokens_used, duration_ms, depth, api_calls, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        body.get('sessionId', ''),
                        body.get('modelId', ''),
                        body.get('taskTitle', ''),
                        1 if body.get('success') else 0,
                        body.get('tokensUsed', 0) or 0,
                        body.get('durationMs', 0) or 0,
                        body.get('depth', 0) or 0,
                        body.get('apiCalls', 0) or 0,
                        now
                    ))
                    conn.commit()
                    result = {'ok': True, 'id': cur.lastrowid}

                else:
                    result = None  # 404

                conn.close()
                conn = None
        except Exception as e:
            print(f'[POST /api/db] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_error(str(e), 500)
            return

        # 杩炴帴宸插叧闂紝瀹夊叏鍙戦€佸搷搴?
        if result is not None:
            self._send_json(result)
        else:
            self._send_error('Unknown POST route: ' + path, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # ===== 备份管理：删除快照 =====
        if path.startswith('/api/backup/delete/'):
            backup_name = path[len('/api/backup/delete/'):]
            self._handle_backup_delete(backup_name)
            return

        # ===== 鐩戞帶闃熷垪鍒犻櫎锛堟爣璁板凡澶勭悊锛?=====
        if path.startswith('/api/monitor/poll/'):
            chat_id = parse_qs(parsed.query).get('chat_id', [''])[0]
            if not chat_id:
                self._send_json({'ok': False, 'error': 'missing chat_id'}, 400)
                return
            key = path[len('/api/monitor/poll/'):]
            conn = None
            try:
                with _db_lock:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute(
                        "DELETE FROM app_data WHERE category='monitor_queue' AND key=? "
                        "AND json_extract(value, '$.chat_id')=?",
                        (key, chat_id)
                    )
                    conn.commit()
                    deleted = cur.rowcount
                    conn.close()
                    conn = None
                self._send_json({'ok': True, 'deleted': deleted})
            except Exception as e:
                if conn:
                    try: conn.close()
                    except: pass
                self._send_error(str(e), 500)
            return

        if not path.startswith('/api/db/'):
            self._send_error('Unknown path: ' + path, 404)
            return

        parts = path[len('/api/db/'):].split('/')
        resource = parts[0] if parts else ''

        result = None
        conn = None
        try:
            with _db_lock:
                conn = get_db()
                cur = conn.cursor()

                if resource == 'nodes' and len(parts) > 1:
                    node_id = parts[1]
                    cur.execute('DELETE FROM canvas_nodes WHERE id=?', (node_id,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'stats':
                    cur.execute('DELETE FROM task_stats')
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'kv' and len(parts) > 1:
                    key = parts[1]
                    cur.execute('DELETE FROM kv_store WHERE key=?', (key,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'sessions' and len(parts) > 1:
                    sid = parts[1]
                    cur.execute('''CREATE TABLE IF NOT EXISTS chat_history_archive (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, session_name TEXT, role TEXT, content TEXT, model_id TEXT, created_at INTEGER)''')
                    # 归档时防重：跳过 archive 中已存在的完全相同行(session_id+role+content+created_at)
                    cur.execute('''
                        INSERT INTO chat_history_archive (session_id, session_name, role, content, model_id, created_at)
                        SELECT ch.session_id, COALESCE(s.name, ch.session_id), ch.role, ch.content, ch.model_id, ch.created_at
                        FROM chat_history ch LEFT JOIN sessions s ON s.id = ch.session_id
                        WHERE ch.session_id=? AND NOT EXISTS (
                            SELECT 1 FROM chat_history_archive a
                            WHERE a.session_id = ch.session_id AND a.role = ch.role
                              AND a.content = ch.content AND a.created_at = ch.created_at
                        )
                    ''', (sid,))
                    # 与 DELETE /chat/{sid} 保持一致：归档后删除原数据，避免重复归档
                    cur.execute('DELETE FROM chat_history WHERE session_id=?', (sid,))
                    cur.execute('DELETE FROM sessions WHERE id=?', (sid,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'projects' and len(parts) > 1:
                    proj_id = parts[1]
                    # 鍒犻櫎椤圭洰鏃讹紝娓呴櫎鑺傜偣鐨?project_id锛堜笉鍒犻櫎鑺傜偣鏈韩锛?
                    cur.execute('UPDATE canvas_nodes SET project_id=NULL WHERE project_id=?', (proj_id,))
                    cur.execute('DELETE FROM projects WHERE id=?', (proj_id,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'chat':
                    # --- 鍘嗗彶闈㈡澘 v2锛氬垹闄ゅ崟涓細璇?/ 娓呯┖鍏ㄩ儴瀵硅瘽鍘嗗彶 ---
                    # 鏃ф暟鎹簱鍙兘宸插瓨鍦ㄥ綊妗ｈ〃浣嗙己灏?model_id锛屼笅闈細琛ラ綈瀛楁銆?
                    cur.execute('''CREATE TABLE IF NOT EXISTS chat_history_archive (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL,
                        session_name TEXT,
                        role TEXT,
                        content TEXT,
                        model_id TEXT,
                            created_at INTEGER
                    )''')
                    # 褰掓。鍐欏叆鍙娇鐢ㄥ熀纭€瀛楁锛屽吋瀹规棭鏈熸病鏈?model_id 鐨勬棫琛ㄣ€?
                    if len(parts) > 1:
                        sid = parts[1]
                        # 褰掓。璇ヤ細璇?
                        cur.execute('''
                            INSERT INTO chat_history_archive
                                (session_id, session_name, role, content, model_id, created_at)
                            SELECT ch.session_id, COALESCE(s.name, ch.session_id),
                                   ch.role, ch.content, ch.model_id, ch.created_at
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE ch.session_id=? AND NOT EXISTS (
                                SELECT 1 FROM chat_history_archive a
                                WHERE a.session_id = ch.session_id AND a.role = ch.role
                                  AND a.content = ch.content AND a.created_at = ch.created_at
                            )
                        ''', (sid,))
                        archived = cur.rowcount
                        # 鐪熸鍒犻櫎璇ヤ細璇濈殑 chat_history锛堜慨澶嶅師鏉ュ彧褰掓。涓嶅垹闄ょ殑 bug锛?
                        cur.execute('DELETE FROM chat_history WHERE session_id=?', (sid,))
                        deleted_rows = cur.rowcount
                        try:
                            cur.execute('DELETE FROM sessions WHERE id=?', (sid,))
                        except Exception:
                            pass
                        conn.commit()
                        result = {'ok': True, 'deleted': deleted_rows, 'archived_rows': archived, 'cleared': sid}
                    else:
                        # 娓呯┖鍏ㄩ儴锛氬厛鍏ㄩ儴褰掓。锛屽啀娓呯┖ chat_history
                        cur.execute('''
                            INSERT INTO chat_history_archive
                                (session_id, session_name, role, content, model_id, created_at)
                            SELECT ch.session_id, COALESCE(s.name, ch.session_id),
                                   ch.role, ch.content, ch.model_id, ch.created_at
                            FROM chat_history ch
                            LEFT JOIN sessions s ON s.id = ch.session_id
                            WHERE NOT EXISTS (
                                SELECT 1 FROM chat_history_archive a
                                WHERE a.session_id = ch.session_id AND a.role = ch.role
                                  AND a.content = ch.content AND a.created_at = ch.created_at
                            )
                        ''')
                        archived = cur.rowcount
                        cur.execute('DELETE FROM chat_history')
                        deleted_rows = cur.rowcount
                        try:
                            cur.execute('DELETE FROM sessions')
                        except Exception:
                            pass
                        conn.commit()
                        result = {'ok': True, 'deleted': deleted_rows, 'archived_rows': archived, 'cleared': 'all'}

                elif resource == 'data' and len(parts) > 1:
                    category = parts[1]
                    if len(parts) > 2:
                        key = parts[2]
                        cur.execute('DELETE FROM app_data WHERE category=? AND key=?', (category, key))
                    else:
                        cur.execute('DELETE FROM app_data WHERE category=?', (category,))
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'chat-history' and len(parts) > 1 and parts[1] == 'archive':
                    cur.execute('DELETE FROM chat_history_archive')
                    conn.commit()
                    result = {'ok': True, 'deleted': cur.rowcount}

                elif resource == 'chat-history' and len(parts) > 1:
                    try:
                        row_id = int(parts[1])
                    except ValueError:
                        result = {'ok': False, 'error': 'invalid id'}
                    else:
                        cur.execute('DELETE FROM chat_history_archive WHERE id=?', (row_id,))
                        conn.commit()
                        result = {'ok': True, 'deleted': cur.rowcount}

                else:
                    result = None  # 404

                conn.close()
                conn = None
        except Exception as e:
            print(f'[DELETE /api/db] 500 閿欒: {e}')
            traceback.print_exc()
            if conn:
                try: conn.close()
                except: pass
            self._send_error(str(e), 500)
            return

        # 杩炴帴宸插叧闂紝瀹夊叏鍙戦€佸搷搴?
        if result is not None:
            self._send_json(result)
        else:
            self._send_error('Unknown DELETE route: ' + path, 404)


    # ===== 鐑洿鏂?SSE 鍜?API 澶勭悊 =====

    def _handle_hot_reload_sse(self):
        """GET /api/hot-reload/sse - stream hot reload events."""
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if not hr:
            self._send_error('hot reload engine not started', 503)
            return

        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('X-Accel-Buffering', 'no')
        self.end_headers()

        # 娉ㄥ唽涓?SSE 瀹㈡埛绔?
        hr.add_sse_client(self.wfile)

        # 蹇冭烦闂撮殧鍙厤锛堥粯璁?10s锛岄伩寮€甯歌鍙嶄唬鐨?30s 绌洪棽鍒囨柇 + 娴忚鍣ㄤ唬鐞?60s 鍒囨柇锛?
        try:
            from config import SSE_HEARTBEAT_SEC
            _hb = max(2.0, min(float(SSE_HEARTBEAT_SEC), 25.0))
        except Exception:
            _hb = 10.0

        import time as _time
        import socket as _sock
        import select as _sel
        _sock_errs = (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError, ValueError)
        try:
            while True:
                # 鐢ㄧ煭杞 + select 鍚屾椂鎵挎媴銆屽績璺冲彂閫併€?銆屾娴嬪鎴风鏂紑銆?
                # 涓嶅啀鐢?_time.sleep(15) 閭ｇ銆屽啓澶辫触鎵嶇煡閬撴柇浜嗐€嶇殑琚姩绛栫暐
                try:
                    _r, _, _ = _sel.select([self.connection], [], [], _hb)
                except _sock_errs:
                    break
                except Exception:
                    # select 澶辫触鏃堕€€鍖栦负 sleep 鍏滃簳
                    _time.sleep(_hb)
                    _r = []

                # 娌℃湁鍙浜嬩欢 = 鍒颁簡蹇冭烦鏃堕棿
                if not _r:
                    try:
                        self.wfile.write(b': heartbeat\n\n')
                        self.wfile.flush()
                    except _sock_errs:
                        break
                    except Exception as e:
                        print(f'[SSE] 蹇冭烦鍐欏叆寮傚父: {e}', flush=True)
                        traceback.print_exc()
                        # 鍗曟澶辫触涓嶉€€鍑猴紝淇濇寔杩炴帴锛堥伩鍏?reload 鏃跺伓鍙戞姈鍔ㄨ鎵€鏈夌獥鍙ｇ绾匡級
                        continue
        except _sock_errs:
            pass
        except Exception as e:
            print(f'[SSE] 涓诲惊鐜紓甯? {e}', flush=True)
            traceback.print_exc()
        finally:
            try:
                hr.remove_sse_client(self.wfile)
            except Exception:
                pass

    def _handle_hot_reload_status(self):
        """Return hot-reload engine status."""
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if not hr:
            self._send_json({'ok': False, 'error': 'hot reload engine not started'})
            return
        self._send_json({'ok': True, 'status': hr.get_status()})

    def _handle_hot_reload_manual(self):
        """Manually reload a hot-reload module."""
        from hot_reload import get_hot_reloader
        hr = get_hot_reloader()
        if not hr:
            self._send_json({'ok': False, 'error': 'hot reload engine not started'})
            return
        try:
            body = self._read_body()
            module_name = body.get('module', None)
            result = hr.manual_reload(module_name)
            self._send_json(result)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})

    # ============================================================
    # 通用存根（工具系统已剥离，仅保留 200 占位以兼容旧前端）
    # ============================================================
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
        # zf3d 项目已剥离，返回空状态以兼容前端
        self._send_json({'ok': True, 'enabled': False, 'exists': False, 'status': 'disabled', 'message': 'zf3d module removed'})

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
        cfg = load_models_config() or {}
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
                      '只输出提示词本身（中文），不要解释、不要引号、不要多余前缀，控制在200字以内。')
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

    def _get_backup_dir(self):
        return os.path.join(BASE_DIR, 'backups')

    @staticmethod
    def _format_backup_size(n):
        if n == 0:
            return '0 B'
        units = ['B', 'KB', 'MB', 'GB']
        i = 0
        while n >= 1024 and i < len(units) - 1:
            n /= 1024
            i += 1
        return '%.1f %s' % (n, units[i])

    def _handle_backup_list(self):
        """GET /api/backup/list - 列出所有备份"""
        backup_dir = self._get_backup_dir()
        backups = []
        try:
            if os.path.isdir(backup_dir):
                for fname in os.listdir(backup_dir):
                    fpath = os.path.join(backup_dir, fname)
                    if not os.path.isfile(fpath):
                        continue
                    if fname.endswith('.zip'):
                        btype = 'snapshot'
                    elif fname.endswith('.db'):
                        btype = 'database'
                    else:
                        continue
                    stat = os.stat(fpath)
                    backups.append({
                        'filename': fname,
                        'size': stat.st_size,
                        'size_human': self._format_backup_size(stat.st_size),
                        'display_time': time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stat.st_mtime)),
                        'mtime': stat.st_mtime,
                        'type': btype,
                    })
            backups.sort(key=lambda b: b['mtime'], reverse=True)
            for b in backups:
                del b['mtime']
            self._send_json({'ok': True, 'backups': backups})
        except Exception as e:
            print('[GET /api/backup/list] 500: %s' % e)
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_backup_open_folder(self):
        """GET /api/backup/open-folder - 在文件管理器中打开备份目录"""
        backup_dir = self._get_backup_dir()
        os.makedirs(backup_dir, exist_ok=True)
        try:
            if sys.platform == 'win32':
                os.startfile(backup_dir)
            elif sys.platform == 'darwin':
                subprocess.Popen(['open', backup_dir])
            else:
                subprocess.Popen(['xdg-open', backup_dir])
            self._send_json({'ok': True})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})

    def _backup_collect_files(self):
        """遍历项目目录，返回 (fpath, arcname) 列表，排除备份目录等"""
        result = []
        for root, dirs, files in os.walk(BASE_DIR):
            dirs[:] = [d for d in dirs if d not in self._BACKUP_EXCLUDE_DIRS]
            for fname in files:
                ext = os.path.splitext(fname)[1].lower()
                if ext in self._BACKUP_EXCLUDE_EXTS:
                    continue
                # 排除各种 .bak 文件（.bak, .bak.0, .bak2 等）
                if '.bak' in fname.lower():
                    continue
                fpath = os.path.join(root, fname)
                arcname = os.path.relpath(fpath, BASE_DIR)
                result.append((fpath, arcname))
        return result

    def _handle_backup_create(self):
        """POST /api/backup/create - 创建项目快照（zip）"""
        backup_dir = self._get_backup_dir()
        os.makedirs(backup_dir, exist_ok=True)

        timestamp = time.strftime('%Y%m%d_%H%M%S')
        filename = 'snapshot_%s.zip' % timestamp
        filepath = os.path.join(backup_dir, filename)
        counter = 1
        while os.path.exists(filepath):
            filename = 'snapshot_%s_%d.zip' % (timestamp, counter)
            filepath = os.path.join(backup_dir, filename)
            counter += 1

        try:
            import zipfile
            file_count = 0
            with zipfile.ZipFile(filepath, 'w', zipfile.ZIP_DEFLATED) as zf:
                for fpath, arcname in self._backup_collect_files():
                    try:
                        zf.write(fpath, arcname)
                        file_count += 1
                    except Exception:
                        pass
            stat = os.stat(filepath)
            self._send_json({
                'ok': True,
                'filename': filename,
                'size_human': self._format_backup_size(stat.st_size),
                'file_count': file_count,
            })
        except Exception as e:
            print('[POST /api/backup/create] 500: %s' % e)
            traceback.print_exc()
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception:
                    pass
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_backup_restore(self):
        """POST /api/backup/restore - 从快照恢复项目"""
        try:
            body = self._read_body()
        except Exception:
            body = {}
        filename = str(body.get('filename', '')).strip()
        if not filename:
            self._send_json({'ok': False, 'error': '缺少 filename 参数'})
            return

        if '..' in filename or '/' in filename or '\\' in filename:
            self._send_json({'ok': False, 'error': '无效的文件名'})
            return

        backup_dir = self._get_backup_dir()
        src_path = os.path.join(backup_dir, filename)
        if not os.path.isfile(src_path):
            self._send_json({'ok': False, 'error': '快照文件不存在: ' + filename})
            return

        # Step 1: 创建恢复前快照
        timestamp = time.strftime('%Y%m%d_%H%M%S')
        pre_filename = 'snapshot_prerestore_%s.zip' % timestamp
        pre_filepath = os.path.join(backup_dir, pre_filename)
        counter = 1
        while os.path.exists(pre_filepath):
            pre_filename = 'snapshot_prerestore_%s_%d.zip' % (timestamp, counter)
            pre_filepath = os.path.join(backup_dir, pre_filename)
            counter += 1

        try:
            import zipfile

            with zipfile.ZipFile(pre_filepath, 'w', zipfile.ZIP_DEFLATED) as zf:
                for fpath, arcname in self._backup_collect_files():
                    try:
                        zf.write(fpath, arcname)
                    except Exception:
                        pass

            # Step 2: 解压快照到项目目录
            with zipfile.ZipFile(src_path, 'r') as zf:
                for member in zf.namelist():
                    member_path = os.path.normpath(member)
                    # 安全：阻止路径穿越
                    if member_path.startswith('..') or os.path.isabs(member_path):
                        continue
                    # 不恢复到 backups 目录
                    if member_path.startswith('backups') or member_path.startswith(os.sep + 'backups'):
                        continue
                    target = os.path.abspath(os.path.join(BASE_DIR, member_path))
                    if not target.startswith(os.path.abspath(BASE_DIR)):
                        continue
                    zf.extract(member, BASE_DIR)

            self._send_json({
                'ok': True,
                'message': '项目已从快照恢复，请刷新页面',
                'pre_restore_backup': pre_filename,
            })
        except Exception as e:
            print('[POST /api/backup/restore] 500: %s' % e)
            traceback.print_exc()
            self._send_json({'ok': False, 'error': str(e)})

    def _handle_backup_delete(self, filename):
        """DELETE /api/backup/delete/{filename} - 删除备份文件"""
        if '..' in filename or '/' in filename or '\\' in filename:
            self._send_json({'ok': False, 'error': '无效的文件名'})
            return

        backup_dir = self._get_backup_dir()
        filepath = os.path.join(backup_dir, filename)
        if not os.path.isfile(filepath):
            self._send_json({'ok': False, 'error': '文件不存在: ' + filename})
            return
        try:
            os.remove(filepath)
            self._send_json({'ok': True})
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)})

