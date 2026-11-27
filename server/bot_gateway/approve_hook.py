#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bot_gateway/approve_hook.py - 审批推手机（P2 第二块）。

当 sys_input 等 dangerous 级工具被 syscall enforce 拦截时，把审批请求推到
已配置的 IM（Telegram / QQ / 微信公众号通道任选其一），用户在手机上回复
「同意 工具名 审批码」（或 approve 工具名 审批码，码见推送消息）即完成
syscall.approve，1 小时内免重复拦截。

配置（data/bot_tokens.json 追加字段，均默认关，不配则纯本地审批）：
  "approve_push": {
      "channel": "telegram",        # telegram / qq
      "chat_id": 123456789,          # TG: 目标 chat；QQ: 群号或好友QQ号
      "user_id": 123456789,          # QQ 私聊时用 user_id；群聊留空
      "group": false                 # QQ true=群聊发送
  }

安全设计：
- 回复指令仅在 dispatcher.handle 白名单通过后处理，且必须同时匹配「工具名 + 审批码」，
  审批码为推送时下发的随机短码（模块级登记，TTL 10 分钟，一次性），无未决审批单一律拒绝
- 推送防抖：同一工具 10 分钟内只推一次，防刷屏
- 任何异常静默失败，绝不影响主流程（对齐 syscall.py 设计原则）
- 零第三方依赖，单文件自包含
"""
import hmac
import json
import os
import secrets
import time
import threading

from util_log import get_logger

log = get_logger('approve_hook')
_SRV = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG_PATH = os.path.join(_SRV, "data", "bot_tokens.json")

_LOCK = threading.Lock()
_LAST_PUSH = {}          # tool -> ts，防抖
_PUSH_DEDUP = 600        # 同工具 10 分钟只推一次

# [安全] 未决审批单：tool -> {'ts': float, 'code': 'XXXXXX'}，由 notify_pending 推送侧登记；
# parse_approve_reply 批准前必须与之对账（工具名 + 审批码），TTL 10 分钟，批准即失效
_PENDING = {}
_PENDING_TTL = 600       # 审批码有效期 10 分钟
_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'   # 去易混字符（I/O/0/1）


def _cfg():
    try:
        with open(CFG_PATH, "r", encoding="utf-8") as f:
            return (json.load(f).get("approve_push") or {})
    except Exception:
        return {}


# ---------------------------------------------------------------- 解析用户回复

def _gc_pending_locked():
    """清理过期未决审批单（调用方需持 _LOCK）。"""
    now = time.time()
    for k in list(_PENDING.keys()):
        if now - float(_PENDING[k].get('ts') or 0) > _PENDING_TTL:
            del _PENDING[k]


def parse_approve_reply(text):
    """解析手机回复文本。仅当存在**未决审批单**且「工具名 + 审批码」均匹配时
    返回工具名，否则 None（fail-closed）。
    支持：同意 工具名 审批码 / 批准 工具名 审批码 / approve tool CODE。
    缺码、错码、过期、无审批单均拒绝；批准后审批单立即失效（一次性，防重放）。"""
    parts = str(text or '').strip().split()
    if len(parts) >= 2 and parts[0] in ('同意', '批准', 'approve'):
        tool = parts[1]
        code = (parts[2] if len(parts) >= 3 else '').strip().upper()
        with _LOCK:
            _gc_pending_locked()
            ent = _PENDING.get(tool)
            if not ent or not code:
                return None                # 无未决审批单或未附审批码 → 拒绝
            if not hmac.compare_digest(code.encode('utf-8'),
                                       str(ent['code']).encode('utf-8')):
                return None                # 审批码不匹配 → 拒绝
            del _PENDING[tool]             # 一次性：消费审批单，防重放
            return tool
    return None


# ---------------------------------------------------------------- 推送

def _push_telegram(cfg, text):
    import urllib.request
    token = ((json.load(open(CFG_PATH, encoding='utf-8')).get('telegram') or {}).get('token') or '')
    if not token:
        return False
    api = 'https://api.telegram.org/bot%s/%s' % (token, 'sendMessage')
    req = urllib.request.Request(api, data=json.dumps(
        {'chat_id': cfg.get('chat_id'), 'text': text}).encode('utf-8'),
        headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status == 200


def _push_qq(cfg, text):
    from bot_gateway.qq_adapter import _post_json
    api_base = ((json.load(open(CFG_PATH, encoding='utf-8')).get('qq') or {}).get('api_base') or '')
    if not api_base:
        return False
    token = ((json.load(open(CFG_PATH, encoding='utf-8')).get('qq') or {}).get('access_token') or '')
    payload = {'message': text, 'auto_escape': False}
    if cfg.get('group'):
        payload['group_id'] = int(cfg['chat_id'])
        url = api_base + '/send_group_msg'
    else:
        payload['user_id'] = int(cfg.get('user_id') or cfg.get('chat_id'))
        url = api_base + '/send_private_msg'
    _post_json(url, payload, token)
    return True


def notify_pending(tool, reason=''):
    """dangerous 工具被拦截时推送审批请求到手机。任何失败静默。"""
    try:
        cfg = _cfg()
        if not cfg or not cfg.get('channel'):
            return False
        now = time.time()
        code = ''.join(secrets.choice(_CODE_ALPHABET) for _ in range(6))
        with _LOCK:
            if now - _LAST_PUSH.get(str(tool), 0) < _PUSH_DEDUP:
                return False                  # 防抖：10 分钟内不重复推（原审批码仍有效）
            _LAST_PUSH[str(tool)] = now
            # [安全] 推送侧登记未决审批单：批准回复必须携带此随机短码（TTL 10 分钟）
            _gc_pending_locked()
            _PENDING[str(tool)] = {'ts': now, 'code': code}
        text = ('🔔 [智能体审批] 工具 %s 请求执行（dangerous 级）\n'
                '原因: %s\n'
                '回复「同意 %s %s」批准（审批码10分钟内有效，批准后1小时内免重复确认），'
                '回复其他内容忽略。'
                % (tool, str(reason)[:160], tool, code))
        if cfg['channel'] == 'telegram':
            return _push_telegram(cfg, text)
        if cfg['channel'] == 'qq':
            return _push_qq(cfg, text)
        return False
    except Exception as e:
        log.error('[approve_hook] 推送失败（不影响主流程）: %s' % e)
        return False
