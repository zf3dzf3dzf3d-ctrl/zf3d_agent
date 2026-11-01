import io,sys
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
for name in ['dispatch_swarm_seg1.py','swarm_pipeline.py']:
    p=r'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.7.0/server/'+name
    lines=open(p,encoding='utf-8',errors='ignore').read().splitlines()
    print('=====',name,len(lines))
    for i,l in enumerate(lines):
        if any(k in l for k in ['汇总','回收','as_completed','executor','wait(','Thread','timeout','返回完成','submit(']):
            print(i+1,':',l.strip()[:180])
