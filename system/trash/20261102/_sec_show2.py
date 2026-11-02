# -*- coding: utf-8 -*-
import re, io, sys, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# 1) 真实源码里的硬编码密钥（排除二进制缓存/数据文件）
pat = re.compile(r'(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})')
src_ext = ('.py', '.js', '.html', '.json', '.bat', '.ps1', '.md', '.vbs')
roots = ['server', 'tool', 'tools', 'public', 'private', 'system']
import os
found = []
for root in roots:
    if not os.path.isdir(root): continue
    for dp, _, fns in os.walk(root):
        if 'profiles' in dp or 'Cache' in dp or 'node_modules' in dp: continue
        for fn in fns:
            if not fn.endswith(src_ext) or fn.endswith('.bak'): continue
            p = os.path.join(dp, fn)
            try:
                for i, ln in enumerate(open(p, encoding='utf-8', errors='ignore'), 1):
                    m = pat.search(ln)
                    if m:
                        found.append(f'{p}:{i}: ...{ln.strip()[:90]}')
                        break
            except Exception: pass
print('== hardcoded keys in source ==', len(found))
for x in found[:15]: print(' ', x)

# 2) send_file / send_from_directory 路径来源
pat2 = re.compile(r'send_file|send_from_directory')
print('== send_file usages ==')
for root in ['server', 'tool', 'tools']:
    if not os.path.isdir(root): continue
    for dp, _, fns in os.walk(root):
        for fn in fns:
            if not fn.endswith('.py') or fn.endswith('.bak'): continue
            p = os.path.join(dp, fn)
            try:
                for i, ln in enumerate(open(p, encoding='utf-8', errors='ignore'), 1):
                    if pat2.search(ln):
                        print(f'  {p}:{i}: {ln.strip()[:120]}')
            except Exception: pass

# 3) HTTP 路由直接拼用户输入到 shell/路径 的可疑点
pat3 = re.compile(r'request\.(args|json|form|data|values)')
pat4 = re.compile(r'(os\.system|subprocess\.(run|Popen|call|check_output)|os\.popen)')
print('== files mixing request-input + subprocess ==')
for root in ['server']:
    for dp, _, fns in os.walk(root):
        for fn in fns:
            if not fn.endswith('.py') or fn.endswith('.bak'): continue
            p = os.path.join(dp, fn)
            try: t = open(p, encoding='utf-8', errors='ignore').read()
            except Exception: continue
            if pat3.search(t) and pat4.search(t):
                print('  ', p)
