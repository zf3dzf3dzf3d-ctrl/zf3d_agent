#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""skills ui 接口自测"""
import json, sys, os
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
os.chdir(ROOT); sys.path.insert(0, ROOT)

from extensions import skills

class H:
    path = '/api/ext/skills/ui?text=%E4%BB%A3%E7%A0%81%E5%AE%A1%E6%9F%A5'
    def _send_json(self, data, code=200):
        print('[API]', json.dumps(data, ensure_ascii=False)[:500])

h = H()
skills.handle(h, 'GET', ['ui'], {})
skills.handle(h, 'GET', ['ui'], {'text': 'x'})   # 直接传 path query 解析
import urllib.request
print('--- match ---')
skills.handle(h, 'POST', ['match'], {'text': '帮我看看这段代码'})
print('--- json valid ---')
for p in ['extensions/skills/code_review/skill.json', 'extensions/skills/_template/skill.json']:
    json.load(open(p, encoding='utf-8')); print('ok', p)
