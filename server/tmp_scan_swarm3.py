import io,sys,re
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
for name in ['dispatch_swarm_seg1.py','dispatch_swarm_seg2.py']:
    p=r'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.7.0/server/'+name
    lines=open(p,encoding='utf-8',errors='ignore').read().splitlines()
    for i,l in enumerate(lines):
        if re.search(r'def (submit|collect|_poll|status)|_BATCHES|future|result\(|\.result|done|未完成|未返回|提前', l):
            print(name, i+1, ':', l.strip()[:200])
