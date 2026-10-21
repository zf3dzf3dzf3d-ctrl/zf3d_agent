# -*- coding: utf-8 -*-
import sys
sys.path.insert(0, r'F:\朱峰智能体无限_新版本\朱峰智能体无限_5.2.2\tools')
# 只复用 try_one：手工加载模块但阻止其主循环
import types, importlib.util
spec = importlib.util.spec_from_file_location('p', r'F:\朱峰智能体无限_新版本\朱峰智能体无限_5.2.2\tools\probe_tts_endpoint.py')
src = open(spec.origin, encoding='utf-8').read()
src = src.split('combos = [')[0]  # 去掉主循环
m = types.ModuleType('p')
m.__dict__['__file__'] = spec.origin
exec(compile(src, 'p', 'exec'), m.__dict__)
for sp in ['cherry', 'cancan', 'default', 'zh_female_cancan', 'zh_male_concise', 'BV001_streaming', 'jiaojiao', 'lazyman']:
    try:
        print(sp, '=>', m.try_one('seed-tts-2.0', sp)[:200])
    except Exception as e:
        print(sp, 'ERR', e)
