import io,sys,os
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
base=r'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.7.0/server'
for f in ['dispatch_swarm.py','swarm_pipeline.py','dispatch_swarm_seg1.py','dispatch_swarm_seg2.py','employee_scheduler.py']:
    p=os.path.join(base,f)
    t=open(p,encoding='utf-8',errors='ignore').read()
    print('==',f,len(t))
    for kw in ['返回完成','已汇总','汇总','回收','派单','派出','join','done','pending']:
        c=t.count(kw)
        if c: print('  ',kw,c)
