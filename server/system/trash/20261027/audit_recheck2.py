import os,hashlib,collections
root=r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\private\记忆'
files=[]
for dp,dn,fn in os.walk(root):
    for f in fn:
        if f.lower().endswith('.md'):
            files.append(os.path.join(dp,f))
print('total remaining .md:',len(files))
h=collections.defaultdict(list)
for p in files:
    h[hashlib.md5(open(p,'rb').read()).hexdigest()].append(p)
dups={k:v for k,v in h.items() if len(v)>1}
print('md5 dup groups:',len(dups),'redundant:',sum(len(v)-1 for v in dups.values()))
for k,v in list(dups.items())[:5]:
    print('SAMPLE:',[os.path.basename(x) for x in v])
bk=r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\private\backups\memory_dedup_20261027'
allc=sum(len(fn) for dp,dn,fn in os.walk(bk))
p2=sum(1 for dp,dn,fn in os.walk(bk) for f in fn if f.startswith('pass2_'))
print('backup total:',allc,'pass2:',p2)
