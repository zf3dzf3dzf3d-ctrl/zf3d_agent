#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
kill_switch.py - 四级隐私防护 P1-3：紧急停止开关（一级一句话停机）

原理极简、极可靠：开关 = server/private/KILL_SWITCH 文件是否存在。
- 打开：egress_gate 拦截一切出域；各模块可在关键写操作前检查
- 文件放本机，任何进程可创建/删除，不依赖服务是否存活
- 每次切换都写入 audit_chain 哈希链留痕

提供 API 与 CLI 双入口：
  python kill_switch.py on|off|status
"""

import os
import sys

from util_log import get_logger

log = get_logger('kill_switch')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import audit_chain

_KILL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'private', 'KILL_SWITCH')


def is_on():
    try:
        return os.path.exists(_KILL_FILE)
    except Exception:
        return False


def turn_on(by='user'):
    try:
        os.makedirs(os.path.dirname(_KILL_FILE), exist_ok=True)
        with open(_KILL_FILE, 'w', encoding='utf-8') as f:
            f.write('KILL SWITCH ON at ' + str(by))
        audit_chain.record('killswitch', 'killswitch_on', None,
                           actor=by, level='warn')
        return True
    except Exception as e:
        audit_chain.record('killswitch', 'killswitch_on_failed',
                           {'err': str(e)[:100]}, actor=by, level='warn')
        return False


def turn_off(by='user'):
    try:
        if os.path.exists(_KILL_FILE):
            os.remove(_KILL_FILE)
        audit_chain.record('killswitch', 'killswitch_off', None,
                           actor=by, level='warn')
        return True
    except Exception as e:
        audit_chain.record('killswitch', 'killswitch_off_failed',
                           {'err': str(e)[:100]}, actor=by, level='warn')
        return False


def status():
    return {'on': is_on(), 'file': _KILL_FILE}


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'status'
    by = sys.argv[2] if len(sys.argv) > 2 else 'user'
    if cmd == 'on':
        turn_on(by)
        log.info('KILL SWITCH: ON (一切出域已禁止)')
    elif cmd == 'off':
        turn_off(by)
        log.info('KILL SWITCH: OFF')
    else:
        log.info('%s %s', 'KILL SWITCH:', 'ON' if is_on() else 'OFF')
