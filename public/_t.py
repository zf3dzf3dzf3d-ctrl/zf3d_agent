import re, sys
sys.stdout.reconfigure(encoding='utf-8')
for f in ['css/style-chatbox.css','css/style-tools.css','css/style-cbq.css']:
    s = open(f, encoding='utf-8', errors='ignore').read()
    print('=== FILE', f, len(s))
    for m in re.finditer(r'([^{}]+)\{([^}]*)\}', s):
        sel, body = m.group(1).strip(), m.group(2)
        if 'overflow' in body:
            print(' ', sel[:120].replace('\n',' '), '=>', body.replace('\n',' ')[:220])
