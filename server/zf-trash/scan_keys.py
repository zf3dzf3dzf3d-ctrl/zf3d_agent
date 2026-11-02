import os, sys
sys.stdout.reconfigure(encoding='utf-8')
root = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0'
pats = ['密钥未配置', 'Key 为空', '会被拦截']
skip = {'node_modules', '.git', 'python', 'private', 'backups', 'zf-trash'}
for dp, ds, fns in os.walk(root):
    ds[:] = [d for d in ds if d not in skip]
    for fn in fns:
        if fn.split('.')[-1].lower() in ('py', 'js', 'html', 'vue', 'ts'):
            p = os.path.join(dp, fn)
            try:
                t = open(p, encoding='utf-8', errors='replace').read()
            except Exception:
                continue
            for i, l in enumerate(t.splitlines(), 1):
                if any(x in l for x in pats):
                    print(os.path.relpath(p, root), i, l.strip()[:130])
