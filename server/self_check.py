#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
self_check.py - 四级隐私防护 P4：监督网警·防护自检报告

监督"网警"本身：定期核验各防护模块是否健在、审计链是否完整、
开关状态是否正常，输出一份总体健康报告。全部只读，零副作用。

API:  run_self_check() -> {'overall': 'ok'|'warn'|'critical', 'checks': [...]}
CLI:  python self_check.py
"""

import os
import sys
import importlib

from util_log import get_logger

log = get_logger('self_check')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
_BASE = os.path.dirname(os.path.abspath(__file__))


def run_self_check():
    checks = []

    # 1. 四大模块可导入且核心函数在位
    for mod_name, funcs in [
        ('audit_chain', ['record', 'verify', 'status']),
        ('egress_gate', ['check']),
        ('kill_switch', ['is_on', 'turn_on', 'turn_off', 'status']),
        ('sentinel', ['patrol', 'patrol_report']),
        ('browser_guard', ['classify', 'check_navigation', 'check_action',
                           'scan_injection']),
    ]:
        try:
            m = importlib.import_module(mod_name)
            missing = [f for f in funcs if not hasattr(m, f)]
            if missing:
                checks.append({'item': mod_name, 'state': 'warn',
                               'msg': '缺少函数: %s' % ','.join(missing)})
            else:
                checks.append({'item': mod_name, 'state': 'ok', 'msg': '模块健在'})
        except Exception as e:
            checks.append({'item': mod_name, 'state': 'critical',
                           'msg': '模块导入失败: ' + str(e)[:100]})

    # 2. 审计链完整性（断裂时先尝试自动重链，仍断才报 critical）
    try:
        import audit_chain
        st = audit_chain.status()
        vr = audit_chain.verify()
        if st.get('exists') and not vr.get('ok'):
            broken_at = vr.get('broken_at')
            rp = audit_chain.repair_chain()  # 顺序重放修复存量断裂
            vr = audit_chain.verify()
            if rp.get('verify_ok') and rp.get('fixed', 0) > 0:
                # 重链成功也必须 WARN：破链本身是异常信号（如旧版进程绕锁写入），
                # 静默抹平会掩盖持续破链（蜂群收口第2轮整改点）
                rep = ('（发现断裂@%s，已自动重链修复 %d 条——'
                       '请检查是否有旧版进程在写链/是否有篡改）'
                       % (broken_at, rp.get('fixed', 0)))
                _repaired_warn = True
            elif rp.get('verify_ok'):
                rep = '（已自动重链）'
                _repaired_warn = True
            else:
                rep = '（自动修复失败：%s）' % rp.get('error', '未知')
                _repaired_warn = False
        else:
            rep = ''
            _repaired_warn = False
        if st.get('exists'):
            state = ('ok' if vr.get('ok') else 'critical')
            if vr.get('ok') and _repaired_warn:
                state = 'warn'  # 修复后完整≠没破过链
            checks.append({'item': 'audit_chain.integrity',
                           'state': state,
                           'msg': '%d 条记录，%s%s' % (
                               st.get('lines', 0),
                               '链完整' if vr.get('ok') else
                               '链断裂@%s(疑似篡改!)' % vr.get('broken_at'),
                               rep)})
        else:
            checks.append({'item': 'audit_chain.integrity', 'state': 'ok',
                           'msg': '审计日志尚未产生（空链视为正常）'})
    except Exception as e:
        checks.append({'item': 'audit_chain.integrity', 'state': 'critical',
                       'msg': str(e)[:100]})

    # 3. 紧急停止开关状态
    try:
        import kill_switch
        ks = kill_switch.status()
        checks.append({'item': 'kill_switch',
                       'state': 'warn' if ks['on'] else 'ok',
                       'msg': '开关 %s' % ('ON(系统停机中)' if ks['on'] else 'OFF(正常)')})
    except Exception as e:
        checks.append({'item': 'kill_switch', 'state': 'critical',
                       'msg': str(e)[:100]})

    # 4. 出域闸门模式库健康
    try:
        import egress_gate
        hit = egress_gate.check('egress', 'test', 'my key is sk-abcdefghijklmnopqrstuvwxyz123456')
        # 【修复】egress_gate.check 返回 {'decision': 'allow'|'block', ...}，
        # 旧断言读不存在的 'allow' 键恒为 None，自检永远误报 ok。改判 decision。
        clean = egress_gate.check('egress', 'test', '今天天气不错，写点普通文档没有问题')
        ok = (hit.get('decision') == 'block') and bool(hit.get('reason')) \
            and (clean.get('decision') == 'allow')
        checks.append({'item': 'egress_gate.detect',
                       'state': 'ok' if ok else 'critical',
                       'msg': '密钥样本检测%s' % ('命中拦截(负样本放行)'
                                                 if ok else '未命中/误拦(检测失效!)')})
    except Exception as e:
        checks.append({'item': 'egress_gate.detect', 'state': 'critical',
                       'msg': str(e)[:100]})

    # 5. 加密存储可用性
    try:
        ok_store, store_err = False, ''
        try:
            import secure_store
            ok_store = hasattr(secure_store, 'encrypt_value')
        except Exception:
            try:
                import vault
                ok_store = hasattr(vault, 'save_item')
            except Exception as e2:
                store_err = str(e2)[:100]
        checks.append({'item': 'encrypted_store',
                       'state': 'ok' if ok_store else 'warn',
                       'msg': 'DPAPI/Fernet 加密存储可用' if ok_store
                              else ('加密存储模块不可用: ' + store_err)})
    except Exception as e:
        checks.append({'item': 'encrypted_store', 'state': 'warn',
                       'msg': str(e)[:100]})

    # 6. private/ 目录权限与存在性
    priv = os.path.join(_BASE, 'private')
    if os.path.isdir(priv):
        checks.append({'item': 'private_dir', 'state': 'ok', 'msg': '目录存在'})
    else:
        checks.append({'item': 'private_dir', 'state': 'warn',
                       'msg': 'private/ 目录不存在（首次运行可自动创建）'})

    states = [c['state'] for c in checks]
    overall = ('critical' if 'critical' in states else
               'warn' if 'warn' in states else 'ok')
    return {'overall': overall, 'checks': checks,
            'summary': '%d 项检查: ok=%d warn=%d critical=%d' % (
                len(checks), states.count('ok'),
                states.count('warn'), states.count('critical'))}


def report_text():
    r = run_self_check()
    icon = {'ok': '[OK]', 'warn': '[警告]', 'critical': '[严重]'}
    lines = ['===== 防护自检报告 (总体: %s) =====' % r['overall'].upper(), r['summary'], '']
    for c in r['checks']:
        lines.append('%s %-24s %s' % (icon[c['state']], c['item'], c['msg']))
    return '\n'.join(lines)


if __name__ == '__main__':
    log.info(report_text())
