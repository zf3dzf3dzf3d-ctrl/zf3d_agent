# -*- coding: utf-8 -*-
"""type_baseline - M2.1 类型检查基线（策划案 M2.1：基线锁定存量，新增代码零错误）。

偏差说明：策划案指定 pyright，但 pyright 的 pip 包装器在本机异常退出（静默无输出，
连 --version 都不打印），换 mypy 2.4.1 实现同等目标；CI 阶段（M2.5）再评估 pyright。

语义：
  - 基线按【文件】锁定错误数（tools/quality/mypy_baseline.json）；
  - 基线外的文件（新增代码）有错误 → 拦截（M2.1 验收：新增代码零错误）；
  - 基线内文件现值 > 基线 → 拦截（单文件只许降不许涨；编辑后行数变化不影响计数口径）；
  - 现值 < 基线 → 自由（鼓励消化），下次 --baseline 可把存量写低。

用法：
  py tools/quality/type_baseline.py             # 检查（门禁步）
  py tools/quality/type_baseline.py --baseline  # 重新锁定存量
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from collections import Counter
from typing import List, Tuple
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]   # tools/quality/ 上溯两级 = 项目根
BASELINE = ROOT / 'tools' / 'quality' / 'mypy_baseline.json'

MYPY_ARGS = [
    'server', 'tools', 'scripts',
    '--explicit-package-bases', '--namespace-packages',
    '--ignore-missing-imports',
    '--allow-untyped-defs', '--allow-untyped-calls',
    '--no-strict-optional',
    '--disable-error-code=import-untyped',
    '--disable-error-code=no-any-return',
    '--cache-dir', 'tmp/mypy_cache',
    '--no-error-summary',
]


def run_mypy() -> Counter:
    r = subprocess.run([sys.executable, '-m', 'mypy'] + MYPY_ARGS,
                       cwd=str(ROOT), capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=1800)
    counts: Counter = Counter()
    for line in (r.stdout or '').splitlines():
        # 形如 tools\xxx.py:12: error: ... [code]
        if ': error:' not in line:
            continue
        loc = line.split(':', 1)[0]
        counts[loc.replace('\\', '/')] += 1
    return counts


def compare(base: dict, cur: Counter) -> Tuple[List[str], List[str]]:
    new_bad, grown = [], []
    for f, n in sorted(cur.items()):
        b = int(base.get(f, 0))
        if f not in base and n > 0:
            new_bad.append('%s: 基线外新增文件 %d 个错误' % (f, n))
        elif b and n > b:
            grown.append('%s: %d > %d' % (f, n, b))
    return new_bad, grown


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    t0 = time.time()
    cur = run_mypy()
    total = sum(cur.values())
    if '--baseline' in sys.argv:
        BASELINE.write_text(json.dumps(dict(sorted(cur.items())), indent=1), encoding='utf-8')
        print('类型基线已锁定: %d 个文件 / %d 条错误（%.0fs）' % (len(cur), total, time.time() - t0))
        return 0
    if not BASELINE.exists():
        print('[SKIP] 无类型基线（首次请 --baseline 锁定）')
        return 0
    base = json.loads(BASELINE.read_text(encoding='utf-8'))
    new_bad, grown = compare(base, cur)
    print('== 类型基线 ==（%.0fs，全仓 %d 条 / %d 文件）' % (time.time() - t0, total, len(cur)))
    for line in new_bad[:10]:
        print('  [新增文件] ' + line)
    for line in grown[:10]:
        print('  [上涨] ' + line)
    if new_bad or grown:
        print('[FAIL] 类型基线拦截: 新增文件 %d、上涨 %d' % (len(new_bad), len(grown)))
        print('       处置：新增代码零错误（补注解/修类型）；基线内文件只许降不许涨。')
        return 1
    print('[OK] 类型基线全绿（无新增文件错误、无上涨）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
