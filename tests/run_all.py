# -*- coding: utf-8 -*-
"""测试入口：一次跑全部冒烟测试。用法: python\\python.exe tests\\run_all.py"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(os.path.dirname(HERE), 'python', 'python.exe')
if not os.path.exists(PY):
    PY = sys.executable

SCRIPTS = ['smoke_engines.py']


def main():
    failed = []
    for s in SCRIPTS:
        print('\n>>> 运行 %s' % s)
        r = subprocess.run([PY, os.path.join(HERE, s)])
        if r.returncode != 0:
            failed.append(s)
    print('\n========== 汇总 ==========')
    if failed:
        print('FAILED:', ', '.join(failed))
        sys.exit(1)
    print('ALL PASS')


if __name__ == '__main__':
    main()
