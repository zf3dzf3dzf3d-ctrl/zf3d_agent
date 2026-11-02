import glob,os,json,sys,traceback
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
d=r'C:\Users\Administrator\.codely-cli\tmp'
fs=glob.glob(os.path.join(d,'*','chat-*.json'))+glob.glob(os.path.join(d,'*','chats','*.json'))
tot=0;errs=0;last=None;first=None
for f in fs:
    try:
        j=json.load(open(f,encoding='utf-8'));tot+=len(j.get('clientHistory',[]));last=j
        if first is None: first=f
    except Exception as e:
        errs+=1
        if errs<=3: print('ERR',f,repr(e)[:120])
print('files',len(fs),'msgs',tot,'errs',errs)
print('keys',list(last.keys()) if last else None)
