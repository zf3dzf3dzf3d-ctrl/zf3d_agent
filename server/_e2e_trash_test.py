#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""端到端验证：删除兜底四条路（shell 改写 / os.remove 钩子 / rmtree 钩子 / BYPASS 强删）"""
import os
import sys
import json
import time
import sqlite3
import subprocess

ROOT = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版'
sys.path.insert(0, os.path.join(ROOT, 'tools', 'coding', 'backend'))
DB = os.path.join(ROOT, 'private', 'db', 'zf3d_canvas.db')
TAG = time.strftime('%H%M%S')
TDIR = os.path.join(ROOT, 'system', '_e2e_del_test_' + TAG)
os.makedirs(TDIR)

f1 = os.path.join(TDIR, 't1_shell.txt');  open(f1, 'w', encoding='utf-8').write('t1')
f2 = os.path.join(TDIR, 't2_pyos.txt');   open(f2, 'w', encoding='utf-8').write('t2')
f3 = os.path.join(TDIR, 't3_force.txt');  open(f3, 'w', encoding='utf-8').write('t3')
sub = os.path.join(TDIR, 't4_sub');  os.makedirs(sub)
open(os.path.join(sub, 'inner.txt'), 'w', encoding='utf-8').write('t4')

def db_rows():
    conn = sqlite3.connect(DB); conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(
            'SELECT id, orig_path, trash_path, source FROM trash_items '
            'WHERE orig_path LIKE ? ORDER BY id DESC LIMIT 12',
            [TDIR + '%']).fetchall()]
    finally:
        conn.close()

print('=== T1 shell del 命令改写（rewrite_command 后真执行） ===')
import trash_intercept as ti
cmd1, notes1 = ti.rewrite_command('del /q "t1_shell.txt"', TDIR)
print('改写后命令:', cmd1)
print('备注:', notes1)
r1 = subprocess.run(cmd1, shell=True, cwd=TDIR, capture_output=True,
                    text=True, encoding='utf-8', errors='replace', timeout=60)
print('exit=%d out=%r err=%r' % (r1.returncode, (r1.stdout or '')[:200], (r1.stderr or '')[:300]))
print('T1 文件已消失:', not os.path.exists(f1))
rows = db_rows()
print('T1 数据库登记:', json.dumps(rows[:1], ensure_ascii=False))
t1_trash = rows[0]['trash_path'] if rows else ''
print('T1 垃圾箱文件物理存在:', bool(t1_trash) and os.path.exists(t1_trash))

print()
print('=== T2 Python os.remove 钩子（sitecustomize 生效进程内） ===')
try:
    os.remove(f2)
except Exception as e:
    print('T2 异常:', e)
print('T2 文件已消失:', not os.path.exists(f2))
rows = db_rows()
print('T2 数据库登记:', json.dumps(rows[:1], ensure_ascii=False))

print()
print('=== T3 Python shutil.rmtree 钩子（整目录） ===')
try:
    import shutil
    shutil.rmtree(sub)
except Exception as e:
    print('T3 异常:', e)
print('T3 目录已消失:', not os.path.exists(sub))
rows = db_rows()
print('T3 数据库登记:', json.dumps(rows[:1], ensure_ascii=False))

print()
print('=== T4 TRASH_BYPASS=1 强制删除（应真删、不入库） ===')
os.environ['TRASH_BYPASS'] = '1'
try:
    os.remove(f3)
except Exception as e:
    print('T4 异常:', e)
print('T4 文件已消失:', not os.path.exists(f3))
hit = [r for r in db_rows() if r['orig_path'].endswith('t3_force.txt')]
print('T4 数据库误登记(应为0条):', len(hit))

print()
print('=== T5 清理测试现场（BYPASS 下真删测试目录） ===')
import shutil
shutil.rmtree(TDIR, ignore_errors=True)
print('T5 测试目录已清理:', not os.path.isdir(TDIR))
print()
print('ALL DONE')
