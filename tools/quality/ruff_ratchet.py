# -*- coding: utf-8 -*-
"""ruff_ratchet - M2.2 ruff F 规则棘轮（策划案 M2.2：F 全量 → B → S，基线只降不升）。

对全部 F 规则按规则码锁基线（tools/quality/ruff_baseline.json）：
  - 现值 ≤ 基线 → 通过（下降自由）；
  - 现值 > 基线 → 拦截，列出上涨的规则码；
  - --baseline 重新锁定（消化后允许把基线写得更低，锁定值会留在 git 历史里）。

用法：
  py tools/quality/ruff_ratchet.py             # 棘轮检查（门禁步）
  py tools/quality/ruff_ratchet.py --baseline  # 重新锁定基线

纳入 scripts/run_checks.py 门禁（M2.2 交付）。
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from collections import Counter
from typing import List
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]   # tools/quality/ 上溯两级 = 项目根
BASELINE = ROOT / 'tools' / 'quality' / 'ruff_baseline.json'


def find_ruff() -> str:
    exe = Path(sys.executable).parent / 'Scripts' / ('ruff.exe' if os.name == 'nt' else 'ruff')
    if exe.exists():
        return str(exe)
    return shutil.which('ruff') or ''


def current_counts() -> Counter:
    exe = find_ruff()
    if not exe:
        print('[SKIP] ruff 未安装')
        return Counter()
    r = subprocess.run([exe, 'check', '.', '--config', str(ROOT / 'tools/quality/ruff.toml'),
                        '--select', 'F', '--output-format', 'json'],
                       cwd=str(ROOT), capture_output=True, text=True, encoding='utf-8',
                       errors='replace', timeout=600)
    try:
        diags = json.loads(r.stdout or '[]')
    except ValueError:
        print('[FAIL] ruff 输出不是 JSON（%d 字节）' % len(r.stdout or ''))
        return Counter({'__ruff_broken__': 1})
    return Counter(d['code'] for d in diags)


def compare(base: dict, cur: Counter) -> List[str]:
    """返回上涨的规则码列表（空 = 通过）。下降自由；新出现的规则码也算上涨。"""
    ups = []
    for code, n in sorted(cur.items()):
        b = int(base.get(code, 0))
        if n > b:
            ups.append('%s: %d > %d' % (code, n, b))
    return ups


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    t0 = time.time()
    cur = current_counts()
    if '--baseline' in sys.argv:
        BASELINE.write_text(json.dumps(dict(sorted(cur.items())), indent=1), encoding='utf-8')
        print('基线已锁定: %d 条 / %d 个规则码' % (sum(cur.values()), len(cur)))
        return 0
    if not BASELINE.exists():
        print('[SKIP] 无基线文件（首次请 --baseline 锁定）')
        return 0
    base = json.loads(BASELINE.read_text(encoding='utf-8'))
    ups = compare(base, cur)
    total = sum(cur.values())
    print('== ruff F 棘轮 ==（%.1fs）' % (time.time() - t0))
    for code in sorted(set(base) | set(cur)):
        b, c = int(base.get(code, 0)), cur.get(code, 0)
        mark = 'OK' if c <= b else 'UP'
        print('  %-6s 基线 %-5d 现值 %-5d %s' % (code, b, c, mark))
    if ups:
        print('[FAIL] 反模式棘轮上涨: %s' % '; '.join(ups))
        print('       处置：当场消化（删未用导入等），多数可 ruff --fix 自动修复；不得上调基线。')
        return 1
    print('[OK] F 规则棘轮全绿（总量 %d）' % total)
    return 0


if __name__ == '__main__':
    import os
    import shutil
    sys.exit(main())
