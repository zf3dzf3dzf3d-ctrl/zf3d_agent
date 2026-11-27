# -*- coding: utf-8 -*-
"""coverage_gate - M2.3 核心模块覆盖率门槛（策划案 M2.3，2026-11-24）。

语义（策划案：门槛从实测基线起步，逐月上调至 70%）：
  - 被测集合：M1 安全防线核心模块（策略/票据/脱敏/不可信登记）；
  - 驱动套件：tests/ 下对应的回归套件（每个套件在独立 coverage 子进程里运行，
    --parallel-mode 落数据分片，最后 combine 汇总）；
  - 门槛按【模块】逐个判定：行覆盖率 ≥ 基线锁定的值。基线 = 首次实测；
    上调门槛 = 改 tools/quality/coverage_baseline.json（策划案：逐月向 70% 收敛）；
  - 套件失败或模块覆盖低于门槛 → 门禁拦截。

用法：
  py tools/quality/coverage_gate.py             # 跑套件 + 度量 + 门槛判定
  py tools/quality/coverage_gate.py --baseline  # 用本次实测重新锁定基线
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict

ROOT = Path(__file__).resolve().parents[2]   # tools/quality/ 上溯两级 = 项目根
BASELINE = ROOT / 'tools' / 'quality' / 'coverage_baseline.json'
DATA_DIR = ROOT / 'tmp' / 'coverage_m23'

CORE_MODULES = [
    'server/util_policy.py',
    'server/util_ticket.py',
    'server/util_key_scrub.py',
    'server/util_untrusted.py',
]
CORE_TESTS = [
    'tests/test_policy_engine.py',
    'tests/test_policy_modes.py',
    'tests/test_approve_ticket.py',
    'tests/test_key_scrub.py',
    'tests/test_untrusted_m15.py',
    'tests/test_capability_wiring.py',
]

TARGET_GOAL = 70   # 策划案 M2.3：门槛逐月上调，向 70% 收敛


def run_suites() -> bool:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for stale in DATA_DIR.glob('.coverage*'):
        stale.unlink()
    # 不用 --include：Windows 下正/反斜杠与大小写导致过滤失配（实测），
    # 全量收集后按模块后缀在 JSON 报告里取数
    for t in CORE_TESTS:
        r = subprocess.run([sys.executable, '-m', 'coverage', 'run', '--parallel-mode',
                            '--data-file', str(DATA_DIR / '.coverage'),
                            str(ROOT / t)],
                           cwd=str(ROOT), capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=600)
        if r.returncode != 0:
            print('[FAIL] 套件失败: %s（覆盖率数据不完整）' % t)
            print((r.stdout or '')[-300:], (r.stderr or '')[-300:])
            return False
    r = subprocess.run([sys.executable, '-m', 'coverage', 'combine',
                        '--data-file', str(DATA_DIR / '.coverage'),
                        str(DATA_DIR)], cwd=str(ROOT), capture_output=True, text=True)
    return True


def measured() -> Dict[str, Any]:
    """用 coverage json 报告读取各核心模块的行覆盖率（0-100）。"""
    out_path = DATA_DIR / 'cov.json'
    subprocess.run([sys.executable, '-m', 'coverage', 'json', '-o', str(out_path),
                    '--data-file', str(DATA_DIR / '.coverage'), '-q'],
                   cwd=str(ROOT), capture_output=True, text=True)
    if not out_path.is_file():
        return {}
    doc = json.loads(out_path.read_text(encoding='utf-8'))
    files = doc.get('files', {})
    out = {}
    for m in CORE_MODULES:
        key = m.replace('\\', '/')
        for fkey, meta in files.items():
            if fkey.replace('\\', '/').endswith(key):
                out[key] = float(meta['summary'].get('percent_covered', 0.0))
                break
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    t0 = time.time()
    if not run_suites():
        return 1
    cur = measured()
    total = sum(cur.values())
    if '--baseline' in sys.argv:
        BASELINE.write_text(json.dumps({k: int(v) for k, v in sorted(cur.items())},
                                       indent=1), encoding='utf-8')
        print('覆盖率基线已锁定: %s（%.0fs）'
              % ({k: str(v) + '%' for k, v in cur.items()}, time.time() - t0))
        return 0
    if not BASELINE.exists():
        print('[SKIP] 无覆盖率基线（首次请 --baseline 锁定）')
        return 0
    base = json.loads(BASELINE.read_text(encoding='utf-8'))
    bad = []
    for m in CORE_MODULES:
        c = cur.get(m)
        b = int(base.get(m, 0))
        c_int = int(c) if c is not None else None
        if c is None:
            bad.append('%s: 套件未覆盖到该模块' % m)
        elif c_int < b:
            bad.append('%s: %.0f%% < 门槛 %.0f%%' % (m, c, b))
        print('  %-30s 实测 %d%% / 门槛 %d%%' % (m, c_int if c_int is not None else -1, b))
    if bad:
        print('[FAIL] 覆盖率门槛拦截: %s' % '; '.join(bad))
        print('       处置：补测试用例（门槛只许升不许降；下调门槛须在提交说明写明理由）。')
        return 1
    print('[OK] 核心模块覆盖率达标（%.0fs，目标向 %d%% 逐月收敛）' % (time.time() - t0, TARGET_GOAL))
    return 0


if __name__ == '__main__':
    sys.exit(main())
