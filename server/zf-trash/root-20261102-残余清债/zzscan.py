import os, sys
sys.stdout.reconfigure(encoding='utf-8')
kws = ['自动回收', '_autoTicket', '_zfAutoGatherNext', 'detectReply', 'canGather', '_replied']
skip = ['.git', 'node_modules', '__pycache__', '垃圾箱', '蜂群回收', 'python', 'dsh研究']
for dp, ds, fs in os.walk('.'):
    ds[:] = [d for d in ds if d not in skip]
    for f in fs:
        if not f.endswith('.js'):
            continue
        p = os.path.join(dp, f)
        try:
            b = open(p, 'rb').read()
        except Exception:
            continue
        found = [k for k in kws if k.encode('utf-8') in b]
        if found:
            print(p, found)
