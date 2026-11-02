# -*- coding: utf-8 -*-
import io, json, os
out = io.open('_rb_out.txt', 'w', encoding='utf-8')
for f in ['server/routes/mixin_proxy.py', 'server/routes/mixin_proxy_stream.py', 'server/idle_auto_restart.py']:
    try:
        s = io.open(f, encoding='utf-8').read()
        out.write('== %s len=%d ==\n' % (f, len(s)))
        for kw in ['_norm_id', 'Missing _target_url', '_pool_busy', 'KeyGuard', 'zf-glm-flash', 'zfglm-flash', '_target_url', '_body']:
            out.write('  %s: %d\n' % (kw, s.count(kw)))
    except Exception as e:
        out.write('== %s ERR %s ==\n' % (f, e))
p = 'server/zf_models_cache.json'
out.write('zf_models_cache exists: %s\n' % os.path.exists(p))
if os.path.exists(p):
    d = json.load(io.open(p, encoding='utf-8'))
    ms = d.get('models', [])
    out.write('cache models: %d\n' % len(ms))
    for m in ms[:6]:
        out.write('  id=%s\n' % m.get('id'))
mj = json.load(io.open('public/config/models.json', encoding='utf-8'))
models = mj if isinstance(mj, list) else mj.get('models', [])
out.write('models.json count: %d\n' % len(models))
for m in models:
    if 'zf' in str(m.get('id', '')).lower() or '智谱' in str(m.get('name', '')):
        out.write('  id=%s ep=%s\n' % (m.get('id'), m.get('endpoint')))
out.close()
print('done')
