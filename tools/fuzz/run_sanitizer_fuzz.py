# -*- coding: utf-8 -*-
"""M2.4 消毒器模糊测试驱动器：分块多进程跑满 10 万次变异输入。

jsdom 的 DOMParser 文档驻留会让单进程长跑 OOM（实测 5 万次吃满 4GB 堆），
所以按 1 万次/进程分块，每块全新 node 进程（独立种子，结果可复现），
驱动器汇总 throws/leaks 并给出退出码。

用法：py tools/fuzz/run_sanitizer_fuzz.py [总次数=100000] [每块=10000]
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
JS = os.path.join(ROOT, 'tools', 'fuzz', 'fuzz_sanitizer.js')


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    total = int(sys.argv[1]) if len(sys.argv) > 1 else 100000
    chunk = int(sys.argv[2]) if len(sys.argv) > 2 else 10000
    env = dict(os.environ)
    env.setdefault('ZF_JSDOM_DIR',
                   os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Temp', 'zf-jsdom-20261123'))
    throws = leaks = 0
    blocks = (total + chunk - 1) // chunk
    for b in range(blocks):
        n = min(chunk, total - b * chunk)
        r = subprocess.run(['node', '--expose-gc', '--max-old-space-size=2048',
                            JS, str(n), str(20261124 + b)],
                           capture_output=True, text=True, encoding='utf-8',
                           errors='replace', timeout=600, env=env)
        for line in (r.stdout or '').splitlines():
            if line.startswith('RESULT'):
                parts = line.split()
                for part in parts:
                    if part.startswith('throws='):
                        throws += int(part.split('=')[1])
                    elif part.startswith('leaks='):
                        leaks += int(part.split('=')[1])
        if r.returncode not in (0, 1):
            print('[FAIL] 块 %d 异常退出 rc=%s' % (b, r.returncode))
            print((r.stdout or '')[-400:])
            print((r.stderr or '')[-200:])
            return 1
        print('  块 %d/%d: %d 次（累计 throws=%d leaks=%d）' % (b + 1, blocks, n, throws, leaks))
    print('== 消毒器模糊测试: %d 次变异输入，异常逃逸 %d，判定泄漏 %d ==' % (total, throws, leaks))
    if throws or leaks:
        print('[FAIL] 发现问题')
        return 1
    print('[OK] 100%% 变异输入通过（无崩溃、无泄漏）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
