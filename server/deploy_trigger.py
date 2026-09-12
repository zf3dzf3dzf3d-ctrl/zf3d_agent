# -*- coding: utf-8 -*-
import requests, urllib3, json
urllib3.disable_warnings()
secrets = [
 '3277b70cc5cbcc483e995fe137db44ce28a36b77ec22dd6e0bc9ee1e3d35321a',
 '3277b70cc5cbcc483e995fe137db44ce28a36b77ec22dd6e0bc9ee1e3d35321a\r\n',
 '3277B70CC5CBCC483E995FE137DB44CE28A36B77EC22DD6E0BC9EE1E3D35321A',
]
body0 = {'hook_name':'push_hooks','ref':'refs/heads/main','after':'6c5f8175','before':'f4ace3fb','event_name':'push'}
res=[]
for s in secrets:
    body = dict(body0); body['password']=s
    r = requests.post('https://www.zf3d.com/deploy_webhook.asp', data=json.dumps(body), verify=False, timeout=60, proxies={'http':None,'https':None})
    res.append('%s -> %s %s' % (s[:12], r.status_code, r.text[:120]))
open('server/deploy_trigger_out.txt','w',encoding='utf-8').write('\n'.join(res))
