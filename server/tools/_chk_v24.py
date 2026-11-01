import io, time
for p in ['public/index.html','public/_clean_index/index.html.clean']:
    t = io.open(p, encoding='utf-8', newline='').read()
    print(p, 'before v23:', t.count('app-focus-mode.js?v=23'))
    t = t.replace('app-focus-mode.js?v=23', 'app-focus-mode.js?v=24')
    io.open(p, 'w', encoding='utf-8', newline='').write(t)
time.sleep(3)
for p in ['public/index.html','public/_clean_index/index.html.clean','server/public/index.html']:
    t = io.open(p, encoding='utf-8', newline='').read()
    print(p, 'after3s v23:', t.count('app-focus-mode.js?v=23'), 'v24:', t.count('app-focus-mode.js?v=24'))
