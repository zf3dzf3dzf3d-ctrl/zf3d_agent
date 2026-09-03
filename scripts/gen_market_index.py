# -*- coding: utf-8 -*-
"""生成初始 _market.json 索引（只存元数据+下载路径，不存技能内容）"""
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from extensions import market

data = market.refresh_market(limit_per_source=50)
print('sources:', data['sources'])
print('items:', len(data['items']))
for it in data['items'][:10]:
    print(' -', it['source'], it['id'], it['stars'])
idx = market._INDEX_PATH
print('index saved:', idx, os.path.getsize(idx), 'bytes')
