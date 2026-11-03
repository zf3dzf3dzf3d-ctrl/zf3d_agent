# -*- coding: utf-8 -*-
import os, re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
root = 'server'
skip_dirs = {'node_modules', '.git', 'logs', '__pycache__', 'data', 'browser_profile'}
pat_key = re.compile(r"(sk-[A-Za-z0-9_\-]{20,}|api[_-]?key\s*[:=]\s*['\"][^'\"]{8,}['\"]|token\s*[:=]\s*['\"][A-Za-z0-9\-_\.]{16,}['\"]|password\s*[:=]\s*['\"][^'\"]{4,}['\"])", re.I)
pat_url = re.compile(r"(https?://[A-Za-z0-9\.\-]+(?::\d+)?)")
pat_path = re.compile(r"([A-Z]:\\{1,2}[^\s'\"]+|[A-Z]:/[^\s'\"]+)")
pat_model = re.compile(r"(gpt-4[a-z\-\.]*|claude-[a-z0-9\-\.]+|deepseek[a-z0-9\-\.]*|qwen[a-z0-9\-\.]*|gemini-[a-z0-9\-\.]+)")
res = {'key': [], 'url': [], 'path': [], 'model': []}
nfiles = 0
for dp, ds, fn in os.walk(root):
    ds[:] = [d for d in ds if d not in skip_dirs]
    for f in fn:
        if not f.endswith(('.js', '.py', '.json', '.html', '.css')):
            continue
        if '.bak' in f:
            continue
        p = os.path.join(dp, f)
        nfiles += 1
        try:
            for i, line in enumerate(open(p, encoding='utf-8', errors='ignore'), 1):
                if len(line) > 400:
                    line = line[:400]
                if pat_key.search(line):
                    res['key'].append(f"{p}:{i}: {line.strip()[:160]}")
                for m in pat_url.findall(line):
                    if any(s in m for s in ('localhost', '127.0.0.1', 'example.com', 'w3.org', 'schema')):
                        continue
                    res['url'].append(f"{p}:{i}: {m}")
                for m in pat_path.findall(line):
                    if m.upper().startswith(('F:', 'C:')):
                        res['path'].append(f"{p}:{i}: {m[:120]}")
                if pat_model.search(line) and ('model' in line.lower() or 'default' in line.lower()):
                    res['model'].append(f"{p}:{i}: {line.strip()[:140]}")
        except Exception as e:
            print('ERR', p, e)
print(f'scanned {nfiles} files')
for k, v in res.items():
    print(f"===== {k}: {len(v)} hits =====")
    for x in v[:50]:
        print(x)
