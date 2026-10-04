import re, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
base = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.2.5\public\js'
files = ['ext-settings-panel.js','panel-settings.js','settings-rewrite.js','tools-settings.js','user-settings.js']
pat = re.compile(r'[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9：:（）()%·、／/ \-．.。？！？!*×]{1,}')
seen = {}
for f in files:
    c = open(f'{base}\\{f}', encoding='utf-8').read()
    out = []
    loc = set()
    for m in pat.findall(c):
        v = m.strip()
        if len(v) < 2 or v in loc: continue
        loc.add(v); out.append(v)
    seen[f] = out
# 收集现有词典 key（i18n 全部数据文件）
keys = set()
for df in ['i18n-data.js','i18n-data-multi.js','i18n-data-extra.js']:
    try:
        c = open(f'{base}\\{df}', encoding='utf-8').read()
    except: continue
    for m in re.finditer(r'"([^"]*[\u4e00-\u9fff][^"]*)"\s*:', c):
        keys.add(m.group(1))
    for m in re.finditer(r"'([^']*[\u4e00-\u9fff][^']*)'\s*:", c):
        keys.add(m.group(1))
print('词典key数:', len(keys))
missing_total = []
for f, ws in seen.items():
    miss = [w for w in ws if w not in keys]
    print(f, '词条', len(ws), '缺失', len(miss))
    missing_total.extend(miss)
print('总缺失', len(missing_total))
json.dump(sorted(set(missing_total)), open(f'{base}\\_missing_cn.json','w',encoding='utf-8'), ensure_ascii=False, indent=1)
