import io, re
s = io.open('public/js/app-workbench-drawer.js', encoding='utf-8').read()
emo = ''.join(sorted(c for c in set(s) if ord(c) > 0x2100))
print('emo:', emo or 'NONE', 'svg:', s.count('<svg'))
css = io.open('public/css/app-workbench-drawer.css', encoding='utf-8').read()
print('css_rule:', 'wb-tab-ico' in css and 'wb-br-ico' in css)
