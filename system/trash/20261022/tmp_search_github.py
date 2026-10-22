import urllib.request, urllib.parse, json
def s(q):
    u='https://api.github.com/search/repositories?q='+urllib.parse.quote(q)+'&sort=stars&per_page=8'
    r=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'x'})))
    print('==',q,'total:',r.get('total_count'))
    for i in r.get('items',[]):
        print(i['full_name'],'| star',i['stargazers_count'],'|',(i.get('description') or '')[:90])
for q in ['作战大屏','智能体 大屏','agent dashboard','ai agent dashboard 大屏','AI Agents War Room']:
    try: s(q)
    except Exception as e: print(q,'ERR',repr(e))
