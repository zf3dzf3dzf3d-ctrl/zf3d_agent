# -*- coding: utf-8 -*-
"""端到端自测：发令牌 -> 无效令牌401 -> 充值 -> 余额不足拦截 -> 鉴权通过"""
import json, urllib.request, urllib.error

def post(url, data, tok=None):
    h = {'Content-Type': 'application/json'}
    if tok: h['Authorization'] = 'Bearer ' + tok
    req = urllib.request.Request(url, data=json.dumps(data).encode(), headers=h)
    try:
        return urllib.request.urlopen(req).read().decode()
    except urllib.error.HTTPError as e:
        return f'HTTP{e.code}: ' + e.read().decode()[:120]

B = 'http://127.0.0.1:8787'
r = json.loads(post(B + '/internal/issue_token', {'user_id': 998}))
tok = r['token']
print('1 发令牌:', tok[:14] + '...')
print('2 无效令牌:', post(B + '/v1/chat/completions', {'model': 'gpt-4o', 'messages': []}, 'zfai_bad')[:60])
print('3 未充值会员调用(余额0应402):', post(B + '/v1/chat/completions', {'model': 'gpt-4o', 'messages': [{'role': 'user', 'content': 'hi'}]}, tok)[:80])
post(B + '/internal/recharge', {'user_id': 998, 'credits': 10})
print('4 充值10积分后再调用(无上游key预期502):', post(B + '/v1/chat/completions', {'model': 'gpt-4o', 'messages': [{'role': 'user', 'content': 'hi'}]}, tok)[:80])

import sqlite3
c = sqlite3.connect(r'C:\work\web\data\zf3d.db')
print('5 账户余额:', c.execute('select balance,status from ai_accounts where user_id=998').fetchone())
# 清理测试数据
c.execute("DELETE FROM ai_accounts WHERE user_id IN (998,999)")
c.execute("DELETE FROM ai_usage WHERE user_id IN (998,999)")
c.commit(); c.close()
print('6 测试数据已清理')
