# -*- coding: utf-8 -*-
"""最终验收：等积压清完 → 云端镜像/心跳/测试数据清理 一次查清"""
import sys, os, time, urllib.request, urllib.parse, ssl
sys.stdout.reconfigure(encoding='utf-8')
SRV = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server'
sys.path.insert(0, SRV)
os.chdir(SRV)
import zf3d_commands as z

def prog():
    return int(z._get_config_value('zf3d', 'remote_sync_last_rowid', '0') or 0)

print('等待 150 秒让积压清完...')
time.sleep(150)
p = prog()
print('[本地进度] last_rowid =', p, '（本地 max≈43099，到达即清完）')

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
KEY = z._get_api_key()

def sql(tag, stmt):
    d = urllib.parse.urlencode({'sql': stmt}).encode('utf-8')
    req = urllib.request.Request('https://www.zf3d.com/api/agent_api.asp?key=%s&a=exec_sql' % KEY, data=d, method='POST')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')
    try:
        r = urllib.request.urlopen(req, timeout=20, context=ctx)
        print(tag, '->', r.read().decode('utf-8', errors='replace')[:260])
    except Exception as e:
        print(tag, 'FAIL ->', e)

sql('[镜像总量]', "SELECT COUNT(*) AS c FROM agent_local_chats")
sql('[真实数据]', "SELECT COUNT(*) AS c FROM agent_local_chats WHERE session_id NOT LIKE 'testSess%'")
sql('[清理测试数据]', "DELETE FROM agent_local_chats WHERE session_id LIKE 'testSess%'")
sql('[清理后总量]', "SELECT COUNT(*) AS c FROM agent_local_chats")
sql('[心跳最新]', "SELECT username, logged_in, last_seen FROM agent_heartbeats ORDER BY last_seen DESC LIMIT 1")
