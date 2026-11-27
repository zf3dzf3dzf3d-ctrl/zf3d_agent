# -*- coding: utf-8 -*-
"""gen_lock.py - 由 requirements.txt 生成 Windows x64 专属、带官方 SHA-256 的完整依赖锁定文件
server/requirements.win.lock。

为什么需要：requirements.txt 只固定了直接依赖的版本，传递依赖未固定，且没有任何哈希。
安装时拿到的是什么，取决于当时的镜像站与网络。锁定文件把“解析结果 + 每个制品的官方哈希”钉死，
安装时用 --require-hashes 逐个校验：镜像被污染、缓存被替换、传输被篡改都会被 pip 当场拒绝。

怎么生成：让 pip 在“只解析、不安装”模式下做一次完整解析（--dry-run --report），
解析报告里每个包都带所选制品的下载地址与官方 sha256，本脚本只是把它整理成锁定格式。

用法：
    py tools/quality/gen_lock.py              # 生成 server/requirements.win.lock
    py tools/quality/gen_lock.py --check      # 只校验现有锁定文件能否通过 --require-hashes 解析

适用平台：Windows x64 + 内嵌 Python 3.11.9（wheel 按 cp311 / win_amd64 选定，与随包分发的解释器一致）。
升级依赖：先改 requirements.txt，再重跑本脚本。
"""
import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REQ = ROOT / 'requirements.txt'
LOCK = ROOT / 'server' / 'requirements.win.lock'
CANON = re.compile(r'[-_.]+')


def canon(name):
    return CANON.sub('-', name).lower()


HEADER = '''# requirements.win.lock - Windows x64 专属的完整依赖锁定（直接依赖 + 传递依赖 + 每个制品的官方 SHA-256）
#
# 本文件是生成物，不要手改。生成：py tools/quality/gen_lock.py   （源头是 requirements.txt）
# 安装：pip install --require-hashes -r server/requirements.win.lock
#       哈希不匹配时 pip 拒绝安装——这是它的职责，不要去掉 --require-hashes 来“先装上再说”。
# 适用：Windows x64 + 内嵌 Python 3.11.9。
#
# 与同目录 requirements.lock 的分工：那一份是跨平台清单（Linux / macOS / 更新器使用），每个包列出该版本
# 在 PyPI 上的全部制品哈希；本文件只含 pip 在 Windows x64 + cp311 上实际会选中的那一个制品，
# 用途是“用脚本重建内嵌运行时”时有可验证的基准。更新器不读本文件（Windows 正式版自带预装依赖的 python/）。
#
# 解析时间：{when}
# 包数量：{count}（其中源码包 {sdist} 个，构建依赖 {build} 个）
'''


def resolve(requirements_path):
    """让 pip 只解析不安装，返回 [(规范名, 版本, sha256, 是否源码包)]。"""
    with tempfile.TemporaryDirectory(prefix='zf_genlock_') as td:
        report = Path(td) / 'report.json'
        cmd = [sys.executable, '-m', 'pip', 'install', '--dry-run', '--ignore-installed',
               '--report', str(report), '-r', str(requirements_path), '--quiet', '--disable-pip-version-check', '--retries', '5', '--timeout', '60']
        r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode != 0 or not report.exists():
            raise RuntimeError('pip 解析失败（退出码 %s）：%s' % (r.returncode, (r.stderr or r.stdout)[-600:]))
        data = json.loads(report.read_text(encoding='utf-8'))
    out = []
    for it in data.get('install') or []:
        di = it.get('download_info') or {}
        url = di.get('url', '')
        sha = ((di.get('archive_info') or {}).get('hashes') or {}).get('sha256')
        if not sha:
            raise RuntimeError('解析结果缺少 sha256：%s' % it.get('metadata', {}).get('name'))
        out.append((canon(it['metadata']['name']), it['metadata']['version'], sha, not url.endswith('.whl')))
    return sorted(out)


def direct_names():
    names = []
    for line in REQ.read_text(encoding='utf-8').splitlines():
        m = re.match(r'\s*([A-Za-z0-9_.\-]+)\s*(==|>=|<|>|~=)', line)
        if m and not line.strip().startswith('#'):
            names.append(canon(m.group(1)))
    return names


def generate():
    items = resolve(REQ)
    sdist = [x for x in items if x[3]]
    build = []
    if sdist:
        # 哈希校验模式下，源码包的构建工具也必须带哈希——pip 会到同一份需求文件里找它们
        with tempfile.TemporaryDirectory(prefix='zf_genlock_') as td:
            seed = Path(td) / 'seed.txt'
            seed.write_text('setuptools\nwheel\n', encoding='utf-8')
            build = resolve(seed)
            build = [x for x in build if not x[3]]      # 构建工具自身只接受 wheel
        if len(build) < 2:
            raise RuntimeError('未能解析出构建工具（setuptools / wheel）的哈希')
    direct = set(direct_names())
    lines, seen = [], set()
    lines.append('# ---- 构建工具（仅当存在源码包时需要；哈希校验模式要求它们同样带哈希）----')
    for name, ver, sha, _ in build:
        lines.append('%s==%s \\\n    --hash=sha256:%s' % (name, ver, sha))
        seen.add(name)
    lines.append('')
    lines.append('# ---- 直接依赖（版本源头见 requirements.txt 的同名条目）----')
    for name, ver, sha, is_sd in items:
        if name in direct:
            lines.append('%s==%s \\\n    --hash=sha256:%s%s' % (name, ver, sha, '   # 源码包' if is_sd else ''))
            seen.add(name)
    lines.append('')
    lines.append('# ---- 传递依赖 ----')
    for name, ver, sha, is_sd in items:
        if name not in seen:
            lines.append('%s==%s \\\n    --hash=sha256:%s%s' % (name, ver, sha, '   # 源码包' if is_sd else ''))
    import datetime
    text = HEADER.format(when=datetime.datetime.now().strftime('%Y-%m-%d %H:%M'),
                         count=len(items), sdist=len(sdist), build=len(build)) + '\n'.join(lines) + '\n'
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    LOCK.write_text(text, encoding='utf-8', newline='\n')
    return len(items), len(sdist), len(build)


def check():
    """用 --require-hashes 重新解析一遍现有锁定文件：任何一条哈希对不上、或文件格式有误都会失败。"""
    if not LOCK.exists():
        print('[FAIL] 缺少 server/requirements.win.lock')
        return 1
    cmd = [sys.executable, '-m', 'pip', 'install', '--dry-run', '--ignore-installed',
           '--require-hashes', '-r', str(LOCK), '--quiet', '--disable-pip-version-check', '--retries', '5', '--timeout', '60']
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('[FAIL] 锁定文件未通过 --require-hashes 解析（退出码 %s）：' % r.returncode)
        print((r.stderr or r.stdout)[-1200:])
        return 1
    n = len([l for l in LOCK.read_text(encoding='utf-8').splitlines() if re.match(r'^[A-Za-z0-9_.\-]+==', l)])
    print('[OK] server/requirements.win.lock 通过 --require-hashes 解析，共 %d 个带哈希的条目' % n)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只校验现有锁定文件')
    a = ap.parse_args()
    if a.check:
        return check()
    n, s, b = generate()
    print('[OK] 已生成 %s：%d 个包（源码包 %d 个，构建依赖 %d 个）' % (LOCK.name, n, s, b))
    return check()


if __name__ == '__main__':
    sys.exit(main())
