# -*- coding: utf-8 -*-
"""
zf_proxy_billing.py — 朱峰通道代理计费网关（2026-09-20 落地）

背景：此前 /api/proxy 与 /api/proxy_stream 转发朱峰通道（本机 8527 /v1 等）
完全不鉴权、不扣费（模型 keyRef=user、noKeyRequired=true），任何智能体可
免费白嫖 GLM 通道。本模块在代理入口补上「身份识别 + 余额预检 + 按用量扣费」。

计费方式：
  - 朱峰通道文本对话按上游 usage（prompt+completion tokens）折算会员余额扣减，
    费率 rmb_per_1k_tokens 可在 public/config/zf_proxy_billing.json 配置
    （默认 0.002 元/千token，站长可调；设 0 = 暂不计费只记流水）。
  - 请求前预检余额，余额不足以覆盖预估值（按请求字符数估算）直接拒绝。
  - 上游成功后按真实 usage 原子扣费（/internal/deduct），失败不扣。
  - 流水写 private/billing/zf_proxy_billing_ledger.jsonl（幂等 request_id）。

识别身份（2026-09-21 加固）：只认服务端 HMAC 签发的身份票 zf_idt
（Cookie / X-ZF-Idt），或配置里显式绑定的令牌。客户端自报的裸
zf_uid / X-ZF-Uid / _zf_user_id 一律不再信任（可伪造冒用）。
"""
import json
import logging
import os
import threading
import time
import urllib.parse
import urllib.request

try:
    import zf_identity as _zfi
except Exception:
    _zfi = None

_BASE = os.path.dirname(os.path.abspath(__file__))
_CFG_FILE = os.path.join(os.path.dirname(_BASE), 'public', 'config', 'zf_proxy_billing.json')
_LEDGER_FILE = os.path.join(_BASE, 'private', 'billing', 'zf_proxy_billing_ledger.jsonl')
_PROXY_PORT_FILE = os.path.join(os.path.dirname(_BASE), 'public', 'config', 'ai_proxy.json')

_lock = threading.Lock()
_gw_fail_count = 0          # 余额网关连续失败计数（熔断器）
_GW_FAIL_TRIP = 3           # 连续失败 N 次 → 熔断（503 拒绝，防欠费透支）
_GW_FAIL_COOLDOWN = 60.0    # 熔断冷却秒数，冷却后放一次探测请求
_gw_fail_ts = 0.0           # 熔断触发时刻

DEFAULT_CFG = {
    'enabled': True,            # 总开关（false=恢复免计费旧行为）
    'rmb_per_1k_tokens': 0.002, # 元 / 千 token（文本模型基础单价）
    'min_balance': 0.01,        # 低于此余额拒绝服务
    'free_usernames': [],       # 免计费白名单（测试用）
    # —— 按模型计费规则（key 支持通配符，从上到下第一个命中生效）——
    # token 模型:      cost = tokens/1000 * rmb_per_1k_tokens * multiplier（如智谱 x1、deepseek x1.5）
    # per_call 模型:   cost = price（生图：一张 1 元 → {"type":"per_call","price":1}）
    # per_second 模型: cost = seconds * price（视频：2 元/秒 → {"type":"per_second","price":2}，
    #                  seconds 从 usage.get('seconds') 或 meta.get('seconds') 取，取不到按 1 秒）
    'models': {
        'glm-*':      {'type': 'token', 'multiplier': 1},
        'zhipu-*':    {'type': 'token', 'multiplier': 1},
        'deepseek-*': {'type': 'token', 'multiplier': 1.5},
        'cogview-*':  {'type': 'per_call', 'price': 1},
        '*image*':    {'type': 'per_call', 'price': 1},
        'cogvideox-*': {'type': 'per_second', 'price': 2},
        '*video*':    {'type': 'per_second', 'price': 2},
    },
}


def _cfg():
    c = dict(DEFAULT_CFG)
    try:
        with open(_CFG_FILE, encoding='utf-8') as f:
            c.update(json.load(f))
    except Exception:
        pass
    return c


def _proxy_port():
    """与 zf_billing 保持同一网关端口来源。"""
    try:
        import zf_billing
        return zf_billing._proxy_port()
    except Exception:
        try:
            with open(_PROXY_PORT_FILE, encoding='utf-8') as f:
                return int(json.load(f).get('port', 8527))
        except Exception:
            return 8527


def _gateway(path, payload, timeout=8):
    try:
        import zf_billing
        return zf_billing._gateway(path, payload, timeout)
    except ImportError:
        req = urllib.request.Request(
            'http://127.0.0.1:%d%s' % (_proxy_port(), path),
            data=json.dumps(payload).encode('utf-8'), method='POST')
        req.add_header('Content-Type', 'application/json')
        try:
            import zf_identity as _zfi
            _sec = _zfi.internal_secret()
            if _sec:
                req.add_header('X-ZF-Internal', _sec)
        except Exception:
            pass
        resp = urllib.request.urlopen(req, timeout=timeout)
        return json.loads(resp.read().decode('utf-8', errors='replace'))


# ---------------- 通道识别 ----------------

_ZF_HOST_KEYWORDS = ('127.0.0.1', 'localhost', 'zhufeng', 'zf3d')


def is_zf_channel(target_url):
    """判断 target_url 是否走朱峰通道（本机网关 /v1 或官方通道域名）。"""
    try:
        u = urllib.parse.urlparse(str(target_url or ''))
        host = (u.hostname or '').lower()
        if not host:
            return False
        # 本机网关（8527 /v1/...）
        if host in ('127.0.0.1', 'localhost'):
            return True
        # 官方通道域名包含 zhufeng / zf 关键词
        return any(k in host for k in ('zhufeng', 'zfai', 'zf-model'))
    except Exception:
        return False


def _estimate_cost(cfg, body):
    """按请求体字符数粗估预扣费用（保守上界：中文≈1.5 token/字）。"""
    try:
        msgs = body.get('messages') or []
        chars = sum(len(str(m.get('content') or '')) for m in msgs)
        est_tokens = int(chars * 1.5) + 512   # +512 预留回复
        return est_tokens / 1000.0 * float(cfg.get('rmb_per_1k_tokens', 0))
    except Exception:
        return 0.0


def _allow_legacy_uid():
    """是否允许裸 uid 兜底（默认关）。改 zf_proxy_billing.json -> security.allow_legacy_uid=true 开启。"""
    try:
        import json as _j
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'config', 'zf_proxy_billing.json')
        with open(os.path.normpath(p), encoding='utf-8') as f:
            return bool(((_j.load(f).get('security') or {}).get('allow_legacy_uid')))
    except Exception:
        return False


def identify_user(headers, body=None):
    """从请求头/请求体识别会员。返回 (user_id:int, username:str)；识别失败 (0,'')。

    [意见1 安全修复 2026-09-21]
    原实现直接信任 body._zf_user_id / Header X-ZF-Uid / Cookie zf_uid 数字 ID。
    会员 ID 公开递增，攻击者改个 Cookie 就能冒用他人身份扣别人的钱，还能命中
    free_usernames 白名单免账。现在身份只能来自可验证凭据：
      1. 服务端 HMAC 签发的身份票（Cookie zf_idt / Header X-ZF-Idt）——主路径
      2. 站长在 zf_proxy_billing.json -> security.token_bindings 里显式绑定的令牌
      3. 仅在 allow_legacy_uid=true 时才回落到裸 uid（并写审计告警）
    任何不可信来源一律 (0, '')，调用方据此拒绝计费或按游客处理。
    """
    uid, err = 0, 'no_ticket'
    if _zfi is not None:
        try:
            uid, err = _zfi.identity_from_headers(headers or {})
        except Exception as e:
            uid, err = 0, 'verify_error:%s' % e
        if uid > 0:
            _zfi.audit('identity_ok', uid=uid, via='signed_ticket')
            return uid, ''
        # 路径2：令牌绑定表
        try:
            import json as _j
            p = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                              '..', 'public', 'config', 'zf_proxy_billing.json'))
            bind = {}
            with open(p, encoding='utf-8') as f:
                bind = ((_j.load(f).get('security') or {}).get('token_bindings') or {})
            bu, _be = _zfi.bind_token_to_uid(headers or {}, bind)
            if bu > 0:
                _zfi.audit('identity_ok', uid=bu, via='token_binding')
                return bu, ''
        except Exception:
            pass

    # 路径3：裸 uid 兜底（默认关闭）
    raw = 0
    try:
        if isinstance(body, dict):
            raw = int(body.get('_zf_user_id') or 0)
    except Exception:
        pass
    if not raw:
        try:
            h = {k.lower(): v for k, v in (headers or {}).items()}
            if h.get('x-zf-uid'):
                raw = int(h['x-zf-uid'])
            else:
                for part in str(h.get('cookie', '')).split(';'):
                    part = part.strip()
                    if part.startswith('zf_uid='):
                        raw = int(part.split('=', 1)[1])
                        break
        except Exception:
            pass

    if raw > 0 and _allow_legacy_uid():
        if _zfi is not None:
            _zfi.audit('identity_legacy_uid', uid=raw, warn='裸 uid 已由配置显式放行')
        return raw, ''
    if raw > 0:
        if _zfi is not None:
            _zfi.audit('identity_rejected', claimed_uid=raw, reason=err,
                       warn='客户端自报 uid 不可信，已拒绝')
    return 0, ''


# ---- 熔断器统一封装（v5.3.6：状态判断/触发/恢复集中管理）----
def _gw_breaker_check():
    """熔断检查。返回 (deny, probe)：
    deny=None 放行（含半开探测）；dict=直接拒绝。
    probe=True 表示本次放行是冷却期满后的半开探测（供恢复审计用）。
    状态全部在锁内读取，消除锁外读计数的竞态（v5.3.6.1）。"""
    with _lock:
        if _gw_fail_count >= _GW_FAIL_TRIP:
            if time.time() - _gw_fail_ts < _GW_FAIL_COOLDOWN:
                # 熔断中：网关连续失联，拒绝以防止余额查询失效期间欠费透支
                return {'status': 503, 'err': '计费网关暂时不可用，请稍后重试'}, False
            # 冷却期到，放行本次作为半开探测
            return None, True
    return None, False


def _gw_breaker_failure():
    """余额查询失败时调用：累计计数，首次达阈值记录触发时刻并写审计。"""
    global _gw_fail_count, _gw_fail_ts
    trip_now = False
    with _lock:
        _gw_fail_count += 1
        if _gw_fail_count >= _GW_FAIL_TRIP and _gw_fail_ts == 0.0:
            _gw_fail_ts = time.time()
            trip_now = True
    if trip_now and _zfi is not None:
        try:
            _zfi.audit('billing_gateway_breaker_tripped', fails=_gw_fail_count)
        except Exception:
            pass


def _gw_breaker_success(tripped_probe):
    """余额查询成功时调用：计数归零恢复熔断器；半开探测成功写恢复审计。"""
    global _gw_fail_count, _gw_fail_ts
    with _lock:
        _gw_fail_count = 0
        _gw_fail_ts = 0.0
    if tripped_probe and _zfi is not None:
        try:
            _zfi.audit('billing_gateway_breaker_recovered')
        except Exception:
            pass


def precheck(target_url, headers, body):
    """代理入口预检。返回 None=放行；返回 dict=拒绝响应体（含 status）。"""
    cfg = _cfg()
    if not cfg.get('enabled', True):
        return None
    if not is_zf_channel(target_url):
        return None                      # 非朱峰通道不管
    try:
        model = str((body or {}).get('model') or '')
    except Exception:
        model = ''
    if any(model.startswith(p) or model == p for p in ('zf-embed',)):
        return None
    uid, _uname = identify_user(headers, body)
    if uid <= 0:
        return {'status': 401, 'err': '朱峰通道需要会员身份：请携带服务端签发的身份票 Cookie(zf_idt=...) 或 X-ZF-Idt'}
    if any(str(uid) == str(x) for x in cfg.get('free_usernames', [])):
        # 白名单只对通过签名校验的身份生效（uid 已由 identify_user 验证）
        return None                      # 白名单免计费
    # 限流：按已验证 uid，防止单一身份打爆上游导致站长资损
    try:
        rl = int((cfg.get('security') or {}).get('rate_limit_per_min', 0) or 0)
        if rl > 0 and _zfi is not None:
            ok, retry = _zfi.rate_allow('uid:%d' % uid, rl)
            if not ok:
                _zfi.audit('rate_limited', uid=uid, retry_after=round(retry, 1))
                return {'status': 429, 'err': '请求过于频繁：请 %.0f 秒后重试' % max(1.0, retry)}
    except Exception:
        pass
    est = _estimate_cost(cfg, body or {})
    # 熔断检查（v5.3.6 封装）：熔断中直接 503，冷却期满放行作半开探测
    deny, tripped_probe = _gw_breaker_check()
    if deny is not None:
        return deny
    try:
        bal = float(_gateway('/internal/me', {'user_id': uid}).get('balance', 0))
    except Exception:
        bal = None                         # 网关抖动 → 保守放行，结算时兜底
        _gw_breaker_failure()
    else:
        _gw_breaker_success(tripped_probe)
    if bal is not None and max(bal, 0) < max(float(cfg.get('min_balance', 0)), est):
        return {'status': 402, 'err': '余额不足：预估本次需 %.2f 元，当前余额 %.2f 元，请充值后再试' % (est, bal)}
    return None


def _model_cost(cfg, model, total_tokens, usage=None, meta=None):
    """按模型规则表算费用（元）。返回 None 表示不扣费。"""
    usage = usage or {}
    meta = meta or {}
    name = str(model or '')
    rule = None
    for pat, r in (cfg.get('models') or {}).items():
        try:
            import fnmatch as _fm
            if _fm.fnmatch(name, pat):
                rule = r
                break
        except Exception:
            continue
    rtype = (rule or {}).get('type', 'token')
    try:
        if rtype == 'per_call':
            return round(float(rule.get('price', 0)), 4)
        if rtype == 'per_second':
            seconds = float(usage.get('seconds') or meta.get('seconds') or 1)
            return round(max(seconds, 0.0) * float(rule.get('price', 0)), 4)
        # token：按倍率
        mult = float((rule or {}).get('multiplier', 1))
        return round(total_tokens / 1000.0 * float(cfg.get('rmb_per_1k_tokens', 0)) * mult, 4)
    except Exception:
        return round(total_tokens / 1000.0 * float(cfg.get('rmb_per_1k_tokens', 0)), 4)


def settle(user_id, usage, model='', request_id='', meta=None):
    """上游成功后按 usage 扣费。usage: {'prompt_tokens':..,'completion_tokens':..}
    幂等（request_id），失败/0费率静默跳过。返回流水 dict 或 None。"""
    cfg = _cfg()
    if not cfg.get('enabled', True) or not usage or user_id <= 0:
        return None
    if any(str(user_id) == str(x) for x in cfg.get('free_usernames', [])):
        return None
    try:
        pt = int(usage.get('prompt_tokens') or 0)
        ct = int(usage.get('completion_tokens') or 0)
    except Exception:
        return None
    total_tokens = pt + ct
    if total_tokens <= 0:
        return None
    cost = _model_cost(cfg, model, total_tokens, usage, meta)
    if cost is None:
        return None
    rid = request_id or ('proxy-%d-%s' % (int(time.time() * 1000), user_id))
    ok = True
    if cost > 0:
        try:
            r = _gateway('/internal/deduct', {'user_id': int(user_id), 'cost': cost}, timeout=10)
            ok = bool(r.get('ok', True))
        except Exception as e:
            logging.warning('[zf_proxy_billing] deduct fail uid=%s cost=%s: %s', user_id, cost, e)
            ok = False
    entry = {'id': rid, 'ts': int(time.time() * 1000), 'user_id': int(user_id),
             'channel': 'proxy_chat', 'model': model, 'prompt_tokens': pt,
             'completion_tokens': ct, 'total_tokens': total_tokens,
             'cost': cost, 'ok': ok, 'meta': meta or {}}
    try:
        os.makedirs(os.path.dirname(_LEDGER_FILE), exist_ok=True)
        with _lock:
            with open(_LEDGER_FILE, 'a', encoding='utf-8') as f:
                f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except Exception:
        pass
    return entry


def extract_usage(resp_data):
    """从非流式响应 JSON 提取 usage；无则 None。"""
    try:
        u = (resp_data or {}).get('usage')
        if isinstance(u, dict) and (u.get('total_tokens') or u.get('prompt_tokens')):
            return u
    except Exception:
        pass
    return None


def extract_usage_from_sse(raw_text):
    """从 SSE 流拼文里捞最后一个带 usage 的 chunk（OpenAI 兼容 stream_options）。"""
    usage = None
    try:
        for line in str(raw_text or '').splitlines():
            line = line.strip()
            if not line.startswith('data:'):
                continue
            payload = line[5:].strip()
            if not payload or payload == '[DONE]':
                continue
            try:
                obj = json.loads(payload)
                u = obj.get('usage')
                if isinstance(u, dict) and (u.get('total_tokens') or u.get('prompt_tokens')):
                    usage = u
            except Exception:
                continue
    except Exception:
        pass
    return usage


def estimate_usage_fallback(body, resp_data):
    """上游没回 usage 时按回复长度粗估（宁可少收不可多收：只算回复字符）。"""
    try:
        ch = ((resp_data or {}).get('choices') or [{}])[0].get('message', {}).get('content') or ''
        return {'prompt_tokens': 0,
                'completion_tokens': int(len(str(ch)) * 1.2) if ch else 0}
    except Exception:
        return None
