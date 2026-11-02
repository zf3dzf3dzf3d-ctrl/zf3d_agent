import io
for f in ['public/js/app-kite-modes.js','public/js/app-combo.js','public/js/app-kite-core.js']:
    try:
        t=io.open(f,encoding='utf-8',errors='replace').read()
    except Exception as e:
        print(f,'ERR',e); continue
    print('==',f,len(t))
    for kw in ['spider','Spider','spd','joint','Joint','shake','combo','Combo','crit','draw']:
        c=t.count(kw)
        if c: print('  ',kw,c)
