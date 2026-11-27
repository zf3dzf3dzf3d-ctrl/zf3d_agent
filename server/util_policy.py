# -*- coding: utf-8 -*-
"""util_policy.py - M1.1 能力策略引擎（策划案 M1.1；M3.1 包化时迁 server/zf/policy）。

解决什么问题
------------
M0 的执法设施是“硬编码的墙”（哪些事永远不许做）。M1 要的是“可配置的策略”：
同类能力（网络、写文件、剪贴板…）默认交给人审批（ask），用户可以用规则文件把某些目标
放行（allow）或加严（deny）。本模块只做**判定**，不做**执行**——各能力闸门（M1.3 接入）
调用 decide() 拿到 allow/ask/deny 后自行执行。

语义（验收口径，tests/test_policy_engine.py 逐条钉死）
------------------------------------------------------
  - deny > ask > allow：多层判定取最严；任何 allow 不能覆盖 deny，也不能放宽用户层的默认。
  - 文件内首条匹配优先（顺序即优先级，写在前面的更具体的规则先生效）。
  - 工作区规则只能收紧：工作区层没有默认值、没有豁免权，只能追加匹配规则与禁用能力——
    结构上由“与用户层取 severity-max”保证，仓库里放一份宽松规则文件不可能给自己提权。
  - 规则文件放用户目录（private/policy/rules.json）：随部署/换仓库不会重置用户的安全决策。
  - 工作区层文件缺省不存在（空层 = 不收紧）；确需创建须登记根目录白名单（见 AGENTS.md）。
  - 规则文件损坏：fail-ask（一切交人判定），并在 status()['degraded'] 如实暴露；
    M1.3 接入无人值守场景时由调用方把 ask 升级为 deny。

规则文件格式（UTF-8，无 BOM 也可）
----------------------------------
    {
      "defaults": {"*": "ask", "net": "deny"},   // 用户层默认（按能力，"*" 兜底）；工作区文件忽略此段
      "disabled": ["clipboard"],                  // 整体禁用的能力：一律 deny
      "rules": [
        {"capability": "net",   "target": "*.example.com", "action": "allow", "note": "…"},
        {"capability": "net",   "target": "*",             "action": "ask"},
        {"capability": "fs.write", "target": "private/*",  "action": "deny"}
      ]
    }
  target 用 fnmatch 通配（'*' 跨目录段）；target 缺省为 '*'；capability 缺省为 '*'（任意能力）。
  Windows 路径统一转 '/' 后匹配；比较不分大小写。

线程安全：内部 1 秒 mtime 缓存 + 锁；规则文件落盘后最迟 1 秒生效。
"""
from __future__ import annotations

import fnmatch
import json
import os
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

from util_log import get_logger

log = get_logger('util_policy')

DECISION_ALLOW = 'allow'
DECISION_ASK = 'ask'
DECISION_DENY = 'deny'

VALID_ACTIONS = (DECISION_ALLOW, DECISION_ASK, DECISION_DENY)
_SEVERITY: Dict[str, int] = {DECISION_ALLOW: 0, DECISION_ASK: 1, DECISION_DENY: 2}

# ---- M1.4 权限模式 ----
MODE_STANDARD = 'standard'   # 标准：规则生效，ask 走审批（默认）
MODE_STRICT = 'strict'       # 严格：未被规则明确 allow 的默认一律交人
MODE_FULL = 'full'           # 完全访问：ask 免票据放行；deny 规则仍然生效；1 小时自动回落
MODE_READONLY = 'readonly'   # 只读：写/执行/出域类能力一律拒绝
MODES = (MODE_STANDARD, MODE_STRICT, MODE_FULL, MODE_READONLY)

# 只读模式下拒绝的能力集合（写/执行/出域；fs.read 与 net 的拉取类属读，不在此列）
_READONLY_DENIED_CAPS = ('fs.write', 'shell', 'sys.tool', 'browser')
DEFAULT_MODE = MODE_STANDARD
FULL_AUTO_REVERT_SEC = 3600


class Decision(object):
    """一次策略判定的结果。rule 仅作诊断，不含任何用户数据。"""

    __slots__ = ('action', 'layer', 'rule', 'reason')

    def __init__(self, action: str, layer: str, rule: Optional[Dict[str, str]] = None, reason: str = '') -> None:
        self.action = action   # 'allow' | 'ask' | 'deny'
        self.layer = layer     # 'user' | 'workspace' | 'both' | 'default' | 'degraded' | 'disabled'
        self.rule = rule
        self.reason = reason

    def __repr__(self) -> str:
        return 'Decision(action=%r, layer=%r, reason=%r)' % (self.action, self.layer, self.reason)


class _Layer(object):
    """一层规则文件的内存形态。文件不存在 = 空层（合法，不收紧）。"""

    __slots__ = ('mtime', 'rules', 'disabled', 'defaults', 'load_error')

    def __init__(self) -> None:
        self.mtime: Optional[float] = None
        self.rules: List[Dict[str, str]] = []
        self.disabled: set = set()
        self.defaults: Dict[str, str] = {}
        self.load_error: Optional[str] = None


def _load_layer(path: Optional[str]) -> _Layer:
    layer = _Layer()
    if not path:
        return layer
    try:
        layer.mtime = os.path.getmtime(path)
    except OSError:
        return layer                      # 文件不存在：空层
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            raw = json.load(f)
    except (OSError, ValueError) as e:
        layer.load_error = str(e)[:200]   # json.JSONDecodeError ⊂ ValueError
        return layer
    if not isinstance(raw, dict):
        layer.load_error = '顶层须为 JSON 对象'
        return layer

    rules = raw.get('rules')
    if isinstance(rules, list):
        for r in rules:
            if not isinstance(r, dict):
                continue
            action = str(r.get('action') or '').strip().lower()
            if action not in VALID_ACTIONS:
                continue
            layer.rules.append({
                'capability': str(r.get('capability') or '*').strip(),
                'target': str(r.get('target') or '*').strip(),
                'action': action,
                'note': str(r.get('note') or '')[:120],
            })
    disabled = raw.get('disabled')
    if isinstance(disabled, list):
        layer.disabled = set(str(x).strip() for x in disabled if isinstance(x, str) and x.strip())
    defaults = raw.get('defaults')
    if isinstance(defaults, dict):
        layer.defaults = {str(k).strip(): str(v).strip() for k, v in defaults.items()
                          if str(v).strip() in VALID_ACTIONS}
    return layer


def _match(rule: Dict[str, str], capability: str, target: str) -> bool:
    rc = rule['capability']
    if rc not in ('*', capability):
        return False
    pat = rule['target']
    if pat in ('*', ''):
        return True
    t = target.replace('\\', '/')
    return (fnmatch.fnmatch(t.lower(), pat.lower())
            or fnmatch.fnmatch(t, pat)
            or fnmatch.fnmatch(t.replace('\\', '/').lower(), pat.lower()))


_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def project_rel(path: str) -> str:
    """绝对路径 → 项目根相对路径（正斜杠）；不在项目内的路径原样返回（归一化反斜杠）。

    fs 规则的 target 按项目根相对路径书写，调用方必须先用本函数归一化再判定，
    否则绝对路径形式的调用会绕过规则（M1.3 实测教训）。"""
    p = str(path or '').replace('\\', '/').strip()
    root = _REPO_ROOT.replace('\\', '/')
    pl, rl = p.lower(), root.lower()
    if pl.startswith(rl + '/'):
        return p[len(root) + 1:]
    if pl == rl:
        return '.'
    return p


def default_user_rules_path(base_dir: Optional[str] = None) -> str:
    """用户层规则文件：private/policy/rules.json（用户目录，不随仓库/部署重置）。"""
    base = base_dir
    if not base:
        try:
            from config import BASE_DIR
            base = BASE_DIR
        except ImportError:
            base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, 'private', 'policy', 'rules.json')


def default_workspace_rules_path(base_dir: Optional[str] = None) -> str:
    """工作区层规则文件（仓库自带的收紧规则）。缺省位置在根目录白名单外，
    创建前须登记 _ROOT_OK_NAMES；不存在 = 工作区层不参与。"""
    base = base_dir or (os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                        if os.path.basename(os.path.dirname(os.path.abspath(__file__))) == 'server'
                        else os.getcwd())
    return os.path.join(base, 'policy.workspace.json')


# ---- M1.4 模式存取（private/policy/mode.json；损坏回落 standard，不抛异常）----

_MODE_DEFAULTS: Dict[str, Any] = {'mode': DEFAULT_MODE, 'expires_at': None,
                                  'set_by': '', 'set_at': '', 'load_error': None}


def _mode_file_path(base_dir: Optional[str] = None) -> str:
    base = base_dir
    if not base:
        try:
            from config import BASE_DIR
            base = BASE_DIR
        except ImportError:
            base = _REPO_ROOT
    return os.path.join(base, 'private', 'policy', 'mode.json')


def _load_mode(base_dir: Optional[str] = None) -> Dict[str, Any]:
    state = dict(_MODE_DEFAULTS)
    path = _mode_file_path(base_dir)
    try:
        with open(path, 'r', encoding='utf-8-sig') as f:
            raw = json.load(f)
    except FileNotFoundError:
        return state
    except (OSError, ValueError) as e:
        state['load_error'] = str(e)[:200]
        return state
    if not isinstance(raw, dict):
        state['load_error'] = '模式文件顶层须为对象'
        return state
    mode = str(raw.get('mode') or '').strip()
    state['mode'] = mode if mode in MODES else DEFAULT_MODE
    state['expires_at'] = raw.get('expires_at') if isinstance(raw.get('expires_at'), (int, float)) else None
    state['set_by'] = str(raw.get('set_by') or '')[:60]
    state['set_at'] = str(raw.get('set_at') or '')[:30]
    return state


def set_mode(mode: str, ttl_sec: Optional[int] = None, by: str = 'user',
             base_dir: Optional[str] = None) -> Dict[str, Any]:
    """设置权限模式。full 必须带有效期（缺省 1 小时，到点自动回落 standard）。"""
    mode = str(mode or '').strip()
    if mode not in MODES:
        return {'ok': False, 'err': '未知模式: %s（可用 %s）' % (mode, '/'.join(MODES))}
    expires_at = None
    if mode == MODE_FULL:
        ttl = int(ttl_sec) if ttl_sec else FULL_AUTO_REVERT_SEC
        ttl = max(60, min(ttl, 24 * 3600))
        expires_at = time.time() + ttl
    state = {'mode': mode, 'expires_at': expires_at,
             'set_by': str(by)[:60], 'set_at': time.strftime('%Y-%m-%dT%H:%M:%S'),
             'load_error': None}
    path = _mode_file_path(base_dir)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, path)
    return {'ok': True, 'mode': mode, 'expires_in': (int(expires_at - time.time())
                                                     if expires_at else None)}


def get_mode(base_dir: Optional[str] = None) -> Dict[str, Any]:
    """当前生效模式。full 过期即回落 standard（惰性，不重写文件）；文件损坏回落 standard。"""
    state = _load_mode(base_dir)
    eff = state['mode']
    expires_in = None
    if eff == MODE_FULL:
        exp = state.get('expires_at') or 0
        remain = exp - time.time()
        if remain <= 0:
            eff = DEFAULT_MODE
        else:
            expires_in = int(remain)
    if state.get('load_error'):
        eff = DEFAULT_MODE
    return {'mode': eff, 'configured': state['mode'], 'expires_in': expires_in,
            'set_by': state['set_by'], 'set_at': state['set_at'],
            'degraded': state.get('load_error')}


class PolicyEngine(object):
    """deny > ask > allow 的能力策略引擎。线程安全；规则文件改动最迟 1 秒生效。"""

    RELOAD_INTERVAL = 1.0

    def __init__(self, user_path: str, workspace_path: Optional[str] = None) -> None:
        self._user_path = user_path
        self._workspace_path = workspace_path or None
        self._lock = threading.Lock()
        self._user = _Layer()
        self._workspace = _Layer()
        self._loaded_at = 0.0

    def _ensure(self, force: bool = False) -> None:
        now = time.time()
        with self._lock:
            if not force and now - self._loaded_at < self.RELOAD_INTERVAL:
                return
            self._user = _load_layer(self._user_path)
            self._workspace = _load_layer(self._workspace_path)
            self._loaded_at = now

    def status(self) -> Dict[str, Any]:
        self._ensure()
        degraded = []
        for name, path, layer in (('user', self._user_path, self._user),
                                  ('workspace', self._workspace_path, self._workspace)):
            if layer.load_error:
                degraded.append({'layer': name, 'path': path, 'error': layer.load_error})
        return {
            'user_rules': len(self._user.rules),
            'workspace_rules': len(self._workspace.rules),
            'user_disabled': sorted(self._user.disabled),
            'workspace_disabled': sorted(self._workspace.disabled),
            'degraded': degraded,
            'user_mtime': self._user.mtime,
        }

    def decide(self, capability: str, target: str = '') -> Decision:
        """判定一次能力调用。capability 形如 'net' / 'fs.write'；target 形如域名或路径，可空。"""
        self._ensure()
        cap = str(capability or '').strip()
        tgt = str(target or '')
        if not cap:
            return Decision(DECISION_ASK, 'degraded', reason='capability 为空（调用方缺陷），交人判定')

        # 整体禁用：任一层禁用即 deny。禁用只能叠加（用户解除后工作区仍可禁；反之亦然）
        if cap in self._user.disabled or cap in self._workspace.disabled:
            return Decision(DECISION_DENY, 'disabled', reason='capability 被策略禁用')

        if self._user.load_error or self._workspace.load_error:
            return Decision(DECISION_ASK, 'degraded',
                            reason='规则文件解析失败，fail-ask：%s'
                                   % (self._user.load_error or self._workspace.load_error))

        user_dec = self._first_match(self._user, cap, tgt, 'user')
        if user_dec is None:
            fallback = self._user.defaults.get(cap) or self._user.defaults.get('*') or DECISION_ASK
            user_dec = Decision(fallback, 'default', reason='用户层无匹配，按默认')
        ws_dec = self._first_match(self._workspace, cap, tgt, 'workspace')

        # 工作区层只能收紧：severity-max。用户层即便没匹配（走默认 ask），工作区的 allow 也
        # 放不宽它——这是“工作区规则只能收紧”的结构保证。
        best = max((user_dec, ws_dec), key=lambda d: _SEVERITY[d.action]) if ws_dec else user_dec
        if ws_dec and ws_dec is best:
            best.layer = 'both' if ws_dec.action != user_dec.action else user_dec.layer

        # 【M1.4】权限模式变换（在规则判定之上）
        mode = get_mode()['mode']
        if mode == MODE_READONLY and cap in _READONLY_DENIED_CAPS:
            return Decision(DECISION_DENY, 'mode:readonly',
                            reason='只读模式拒绝写/执行/出域能力: %s' % cap)
        if mode == MODE_FULL and best.action == DECISION_ASK:
            # 完全访问只放宽 ask，不放宽 deny——deny 是用户的长期意志，临时模式盖不过它
            return Decision(DECISION_ALLOW, 'mode:full',
                            reason='完全访问模式：ask 免票据放行（deny 规则仍生效）')
        if mode == MODE_STRICT and best.action == DECISION_ALLOW and best.layer == 'default':
            return Decision(DECISION_ASK, 'mode:strict',
                            reason='严格模式：未被规则明确 allow 的默认交人判定')

        # 【M1.5】不可信内容升级：目标域名曾在不可信内容（浏览器页面等）中出现，
        # 即使规则放行也升级为 ask 交人（full 模式除外——用户显式选择了免审批）
        if (mode != MODE_FULL and best.action == DECISION_ALLOW and tgt):
            try:
                import util_untrusted as _uu
                _host = ''
                try:
                    import urllib.parse as _upm
                    _host = _upm.urlparse(tgt).hostname or ''
                except ValueError:
                    _host = ''
                if _uu.is_flagged(_host or tgt):
                    return Decision(DECISION_ASK, 'untrusted',
                                    reason='目标域名出现在不可信内容中（%s），升级交人判定' % (_host or tgt)[:40])
            except ImportError:
                pass
        return best

    @staticmethod
    def _first_match(layer: _Layer, capability: str, target: str, layer_name: str) -> Optional[Decision]:
        if layer.load_error:
            return None
        for r in layer.rules:
            if _match(r, capability, target):
                return Decision(r['action'], layer_name, rule=r)
        return None


_default_engine: Optional[PolicyEngine] = None
_default_lock = threading.Lock()


def get_default_engine(workspace_path: Optional[str] = None) -> PolicyEngine:
    """进程级单例（用户层默认路径 + 可选工作区层）。供 M1.3 各能力闸门取用。"""
    global _default_engine
    with _default_lock:
        if _default_engine is None:
            _default_engine = PolicyEngine(default_user_rules_path(), workspace_path)
        return _default_engine


def check_tool_call(engine: PolicyEngine, capability: str, target: str,
                    params: Any, body: Optional[Dict[str, Any]] = None) -> Tuple[bool, str, Decision]:
    """M1.3 能力闸门的一站式判定（deny 即拒 / ask 须审批票据 / allow 放行）。

    ask 通路：调用方 body 需携带 `_policy_ticket`（人批准后由 util_ticket.issue 签发），
    并携带 `_session_id` / `_call_id` 供票据四元绑定核销；票据缺失或核销失败一律拒绝
    （fail-closed）。返回 (allowed, reason, decision)，reason 供工具向 AI/用户回显。"""
    body = body or {}
    d = engine.decide(capability, target)
    if d.action == DECISION_DENY:
        return False, 'policy_deny：用户规则拒绝该目标' + (('（%s）' % d.reason) if d.reason else ''), d
    if d.action == DECISION_ALLOW:
        return True, 'policy_allow', d
    # ask：需要人工批准
    session = str(body.get('_session_id') or body.get('_box_id') or body.get('_chat_id') or '')
    call = str(body.get('_call_id') or '')
    ticket = str(body.get('_policy_ticket') or '')
    if not ticket:
        # 【M1.4】登记待批请求（同绑定自动去重），把请求编号回给调用方——
        # 人批准后凭编号换票据，前端带票据重试原调用
        rid = ''
        try:
            import util_ticket as _ut
            _req = _ut.register_request(capability, target, params, session, call)
            rid = str(_req.get('request_id') or '')
        except (ImportError, ValueError, OSError) as _re:
            log.info('待批请求登记失败: %s' % _re)
        hint = '（请求编号 %s；审批页 /policy-approve.html）' % rid if rid else ''
        return False, ('policy_ask_need_ticket：该目标当前策略为 ask（需人工批准）。'
                       '请让用户在审批界面批准后，携带 _policy_ticket 重试' + hint), d
    try:
        import util_ticket
        ok, reason = util_ticket.consume(ticket, capability, params, session, call)
    except ImportError:
        return False, 'policy_ticket_unavailable：票据模块缺失，fail-closed 拒绝', d
    if not ok:
        return False, 'policy_ticket_invalid: %s' % reason, d
    return True, 'policy_ask_approved：人工批准票据已核销', d
