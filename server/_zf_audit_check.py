import io, re
src = io.open('public/js/dom-settings-panel.js', encoding='utf-8').read()
print('panel count:', src.count('settingsPanel-versions'))
print('body count:', src.count('settingsVersionsBody'))
print('nav versions attr count:', src.count('data-settings-tab=\\"versions\\"'))
print('bad about+versions:', bool(re.search(r'data-settings-tab=\\"about\\"[^>]*versions', src)))
idx = io.open('public/index.html', encoding='utf-8').read()
print('cache dom-settings-panel:', re.findall(r'dom-settings-panel\.js\?v=(\d+)', idx))
print('cache panel-docs-sync:', re.findall(r'panel-docs-sync\.js\?v=(\d+)', idx))
