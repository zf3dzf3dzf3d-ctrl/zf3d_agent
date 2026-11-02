# -*- coding: utf-8 -*-
import os, sys, time, glob
sys.stdout.reconfigure(encoding='utf-8')
# 全盘找含"本地mimo"或"火山方舟"的 models 类文件（历史 models.json 快照）
root = os.getcwd()
kws = ['本地mimo', '火山方舟', '智谱视频', 'MiniMax生图']
found = []
for d, dirs, files in os.walk(root):
    dirs[:] = [x for x in dirs if x not in ('node_modules', '.git', 'python', '__pycache__', '私有备份勿动')]
    for f in files:
        p = os.path.join(d, f)
        name = f.lower()
        if not (name.endswith('.json') or '.bak' in name or 'tmp' in name):
            continue
        try:
            sz = os.path.getsize(p)
            if sz < 3000 or sz > 2_000_000:
                continue
            t = open(p, 'r', encoding='utf-8', errors='ignore').read()
            c = sum(1 for k in kws if k in t)
            if c >= 2:
                found.append((c, p, sz, time.strftime('%m-%d %H:%M', time.localtime(os.path.getmtime(p)))))
        except Exception:
            pass
found.sort(reverse=True)
for c, p, sz, mt in found[:25]:
    print(c, p, sz, mt)
