import json, urllib.request
key = 'efd7bc0708f24b19aed98d72b83dba83.9X0HnhpubSK6JrI9'
url = 'https://open.bigmodel.cn/api/paas/v4/embeddings'
req = urllib.request.Request(url, data=json.dumps({'model':'embedding-3','input':'测试向量化'}).encode(), headers={'Content-Type':'application/json','Authorization':'Bearer '+key})
try:
    r = urllib.request.urlopen(req, timeout=30)
    d = json.loads(r.read())
    print('OK dims=', len(d['data'][0]['embedding']))
except Exception as e:
    print('FAIL:', str(e)[:200])
    try: print(e.read().decode()[:300])
    except: pass
# 也试下硅基流动官方（无key预期失败，但确认错误类型）
url2 = 'https://api.siliconflow.cn/v1/embeddings'
req2 = urllib.request.Request(url2, data=json.dumps({'model':'BAAI/bge-m3','input':'测试'}).encode(), headers={'Content-Type':'application/json','Authorization':'Bearer empty'})
try:
    r2 = urllib.request.urlopen(req2, timeout=30)
    print('SF OK')
except Exception as e:
    print('SF FAIL:', str(e)[:150])
