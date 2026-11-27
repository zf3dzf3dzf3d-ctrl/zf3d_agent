# -*- coding: utf-8 -*-
"""一次性：server.py 全链启动实测（S1 前置·第5轮拖账销账）。
流程：备份 port.json -> 切测试端口 -> 子进程启动 -> 探活+插件认证断言 -> 杀进程 -> 还原。
跑完即删。
【手动实测脚本】（快速优化冲刺 A4 20261123）本文件改写 private/port.json 并启停服务，
属脚本式实测，被 conftest AST 排除是预期行为，禁止为收集而改写。"""
import json, os, socket, subprocess, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRV = os.path.join(ROOT, 'server')
PJ = os.path.join(ROOT, 'private', 'port.json')
API, WS, TTS, RWS, PROXY = 8590, 8591, 8592, 8593, 8594

def free(p):
    s = socket.socket(); r = s.connect_ex(('127.0.0.1', p)) != 0; s.close(); return r

# 安全护栏（收尾队W4 2026-11-23）：本测试会改写 private/port.json、启动并查杀服务进程。
# 若生产服务（默认 8620 端口）正在运行，拒绝在活体上自毁式运行——先停服再跑。
if not free(8620):
    print('[GUARD] 8620 端口可连——检测到生产服务正在运行。')
    print('[GUARD] 本测试会改写 private/port.json 并启动/查杀子进程，为防自毁拒绝运行（exit 2）。')
    print('[GUARD] 请先停掉生产服务后再执行本测试。')
    sys.exit(2)

assert free(API) and free(WS), 'test ports busy, abort'

orig = open(PJ, 'rb').read()
cfg = json.loads(orig.decode('utf-8-sig'))
cfg.update({'api_port': API, 'ws_port': WS, 'remote_ws_port': RWS,
            'tts_stream': {'enabled': False, 'port': TTS}, 'ai_proxy_port': PROXY})
open(PJ, 'w', encoding='utf-8').write(json.dumps(cfg, ensure_ascii=False, indent=2))
# 预置插件启用名单（生命周期默认 disabled，此步模拟"启用状态已持久化"的恢复场景）
ST = os.path.join(ROOT, 'server', 'data', 'plugin_states.json')
st_orig = open(ST, 'rb').read()
json.dump({'enabled': ['manager.zf-console', 'tool.time-report'],
           'implementations': {}, 'config': {}}, open(ST, 'w', encoding='utf-8'))
try:
    py = sys.executable
    env = dict(os.environ, AI_PROXY_PORT=str(PROXY))
    p = subprocess.Popen([py, 'server.py'], cwd=SRV, env=env,
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    up = False
    t0 = time.time()
    while time.time() - t0 < 75:
        if p.poll() is not None:
            out = p.stdout.read().decode('utf-8', 'ignore')[-3000:]
            print('BOOT DIED rc=%s\n%s' % (p.returncode, out))
            print('RESULT: FAIL (process exited)'); sys.exit(1)
        try:
            with urllib.request.urlopen('http://127.0.0.1:%d/api/hot-reload/status' % API, timeout=2) as r:
                if r.status == 200:
                    up = True; break
        except Exception:
            time.sleep(1.5)
    assert up, 'server did not become healthy in 75s'
    print('T1 boot+listen: PASS')

    # T2 插件全链：管理端点无 token 必须 403（kernel 认证 + 插件路由全链）
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d/api/plugin-manager/list' % API, timeout=5) as r:
            print('T2 no-token status=%s (expect 403)' % r.status); ok2 = False
    except urllib.error.HTTPError as e:
        ok2 = (e.code == 403)
        print('T2 no-token -> 403: %s' % ('PASS' if ok2 else 'FAIL code=%s' % e.code))
    # T3 带 token 放行
    tok = open(os.path.join(ROOT, 'plugins', 'data', 'plugin_console_token.txt')).read().strip()
    req = urllib.request.Request('http://127.0.0.1:%d/api/plugin-manager/list' % API,
                                 headers={'X-Plugin-Token': tok})
    with urllib.request.urlopen(req, timeout=5) as r:
        body = json.loads(r.read().decode('utf-8'))
        ok3 = r.status == 200 and body.get('ok') and any(pl['id'] == 'tool.time-report' for pl in body.get('plugins', []))
        print('T3 with-token list 200 & has time-report: %s' % ('PASS' if ok3 else 'FAIL: %s' % body))
    print('RESULT: %s' % ('ALL PASS' if (ok2 and ok3) else 'FAIL'))
finally:
    try:
        p.terminate(); time.sleep(1)
        if p.poll() is None: p.kill()
    except Exception: pass
    open(PJ, 'wb').write(orig)  # 无条件还原
    open(ST, 'wb').write(st_orig)  # 还原插件状态
    print('port.json restored: %s' % (open(PJ,'rb').read() == orig))
