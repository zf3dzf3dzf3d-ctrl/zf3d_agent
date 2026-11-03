# -*- coding: utf-8 -*-
import io, sys
sys.stdout.reconfigure(encoding='utf-8')
for p in ['public/js/app-butler.js', 'public/js/app-project-panel.js', 'public/js/chatbox-header-template.js']:
    s = io.open(p, encoding='utf-8').read()
    print('==', p, 'partner hits:', s.count('伴侣'), 'relation hits:', s.count('relation'), 'icon hits:', s.count('crewIcon') + s.count('CREW_ICON'))
    for kw in ['伴侣', '孩子', '父母', 'crewIcon', 'CREW_ICON', 'relation']:
        idx = s.find(kw)
        if idx >= 0:
            print('  first', kw, ':', s[max(0, idx-80):idx+120].replace('\n', ' | ')[:220])
