# -*- coding: utf-8 -*-
import json, sys, os
sys.stdout.reconfigure(encoding='utf-8')
# 1) models_zf.json 是什么
j = json.load(open('public/config/models_zf.json', encoding='utf-8-sig'))
print('models_zf top:', list(j.keys()) if isinstance(j, dict) else type(j))
ms = j.get('models', []) if isinstance(j, dict) else j
print('models_zf count:', len(ms), [m.get('name') for m in ms][:10])
# 2) api_keys.json 里的43个名字 vs models.json 7个 —— 找回模型定义的线索：
#    看zf_model_sync.py 会不会用 models_zf.json 覆盖 models.json
t = open('server/zf_model_sync.py', encoding='utf-8').read()
for kw in ['models_zf', 'models.json', 'MODELS_FILE', 'merge', '合并']:
    print(kw, 'in zf_model_sync.py:', kw in t)
