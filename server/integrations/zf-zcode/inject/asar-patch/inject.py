# -*- coding: utf-8 -*-
import io, sys
from util_log import get_logger

log = get_logger('inject')
h = r'F:\zf-asar-tmp\app\out\renderer\index.html'
snip_path = r'F:\zf-asar-tmp\zf-inject-snippet.html'
s = io.open(h, encoding='utf-8').read()
if 'zf-fab' in s:
    log.info('ALREADY_INJECTED')
    sys.exit(0)
snip = io.open(snip_path, encoding='utf-8').read()
assert s.count('</body>') == 1, 'body tag count: %d' % s.count('</body>')
s2 = s.replace('</body>', snip + '\n  </body>')
io.open(h, 'w', encoding='utf-8').write(s2)
check = io.open(h, encoding='utf-8').read()
log.info('%s %s', 'INJECTED_OK', 'zf-fab' in check)
