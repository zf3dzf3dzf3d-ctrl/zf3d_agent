PUBLIC_DIR=os.path.abspath('public'
text=open('public/index.html',encoding='utf-8').read() 
def _ver_of(m): 
    fp=os.path.join(PUBLIC_DIR,m.group(2).lstrip('/').replace('/',os.sep)) 
    if os.path.isfile(fp): return m.group(1)+m.group(2)+'?v='+hashlib.md5(open(fp,'rb').read()).hexdigest()[:8] 
    return m.group(0) 
