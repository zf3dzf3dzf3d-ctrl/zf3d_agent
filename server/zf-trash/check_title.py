import io, sys, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
t = open('public/canvas/进化树/viewer.html', encoding='utf-8').read()
print('has id=title:', 'id="title"' in t or "id='title'" in t)
for pat in ['titleText', 'countNodes', "getElementById('title')", 'textContent']:
    print(pat, '->', t.count(pat))
i = t.find('titleText')
print(repr(t[max(0, i-150):i+400]))
