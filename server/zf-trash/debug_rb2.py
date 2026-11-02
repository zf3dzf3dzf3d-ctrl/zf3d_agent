import sys, json, io
sys.stdout.reconfigure(encoding='utf-8')
p = r'C:\Users\Administrator\.codex\session_index.jsonl'
o = None; cnt = 0
with io.open(p, 'r', encoding='utf-8', errors='replace') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        cnt += 1
        if o is None: o = json.loads(line)
print('index lines:', cnt)
print('first keys:', sorted(o.keys()) if o else None)
d = json.load(io.open(r'C:\Users\Administrator\.codex\external_agent_session_imports.json', 'r', encoding='utf-8'))
print('imports:', type(d).__name__, len(d) if hasattr(d, '__len__') else '?')
