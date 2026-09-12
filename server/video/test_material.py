# -*- coding: utf-8 -*-
"""test_material.py - 素材自动搜配实测"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import material_match as mm

OK = True
def check(name, cond, extra=''):
    global OK
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond: OK = False

# 造临时素材库
lib = os.path.join(os.path.dirname(os.path.abspath(__file__)), '_test_lib')
os.makedirs(lib, exist_ok=True)
for name, desc in [('城市夜景航拍.mp4', '夜晚 高楼 灯光 车流 都市'),
                   ('海边日落延时.mp4', '大海 波浪 夕阳 天空'),
                   ('程序员敲代码.jpg', '电脑 键盘 工作 办公')]:
    p = os.path.join(lib, name)
    open(p, 'wb').write(b'\x00' * 100)
    open(os.path.join(lib, os.path.splitext(name)[0] + '.txt'), 'w', encoding='utf-8').write(desc)

idx = mm.build_index(lib)
check('索引建立', len(idx) == 3, f'({len(idx)} 个素材)')

kws = mm.extract_keywords('夜晚的城市灯光真美，高楼大厦车流不息')
print('[INFO] 关键词:', kws)

hits = mm.match('夜晚的城市灯光真美', idx)
check('匹配城市素材', len(hits) > 0 and '城市' in hits[0][0], str(hits[:2]))

hits2 = mm.match('海边日落太治愈了', idx)
check('匹配海边素材', len(hits2) > 0 and '海边' in hits2[0][0], str(hits2[:2]))

assign = mm.auto_assign(['夜晚的城市灯光真美', '海边日落太治愈了', '程序员在加班敲代码'], lib)
check('自动分配 3 段', len(assign) == 3 and all('materials' in a for a in assign))
for a in assign:
    print('  ', a['text'][:12], '->', [os.path.basename(m) for m in a['materials']])

# 清理
import shutil; shutil.rmtree(lib, ignore_errors=True)

print('\n=== ALL PASS ===' if OK else '\n=== SOME FAILED ===')
sys.exit(0 if OK else 1)
