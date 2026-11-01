# -*- coding: utf-8 -*-
import io, sys
h = r'F:\zf-asar-tmp\app\out\renderer\index.html'
snip_path = r'F:\zf-asar-tmp\zf-inject-snippet.html'
s = io.open(h, encoding='utf-8').read()
if 'zf-fab' in s:
    print('ALREADY_INJECTED')
    sys.exit(0)
snip = io.open(snip_path, encoding='utf-8').read()
assert s.count('</body>') == 1, 'body tag count: %d' % s.count('</body>')
s2 = s.replace('</body>', snip + '\n  </body>')
io.open(h, 'w', encoding='utf-8').write(s2)
check = io.open(h, encoding='utf-8').read()
print('INJECTED_OK', 'zf-fab' in check)
