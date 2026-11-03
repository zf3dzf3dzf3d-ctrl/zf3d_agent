import os
from urllib.parse import unquote
pd = os.path.realpath('public')
print('PUBLIC_DIR', pd, os.path.isdir(pd))
def blocked(p):
    p = unquote(p.split('?')[0])
    fp = os.path.realpath(os.path.join(pd, p.lstrip('/')))
    return not fp.startswith(pd)
tests = ['/%2e%2e%2fprivate%2fx.txt', '/js/app.js', '/%5c..%5cprivate/x.txt', '/index.html', '/../private/x.txt']
for t in tests:
    print(t, 'BLOCKED' if blocked(t) else 'PASS')
