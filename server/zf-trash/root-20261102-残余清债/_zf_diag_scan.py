import io, re, sys, glob, os

FILES = ['hot_reload.py', 'routes/mixin_hot_reload.py', 'restart_server.py', 'watchdog.py',
         'supervisor.py', 'tray_server.py', 'server.py', 'chat_pool.py', 'routes/mixin_chat_pool.py']

PAT = re.compile(r'(restart|reload|\.py|watch|poll|interval|sleep|serve_forever|taskkill|Popen|subprocess|start_watcher|__main__)')

for f in FILES:
    if not os.path.exists(f):
        print('---- missing: ' + f); continue
    L = io.open(f, encoding='utf-8', errors='replace').read().splitlines()
    print('======== %s (%d lines) ========' % (f, len(L)))
    for i, l in enumerate(L):
        if re.search(r'(restart|Restart|RESTART|taskkill|Popen|subprocess\.|serve_forever|start_watcher|shutdown|Reload|reload)', l):
            print('%5d: %s' % (i + 1, l.rstrip()[:170]))
    print()
