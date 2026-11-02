# -*- coding: utf-8 -*-
import json, sys, shutil, time
sys.stdout.reconfigure(encoding='utf-8')
src = 'public/config/backups/models-20261026-175938.json'
j = json.load(open(src, encoding='utf-8-sig'))
ms = j.get('models', [])
print('backup count:', len(ms))
# 确认无官方中转混入（两文件分离设计：官方在 models_zf.json）
zf = [m for m in ms if m.get('zfLine') or m.get('zfManaged') or m.get('name') == '朱峰模型']
print('zf entries in backup:', len(zf))
# 备份当前坏文件，再恢复
shutil.copy2('public/config/models.json', 'public/config/models.json.broken-20261026-1923')
data = open(src, 'r', encoding='utf-8-sig').read()
open('public/config/models.json', 'w', encoding='utf-8').write(data)
j2 = json.load(open('public/config/models.json', encoding='utf-8-sig'))
print('restored count:', len(j2.get('models', [])))
print([m.get('name') for m in j2['models']][:20])
