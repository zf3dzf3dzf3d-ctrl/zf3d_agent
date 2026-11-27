# -*- coding: utf-8 -*-
"""
tool_audit_hook.py - 工具调用审计钩子（策划案 v2.1 / P1）
落盘 server/logs/tool_audit-YYYYMM.jsonl，append-only，按月轮转，失败静默。
定位：防误清（不提供任何删除/清空接口）；摘要级记录，不含完整参数与结果。
被两处调用：
  1) handler_base._handle_tools_post   -> source='http'   （前端模式2全链路）
  2) engines/common/agent_loop.py      -> source='engine' （Python 引擎链路）
"""
import os
import json
import time
import threading

_LOCK = threading.Lock()
_LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'logs')
_MAX_LOG_BYTES = 32 * 1024 * 1024  # 单文件上限：超过即改名归档（只改名不删除，保持"防误清"承诺）

# 摘要级参数黑名单关键词：命中则整段参数替换为占位（防密钥外泄）
_SECRET_KEYS = ('password', 'token', 'secret', 'apikey', 'api_key', 'key', 'authorization')


def _sanitize_args(args_str):
    """参数摘要：截断 + 黑名单整段降级。"""
    try:
        s = str(args_str or '')
        low = s.lower()
        for kw in _SECRET_KEYS:
            if kw in low:
                return '<redacted>'
        return s[:300]
    except Exception:
        return '<unavailable>'


def audit_tool_call(source, tool_name, args_summary='', result_ok=True, result_summary='',
                    box_id='', turn=None, extra=None):
    """写一条审计记录。任何异常静默吞掉，绝不影响主链路。"""
    try:
        rec = {
            'ts': time.strftime('%Y-%m-%d %H:%M:%S'),
            'ts_ms': int(time.time() * 1000),
            'source': str(source or '?'),        # http | engine
            'tool': str(tool_name or '?'),
            'args': _sanitize_args(args_summary),
            'ok': bool(result_ok),
            'result': str(result_summary or '')[:200],
            'box_id': str(box_id or ''),
            'turn': turn,
        }
        if extra:
            rec['extra'] = extra
        line = json.dumps(rec, ensure_ascii=False) + '\n'
        os.makedirs(_LOG_DIR, exist_ok=True)
        fname = os.path.join(_LOG_DIR, 'tool_audit-%s.jsonl' % time.strftime('%Y%m'))
        with _LOCK:                      # 按月轮转：文件名含当月，换月自动切新文件
            # 单月过大归档（20261123）：tool_audit-YYYYMM-HHMMSS.jsonl，只改名不删数据。
            # 实测单月可涨到 65MB+，归档后当月文件从头计。
            try:
                if os.path.getsize(fname) > _MAX_LOG_BYTES:
                    os.replace(fname, fname[:-6] + '-' + time.strftime('%H%M%S') + '.jsonl')
            except OSError:
                pass
            with open(fname, 'a', encoding='utf-8') as f:
                f.write(line)
    except Exception:
        pass  # 失败静默：审计绝不能拖垮主链路
