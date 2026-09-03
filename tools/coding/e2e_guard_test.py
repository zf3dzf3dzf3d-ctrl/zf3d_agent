#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E2E 验证：三种破坏场景全部可恢复（改不坏防护体系 lp-20260902-053009 · 步骤 7）
场景 A：写坏语法 → 预检闸门拦截（拒写，文件不落盘）
场景 B：绕过预检直接写坏 → timeline 撤销恢复
场景 C：多步操作后回退中间步骤 → undo_step 安全回退（revert，不删后续）
"""
import os
import sys
import subprocess
import shutil
import importlib

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, 'server'))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'coding', 'backend'))
os.chdir(ROOT)

RESULTS = []


def ok(name, cond, extra=''):
    RESULTS.append((name, bool(cond), extra))
    print(('[PASS] ' if cond else '[FAIL] ') + name + ('  ' + extra if extra else ''))


def run(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return r.returncode, (r.stdout or '') + (r.stderr or '')


class FakeCtx:
    def __init__(self, project_dir=None):
        self.project_dir = project_dir or ROOT
        self.resp = None

    def send_error(self, msg):
        self.resp = {'ok': False, 'error': msg}

    def send_json(self, obj):
        self.resp = obj


# ---------- 场景 A：预检闸门 ----------
print('=== 场景 A：坏语法被预检拦截 ===')
from tools.coding.backend._preflight import check_syntax
bad_py = 'def f(:\n  pass\n'
bad_js = 'var a = {{{'
good_py = 'def f():\n    return 1\n'
ok('A1 坏 py 被拦', check_syntax(victim if False else 'x.py', bad_py)[0] is False, str(check_syntax('x.py', bad_py))[:120])
ok('A2 坏 js 被拦', check_syntax('x.js', bad_js)[0] is False)
ok('A3 好 py 放行', check_syntax('x.py', good_py)[0] is True)
ok('A4 md 放行', check_syntax('x.md', '# hello')[0] is True)

import tools.coding.backend.write as wmod
importlib.reload(wmod)

victim = os.path.join(ROOT, 'private', 'e2e_victim.py')
if os.path.exists(victim):
    os.remove(victim)
ctx = FakeCtx()
wmod.handle({'path': victim, 'content': bad_py}, ctx)
ok('A5 write 工具拒写坏 py', ctx.resp is not None and ctx.resp.get('ok') is False,
   str(ctx.resp)[:120])
ok('A6 坏文件未落盘', not os.path.exists(victim))

def _latest_step():
    """读项目账本最近一个未撤销的 step 号。"""
    import json as _j
    p = os.path.join(ROOT, 'private', 'agent_steps', 'steps.jsonl')
    latest = None
    try:
        with open(p, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = _j.loads(line)
                except Exception:
                    continue
                if isinstance(rec, dict) and not rec.get('undone'):
                    latest = rec.get('step')
    except Exception:
        pass
    return latest


# ---------- 场景 B：绕过预检写坏 → 撤销恢复 ----------
print('=== 场景 B：绕过预检写坏 → 回滚恢复 ===')
# 模拟"绕过"：写到项目可写区（public 下临时文件），内容语法合法但语义破坏
evil = os.path.join(ROOT, 'public', '_e2e_victim.js')
if os.path.exists(evil):
    os.remove(evil)
ctx2 = FakeCtx()
wmod.handle({'path': evil, 'content': 'var x = "hacked-evil-payload";\nwhile(true){}\n'.replace('while(true){}', '/*evil*/ console.log("hacked")'), }, ctx2)
ok('B1 语法合法的破坏代码被写入', os.path.exists(evil), str(ctx2.resp)[:120])
# auto-checkpoint 已自动提交 → git 历史里能找回写入前状态
code, out = run('git log --oneline -3 -- "%s"' % evil.replace('\\', '/'))
ok('B2 auto-checkpoint 已记账（git log 有该文件提交）', out.strip() != '', out.strip()[:100])
# timeline 撤销最近一步
import tools.coding.backend.timeline as tmod
importlib.reload(tmod)
ctx3 = FakeCtx()
tmod.handle({'action': 'rollback', 'step': _latest_step()}, ctx3)
resp3 = ctx3.resp
ok('B3 timeline rollback 执行', resp3 is not None and resp3.get('ok'), str(resp3)[:150])
# 回滚后文件应恢复到无害状态（撤销生成 revert 提交，把写入还原）
if os.path.exists(evil):
    content = open(evil, encoding='utf-8').read()
    ok('B4 文件回滚到无害状态', 'hacked' not in content, content[:80])
else:
    ok('B4 文件已回滚（不存在=恢复原状）', True)

# ---------- 场景 C：多步操作后回退中间步骤 ----------
print('=== 场景 C：多步 → 中间步骤安全回退 ===')
import tempfile
tmp = tempfile.mkdtemp(prefix='e2e_git_')
run('cd /d "%s" && git init -q && git config user.email t@t && git config user.name t' % tmp)
commits = []
for i, (fname, body) in enumerate([('a.txt', 'A1'), ('b.txt', 'B1'), ('c.txt', 'C1')]):
    open(os.path.join(tmp, fname), 'w').write(body)
    run('cd /d "%s" && git add -A && git commit -qm "step%d"' % (tmp, i + 1))
    c, h = run('cd /d "%s" && git rev-parse --short HEAD' % tmp)
    commits.append(h.strip())
ledger = os.path.join(tmp, 'private', 'agent_steps', 'steps.jsonl')
os.makedirs(os.path.dirname(ledger), exist_ok=True)
with open(ledger, 'w', encoding='utf-8') as f:
    for i, c in enumerate(commits):
        f.write(__import__('json').dumps({'step': i + 1, 'commit': c, 'message': 'step%d' % (i + 1), 'time': 't%d' % (i + 1)}) + '\n')

import tools.coding.backend.undo_step as umod
importlib.reload(umod)
ctx4 = FakeCtx(tmp)
umod.handle({'path': tmp, 'step': 2}, ctx4)
ok('C1 undo_step(中间步骤) 成功', ctx4.resp is not None and ctx4.resp.get('ok'), str(ctx4.resp)[:150])
_, log = run('cd /d "%s" && git log --oneline' % tmp)
ok('C2 历史未删（revert 而非 reset，>=3 条提交）', len([l for l in log.splitlines() if l.strip()]) >= 3,
   ' | '.join(log.splitlines()))
c1 = os.path.exists(os.path.join(tmp, 'c.txt'))
ok('C3 后续提交的文件保留（c.txt 还在）', c1)
shutil.rmtree(tmp, ignore_errors=True)

# 清理 e2e 残留（victim 可能已被回滚删除）
for f in [victim, victim + '.bak', evil]:
    if os.path.exists(f):
        os.remove(f)

print()
fails = [r for r in RESULTS if not r[1]]
print('总计 %d 项，失败 %d 项' % (len(RESULTS), len(fails)))
for n, _, e in fails:
    print('  FAIL:', n, e)
sys.exit(1 if fails else 0)
