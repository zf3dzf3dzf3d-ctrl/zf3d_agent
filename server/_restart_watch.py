# -*- coding: utf-8 -*-
"""发重启命令(让服务加载新代码) + 观察同步进度是否自动推进"""
import sys, os, time, urllib.request, urllib.parse, ssl
sys.stdout.reconfigure(encoding='utf-8')
SRV = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server'
sys.path.insert(0, SRV)
os.chdir(SRV)
import zf3d_commands as z

def prog():
    return int(z._get_config_value('zf3d', 'remote_sync_last_rowid', '0') or 0)

print('[发送前] last_rowid =', prog())

# 直接下发 restart 命令到云端队列（本地消费者会拉取执行）
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
KEY = z._get_api_key()
MID = z._get_machine_id()
d = urllib.parse.urlencode({'machine_id': MID, 'command_type': 'restart', 'command_data': '{}'}).encode('utf-8')
req = urllib.request.Request('https://www.zf3d.com/api/agent_api.asp?key=%s&a=send_command' % KEY, data=d, method='POST')
req.add_header('Content-Type', 'application/x-www-form-urlencoded')
try:
    r = urllib.request.urlopen(req, timeout=20, context=ctx)
    print('[重启命令]', r.read().decode('utf-8', errors='replace')[:150])
except Exception as e:
    print('[重启命令] FAIL', e)

print('等待 70 秒（消费+重启+首心跳+首同步）...')
time.sleep(70)
p1 = prog()
print('[70秒后] last_rowid =', p1)
time.sleep(20)
p2 = prog()
print('[90秒后] last_rowid =', p2, '（>前值=新代码在自动推进）')
