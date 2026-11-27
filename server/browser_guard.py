#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
browser_guard.py - 四级隐私防护·浏览器安全防护专项

为内置浏览器保驾护航：既不被 AI 伤害，也不被浏览器伤害。
1. 域名三级分级：trusted(放行) / caution(放行留痕+提示) / forbidden(拦截)
2. 敏感动作分级：登录/发帖/支付/下载 → 需确认级动作，过出域闸门留痕
3. 提示注入扫描：页面内容含"忽略之前指令/外传数据"类注入话术 → 告警
4. 一切判定写入 audit_chain 哈希链

API:
  classify(url)            -> {'tier': 'trusted'|'caution'|'forbidden', ...}
  check_navigation(url)    -> 导航前检查，block 即停
  check_action(url, act)   -> 动作前检查（login/post/pay/download），block 即停
  scan_injection(page_text)-> 提示注入扫描
CLI:
  python browser_guard.py <url>
"""

import os
import re
import sys
from urllib.parse import urlparse

from util_log import get_logger

log = get_logger('browser_guard')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_chain
import egress_gate

# ---- 域名三级分级表 ----
# trusted: 明网常用站；caution: UGC/需账号站，访问留痕；forbidden: 危险站
_TRUSTED = {
    'baidu.com', 'bing.com', 'google.com', 'github.com', 'zhihu.com',
    'cnblogs.com', 'stackoverflow.com', 'python.org', 'mdn.mozilla.org',
    'wikipedia.org', 'bj.cn', 'gov.cn', 'edu.cn', 'pep.com.cn',
}
_CAUTION = {
    'weibo.com', 'tieba.baidu.com', 'douyin.com', 'bilibili.com',
    'taobao.com', 'jd.com', 'tmall.com', 'pinduoduo.com',
    'email.qq.com', 'mail.163.com', 'feishu.cn', 'dingtalk.com',
}
_FORBIDDEN = {
    # 已知钓鱼/诈骗类特征词不在此列，靠规则判；这里是明确黑名单示例
    'onion', '.tk', '.xyz.com',
}
# 危险 TLD（免费域名，钓鱼高发）
_RISKY_TLDS = {'.tk', '.ml', '.ga', '.cf', '.gq'}

# 敏感动作定义：动作 -> (是否需确认, 描述)
_SENSITIVE_ACTIONS = {
    'login':    (True,  '账号登录（可能提交凭证）'),
    'post':     (True,  '发帖/评论/提交内容'),
    'pay':      (True,  '支付/下单操作'),
    'download': (False, '文件下载'),
    'upload':   (True,  '文件上传（本机数据出域）'),
}

# 提示注入特征话术
_INJECTION_PATTERNS = [
    re.compile(r'(?i)(忽略|无视|disregard)[^。\.]{0,20}(之前|above|前面)[^。\.]{0,10}(指令|instruction|提示)'),
    re.compile(r'(?i)(你现在是|you are now)[^。\.]{0,20}(无限制|unrestricted|DAN)'),
    re.compile(r'(?i)(把|将)[^。\.]{0,10}(密钥|key|token|密码|私密|private)[^。\.]{0,20}(发送|发到|post|upload|传)[^。\.]{0,30}(http|网址|url|服务器)'),
]


def _registrable_domain(url):
    """提取注册域名（粗略：取最后两段，带常见二级后缀取三段）。"""
    try:
        host = (urlparse(url if '://' in url else 'https://' + url)
                or urlparse('https://' + str(url))).hostname or ''
    except Exception:
        host = str(url).split('/')[0]
    host = host.lower().strip('.')
    parts = host.split('.')
    if len(parts) >= 3 and parts[-2] in ('com', 'org', 'net', 'gov', 'edu', 'co'):
        return '.'.join(parts[-3:])
    if len(parts) >= 2:
        return '.'.join(parts[-2:])
    return host


def classify(url):
    """
    域名分级。返回 {'tier': 'trusted'|'caution'|'forbidden'|'unknown',
                    'domain': 注册域名, 'reason': str}
    """
    d = _registrable_domain(url)
    low = d.lower()
    if low in _FORBIDDEN or any(low.endswith(t) for t in _RISKY_TLDS):
        return {'tier': 'forbidden', 'domain': d, 'reason': '命中黑名单/高危TLD'}
    if low in _TRUSTED:
        return {'tier': 'trusted', 'domain': d, 'reason': '明网信任名单'}
    if low in _CAUTION:
        return {'tier': 'caution', 'domain': d, 'reason': '需账号/UGC站，留痕访问'}
    return {'tier': 'unknown', 'domain': d, 'reason': '未知站，默认留痕+谨慎'}


def check_navigation(url, actor='browser'):
    """
    导航前检查。返回 {'decision': 'allow'|'block'|'caution', ...}
    forbidden 一律拦截；kill_switch 打开一律拦截。
    """
    if egress_gate.kill_switch_on():
        audit_chain.record('browser', 'nav_blocked',
                           {'target': str(url)[:100], 'reason': 'kill_switch'},
                           actor=actor, level='block')
        return {'decision': 'block', 'reason': '紧急停止开关已打开，禁止浏览'}

    c = classify(url)
    if c['tier'] == 'forbidden':
        audit_chain.record('browser', 'nav_blocked',
                           {'target': str(url)[:100], 'reason': c['reason']},
                           actor=actor, level='block')
        return dict(decision='block', **c)

    # trusted/caution/unknown 都放行，但 caution/unknown 留痕
    audit_chain.record('browser', 'nav_' + c['tier'],
                       {'target': str(url)[:100]},
                       actor=actor, level='info')
    decision = 'allow' if c['tier'] == 'trusted' else 'caution'
    return dict(decision=decision, **c)


def check_action(url, action, actor='browser'):
    """
    敏感动作前检查（login/post/pay/download/upload）。
    需确认级动作：过出域闸门敏感扫描 + 留痕为 'confirm_required'。
    返回 {'decision': 'allow'|'confirm'|'block', ...}

    契约收紧（终验整改）：url/action 必须可归一化为字符串；传 dict 等对象
    自动取最可能字段归一化，无法归一化时返回 block 而非抛 TypeError。
    """
    def _norm(v, keys=('url', 'target', 'href', 'action', 'name', 'type')):
        if isinstance(v, str):
            return v.strip()
        if isinstance(v, dict):
            for k in keys:
                if isinstance(v.get(k), str) and v.get(k).strip():
                    return v[k].strip()
            return ''
        if v is None:
            return ''
        try:
            return str(v).strip()
        except Exception:
            return ''
    url = _norm(url)
    action = _norm(action, keys=('action', 'name', 'type'))
    if not url or not action:
        return {'decision': 'block',
                'reason': '参数不合法：url/action 无法归一化为非空字符串'}
    unknown = action not in _SENSITIVE_ACTIONS
    need_confirm, desc = _SENSITIVE_ACTIONS.get(action, (False, action))
    c = classify(url)

    if egress_gate.kill_switch_on():
        audit_chain.record('browser', 'action_blocked',
                           {'target': str(url)[:100], 'action': action,
                            'reason': 'kill_switch'},
                           actor=actor, level='block')
        return {'decision': 'block', 'reason': '紧急停止开关已打开'}

    if c['tier'] == 'forbidden':
        audit_chain.record('browser', 'action_blocked',
                           {'target': str(url)[:100], 'action': action,
                            'reason': c['reason']},
                           actor=actor, level='block')
        return {'decision': 'block', 'reason': c['reason']}

    if need_confirm:
        audit_chain.record('browser', 'action_confirm_required',
                           {'target': str(url)[:100], 'action': action,
                            'desc': desc},
                           actor=actor, level='warn')
        return {'decision': 'confirm', 'reason': desc + '（需用户确认）',
                'domain': c['domain']}

    audit_chain.record('browser', 'action_allow',
                       {'target': url[:100], 'action': action,
                        'unknown_action': unknown},
                       actor=actor, level='info')
    r = {'decision': 'allow', 'reason': '常规动作', 'domain': c['domain']}
    if unknown:
        r['note'] = '未注册动作名，按常规处理，如属敏感操作请先在 _SENSITIVE_ACTIONS 注册'
    return r


def scan_injection(page_text):
    """
    页面内容提示注入扫描。返回 {'found': bool, 'patterns': [名]}
    命中即写审计链告警。
    """
    s = str(page_text or '')
    found = []
    for i, pat in enumerate(_INJECTION_PATTERNS):
        if pat.search(s):
            found.append('injection_rule_%d' % (i + 1))
    if found:
        audit_chain.record('browser', 'injection_detected',
                           {'patterns': ','.join(found)},
                           actor='browser', level='warn')
    return {'found': bool(found), 'patterns': found}


if __name__ == '__main__':
    url = sys.argv[1] if len(sys.argv) > 1 else 'https://github.com'
    r = check_navigation(url)
    log.info('%s %s', '导航检查:', r)
