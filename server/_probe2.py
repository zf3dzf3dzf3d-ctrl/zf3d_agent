import io
f = r'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.2.0/public/js/app-kite.js'
lines = io.open(f, encoding='utf-8', errors='replace').read().split('\n')
for i in range(968, 1010):
    print(i, lines[i-1][:160])
# CSS 定义内容
cf = r'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.2.0/public/css/style-kite.css'
ct = io.open(cf, encoding='utf-8', errors='replace').read()
cl = ct.split('\n')
import re
for i, l in enumerate(cl, 1):
    if '.kite-missile' in l:
        for j in range(i, min(i+15, len(cl)+1)):
            print('CSS', j, cl[j-1][:140])
        break
