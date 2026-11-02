# -*- coding: utf-8 -*-
import urllib.request, json, sys, time
sys.stdout.reconfigure(encoding='utf-8')
j = json.load(urllib.request.urlopen('http://127.0.0.1:8570/api/models/config', timeout=10))
lst = j['config'].get('list', [])
print('API list count:', len(lst))
print([m.get('name') for m in lst])
# 实测 CodingPlan智谱 转圈线路：走本地代理还是直连？取该条配置看 endpoint
for m in lst:
    if m.get('name') == 'CodingPlan智谱':
        print('CodingPlan endpoint:', m.get('endpoint') or m.get('baseUrl'))
        print('modelId:', m.get('modelId'), 'keyRef:', m.get('keyRef'))
