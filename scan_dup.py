import filecmp, os
pairs = [
 ('public/js/inline-00.js','public/js/inline/inline-01.js'),
 ('public/js/inline-01.js','public/js/inline/inline-02.js'),
 ('public/js/inline-02.js','public/js/inline/inline-03.js'),
 ('public/js/inline-03.js','public/js/inline/inline-04.js'),
 ('public/js/inline-04.js','public/js/inline/inline-05.js'),
]
for a,b in pairs:
    print(a, '~', b, ':', 'IDENTICAL' if filecmp.cmp(a,b,shallow=False) else 'DIFF')
# css inline dir files referenced?
print('css/inline refs in index.html:', 'css/inline/' in open('public/index.html',encoding='utf-8',errors='replace').read())
# how are css/inline/* loaded? check any loader
import glob
for f in glob.glob('server/*.py'):
    t = open(f,encoding='utf-8',errors='replace').read()
    if 'inline-01.css' in t or 'css/inline' in t or 'css\\\\inline' in t:
        print('server loader:', f)
for f in glob.glob('public/js/*.js'):
    t = open(f,encoding='utf-8',errors='replace').read()
    if 'css/inline' in t or 'inline-01.css' in t:
        print('js loader:', f)
