# -*- coding: utf-8 -*-
"""dep_audit.py - 对依赖锁定文件做已知漏洞审计（封装 pip-audit）。

审计对象是两份锁定文件（版本已固定，所以用 --no-deps 逐条查漏洞库，不再解析依赖）：
  - server/requirements.lock      跨平台（Linux / macOS / 更新器使用）
  - server/requirements.win.lock  Windows x64 专属（重建内嵌运行时用）

pip-audit 以 -r 方式审计时可能漏掉个别条目（例如只被源码包构建用到的构建工具）。
本脚本把“锁定文件里有、审计结果里没有”的条目单独再查一遍，并在输出里报告覆盖情况——
不把“没查到”当成“没问题”。

用法：
    py tools/quality/dep_audit.py              # 审计两份锁定文件；任一存在已知漏洞 → 退出码 1
    py tools/quality/dep_audit.py --report     # 只报告不判失败（run_checks 用：结果取决于漏洞库与网络，
                                                # 不能让离线机器的门禁因此变红）
需要：py -m pip install pip-audit；联网访问 PyPI 漏洞数据。
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGETS = [ROOT / 'server' / 'requirements.lock', ROOT / 'server' / 'requirements.win.lock']
PIN = re.compile(r'^([A-Za-z0-9][A-Za-z0-9_.\-]*)==([A-Za-z0-9][A-Za-z0-9.+!\-]*)')
CANON = re.compile(r'[-_.]+')


def canon(name):
    return CANON.sub('-', name).lower()


def pins(path):
    out = []
    for line in path.read_text(encoding='utf-8').splitlines():
        m = PIN.match(line)
        if m:
            out.append((canon(m.group(1)), m.group(2)))
    return out


def _run_audit(req_path):
    """对一个需求文件跑 pip-audit，返回 {规范包名: [漏洞条目]}；工具自身出错时抛 RuntimeError。"""
    cmd = [sys.executable, '-m', 'pip_audit', '--requirement', str(req_path), '--no-deps',
           '--format', 'json', '--progress-spinner', 'off']
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    # 退出码 0 = 无漏洞；1 = 有漏洞；其它 = 工具自身出错
    if r.returncode not in (0, 1) or not (r.stdout or '').strip():
        raise RuntimeError('pip-audit 未能完成（退出码 %s）：%s' % (
            r.returncode, (r.stderr or r.stdout or '无输出')[-500:]))
    data = json.loads(r.stdout)
    return {canon(x.get('name') or ''): (x.get('vulns') or []) for x in data.get('dependencies') or []}


def _osv_query(name, version):
    """直接查 OSV 漏洞库（osv.dev）。用于 pip-audit 默认跳过的条目（setuptools / wheel / packaging）。
    返回 [漏洞ID]；查询失败抛 RuntimeError（不把“查不到”当成“没问题”）。"""
    import urllib.request
    body = json.dumps({'package': {'name': name, 'ecosystem': 'PyPI'}, 'version': version}).encode('utf-8')
    req = urllib.request.Request('https://api.osv.dev/v1/query', data=body,
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'zf-dep-audit/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode('utf-8'))
    out = []
    for v in data.get('vulns') or []:
        vid = v.get('id') or '?'
        aliases = [a for a in (v.get('aliases') or []) if a.startswith('CVE')]
        fixed = sorted({fv for aff in (v.get('affected') or []) for rnge in (aff.get('ranges') or [])
                        for ev in (rnge.get('events') or []) if ev.get('fixed') for fv in [ev.get('fixed')]})
        out.append({'id': aliases[0] if aliases else vid, 'fix_versions': fixed})
    return out


def audit_lock(path):
    """返回 (漏洞列表 [(包, 版本, 漏洞ID, 修复版本)], 覆盖条目数, 总条目数)。"""
    all_pins = pins(path)
    found = _run_audit(path)
    missing = [(n, v) for n, v in all_pins if n not in found]
    if missing:
        # 把漏掉的条目写成一份只有“包名==版本”的临时需求文件再查一遍
        with tempfile.TemporaryDirectory(prefix='zf_depaudit_') as td:
            extra = Path(td) / 'extra.txt'
            extra.write_text(''.join('%s==%s\n' % (n, v) for n, v in missing), encoding='utf-8')
            found.update(_run_audit(extra))
    # 仍没覆盖的（pip-audit 对 setuptools / wheel 等有硬编码跳过）：逐个直接查 OSV
    via_osv = []
    for name, ver in all_pins:
        if name in found:
            continue
        found[name] = _osv_query(name, ver)
        via_osv.append(name)
    vulns = []
    for name, ver in all_pins:
        for v in found.get(name) or []:
            vulns.append((name, ver, v.get('id') or '?', ', '.join(v.get('fix_versions') or []) or '无修复版本'))
    covered = sum(1 for n, _v in all_pins if n in found)
    audit_lock.last_via_osv = via_osv
    return vulns, covered, len(all_pins)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--report', action='store_true', help='只报告，不因存在漏洞而判失败')
    a = ap.parse_args()
    total = 0
    tool_error = False
    for path in TARGETS:
        rel = path.relative_to(ROOT).as_posix()
        if not path.exists():
            print('  [跳过] %s 不存在' % rel)
            continue
        try:
            vulns, covered, n = audit_lock(path)
        except (RuntimeError, ValueError, OSError) as e:
            print('  [未能审计] %s：%s' % (rel, e))
            print('            （pip-audit 未安装或漏洞库不可达。安装：py -m pip install pip-audit）')
            tool_error = True
            continue
        tag = 'OK' if not vulns else '有漏洞'
        print('  [%s] %s：%d / %d 个条目已审计，已知漏洞 %d 条' % (tag, rel, covered, n, len(vulns)))
        via = getattr(audit_lock, 'last_via_osv', [])
        if via:
            print('         其中 %d 个条目 pip-audit 默认跳过，已直接查 OSV 漏洞库补上：%s'
                  % (len(via), ', '.join(via)))
        for name, ver, vid, fix in vulns:
            print('         %-22s %-10s %-18s 修复版本: %s' % (name, ver, vid, fix))
        total += len(vulns)
    if tool_error:
        print('  [报告] 审计未能全部完成（见上）')
        return 0 if a.report else 2
    if total and not a.report:
        print('  [FAIL] 依赖存在 %d 条已知漏洞。处置：在 requirements.txt / server/requirements.txt 升级到修复版本，'
              '重新生成锁定文件（py tools/quality/gen_lock.py、py tools/quality/add_lock_hashes.py）后复审。' % total)
        return 1
    print('  [%s] %s' % ('报告' if a.report else 'OK', '依赖漏洞审计完成，已知漏洞 %d 条' % total))
    return 0


if __name__ == '__main__':
    sys.exit(main())
