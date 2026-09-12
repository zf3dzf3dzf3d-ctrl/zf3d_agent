# -*- coding: utf-8 -*-
import io, sys, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
sys.path.insert(0, 'server')
import model_config as mc

cfg = mc.load_models_config(include_key=True)
items = cfg.get('list', [])
print('models:', [(m.get('name'), m.get('modelId'), bool(m.get('key'))) for m in items])
dft = mc.get_default_model()
print('default:', dft and (dft.get('name'), dft.get('modelId'), bool(dft.get('key'))))

changed = False
if dft and not dft.get('key'):
    try:
        keys = json.load(open('private/api_keys.json', encoding='utf-8-sig')).get('keys', {})
    except Exception as e:
        keys = {}
        print('keys load fail:', e)
    k = keys.get('智谱 GLM', '')
    if k:
        for m in items:
            if (m.get('name') == dft.get('name')) and not m.get('key'):
                m['key'] = k
                changed = True
        if changed:
            try:
                mc.save_models_config({'_meta': cfg.get('_meta'), 'list': items})
                print('key injected & saved')
            except Exception as e:
                print('save fail:', e)

cfg2 = mc.load_models_config(include_key=True)
dft2 = mc.get_default_model()
print('final default:', dft2 and (dft2.get('name'), dft2.get('modelId'), bool(dft2.get('key'))))

# LLM 通道实测
if dft2 and dft2.get('key'):
    sys.path.insert(0, 'server/video')
    import director_ai as da
    try:
        r = da.gen_storyboard('一只机械蝴蝶在霓虹雨夜的城市中穿行', count=3, duration=5)
        print('storyboard ok:', r.get('ok'))
        if r.get('ok'):
            print('title:', r.get('title'), '| llm:', r.get('llm'))
            for s in r.get('shots', []):
                print(' shot', s['id'], s['name'], '|', s['desc'][:24], '| prompt_len:', len(s['video_prompt']), '| tr:', s['transition'])
        else:
            print('storyboard error:', r.get('error'))
    except Exception as e:
        print('storyboard exc:', e)
else:
    print('NO_KEY: LLM 未配置，前端需要提示用户去设置')
