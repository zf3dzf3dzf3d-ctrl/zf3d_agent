import io,sys,difflib
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8',errors='replace')
s505=open('public/index.html',encoding='utf-8').read()
s504=open('../朱峰社区智能体无限_5.0.4/public/index.html',encoding='utf-8').read()
A=s505.splitlines(); B=s504.splitlines()
sm=difflib.SequenceMatcher(None,A,B,autojunk=False)
out=A[:]; fixed=0
for tag,i1,i2,j1,j2 in sm.get_opcodes():
    if tag=='equal': continue
    if i2-i1==j2-j1:
        for k in range(i2-i1):
            a=A[i1+k]; b=B[j1+k]
            if '\ufffd' in a and '\ufffd' not in b:
                out[i1+k]=b; fixed+=1
print('fixed:',fixed)
s='\n'.join(out)
print('remaining fffd:',s.count('\ufffd'))
badlines=[(i,l.strip()[:80]) for i,l in enumerate(s.split('\n'),1) if '\ufffd' in l]
open('badlines.txt','w',encoding='utf-8').write('\n'.join(f'{i}\t{l}' for i,l in badlines))
open('public/index.html','w',encoding='utf-8').write(s)
