# -*- coding: utf-8 -*-
import io, sys, json, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'server'); sys.path.insert(0, 'server/video')
import director_ai as da

r = da.full_produce('一只机械蝴蝶在霓虹雨夜的城市中穿行，最终飞向月光',
                    name='demo_niHongDieYing', count=3, duration=5)
print(json.dumps({k: r.get(k) for k in ('ok', 'name', 'output', 'elapsed', 'dir')},
                 ensure_ascii=False))
print('gen summary:', r.get('generate', {}).get('summary'))
print('gen errors:', r.get('generate', {}).get('errors'))
sb = r.get('storyboard', {})
print('title:', sb.get('title'), '| llm:', sb.get('llm'))
if r.get('output') and os.path.isfile(r['output']):
    print('FINAL_SIZE_MB:', round(os.path.getsize(r['output']) / 1048576.0, 2))
