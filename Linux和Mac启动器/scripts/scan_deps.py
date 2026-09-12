import re, glob, sys
mods = set()
files = glob.glob('server/*.py') + glob.glob('rag/*.py') + glob.glob('tools/**/*.py', recursive=True) + glob.glob('scripts/*.py')
for f in files:
    try:
        src = open(f, encoding='utf-8', errors='ignore').read()
    except Exception:
        continue
    for m in re.findall(r'^(?:import|from)\s+([a-zA-Z_][\w.]*)', src, re.M):
        mods.add(m.split('.')[0])
print('\n'.join(sorted(m for m in mods if m not in sys.stdlib_module_names)))
