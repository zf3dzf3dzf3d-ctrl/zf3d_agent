# -*- coding: utf-8 -*-
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\public\index.html'
d = open(p, 'rb').read()
bad = b'`n    <script'
print('before:', d.count(bad))
d2 = d.replace(bad, b'\r\n    <script')
open(p, 'wb').write(d2)
d3 = open(p, 'rb').read()
print('after:', d3.count(bad), 'tag_count:', d3.count(b'app-project-panel'))
i = d3.find(b'app-project-panel')
print(d3[max(0, i-90):i+70].decode('utf-8', 'replace'))
