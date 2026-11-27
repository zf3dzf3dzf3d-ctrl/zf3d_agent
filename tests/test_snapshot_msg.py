# -*- coding: utf-8 -*-
"""快照归因改造（方案B）回归测试——验证【自动快照】message 的归因头保留机制。

背景（docs/快照归因改造设计-治理抢入库归因不准-20261124.md）：
  历史快照 commit 曾被「未归因」标签污染（17.8%），且 amend 修正实际清单时
  会毁掉原 message 的 [问]/[答] 归因头（毁尸灭迹，无法回答"这快照是谁的会话"）。
  方案B改造（tools/coding/backend/self_check.py，随基线 855c99a 入库）：
    - _start_message/_end_message 标签统一 [自动快照]（去「未归因」污名化）
    - _amend_msg_to_actual(orig_msg=) 保留归因头、剥旧标签旧时间戳、只更新实际清单
  本文件在隔离临时仓库实跑全流程，15 断言；全部通过输出 TOTAL 行并退出码 0。

运行：python tests/test_snapshot_msg.py
"""
import os, sys, tempfile, subprocess, shutil
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
from tools.coding.backend import self_check as sc

results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

def main():
    repo = tempfile.mkdtemp(prefix='zf_snap_verify_')
    os.makedirs(os.path.join(repo, 'tmp'), exist_ok=True)   # tmp/ 在五查白名单内
    def wf(rel, text):
        p = os.path.join(repo, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(text)
    def git(*args):
        r = subprocess.run(['git', '-C', repo] + list(args), capture_output=True, text=True,
                           encoding='utf-8', errors='replace')
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    try:
        git('init')
        git('config', 'user.name', 'tester')
        git('config', 'user.email', 't@t.local')

        # 用例1：message builder 无「未归因」标签
        sm = sc._start_message('继续agi')
        em = sc._end_message(answer_text='快照归因验证')
        check('start_message 无未归因标签', '[自动快照·未归因]' not in sm and sm.startswith('[自动快照] [问]'), sm)
        check('end_message 无未归因标签', '[自动快照·未归因]' not in em and em.startswith('[自动快照] [答]'), em)

        # 用例2：全流程 commit+amend 保留归因头
        wf('tmp/a.txt', 'hello\n')
        h = sc._commit_with_heal(repo, em)
        check('commit 产出 hash', bool(h), str(h))
        if h:
            h2 = sc._amend_msg_to_actual(repo, h, em)
            code, msg = git('log', '-1', '--format=%s')
            check('amend 后返回 hash', bool(h2))
            check('归因头[答]保留', '[答] 快照归因验证' in msg, msg.strip())
            check('实际清单含 tmp/a.txt', 'tmp/a.txt' in msg, msg.strip())
            check('标签[自动快照]无未归因', '[自动快照·未归因]' not in msg, msg.strip())
            check('时间戳不叠加(仅1个@)', msg.count(' @ ') == 1, msg.strip())

        # 用例3：orig_msg 为空回退 chore: 快照（向后兼容）
        wf('tmp/b.txt', 'b\n')
        h3 = sc._commit_with_heal(repo, 'chore: 会话结束快照 @ 2026-01-01 00:00:00')
        if h3:
            sc._amend_msg_to_actual(repo, h3, '')
            code, msg = git('log', '-1', '--format=%s')
            check('空orig_msg回退chore:快照', 'chore: 快照' in msg and 'tmp/b.txt' in msg, msg.strip())

        # 用例4：剥旧标签防叠加（历史「未归因」message 兼容）
        wf('tmp/c.txt', 'c\n')
        old = '[自动快照·未归因] [答] 旧任务回答 @ 2025-01-01 08:00:00'
        h4 = sc._commit_with_heal(repo, old)
        if h4:
            sc._amend_msg_to_actual(repo, h4, old)
            code, msg = git('log', '-1', '--format=%s')
            check('旧标签剥干净', '未归因' not in msg, msg.strip())
            check('旧时间戳不残留', msg.count(' @ ') == 1 and '2025-01-01' not in msg, msg.strip())
            check('旧归因头[答]保留', '[答] 旧任务回答' in msg, msg.strip())

        # 用例5：>4 文件折叠「等N个」
        for i in range(6):
            wf('tmp/f%d.txt' % i, 'x\n')
        m5 = '[自动快照] [答] 折叠测试 @ 2026-01-01 00:00:00'
        h5 = sc._commit_with_heal(repo, m5)
        if h5:
            sc._amend_msg_to_actual(repo, h5, m5)
            code, msg = git('log', '-1', '--format=%s')
            check('>4文件折叠等6个', '等6个' in msg, msg.strip())

        # 用例6：并发防护——HEAD 漂移时放弃 amend 不改写他人 message
        wf('tmp/g.txt', 'g\n')
        m6 = '[自动快照] [答] 并发测试 @ 2026-01-01 00:00:00'
        h6 = sc._commit_with_heal(repo, m6)
        if h6:
            wf('tmp/other.txt', 'other\n')
            sc._commit_with_heal(repo, '[自动快照] [答] 并发他人提交 @ 2026-01-01 00:00:01')
            ret = sc._amend_msg_to_actual(repo, h6, m6)
            code, msg = git('log', '-1', '--format=%s')
            check('HEAD漂移放弃amend返回原hash', ret == h6, 'ret=%s h6=%s' % (ret, h6))
            check('他人message未被改写', '并发他人提交' in msg, msg.strip())
    finally:
        shutil.rmtree(repo, ignore_errors=True)

    fails = [r for r in results if not r[1]]
    print('SNAPSHOT_MSG_TOTAL=%d PASS=%d FAIL=%d' % (len(results), len(results) - len(fails), len(fails)))
    for n, ok, d in results:
        print(('%s PASS ' % n if ok else '%s FAIL | %s' % (n, d)))
    return 1 if fails else 0

if __name__ == '__main__':
    sys.exit(main())
