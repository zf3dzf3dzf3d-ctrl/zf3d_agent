import re
s = open('public/js/chatbox-crew-panel.js', encoding='utf-8').read()
m = re.search(r'\bROLES\b', s)
print(s[m.start():m.start()+3000])
