import json, os, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
d = r'server\data\swarm_state'
bids = ['sw-1acfc18880','sw-683c95c9c9','sw-78a51e036a','sw-9080ea7d2a']
for bid in bids:
    fp = os.path.join(d, 'batch-%s.json' % bid)
    if not os.path.exists(fp):
        print(bid, 'MISSING')
        continue
    j = json.load(open(fp, encoding='utf-8'))
    print('='*30, bid)
    print('top keys:', list(j.keys()))
    tasks = j.get('tasks', [])
    print('n_tasks:', len(tasks))
    for t in tasks:
        print('---')
        for k, v in t.items():
            s = str(v)
            print(k, ':', s[:150].replace('\n',' '))
