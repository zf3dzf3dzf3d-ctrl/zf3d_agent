import json,urllib.request,time,sys
sys.path.insert(0,'.')
# 1) 直连智谱（用本地缓存的 key）
try:
    import win32crypt
except Exception:
    pass
key=None
try:
    raw=open('private/api_keys.json','rb').read()
    try:
        import win32crypt
        dec=win32crypt.CryptUnprotectData(raw,None,None,None,0)[1]
        d=json.loads(dec)
    except Exception:
        d=json.loads(raw)
    # 找 CodingPlan智谱 相关 key
    def walk(o):
        global key
        if isinstance(o,dict):
            for k,v in o.items():
                if '智谱' in str(k) or 'bigmodel' in str(v)[:200]: pass
                walk(v)
        elif isinstance(o,list):
            for i in o: walk(i)
    walk(d)
    print('keys-db-loaded, sample:',str(d)[:300])
except Exception as e:
    print('key-db ERR',repr(e))

# 2) 中转线路详情：带 relay 直接转发时打印上游原始响应
body={'model':'glm-5.3-flash','messages':[{'role':'user','content':'reply ok'}],'stream':False,'_relay':'zfglm-flash'}
req=urllib.request.Request('http://127.0.0.1:8570/api/proxy',json.dumps(body).encode(),{'Content-Type':'application/json'})
r=urllib.request.urlopen(req,timeout=90)
print('proxy raw:',r.read().decode('utf-8')[:500])
