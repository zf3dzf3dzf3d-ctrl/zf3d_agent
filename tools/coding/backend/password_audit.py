#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""password_audit - 本地密码强度审计（弱口令字典/规则检测，纯本地计算）"""

import re
import math

TOOL_NAME = 'password_audit'

_COMMON_WEAK = {
    '123456', '12345678', '123456789', 'password', 'qwerty', 'abc123',
    '111111', '123123', 'admin', 'admin123', 'root', 'toor', 'passw0rd',
    'p@ssw0rd', '88888888', '666666', '000000', '654321', 'iloveyou',
    'a123456', '123qwe', 'qwe123', '1qaz2wsx', 'letmein', 'welcome',
    'monkey', 'dragon', 'sunshine', 'princess', 'football', 'master',
    'zf3d', 'zhufeng', 'test', 'guest', 'user', '1234', '12345',
}

_KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890']


def _char_space(p):
    s = 0
    if re.search(r'[a-z]', p): s += 26
    if re.search(r'[A-Z]', p): s += 26
    if re.search(r'\d', p): s += 10
    if re.search(r'[^a-zA-Z0-9]', p): s += 33
    return s


def _is_seq(p):
    low = p.lower()
    for row in _KEYBOARD_ROWS:
        for i in range(len(row) - 3):
            seg = row[i:i + 4]
            if seg in low or seg[::-1] in low:
                return True
    for i in range(len(low) - 3):
        seg = low[i:i + 4]
        if seg == ''.join(chr(c) for c in range(ord(seg[0]), ord(seg[0]) + 4)):
            return True
        if seg == ''.join(chr(c) for c in range(ord(seg[0]), ord(seg[0]) - 4, -1)):
            return True
    return False


def _audit_one(p):
    issues = []
    score = 0
    if len(p) < 8:
        issues.append('长度不足8位')
    else:
        score += min(30, (len(p) - 7) * 5)
    if p.lower() in _COMMON_WEAK:
        issues.append('命中常见弱口令字典')
        score = 0
    if _is_seq(p):
        issues.append('含键盘连排/连续字符')
        score -= 15
    if re.match(r'^\d+$', p):
        issues.append('纯数字')
        score -= 20
    cl = set()
    for ch in p:
        if ch.islower(): cl.add('l')
        elif ch.isupper(): cl.add('u')
        elif ch.isdigit(): cl.add('d')
        else: cl.add('s')
    classes = len(cl)
    if classes >= 3:
        score += 20
    if classes >= 4:
        score += 10
    if re.match(r'^(\d{4})\1*$', p):
        issues.append('重复模式（如 1212/8888）')
        score -= 20
    score = max(0, min(100, score + (25 if len(p) >= 12 else 0)))
    entropy = round(len(p) * math.log2(max(2, _char_space(p))), 1)
    level = '弱' if score < 40 else '中' if score < 70 else '强'
    return {'password_masked': p[0] + '*' * max(0, len(p) - 2) + (p[-1] if len(p) > 1 else ''),
            'length': len(p), 'score': score, 'level': level,
            'entropy_bits': entropy, 'issues': issues or ['未见明显问题']}


def handle(body, ctx):
    pw = body.get('password')
    file = (body.get('file') or '').strip()
    if file:
        try:
            with open(file, 'r', encoding='utf-8', errors='replace') as f:
                pws = [l.strip() for l in f if l.strip()]
        except Exception as e:
            ctx.send_json({'ok': False, 'error': '读取文件失败: ' + str(e)})
            return
        ctx.send_json({'ok': True, 'mode': 'file', 'file': file, 'count': len(pws),
                       'results': [_audit_one(p) for p in pws[:200]],
                       'weak_count': sum(1 for p in pws[:200] if _audit_one(p)['level'] == '弱')})
        return
    if not pw:
        ctx.send_json({'ok': False, 'error': 'password 或 file 二选一'})
        return
    ctx.send_json({'ok': True, 'mode': 'single', **_audit_one(pw)})
