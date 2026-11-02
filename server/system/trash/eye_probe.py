# -*- coding: utf-8 -*-
import io, re
t = io.open('public/canvas/进化树/viewer.html', encoding='utf-8').read().splitlines()
kw = re.compile(r"breathLoop|springLoop|requestDraw|REST_V|focusSet|mousedown|pointerdown|click|wheel|animate|flyTo|function |root", re.I)
for i, l in enumerate(t, 1):
    if kw.search(l):
        print(i, l[:140])
