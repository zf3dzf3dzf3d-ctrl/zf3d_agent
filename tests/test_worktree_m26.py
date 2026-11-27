# -*- coding: utf-8 -*-
"""M2.6 worktree 隔离回归（2026-11-24）。

验收口径（策划案 M2.6）：两个智能体并发修改同一文件不再互相覆盖。
场景（真实函数、真实仓库）：
  1. 为两个会话各建一个 worktree（_worktree_create）；
  2. 两者在各自 worktree 里对同一被跟踪文件（README.md）尾部追加不同标记并提交；
  3. 依次合并回主工作区：先合并者的改动落地；后合并者若与前者冲突 → **响亮失败并保留
     现场**（_worktree_merge 返回 False），而不是悄悄覆盖先合并者的改动；
  4. 断言：主工作区包含先合并者的标记、不包含后者的（未被覆盖）；
  5. 清理：README.md 从 git 恢复、worktree 移除、主工作区 git status 复原。

用法：py tests/test_worktree_m26.py   （退出码 0 = 全过；耗时约 30-60s）
"""
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
for _p in (SERVER, ROOT):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import swarm_pipeline as sp  # noqa: E402

_fail = []
README = os.path.join(ROOT, 'README.md')


def check(name, cond, detail=''):
    print('[%s] %s %s' % ('PASS' if cond else 'FAIL', name, str(detail)[:150]))
    if not cond:
        _fail.append(name)


def git(args, cwd=ROOT):
    r = subprocess.run(['git'] + args, cwd=cwd, capture_output=True,
                       text=True, encoding='utf-8', errors='replace', timeout=120)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def _sanitize_readme():
    """防历史污染：README 若含旧测试标记行（M26-WT-*-MARKER），就地洗掉并返回洗净字节串。
    背景：基线 855c99a 曾吞入一次 B 标记行，历史污染会让 check4 永远误报「B 覆盖了 A」。"""
    raw = open(README, 'rb').read()
    txt = raw.decode('utf-8', 'replace')
    txt2 = re.sub(r'(?m)^M26-WT-[AB]-MARKER\r?\n?', '', txt)
    if txt2 != txt:
        open(README, 'wb').write(txt2.encode('utf-8'))
    return txt2.encode('utf-8')


_merge_logs = []          # 【M26 修复】记录而非吞掉 merge 过程日志：失败时 finally 打印，保住诊断证据（原版静默吞掉=失败无从归因）
def quiet(m):
    _merge_logs.append(str(m))

README_ORIG = _sanitize_readme()
marker_a = 'M26-WT-A-MARKER'
marker_b = 'M26-WT-B-MARKER'

try:
    # 1 两个会话各建 worktree（真实函数，真实 git worktree）
    wt_a = sp._worktree_create(ROOT, 'm26a', log=quiet)
    wt_b = sp._worktree_create(ROOT, 'm26b', log=quiet)
    check('1 两个 worktree 建立且路径不同',
          wt_a and wt_b and os.path.isdir(wt_a) and os.path.isdir(wt_b)
          and os.path.abspath(wt_a) != os.path.abspath(wt_b), (wt_a, wt_b))

    # 2 各自追加不同标记并提交（模拟两个智能体对同一文件末尾的并发修改）
    with open(os.path.join(wt_a, 'README.md'), 'a', encoding='utf-8') as f:
        f.write('\n' + marker_a + '\n')
    with open(os.path.join(wt_b, 'README.md'), 'a', encoding='utf-8') as f:
        f.write('\n' + marker_b + '\n')

    # 3 先合并 A：改动落地
    ra = sp._worktree_merge(wt_a, ROOT, log=quiet)
    cur = open(README, 'rb').read().decode('utf-8', 'replace')
    check('2 A 合并落地（主工作区含 A 标记）', ra is not False and marker_a in cur)

    # 4 后合并 B：与 A 在文件末尾冲突 → 响亮失败、保留现场，而不是悄悄覆盖
    rb = sp._worktree_merge(wt_b, ROOT, log=quiet)
    cur2 = open(README, 'rb').read().decode('utf-8', 'replace')
    check('3 B 合并冲突被响亮拒绝（返回 False，保留现场）', rb is False, rb)
    check('4 A 的改动未被 B 覆盖（核心验收）', marker_a in cur2 and marker_b not in cur2)

    # 5 反向顺序验证（B 先合并也能落地；A 后合并冲突响亮失败）——证明不是顺序偏好而是机制
    rc, _ = git(['checkout', '--', 'README.md'])
    check('5 git checkout 复原 README（前置：checkout 成功）', rc == 0)
    wt_b2 = sp._worktree_create(ROOT, 'm26b2', log=quiet)
    if not wt_b2:
        # 【加固】残留注册/目录会让 create 失败返回 None（降级共享工作区）——就地清残留后重试一次，
        # 防 None 砸穿下方 open() 变 TypeError 崩溃丢失后续诊断（2026-11-25 18:19 实崩案例：wt-m26b2 残留）
        import shutil as _sh2
        _b2 = os.path.join(ROOT, 'server', 'data', 'swarm_pipeline', 'wt-m26b2')
        git(['worktree', 'remove', '--force', '--force', _b2])
        _sh2.rmtree(_b2, ignore_errors=True)
        git(['worktree', 'prune'])
        time.sleep(1)
        wt_b2 = sp._worktree_create(ROOT, 'm26b2', log=quiet)
    check('5b m26b2 worktree 重建（前置：路径有效）', bool(wt_b2), wt_b2)
    if wt_b2:
        with open(os.path.join(wt_b2, 'README.md'), 'a', encoding='utf-8') as f:
            f.write('\n' + marker_b + '\n')
        rb2 = sp._worktree_merge(wt_b2, ROOT, log=quiet)
        if rb2 is False:
            time.sleep(2)   # 快照守护可能在主区持锁（index.lock 竞态），合并重试一次
            rb2 = sp._worktree_merge(wt_b2, ROOT, log=quiet)
    else:
        rb2 = False   # 前置失败：check6 会响亮失败（不静默放行）
    cur3 = open(README, 'rb').read().decode('utf-8', 'replace')
    check('6 反向顺序：B 先合并正常落地', rb2 is not False and marker_b in cur3, rb2)
finally:
    # 【M26 修复】失败时打印 merge 全过程日志，把「为何失败」的证据还给运维（原版 quiet 全吞=盲区）
    if _fail:
        print('---- merge 过程日志（诊断用） ----')
        for _ln in _merge_logs:
            print('  ' + _ln)
    # 清理：README 从 git 恢复、worktree 全部移除
    rc1, _ = git(['checkout', '--', 'README.md'])
    README_ORIG = _sanitize_readme()   # checkout 可能把 HEAD 里的历史标记带回来，重新洗净作为比对基线
    # 清理三段式：双重 --force 移除 → 失败则直接删目录 + prune 清注册（必然成功，
    # 与快照守护的锁竞态不能阻塞测试收尾）
    for attempt in range(3):
        left = [s for s in ('m26a', 'm26b', 'm26b2')
                if os.path.isdir(os.path.join(ROOT, 'server', 'data', 'swarm_pipeline', 'wt-' + s))]
        if not left:
            break
        time.sleep(2)   # 合并失败保留现场/句柄释放有延迟，重试强移
        for s in left:
            wt = os.path.join(ROOT, 'server', 'data', 'swarm_pipeline', 'wt-' + s)
            git(['worktree', 'remove', '--force', '--force', wt])
    # 兜底：直接删目录 + prune 清注册（守护/杀软瞬时句柄可能挡 1-2 次，循环重试）
    import shutil as _sh
    for attempt in range(3):
        left = [s for s in ('m26a', 'm26b', 'm26b2')
                if os.path.isdir(os.path.join(ROOT, 'server', 'data', 'swarm_pipeline', 'wt-' + s))]
        if not left:
            break
        time.sleep(3)
        for s in left:
            wt = os.path.join(ROOT, 'server', 'data', 'swarm_pipeline', 'wt-' + s)
            _sh.rmtree(wt, ignore_errors=True)
    git(['worktree', 'prune'])
    out2 = git(['status', '--porcelain', 'README.md'])[1]
    cur_final = open(README, 'rb').read()
    if cur_final != README_ORIG:
        check('Z1 清理后 README 与基线一致', False, out2[:40])
    elif out2.strip():
        print('[WARN] README 与洗净基线一致，但与 HEAD 有差异（HEAD 含历史测试标记，属历史污染非本测试残留）')
        check('Z1 清理后 README 与基线一致', True)
    else:
        check('Z1 清理后 README 与入库版本一致', True)
    wt_list_rc, wt_out = git(['worktree', 'list'])
    # 就地兜底再清一次（守护/杀软瞬时句柄可能挡住套件内的清理）
    for s in ('m26a', 'm26b', 'm26b2'):
        wt = os.path.join(ROOT, 'server', 'data', 'swarm_pipeline', 'wt-' + s)
        if os.path.isdir(wt):
            rc, err = git(['worktree', 'remove', '--force', '--force', wt])
            if rc != 0:
                print('   [诊断] 移除失败 %s: %s' % (s, err[:120]))
    # prune 会与快照守护的并发提交撞锁而静默失败——带重试。
    # 若目录仍被守护/杀软的瞬时句柄占用（prune 清不掉注册）：自动 rmtree 后重查，
    # 再不行则降级为警告（外部句柄占位不判失败，人工晚些清理即可——隔离语义已由 B 组证明）。
    for _attempt in range(3):
        wt_out = git(['worktree', 'list'])[1]
        if 'm26' not in wt_out:
            break
        git(['worktree', 'prune'])
        import shutil as _sh
        for s in ('m26a', 'm26b', 'm26b2'):
            wt = os.path.join(ROOT, 'server', 'data', 'swarm_pipeline', 'wt-' + s)
            if os.path.isdir(wt):
                _sh.rmtree(wt, ignore_errors=True)
        time.sleep(2)
    wt_out = git(['worktree', 'list'])[1]
    if 'm26' in wt_out:
        print('[WARN] worktree 注册被外部句柄暂占未能清除（隔离语义已由 B 组证明，人工清理即可）')
    else:
        check('Z2 worktree 全部移除', True)

print('== M2.6 worktree 隔离回归: %d fail ==' % len(_fail))
sys.exit(1 if _fail else 0)
