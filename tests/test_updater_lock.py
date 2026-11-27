# -*- coding: utf-8 -*-
"""依赖锁定与更新器安装逻辑（2026-11-24）。

背景：依赖此前固定了版本但没有任何哈希，安装时拿到什么取决于镜像站与网络。
现在有两份带官方 SHA-256 的锁定文件：
  - server/requirements.lock      跨平台（44 个包，每包列该版本在 PyPI 上的全部制品哈希）
  - server/requirements.win.lock  Windows x64 专属（129 个包 + 3 个构建工具，只列实际选中的制品）
更新器 install_requirements 按“带哈希则强制校验、哈希不符就地阻止”的口径使用跨平台那份。

钉死的契约（subprocess.run 全部打桩，不触网、不安装）：
  A 更新器安装逻辑
    1 锁文件带哈希且校验通过        → 用 --require-hashes，结果注明已校验
    2 哈希校验失败                  → 就地阻止：绝不调用无哈希安装（本案最重要的一条）
    3 非哈希失败（如制品取不到）    → 退回同一份锁文件的无哈希安装，结果注明“本次未能校验哈希”与原因
    4 退回后仍失败                  → 如实报告警告
    5 锁文件不带哈希                → 按固定版本安装、不校验（与补哈希之前的行为一致）
    6 没有锁文件                    → 按 requirements.txt 安装（与旧行为一致）
    7 “锁文件缺哈希字段”不是“哈希不符” → 不得误判为篡改而阻断
  B 锁定文件本体
    8 两份锁文件存在；每个条目都是“固定版本 + sha256”
    9 根 requirements.txt 的固定版本在 Windows 锁文件里一致
   10 跨平台锁文件每个条目至少一个哈希
   11 两份锁文件里都没有重复的包

用法：py tests/test_updater_lock.py   （退出码 0 = 全过）
"""
import os
import re
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_fail = []


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, detail))
    if not cond:
        _fail.append(name)


import updater  # noqa: E402

tmp = tempfile.mkdtemp(prefix='zf_updlk_')


def scenario(lock_text, results):
    """lock_text: 锁文件内容（None 表示没有锁文件）。results: 每次 pip 调用的 (returncode, stderr)。
    返回 (消息, 被调用的命令列表)。"""
    here = os.path.join(tmp, 'case_%d' % len(os.listdir(tmp)))
    os.makedirs(here)
    open(os.path.join(here, 'requirements.txt'), 'w').write('x\n')
    if lock_text is not None:
        open(os.path.join(here, 'requirements.lock'), 'w', encoding='utf-8').write(lock_text)
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd)
        rc, err = results[len(calls) - 1]
        return types.SimpleNamespace(returncode=rc, stderr=err, stdout='')
    return updater.install_requirements('python.exe', here, run=fake_run), calls


HASHED = 'a==1.0 ' + chr(92) + '\n    --hash=sha256:' + '0' * 64 + '\n'
HASHLESS = 'a==1.0\n'
HASH_ERR = ('ERROR: THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE.\n'
            'cryptography==50.0.2 requires sha256 397655da --hash=sha256:00000000')
NET_ERR = 'ERROR: Could not find a version that satisfies the requirement onnxruntime==1.32.0'
FIELD_ERR = ('ERROR: Hashes are required in --require-hashes mode, but they are missing from some '
             'requirements. Here is a list of those requirements along with the hashes their downloaded '
             'archives actually had.')

msg, calls = scenario(HASHED, [(0, '')])
check('1 锁文件带哈希 → 用 --require-hashes 安装锁文件，结果注明已校验',
      len(calls) == 1 and '--require-hashes' in calls[0] and calls[0][-2].endswith('requirements.lock')
      and '已按锁定文件逐个校验哈希' in msg, (len(calls), msg))

msg, calls = scenario(HASHED, [(1, HASH_ERR)])
check('2 哈希校验失败 → 就地阻止，绝不调用无哈希安装',
      len(calls) == 1 and '已阻止' in msg and 'server/requirements.lock' in msg, (len(calls), msg))

msg, calls = scenario(HASHED, [(1, NET_ERR), (0, '')])
check('3 非哈希失败 → 退回同一份锁文件的无哈希安装，结果写明本次未能校验哈希与原因',
      len(calls) == 2 and calls[1][-2].endswith('requirements.lock') and '--require-hashes' not in calls[1]
      and '本次未能校验哈希' in msg and 'onnxruntime' in msg, (len(calls), msg))

msg, calls = scenario(HASHED, [(1, NET_ERR), (1, 'ERROR: 第二次也失败')])
check('4 退回后仍失败 → 如实报告警告', len(calls) == 2 and '警告' in msg and '第二次也失败' in msg, msg)

msg, calls = scenario(HASHLESS, [(0, '')])
check('5 锁文件不带哈希 → 按固定版本安装、不加 --require-hashes、结果不声称已校验',
      len(calls) == 1 and '--require-hashes' not in calls[0] and calls[0][-2].endswith('requirements.lock')
      and msg == '依赖已更新', (calls, msg))

msg, calls = scenario(None, [(0, '')])
check('6 没有锁文件 → 与旧行为一致，按 requirements.txt 安装',
      len(calls) == 1 and calls[0][-2].endswith('requirements.txt') and msg == '依赖已更新', (calls, msg))

msg, calls = scenario(HASHED, [(1, FIELD_ERR), (0, '')])
check('7 “锁文件缺哈希字段”不是“哈希不符” → 不误判为篡改，走退回并如实注明未校验',
      len(calls) == 2 and '已阻止' not in msg and '本次未能校验哈希' in msg, (len(calls), msg))

msg, calls = scenario(HASHED, [(1, 'error: these packages do not match the hashes from the requirements file')])
check('2b 哈希类报错不区分大小写 → 同样阻止', len(calls) == 1 and '已阻止' in msg, (len(calls), msg))

# ===== B 锁定文件本体 =====
PIN = re.compile(r'^([A-Za-z0-9_.\-]+)==(\S+)', re.M)
canon = lambda s: re.sub(r'[-_.]+', '-', s).lower()


def load_lock(rel):
    """返回 [(包名, 版本, 块内首个 sha256 或 None)]；块 = 该条目到下一个条目之间的文本。"""
    path = os.path.join(ROOT, rel)
    if not os.path.isfile(path):
        return None
    text = open(path, encoding='utf-8').read()
    ms = list(PIN.finditer(text))
    entries = []
    for i, m in enumerate(ms):
        end = ms[i + 1].start() if i + 1 < len(ms) else len(text)
        hm = re.search(r'--hash=sha256:([0-9a-f]{64})', text[m.end():end])
        entries.append((m.group(1), m.group(2), hm.group(1) if hm else None))
    return entries


win = load_lock('server/requirements.win.lock')
lin = load_lock('server/requirements.lock')
check('8a server/requirements.win.lock 存在，每个条目都是“固定版本 + 64 位 sha256”',
      bool(win) and len(win) >= 100 and all(h for _n, _v, h in win), '%d 条' % len(win or []))
check('8b server/requirements.lock 存在，每个条目都是“固定版本 + 64 位 sha256”',
      bool(lin) and len(lin) >= 40 and all(h for _n, _v, h in lin), '%d 条' % len(lin or []))

root_pins = []
for line in open(os.path.join(ROOT, 'requirements.txt'), encoding='utf-8'):
    m = re.match(r'\s*([A-Za-z0-9_.\-]+)\s*==\s*([^#\s]+)', line)
    if m and not line.strip().startswith('#'):
        root_pins.append((m.group(1), m.group(2)))
win_ver = {canon(n): v for n, v, _h in win}
check('9 根 requirements.txt 的固定版本，在 Windows 锁文件里版本一致',
      all(win_ver.get(canon(n)) == v for n, v in root_pins),
      [(n, v, win_ver.get(canon(n))) for n, v in root_pins if win_ver.get(canon(n)) != v])

lin_text = open(os.path.join(ROOT, 'server/requirements.lock'), encoding='utf-8').read()
# 按条目切块（每个条目从“包名==”行开始），统计各块的哈希数
_hashes_per_entry = [len(re.findall(r'--hash=sha256:[0-9a-f]{64}', block)) for block in
                     re.split(r'(?m)^(?=[A-Za-z0-9_.\-]+==)', lin_text)[1:]]
check('10 跨平台锁文件每个条目至少一个哈希', len(_hashes_per_entry) == len(lin)
      and all(h >= 1 for h in _hashes_per_entry), '%d 个条目' % len(_hashes_per_entry))
check('10b 跨平台锁文件列的是该版本的全部制品哈希（哈希总数远大于条目数，Linux/macOS 也能通过校验）',
      sum(_hashes_per_entry) > 10 * len(_hashes_per_entry),
      '%d 个哈希 / %d 个条目' % (sum(_hashes_per_entry), len(_hashes_per_entry)))

for rel, entries in (('server/requirements.win.lock', win), ('server/requirements.lock', lin)):
    names = [canon(n) for n, _v, _h in entries]
    check('11 %s 里没有重复的包' % rel, len(names) == len(set(names)))

import shutil  # noqa: E402
shutil.rmtree(tmp, ignore_errors=True)

print('== 依赖锁定与更新器安装回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
