# -*- coding: utf-8 -*-
"""测试 market 模块：list / install / delete（不依赖服务器）"""
import sys, os, io, json, shutil
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from extensions import market, skills

# 1. list
r = market.list_market()
print('market items:', len(r['items']), 'updated:', r['updated'])
inst = [i for i in r['items'] if i['installed']]
print('installed marked:', len(inst))

# 2. install 一个小技能
res, err = market.install_skill('pdf')
print('install pdf:', res, err)
p = os.path.join(market._SKILLS_DIR, 'pdf')
print('files:', os.listdir(p)[:10] if os.path.isdir(p) else 'MISSING')
sp = os.path.join(p, 'skill.json')
print('skill.json:', json.load(open(sp, encoding='utf-8')) if os.path.isfile(sp) else 'MISSING')

# 3. skills 注册验证
sks = skills.list_skills()
print('skills list contains pdf:', 'pdf' in sks)

# 4. delete（卸载测试）
res, err = market.install_skill('pdf')  # already
print('re-install:', res)
shutil.rmtree(p, ignore_errors=True)
print('cleanup done, pdf exists:', os.path.isdir(p))
