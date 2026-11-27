# -*- coding: utf-8 -*-
"""一键质量门禁（工程基建总纲 P1.5 20261123）：ruff → 计数器 → 脚本测试 → pytest → bandit 报告。

本地流水线，与未来云 CI 零改造迁移（同一脚本即 CI 步骤）。
用法：py scripts/run_checks.py        # 全量
      py scripts/run_checks.py --quick  # 跳过 bandit 报告（预提交用）
退出码 0 = 全绿；非 0 = 有门禁拦截。
"""
import contextlib
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = sys.executable
F821_BASELINE = ROOT / 'tools' / 'quality' / 'f821_baseline.json'


def relay(result):
    """子步骤输出捕获后转发（避免继承控制台时的吞行）。"""
    for stream in (result.stdout, result.stderr):
        if stream:
            sys.stdout.write(stream)


def run(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], cwd=str(ROOT), **kw)


def find_ruff():
    """python -m ruff 在本机静默无输出（Windows 包装器怪病），必须用原生 exe。"""
    exe = Path(sys.executable).parent / 'Scripts' / ('ruff.exe' if os.name == 'nt' else 'ruff')
    if exe.exists():
        return str(exe)
    return shutil.which('ruff')


def step_counter():
    # 蜂群持续并发写文件，扫描读到中间态会瞬态虚高（同 F821 3× min-scan 防护）——
    # 最多重试 2 次（间隔 3s），取最后一次稳定结果；连续 3 次失败才真拦。
    for attempt in range(3):
        r = run([PY, 'tools/quality/count_antipatterns.py'],
                capture_output=True, text=True, encoding='utf-8', errors='replace')
        relay(r)
        if r.returncode == 0:
            return 0
        if attempt < 2:
            print('  [重试] 反模式计数器瞬态失败（蜂群并发写入），3s 后重试…')
            time.sleep(3)
    return 1


def step_ruff():
    """E9 语法硬拦截（pyproject select=["E9"]）。"""
    exe = find_ruff()
    if not exe:
        print('[SKIP] ruff 未安装（py -m pip install ruff）')
        return 0
    r = run([exe, 'check', '.', '--config', str(ROOT / 'tools/quality/ruff.toml'),
             '--output-format', 'concise'],
            capture_output=True, text=True, encoding='utf-8', errors='replace')
    relay(r)
    if r.returncode != 0:
        print('[FAIL] ruff 退出码 %s' % r.returncode)
        return 1
    return 0


def step_f821():
    """F821 未定义名（潜伏 NameError）：计数基线只许降不许涨。

    计数走 f821_count()（精确计数 + 竞态复测），与 --f821-baseline 锁基线用同一把尺子。
    此前本步自己数 ruff 输出的非空行：ruff 干净时输出一行 "All checks passed!"，被数成 1，
    对基线 0 恒报"上涨 0 -> 1"——代码最干净时门禁反而必红（20261123 外部整改实测发现并修正）。"""
    exe = find_ruff()
    if not exe:
        return 0
    n = f821_count()
    base = None
    if F821_BASELINE.exists():
        import json
        base = json.loads(F821_BASELINE.read_text(encoding='utf-8')).get('count')
    if base is None:
        print('  [提示] 缺 f821_baseline.json，当前 %d 处（py scripts/run_checks.py --f821-baseline 锁定）' % n)
        return 0
    if n > base:
        print('  [FAIL] F821 上涨: %d -> %d（修一处锁一处，不许新增潜伏 NameError）' % (base, n))
        # 仅在真上涨时回显明细
        relay(run([exe, 'check', '.', '--config', str(ROOT / 'tools/quality/ruff.toml'),
                   '--select', 'F821', '--output-format', 'concise'],
                  capture_output=True, text=True, encoding='utf-8', errors='replace'))
        return 1
    print('  [OK] F821 %d/%d（基线 %d，Phase 2 分批归零）' % (n, base, base))
    return 0

# 破坏性/特殊用途脚本不进自动门禁（各文件头部有说明）：
#   test_fullchain_boot.py 改写 private/port.json 并启停服务进程，只许单独手工跑
#   probe_zplug_guard.py / _auth_check.py 是探针与辅助脚本，非测试
TEST_BLOCKLIST = {'test_fullchain_boot.py'}
TEST_TIMEOUT = 120


def step_script_tests():
    """本仓测试体系为脚本式（assert + 退出码自报），逐个收退出码。"""
    fails = []
    total = 0
    t0 = time.time()
    for f in sorted((ROOT / 'tests').glob('test_*.py')):
        if f.name in TEST_BLOCKLIST:
            print('  [SKIP] %s（破坏性集成实测，单独手工跑）' % f.name)
            continue
        total += 1
        try:
            r = run([PY, f], timeout=TEST_TIMEOUT,
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            rc = r.returncode
        except subprocess.TimeoutExpired:
            rc = -99
        mark = 'PASS' if rc == 0 else 'FAIL(rc=%s)' % rc
        if rc != 0:
            fails.append(f.name)
        print('  [%s] %s' % (mark, f.name))
    print('  脚本测试: %d/%d 通过, 耗时 %.1fs' % (total - len(fails), total, time.time() - t0))
    return 1 if fails else 0


def _ast_excluded_tests():
    """复用 tests/conftest.py 的 AST 规则：模块级 sys.exit 的脚本式文件不进 pytest。"""
    import importlib.util
    cfg = ROOT / 'tests' / 'conftest.py'
    if not cfg.exists():
        return set()
    spec = importlib.util.spec_from_file_location('zf_gate_conftest', str(cfg))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return set(mod.collect_ignore)


def step_pytest():
    """pytest 收编 pytest 式用例（蜂群 20261123 起开始产出，如 test_plaza_safety）。

    【逐文件隔离】单进程收集时，先被 import 的脚本式文件会污染 sys.modules
    （引导插件内核 / chdir / `import server` 解析成模块非包），殃及后续真用例
    （实测 test_plaza_safety 被 banner_switch 污染炸掉收集，退出码 2）。
    故每个 test_*.py 单独起一个 pytest 进程：互不污染、互不连带。
    退出码 5（无用例）= 脚本式文件被 import 跑完自身断言后自然结束，算通过。
    """
    try:
        import pytest  # noqa: F401
    except ImportError:
        print('[SKIP] pytest 未安装')
        return 0
    excluded = _ast_excluded_tests()
    fails = []
    n_ran = 0
    for f in sorted((ROOT / 'tests').glob('test_*.py')):
        if f.name in excluded:
            continue
        r = run([PY, '-m', 'pytest', '-q', '--no-header',
                 '-c', str(ROOT / 'tools/quality/pytest.ini'), '--rootdir', '.', str(f)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if r.returncode == 5:
            continue  # 无 pytest 式用例（脚本体已跑完自身断言）
        n_ran += 1
        if r.returncode != 0:
            fails.append(f.name)
    if fails:
        print('  [FAIL] pytest 式用例失败: %s（单独运行 py -m pytest -q tests/<文件> 查详情）'
              % ', '.join(fails))
        return 1
    print('  [OK] pytest 逐文件隔离全绿（含用例文件 %d 个）' % n_ran)
    return 0


def step_bandit():
    """安全扫描只出报告不拦截（存量问题归 Phase 3 整改），但必须覆盖 ai_proxy.py
    ——此前的 bandit -r server 盲区漏掉了根目录计费网关。"""
    try:
        import bandit  # noqa: F401
    except ImportError:
        print('[SKIP] bandit 未安装')
        return 0
    r = run([PY, '-m', 'bandit', '-q', '-r', '.', '-x', 'archive,历史版本,private,python,node_modules,docs,public'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print('  [报告] bandit 扫描完成（rc=%s，存量问题见 py -m bandit -r . 报告，Phase 3 整改）' % r.returncode)
    return 0


def f821_count():
    exe = find_ruff()
    args = [exe, 'check', '.', '--config', str(ROOT / 'tools/quality/ruff.toml'),
            '--select', 'F821', '--output-format', 'concise']

    def once():
        r = run(args, capture_output=True, text=True, encoding='utf-8', errors='replace')
        # 精确计数：只数含 F821 的发现行（20261123 教训：ruff 干净时输出
        # "All checks passed!" 非空行，朴素行数把它数成 1 造成幻影上涨）
        return len([ln for ln in (r.stdout or '').splitlines()
                    if 'F821' in ln and not ln.strip().startswith('warning:')])

    # 蜂群持续并发写文件，扫描读到中间态的瞬态虚高会持续数秒——
    # 3 次扫描（间隔 3s）取最小值：瞬态被吸收，持续真上涨保留拦截
    # （20261123 三次竞态误报的最终根治；当前活体仓库的固有约束）
    n = once()
    if n:
        for _ in range(2):
            time.sleep(3)
            n = min(n, once())
    return n


def step_ruff_ratchet():
    """M2.2 ruff F 规则棘轮（tools/quality/ruff_baseline.json 基线，只降不升）。"""
    r = run([PY, 'tools/quality/ruff_ratchet.py'],
            capture_output=True, text=True, encoding='utf-8', errors='replace')
    relay(r)
    return r.returncode


def step_coverage_gate():
    """M2.3 核心模块覆盖率门槛（tools/quality/coverage_baseline.json，只升不降）。"""
    r = run([PY, 'tools/quality/coverage_gate.py'],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1800)
    relay(r)
    return r.returncode


def step_type_baseline():
    """M2.1 类型基线（mypy：基线外新增文件零错误；基线内单文件只降不升）。"""
    r = run([PY, 'tools/quality/type_baseline.py'],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1800)
    relay(r)
    return r.returncode


def step_dep_audit():
    """依赖漏洞审计（tools/quality/dep_audit.py，对象是两份带哈希的锁定文件）。只出报告不拦截：
    结果取决于漏洞库与网络，不能让离线机器的门禁因此变红。发布前以
    `py tools/quality/dep_audit.py`（不带 --report）为准，要求已知漏洞为 0。"""
    r = run([PY, 'tools/quality/dep_audit.py', '--report'],
            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    relay(r)
    return 0


def main():
    with contextlib.suppress(Exception):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if '--f821-baseline' in sys.argv:
        import json
        n = f821_count()
        F821_BASELINE.write_text(json.dumps(
            {'count': n, 'locked': time.strftime('%Y-%m-%d'),
             'note': 'exec拼接撤销后首批暴露的潜伏NameError存量，Phase 2 分批归零'},
            ensure_ascii=False, indent=2), encoding='utf-8')
        print('f821 baseline 已锁定: %d 处' % n)
        return 0
    t0 = time.time()
    checks = [('反模式计数器', step_counter), ('ruff', step_ruff),
              ('F821 基线', step_f821), ('ruff F 棘轮', step_ruff_ratchet),
              ('脚本测试', step_script_tests), ('pytest', step_pytest)]
    if '--quick' not in sys.argv:
        checks.append(('bandit', step_bandit))
        checks.append(('类型基线', step_type_baseline))
        checks.append(('覆盖率门槛', step_coverage_gate))
        checks.append(('依赖漏洞审计', step_dep_audit))
    bad = []
    for name, fn in checks:
        print('== %s ==' % name)
        if fn():
            bad.append(name)
    print('\n总耗时 %.1fs' % (time.time() - t0))
    if bad:
        print('[FAIL] 门禁拦截: ' + ', '.join(bad))
        return 1
    print('[OK] 全绿')
    return 0


if __name__ == '__main__':
    sys.exit(main())
