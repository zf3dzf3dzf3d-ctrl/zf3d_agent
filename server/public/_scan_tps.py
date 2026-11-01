import os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
for root, d, fs in os.walk('public'):
    d[:] = [x for x in d if x not in ('node_modules', '.git')]
    for f in fs:
        if not f.endswith(('.js', '.html', '.css')):
            continue
        p = os.path.join(root, f)
        t = open(p, encoding='utf-8', errors='ignore').read()
        for i, l in enumerate(t.splitlines(), 1):
            ll = l.lower()
            if ('tok' in ll and '/s' in ll) or 'toks' in ll or 'tps' in ll or '每秒' in l:
                print(p, i, l.strip()[:200])
