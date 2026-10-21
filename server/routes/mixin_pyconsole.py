# -*- coding: utf-8 -*-
"""Mixin: 内部 Python 工作台（指挥台第 2 个 tab 的后端）。

路由：POST /api/pyconsole/exec | GET /api/pyconsole/history
安全：仅接受 127.0.0.1 本机请求；30s 超时；输出截断 64KB；
     环境变量 ZF_PYCONSOLE=off 可整体禁用。
回显：run_code 钩子（dispatch_swarm_seg1）会把智能体后台执行的命令
     写入环形缓冲 pyconsole_history，工作台可读（只读回显，可看可输入）。
"""
import os
import json
import threading
import time
import subprocess
from collections import deque
from routes._shared import *
from routes.mixin_base import MixinBase

_PYCONSOLE_TIMEOUT = 30          # 秒
_PYCONSOLE_MAX_OUT = 64 * 1024   # 输出截断
_pyconsole_enabled = None        # None=未求值
_pyconsole_token = None          # 一次性 exec token（缺失会致 _pyconsole_token_state NameError）

# 环形回显缓冲（智能体 run_code 钩子 + 用户工作台共用）
_pyconsole_history = deque(maxlen=100)
_pyconsole_hist_lock = threading.Lock()


def pyconsole_push(kind, code, output, exit_code=None):
    """run_code 钩子调用：只读回显一条记录。try/except 全包，绝不影响主流程。"""
    try:
        with _pyconsole_hist_lock:
            _pyconsole_history.append({
                'ts': time.strftime('%H:%M:%S'),
                'kind': kind,       # 'agent' | 'user'
                'code': str(code)[:2000],
                'output': str(output or '')[:4000],
                'exit': exit_code,
            })
    except Exception:
        pass


def pyconsole_history_snapshot(limit=50):
    with _pyconsole_hist_lock:
        return list(_pyconsole_history)[-limit:]


def _pyconsole_gate():
    """总开关 ZF_PYCONSOLE（进程内调用无 IP 概念，只查开关）。"""
    global _pyconsole_enabled
    if _pyconsole_enabled is None:
        _pyconsole_enabled = os.environ.get('ZF_PYCONSOLE', 'on').lower() != 'off'
    if not _pyconsole_enabled:
        return False, 'pyconsole 已禁用（设置环境变量 ZF_PYCONSOLE=on 可开启）'
    return True, ''


def pyconsole_exec_direct(code, cwd=None, kind='agent'):
    """供模型工具（console.exec）直接调用的执行通道：
    与 HTTP handler 同一套超时/截断/回显逻辑，不绕 HTTP、无 token 概念（进程内天然本机）。
    返回 dict: {ok, exit, output} 或 {ok: False, error}。"""
    ok, msg = _pyconsole_gate()
    if not ok:
        return {'ok': False, 'error': msg}
    code = str(code or '').strip()
    if not code:
        return {'ok': False, 'error': '缺少 code'}
    wd = str(cwd or '').strip() or os.getcwd()
    if not os.path.isdir(wd):
        return {'ok': False, 'error': 'cwd 不存在: %s' % wd}
    try:
        r = subprocess.run(code, shell=True, capture_output=True, text=True,
                           encoding='utf-8', errors='replace',
                           timeout=_PYCONSOLE_TIMEOUT, cwd=wd,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        out = (r.stdout or '') + (r.stderr or '')
        if len(out) > _PYCONSOLE_MAX_OUT:
            out = out[:_PYCONSOLE_MAX_OUT] + '\n...(输出已截断)'
        pyconsole_push(kind, code, out, r.returncode)
        return {'ok': True, 'exit': r.returncode, 'output': out}
    except subprocess.TimeoutExpired:
        pyconsole_push(kind, code, '(超时 %ds)' % _PYCONSOLE_TIMEOUT, -1)
        return {'ok': False, 'error': '执行超时（%ds）' % _PYCONSOLE_TIMEOUT}
    except Exception as e:
        pyconsole_push(kind, code, 'error: %s' % e, -1)
        return {'ok': False, 'error': str(e)}


class MixinPyconsole(MixinBase):

    def _pyconsole_allowed(self):
        """仅本机 + 开关 + exec 一次性 token（阶段三·借鉴 DSB 报告 T4）。"""
        global _pyconsole_enabled
        if _pyconsole_enabled is None:
            _pyconsole_enabled = os.environ.get('ZF_PYCONSOLE', 'on').lower() != 'off'
        if not _pyconsole_enabled:
            return False, 'pyconsole 已禁用（设置环境变量 ZF_PYCONSOLE=on 可开启）'
        ip = self.client_address[0] if self.client_address else ''
        if ip not in ('127.0.0.1', '::1', 'localhost'):
            return False, 'pyconsole 仅限本机 127.0.0.1 调用'
        return True, ''

    @staticmethod
    def _pyconsole_token_state():
        """一次性 token：默认 warn（缺失仅告警）；ZF_PYCONSOLE_TOKEN=strict 时强制。
        token 由服务启动时生成并打印，前端工作台随请求带回 _token 字段。"""
        global _pyconsole_token
        strict = os.environ.get('ZF_PYCONSOLE_TOKEN', 'warn').lower() == 'strict'
        if not _pyconsole_token:
            _pyconsole_token = os.urandom(16).hex()
            print('[PyConsole] exec token: %s (mode=%s)' % (
                _pyconsole_token, 'strict' if strict else 'warn'))
        return _pyconsole_token, strict

    def _handle_pyconsole_exec(self):
        ok, msg = self._pyconsole_allowed()
        if not ok:
            self._send_json({'ok': False, 'error': msg}, 403)
            return
        try:
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self._cached_body(length) if length > 0 else b'{}'
            data = json.loads(raw.decode('utf-8') or '{}')
        except Exception as e:
            self._send_json({'ok': False, 'error': 'json 解析失败: %s' % e}, 400)
            return
        code = str(data.get('code') or '').strip()
        if not code:
            self._send_json({'ok': False, 'error': '缺少 code'}, 400)
            return
        wd = str(data.get('cwd') or '').strip() or os.getcwd()
        if not os.path.isdir(wd):
            self._send_json({'ok': False, 'error': 'cwd 不存在: %s' % wd}, 400)
            return
        # 一次性 token 校验（阶段三）：warn 模式缺失仅告警放行；strict 模式强制
        tok, strict = self._pyconsole_token_state()
        given = str(data.get('_token') or '').strip()
        if given != tok:
            if strict:
                self._send_json({'ok': False, 'error': 'pyconsole exec 需要有效一次性 token'}, 403)
                return
            print('[PyConsole] WARN exec without valid token (warn mode)')
        else:
            # 用后即废
            globals()['_pyconsole_token'] = None
        try:
            r = pyconsole_exec_direct(code, wd, kind='user')
            if r.get('ok'):
                self._send_json({'ok': True, 'exit': r['exit'], 'output': r['output']}, 200)
            else:
                # 区分超时/其他错误与 HTTP 层校验错误（等价迁移自原内联逻辑）
                if '超时' in str(r.get('error', '')):
                    self._send_json({'ok': False, 'error': r['error']}, 200)
                elif 'cwd 不存在' in str(r.get('error', '')):
                    self._send_json({'ok': False, 'error': r['error']}, 400)
                else:
                    self._send_json({'ok': False, 'error': r['error']}, 200)
        except Exception as e:
            self._send_json({'ok': False, 'error': str(e)}, 200)

    def _handle_pyconsole_history(self):
        ok, msg = self._pyconsole_allowed()
        if not ok:
            self._send_json({'ok': False, 'error': msg}, 403)
            return
        self._send_json({'ok': True, 'history': pyconsole_history_snapshot()}, 200)
