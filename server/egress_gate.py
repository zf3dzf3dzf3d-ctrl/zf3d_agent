#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
egress_gate.py - 四级隐私防护 P1-2：出域统一闸门（第1级 顶级门卫核心）

一切「数据离开本机」的动作（网络请求、邮件、发帖、上传）必须经此闸门：
1. kill_switch 检查：紧急停止开关打开时，一律拦截
2. 敏感信息扫描：token/密钥/密码/private/ 路径痕迹 → 拦截并打码建议
3. 审计留痕：放行/拦截都写入 audit_chain 哈希链

P1 策略：默认拦截「高敏感」、放行「低敏感」、可疑的放行但标 warn 留痕。
P4 再接入人工确认交互。

失败语义【fail-closed，2026-11-23 更正】：出域闸门是数据防泄漏的授权类检查——
扫描器自身异常时一律拒绝（原实现 except 后按"干净"放行，等于让扫描器出错即可绕过）。
闸门不可用的场景由 tools/coding/backend/_egress.py 同样 fail-closed。
审计留痕自身的失败不影响判定（audit_chain.record 内部已吞写盘异常）；
"绝不阻塞业务"的 fail-open 只保留给审计、统计、埋点这类非授权设施。

零第三方依赖，单文件自包含。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_chain

# ---- 紧急停止开关（P1-3 与本模块共用一个文件开关）----
_KILL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'private', 'KILL_SWITCH')


def kill_switch_on():
    """紧急停止开关是否打开（文件存在=开）。绝不抛错。"""
    try:
        return os.path.exists(_KILL_FILE)
    except Exception:
        return False


# ---- 敏感信息模式（命中即拦截/标警）----
_SENSITIVE_PATTERNS = (
    # (名称, 正则, 级别 block/warn)
    ('api_key_bearer', re.compile(r'(sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9\-_\.]{20,})'), 'block'),
    ('generic_key', re.compile(r'(?i)(api[_-]?key|secret|token|passwd?|password)["\']?\s*[:=]\s*["\']?[A-Za-z0-9\-_]{12,}'), 'block'),
    ('private_path', re.compile(r'(?i)(private[/\\](记忆|logs|keys|站点))'), 'block'),
    ('jwt', re.compile(r'eyJ[A-Za-z0-9\-_]{10,}\.eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}'), 'block'),
    ('email_cred', re.compile(r'(?i)(smtp|imap)[^"]{0,30}(授权码|密码|password)'), 'block'),
    ('phone', re.compile(r'(?<!\d)1[3-9]\d{9}(?!\d)'), 'warn'),
    ('id_card', re.compile(r'(?<!\d)\d{17}[\dXx](?!\d)'), 'block'),
)

# ---- 私有凭据/隐私文件「按引用外传」（2026-11-23）----
# 上面的模式只认"明文出现在文本里"。密钥库在盘上是 DPAPI 密文，明文从不进文本，
# 但 shell 可以按文件引用把整个文件发出去（curl -F f=@private/api_keys.json https://…）：
# 文本里只有路径、没有密钥 → 上面的模式全部漏过。
# 判定 = 同时命中【私有文件引用】与【外传特征】才拦截：
#   type / dir / 本地读取、以及只打本机回环地址的调用都不算外传，不受影响。
_PRIVATE_FILE_REF = re.compile(
    r'(?i)private[/\\]+(?:api_keys|external_providers|port|remote_cmd|path_whitelist|'
    r'file_protection|roles_db|db|日志|浏览器数据)(?:[/\\]|[.]|$)'
    r'|internal_secret[.]txt|browser_profile|cookies[.]sqlite|login data')
_TRANSFER_TOOL_RE = re.compile(
    r'(?i)\b(?:curl|wget|invoke-webrequest|invoke-restmethod|iwr|irm|scp|sftp|pscp|ftp|tftp|'
    r'nc|ncat|netcat|socat|rsync|bitsadmin|ssh)\b|certutil\s+(?:-urlcache|-spliturlcache)')
_URL_RE = re.compile(r'(?i)\bhttps?://[^\s"\'<>]+')
# 回环目标（本机服务）不构成"数据离开本机"
_LOOPBACK_URL_RE = re.compile(
    r'(?i)^https?://(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:[/?#]|$)')
_BLOCK_HINTS = {
    'private_file_egress': '（命令同时引用了私有凭据/隐私文件与外传目标；私有文件不得按引用外传，'
                           '如确需导出请用户手动操作）',
}


def _has_egress_signal(s):
    """文本是否带"数据离开本机"的特征。"""
    urls = _URL_RE.findall(s)
    if any(not _LOOPBACK_URL_RE.match(u) for u in urls):
        return True                       # 出现非回环 URL
    if urls:
        return False                      # 只有回环 URL：本机调用
    return bool(_TRANSFER_TOOL_RE.search(s))   # 无 URL：看是否出现传输类工具


def scan_sensitive(text):
    """
    扫描文本中的敏感信息。返回 (level, hits)
    level: 'clean' / 'warn' / 'block'
    hits: [(名称, 级别, 命中片段前40字符打码), ...]
    """
    hits = []
    level = 'clean'
    s = str(text or '')
    for name, pat, lv in _SENSITIVE_PATTERNS:
        m = pat.search(s)
        if m:
            frag = m.group(0)[:40]
            # 打码：保留头尾各2字符
            if len(frag) > 8:
                frag = frag[:2] + '****' + frag[-2:]
            hits.append((name, lv, frag))
            if lv == 'block':
                level = 'block'
            elif level != 'block':
                level = 'warn'
    if level != 'block':
        m = _PRIVATE_FILE_REF.search(s)
        if m and _has_egress_signal(s):
            frag = m.group(0)[:40]
            hits.append(('private_file_egress', 'block', frag[:2] + '****' + frag[-2:]))
            level = 'block'
    return level, hits


def check(channel, target, text='', actor='system', meta=None):
    """
    出域检查主入口。返回 dict：
    {'decision': 'allow'|'block', 'level': ..., 'hits': [...],
     'reason': str}

    channel: 'net' / 'email' / 'post' / 'upload' / ...
    target:  目标标识（URL / 收件人 / 平台名）
    text:    出域内容主体
    actor:   触发引擎/模块
    meta:    附加信息 dict
    """
    reason = ''
    level = 'clean'
    hits = []

    # 1. 紧急停止开关
    if kill_switch_on():
        audit_chain.record('egress', channel + '_blocked',
                           {'target': str(target)[:100], 'reason': 'kill_switch'},
                           actor=actor, level='block')
        return {'decision': 'block', 'level': 'killswitch', 'hits': [],
                'reason': '紧急停止开关已打开，禁止一切出域操作'}

    # 1.5 【M1.3】能力策略 net：用户规则 deny 即拦。ask 过渡期放行但留 warn 痕
    # （外网访问多为主流模型 API，无审批 UI 前一刀切 ask 会打断正常调用；1.4 上线后收紧为须票据）。
    try:
        from util_policy import get_default_engine
        _pt = str(target or '')
        # 域名规则按 host 匹配（fnmatch 非域名感知，见 M1.1 已知限制）：URL 先取 host，
        # 与原文目标各判一次取更严者——域名规则与非 URL 目标（收件人等）都能命中
        _ph = ''
        try:
            import urllib.parse as _up
            _ph = (_up.urlparse(_pt).hostname or '')
        except ValueError:
            _ph = ''
        _eng = get_default_engine()
        _sev = {'allow': 0, 'ask': 1, 'deny': 2}
        _pd = _eng.decide('net', _pt)
        if _ph and _ph != _pt:
            _pd2 = _eng.decide('net', _ph)
            if _sev.get(_pd2.action, 0) > _sev.get(_pd.action, 0):
                _pd = _pd2
        if _pd.action == 'deny':
            audit_chain.record('egress', channel + '_blocked',
                               {'target': str(target)[:100], 'reason': 'policy_deny'},
                               actor=actor, level='block')
            return {'decision': 'block', 'level': 'policy', 'hits': [],
                    'reason': '能力策略拒绝出域目标（用户规则）'}
        if _pd.action == 'ask':
            audit_chain.record('egress', channel + '_policy_ask',
                               {'target': str(target)[:100]},
                               actor=actor, level='warn')
    except ImportError:
        # 策略模块缺失属于授权类检查失效：fail-closed 拒绝出域
        return {'decision': 'block', 'level': 'policy', 'hits': [],
                'reason': '能力策略模块缺失，fail-closed 拒绝出域'}

    # 2. 敏感扫描
    # 【fail-closed】扫描器自身异常时不得按"干净"放行（原实现 except 后置 clean 即属 fail-open）。
    try:
        level, hits = scan_sensitive(text)
    except Exception as e:
        reason = '出域敏感扫描异常，fail-closed 拒绝: %s' % e
        audit_chain.record('egress', channel + '_blocked',
                           {'target': str(target)[:100], 'reason': reason},
                           actor=actor, level='block')
        return {'decision': 'block', 'level': 'block', 'hits': [],
                'reason': reason}

    if level == 'block':
        blocked_names = [h[0] for h in hits if h[1] == 'block']
        reason = '出域内容命中高敏感模式: ' + ','.join(blocked_names)
        for n in blocked_names:
            if n in _BLOCK_HINTS:
                reason += _BLOCK_HINTS[n]
        audit_chain.record('egress', channel + '_blocked',
                           {'target': str(target)[:100], 'reason': reason},
                           actor=actor, level='block')
        return {'decision': 'block', 'level': 'block', 'hits': hits,
                'reason': reason}

    # 3. 放行（warn 也放行但留痕）
    if level == 'warn':
        reason = 'warn: ' + ','.join(h[0] for h in hits)
    else:
        reason = 'clean'
    audit_chain.record('egress', channel + '_allow',
                       {'target': str(target)[:100],
                        'bytes': len(str(text or ''))},
                       actor=actor, level=level)
    return {'decision': 'allow', 'level': level, 'hits': hits,
            'reason': reason}
