import re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
for f in ['public/js/app-kite.js', 'public/js/app-kite-panels.js']:
    s = open(f, encoding='utf-8').read()
    hits = [(i, l.rstrip()[:140]) for i, l in enumerate(s.splitlines(), 1) if re.search('menu|菜单', l, re.I)]
    print('==', f, 'hits', len(hits))
    for i, l in hits[:25]:
        print(i, l)
