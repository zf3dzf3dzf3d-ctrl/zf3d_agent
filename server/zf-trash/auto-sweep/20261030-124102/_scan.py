import io
buf = []
for f in ['public/js/app-workbench-drawer.js', 'public/js/app-workbench-viewer.js']:
    s = io.open(f, encoding='utf-8').read()
    buf.append('=== ' + f)
    for i, l in enumerate(s.split('\n'), 1):
        if 'wb-tab' in l or 'data-wbwork' in l or 'wb-workbench' in l or 'openWorkbench' in l:
            buf.append('%d %s' % (i, l.strip()[:130]))
io.open('_scan_out.txt', 'w', encoding='utf-8').write('\n'.join(buf))
print('lines', len(buf))
