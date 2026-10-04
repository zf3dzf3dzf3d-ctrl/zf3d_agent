import re,io
src=io.open(r'F:\zz4.txt'.replace('zz4.txt','..') if False else r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\svg_icons\gen_color_icons.py',encoding='utf-8').read()
m=re.search(r'GRADS\s*=\s*(?:f?u?r?"""(.*?)"""|f?u?r?\'\'\'(.*?)\'\'\'|"(.*?)")',src,re.S)
g=m.group(1) or m.group(2) or m.group(3)
ids=re.findall(r'id="(g\w+)"',g)
open(r'F:\zz4.txt','w',encoding='utf-8').write(' '.join(ids))
print('ok',ids)
