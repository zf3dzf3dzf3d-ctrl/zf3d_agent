# -*- coding: utf-8 -*-
import os, re, collections, json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
ROOT = os.path.dirname(os.path.abspath(__file__))
pats = {
 'os_system': r'os\.system\(',
 'shell_true': r'shell\s*=\s*True',
 'eval': r'\beval\(',
 'exec_call': r'\bexec\(',
 'child_process': r'child_process',
 'innerHTML': r'innerHTML',
 'send_file': r'send_file',
 'secret_assign': r'(api_key|apikey|secret)\s*[=:]',
 'pickle_loads': r'pickle\.loads',
 'yaml_load': r'yaml\.load\(',
 'hardcoded_key': r'(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})',
}
cnt = collections.Counter()
files = collections.defaultdict(list)
line_hits = collections.defaultdict(list)
total = {}
for root in ['server', 'tool', 'tools', 'public']:
    rp = os.path.join(ROOT, root)
    if not os.path.isdir(rp):
        total[root] = 'MISSING'; continue
    n = 0
    for dp, _, fns in os.walk(rp):
        for fn in fns:
            if fn.endswith('.bak'): continue
            p = os.path.join(dp, fn); n += 1
            try:
                t = open(p, encoding='utf-8', errors='ignore').read()
            except Exception:
                continue
            lines = t.splitlines()
            for k, pat in pats.items():
                for i, ln in enumerate(lines, 1):
                    if re.search(pat, ln, re.I):
                        cnt[k] += 1
                        if len(files[k]) < 8:
                            files[k].append(p)
                            line_hits[k].append(f'{p}:{i}: {ln.strip()[:120]}')
    total[root] = n
res = {'total': total, 'cnt': dict(cnt), 'lines': dict(line_hits)}
with open(os.path.join(ROOT, '_sec_scan.json'), 'w', encoding='utf-8') as f:
    json.dump(res, f, ensure_ascii=False, indent=1)
print('DONE', json.dumps(total), json.dumps(dict(cnt)))
