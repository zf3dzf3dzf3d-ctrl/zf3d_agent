# -*- coding: utf-8 -*-
"""add_lock_hashes.py - 给已有的版本锁定文件补上 PyPI 官方 SHA-256，不改任何版本。

为什么需要：server/requirements.lock（pip-compile 生成，跨平台）固定了版本但没有哈希，
安装时拿到什么取决于镜像站与网络。补上哈希后，更新器就能用 --require-hashes 逐个制品核对。

与 gen_lock.py 的分工：
  - 本脚本针对“跨平台”锁定文件：每个包列出该版本在 PyPI 上的**全部**制品哈希
    （各平台 wheel + 源码包），所以在 Linux / macOS / Windows 上都能通过校验。
  - gen_lock.py 针对单一平台（Windows x64）：只列 pip 实际会选中的那一个制品。

做法：逐个包读取 PyPI JSON 接口（https://pypi.org/pypi/<包名>/<版本>/json），
取 urls[].digests.sha256。版本一个都不动——只给既有的固定版本加上哈希。

幂等：已有哈希的条目原样保留（重新运行只补缺哈希的条目）。
任何包取不到哈希 → 整体不写盘。

用法：
    py tools/quality/add_lock_hashes.py                  # 处理 server/requirements.lock 并校验
    py tools/quality/add_lock_hashes.py --check [文件]   # 只校验：每个条目都带哈希，且能在 --require-hashes 下解析
"""
import argparse
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LOCK = ROOT / 'server' / 'requirements.lock'
CANON = re.compile(r'[-_.]+')
PIN = re.compile(r'^([A-Za-z0-9][A-Za-z0-9_.\-]*)==([A-Za-z0-9][A-Za-z0-9.+!\-]*)(\s*\\)?\s*$')
HASH_LINE = re.compile(r'^\s+--hash=sha256:([0-9a-f]{64})\s*\\?\s*$')
BACKSLASH = chr(92)
STAMP = '[add_lock_hashes]'


def pypi_hashes(name, version):
    """该版本在 PyPI 上的全部制品 sha256。网络问题退避重试，仍失败则抛错（不静默跳过）。"""
    url = 'https://pypi.org/pypi/%s/%s/json' % (name, version)
    req = urllib.request.Request(url, headers={'User-Agent': 'zf-add-lock-hashes/1.0'})
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read().decode('utf-8'))
            out = []
            for f in data.get('urls') or []:
                h = (f.get('digests') or {}).get('sha256')
                if h and h not in out:
                    out.append(h)
            return out or None
        except (OSError, ValueError) as e:
            last = e
            time.sleep(2.0 * (attempt + 1))
    raise RuntimeError('取不到 %s %s 的 PyPI 哈希：%s' % (name, version, last))


def parse(text):
    """拆成 [(包名, 版本, 已有哈希列表, 其后的注释行)]。

    “其后的注释行” = 紧跟该条目、直到下一个条目或非注释行为止的注释（pip-compile 的 “# via” 注明），
    它们随条目一起保留。"""
    lines = text.split('\n')
    out, i, n = [], 0, len(lines)
    while i < n:
        m = PIN.match(lines[i])
        if not m:
            i += 1
            continue
        name, ver = m.group(1), m.group(2)
        i += 1
        hashes, tail = [], []
        while i < n:
            hm = HASH_LINE.match(lines[i])
            if hm:
                hashes.append(hm.group(1))
            elif lines[i].lstrip().startswith('#'):
                tail.append(lines[i])
            else:
                break
            i += 1
        out.append((name, ver, hashes, tail))
    return out


def render_entries(entries):
    """pip-compile 的哈希风格：
        name==ver \\
            --hash=sha256:... \\
            --hash=sha256:...
            # via ...
    """
    out = []
    for name, ver, hashes, tail in entries:
        if not hashes:
            out.append('%s==%s' % (name, ver))
        else:
            out.append('%s==%s ' % (name, ver) + BACKSLASH)
            for h in hashes[:-1]:
                out.append('    --hash=sha256:%s ' % h + BACKSLASH)
            out.append('    --hash=sha256:%s' % hashes[-1])
        out.extend(tail)
    return out


def process(path):
    text = path.read_text(encoding='utf-8')
    lines = text.split('\n')
    entries = parse(text)
    if not entries:
        raise RuntimeError('%s 里没有识别出任何“包名==版本”条目' % path)
    first = next(i for i, l in enumerate(lines) if PIN.match(l))
    header = [l for l in lines[:first] if STAMP not in l]
    while header and not header[-1].strip():
        header.pop()
    header += [
        '',
        '# %s %s 已补 PyPI 官方 SHA-256（版本一个未动；更新器用 --require-hashes 逐个核对）。'
        % (STAMP, time.strftime('%Y-%m-%d')),
        '# %s 重新 pip-compile 之后哈希会丢，需再跑一次补回：py tools/quality/add_lock_hashes.py' % STAMP,
        '',
    ]
    new_entries, added, kept, failed = [], 0, 0, []
    for name, ver, hashes, tail in entries:
        if hashes:
            kept += 1
        else:
            try:
                hashes = pypi_hashes(name, ver)
            except RuntimeError as e:
                failed.append(str(e))
                hashes = []
            added += 1
        new_entries.append((name, ver, hashes, tail))
    if failed:
        raise RuntimeError('有 %d 个包取不到哈希，未写盘：\n  %s' % (len(failed), '\n  '.join(failed)))
    # 版本一个未动的自检：新旧条目的 (包名, 版本) 序列必须完全一致
    assert [(n, v) for n, v, _h, _t in entries] == [(n, v) for n, v, _h, _t in new_entries]
    out = '\n'.join(header + render_entries(new_entries)).rstrip('\n') + '\n'
    return out, added, kept


def check(path):
    """每个条目都带哈希；且 pip 能在 --require-hashes 下解析（会完整下载逐个核对，较慢）。"""
    entries = parse(path.read_text(encoding='utf-8'))
    if not entries:
        print('[FAIL] 没有识别出任何条目')
        return 1
    missing = ['%s==%s' % (n, v) for n, v, h, _t in entries if not h]
    if missing:
        print('[FAIL] %d / %d 个条目缺哈希：%s' % (len(missing), len(entries), ', '.join(missing[:8])))
        return 1
    print('[OK] %d 个条目全部带哈希，共 %d 个 SHA-256' % (
        len(entries), sum(len(h) for _n, _v, h, _t in entries)))
    cmd = [sys.executable, '-m', 'pip', 'install', '--dry-run', '--ignore-installed',
           '--require-hashes', '-r', str(path), '--quiet', '--disable-pip-version-check',
           '--retries', '5', '--timeout', '60']
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('[FAIL] 未通过 --require-hashes 解析（退出码 %s）：%s' % (r.returncode, (r.stderr or r.stdout)[-900:]))
        return 1
    print('[OK] 通过 --require-hashes 解析')
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', nargs='?', const=str(LOCK), default=None,
                    help='只校验（可指定文件，默认 server/requirements.lock）')
    ap.add_argument('--no-pip-check', action='store_true', help='写盘后不跑耗时的 pip 完整下载校验')
    a = ap.parse_args()
    if a.check:
        return check(Path(a.check))
    out, added, kept = process(LOCK)
    LOCK.write_text(out, encoding='utf-8', newline='\n')
    print('[OK] %s：新增哈希 %d 个条目，保留已有 %d 个条目；版本一个未动' % (LOCK.name, added, kept))
    return 0 if a.no_pip_check else check(LOCK)


if __name__ == '__main__':
    sys.exit(main())
