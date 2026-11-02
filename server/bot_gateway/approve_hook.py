#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bot_gateway/approve_hook.py - 审批推手机（P2 第二块）。

当 sys_input 等 dangerous 级工具被 syscall enforce 拦截时，把审批请求推到
已配置的 IM（Telegram / QQ / 微信公众号通道任选其一），用户在手机上回复
「同意 工具名」（或 approve 工具名）即完成 syscall.approve，1 小时内免重复拦截。

配置（data/bot_tokens.json 追加字段，均默认关，不配则纯本地审批）：
  "approve_push": {
      "channel": "telegram",        # telegram / qq
      "chat_id": 123456789,          # TG: 目标 chat；QQ: 群号或好友QQ号
      "user_id": 123456789,          # QQ 私聊时用 user_id；群聊留空
      "group": false                 # QQ true=群聊发送
  }

安全设计：
- 回复指令仅在 dispatcher.handle 白名单通过后处理，且需精确匹配「同意/批准/approve + 工具名」
- 推送防抖：同一工具 10 分钟内只推一次，防刷屏
- 任何异常静默失败，绝不影响主流程（对齐 syscall.py 设计原则）
- 零第三方依赖，单文件自包含
"""
import json
import os
import time
import threading

_SRV = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG_PATH = os.path.join(_SRV, "data", "bot_tokens.json")

_LOCK = threading.Lock()
_LAST_PUSH = {}          # tool -> ts，防抖
_PUSH_DEDUP = 600        # 同工具 10 分钟只推一次


def _cfg():
    try:
        with open(CFG_PATH, "r", encoding="utf-8") as f:
            return (json.load(f).get("approve_push") or {})
    except Exception:
        return {}


# ---------------------------------------------------------------- 解析用户回复

def parse_approve_reply(text):
    """解析手机回复文本，命中返回工具名，否则 None。
    支持：同意 xxx / 批准 xxx / approve xxx / 拒绝 xxx（返回 ('', False) 形式不在此处理）。"""
    t = str(text or '').strip()
    for prefix in ('同意 ', '批准 ', 'approve '):
        if t.startswith(prefix):
            tool = t[len(prefix):].strip()
            return tool or None
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
        with _LOCK:
            if now - _LAST_PUSH.get(str(tool), 0) < _PUSH_DEDUP:
                return False                      # 防抖：10 分钟内不重复推
            _LAST_PUSH[str(tool)] = now
        text = ('🔔 [智能体审批] 工具 %s 请求执行（dangerous 级）\n'
                '原因: %s\n'
                '回复「同意 %s」批准（1小时内免重复确认），回复其他内容忽略。'
                % (tool, str(reason)[:160], tool))
        if cfg['channel'] == 'telegram':
            return _push_telegram(cfg, text)
        if cfg['channel'] == 'qq':
            return _push_qq(cfg, text)
        return False
    except Exception as e:
        print('[approve_hook] 推送失败（不影响主流程）: %s' % e)
        return False
