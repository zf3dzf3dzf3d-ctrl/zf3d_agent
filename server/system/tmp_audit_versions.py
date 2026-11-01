import re
s = open('public/js/dom-settings-panel.js', encoding='utf-8').read()
tabs = re.findall(r'data-settings-tab=.[a-z]+', s)
print('tabs:', tabs)
print('versions_tab:', s.count('data-settings-tab=\\"versions\\"'), s.count("data-settings-tab=\\'versions\\'"))
i = s.find('versions')
print(repr(s[max(0,i-150):i+150]))
