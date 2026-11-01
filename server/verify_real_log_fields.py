#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_real_log_fields - 课题⑧（v3 第3轮收口裁决 e09e3edb）：真实日志字段齐备断言
断言真实注入日志首行（近24h最新一行）的字段与消费方 butler_injection_report.py
实际消费的字段一致：ts / employee / inject_len。
构造数据漂移防不住，只对真实文件对账。
用法：python verify_real_log_fields.py   退出码 0=通过 1=失败（失败输出缺失字段清单）
冻结豁免依据：裁决「员工集成skill-md-mcp-v3第3轮收口-20261031」采纳进化师课题⑧。
"""
import os
import json
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOG = os.path.join(BASE, 'private', '记忆', '员工知识注入日志.jsonl')
REQUIRED = ['ts', 'employee', 'inject_len']  # report() 实际消费的字段


def main():
    if not os.path.exists(LOG):
        print('FAIL: 真实日志不存在: %s' % LOG)
        return 1
    last = None
    with open(LOG, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    last = json.loads(line)
                except ValueError:
                    pass
    if last is None:
        print('FAIL: 真实日志为空或全部行非法')
        return 1
    missing = [k for k in REQUIRED if k not in last]
    if missing:
        print('FAIL: 真实日志最新一行缺失字段: %s；实际字段: %s' % (missing, sorted(last.keys())))
        return 1
    print('PASS: 真实日志字段齐备 ts/employee/inject_len（最新一行 ts=%s employee=%s inject_len=%s）'
          % (last.get('ts'), last.get('employee'), last.get('inject_len')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
