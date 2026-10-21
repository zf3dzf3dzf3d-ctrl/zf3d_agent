# -*- coding: utf-8 -*-
"""朱峰智能体 · AI 代理(8564)专项诊断
定位 proxy_unavailable 真因：ai_proxy 子进程为何没在端口上跑起来。
用法：把本文件 + 同目录 代理诊断.bat 拷到远程机安装目录下双击运行，回传控制台输出。
"""
import os
import sys
import json
import socket
import subprocess
import threading
import time

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
print("=" * 60)
print("朱峰 AI 代理专项诊断  目录:", BASE)
print("=" * 60)

# 1) 解析端口（与 server 同逻辑：env > private/port.json > public/config/ai_proxy.json > 8564）
def get_port():
    try:
        p = int(os.environ.get("AI_PROXY_PORT", "0"))
        if p > 0:
            return p, "环境变量 AI_PROXY_PORT"
    except Exception:
        pass
    for fn, key in [
        (os.path.join(BASE, "private", "port.json"), "ai_proxy_port"),
        (os.path.join(BASE, "server", "private", "port.json"), "ai_proxy_port"),
        (os.path.join(BASE, "public", "config", "ai_proxy.json"), "port"),
    ]:
        try:
            with open(fn, encoding="utf-8-sig") as f:
                v = json.load(f).get(key)
                if isinstance(v, int) and v > 0:
                    return v, os.path.relpath(fn, BASE)
        except Exception:
            pass
    return 8564, "默认值(未找到配置文件!)"

PORT, SRC = get_port()
print("\n[1] 代理端口 = %s   (来源: %s)" % (PORT, SRC))

# 2) 端口是否 LISTEN
print("\n[2] TCP 探活 127.0.0.1:%s ..." % PORT)
up = False
try:
    s = socket.create_connection(("127.0.0.1", PORT), timeout=3)
    up = True
    print("    -> 端口已开放(有进程在监听)")
    s.close()
except Exception as e:
    print("    -> 端口不通: %r  (这就是 proxy_unavailable 的直接原因)" % e)

# 3) /health 归属：是本项目的 zf-ai-proxy 还是被别的进程占用
if up:
    try:
        import urllib.request
        r = urllib.request.urlopen("http://127.0.0.1:%s/health" % PORT, timeout=5)
        body = r.read().decode("utf-8", "replace")
        print("\n[3] /health 返回:", body[:200])
    except Exception as e:
        print("\n[3] /health 读取失败(可能是非本项目进程占用端口):", e)

# 3b) 【关键·区分"连不上" vs "连上了但业务报错"】直连 get_token 接口拿真实 HTTP 状态码
#     proxy_unavailable 现在只有两种真因：端口连不上(下面 4xx/5xx/异常都说明进程活着)
#     若这里返回 4xx(如 401/403 鉴权/登录态)，说明进程在跑、问题在 token 签发环节，而非"进程没起"
if up:
    print("\n[3b] 直连 POST /internal/get_token 探测真实应答:")
    try:
        import urllib.request, urllib.error
        req = urllib.request.Request(
            "http://127.0.0.1:%s/internal/get_token" % PORT,
            data=json.dumps({"user_id": 0}).encode("utf-8"),
            method="POST")
        req.add_header("Content-Type", "application/json")
        r = urllib.request.urlopen(req, timeout=5)
        print("    -> HTTP %s 应答: %s" % (r.status, r.read().decode("utf-8", "replace")[:300]))
        print("    结论: 代理进程存活且接口可应答(返回 token 空属正常，因探测 user_id=0)")
    except urllib.error.HTTPError as e:
        print("    -> HTTP %s (代理进程【存活】但接口报错，非连不上): %s"
              % (e.code, e.read().decode("utf-8", "replace")[:300]))
        if e.code in (401, 403):
            print("    高度可疑: 鉴权/内部密钥失败 -> 排查 zf_identity.internal_secret 一致性")
        else:
            print("    结论: 进程活着但业务返回 %s -> 新版 server 会标为 upstream_%s 而非 proxy_unavailable" % (e.code, e.code))
    except Exception as e:
        print("    -> 连接级异常(这才是 proxy_unavailable 的真因):", repr(e))

# 4) 端口占用进程
print("\n[4] 占用端口的进程(netstat):")
try:
    out = subprocess.run("netstat -ano | findstr :%s" % PORT, shell=True,
                        capture_output=True, text=True).stdout.strip()
    print("    " + (out.replace("\n", "\n    ") if out else "（无监听进程）"))
except Exception as e:
    print("    netstat 失败:", e)

# 5) 关键：读 ai_proxy_run.log 末尾（子进程真实报错就在这里）
LOGP = os.path.join(BASE, "ai_proxy_run.log")
print("\n[5] ai_proxy_run.log 末尾:")
if os.path.isfile(LOGP):
    try:
        with open(LOGP, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        tail = lines[-30:]
        print("    (共 %d 行，显示末 %d 行)" % (len(lines), len(tail)))
        print("    " + "".join(tail).replace("\n", "\n    "))
    except Exception as e:
        print("    读日志失败:", e)
else:
    print("    日志文件不存在 -> server 可能从未成功拉起过 ai_proxy")

# 6) 决定性：前台直接跑 ai_proxy.py，捕获真实启动报错
print("\n[6] 前台拉起 ai_proxy.py 限时 8 秒，捕获真实报错:")
PROXYPY = os.path.join(BASE, "ai_proxy.py")
if not os.path.isfile(PROXYPY):
    print("    未找到 ai_proxy.py:", PROXYPY)
else:
    captured = []
    try:
        proc = subprocess.Popen([sys.executable, PROXYPY], cwd=BASE,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, encoding="utf-8", errors="replace")
    except Exception as e:
        print("    启动失败:", e)
        proc = None
    if proc:
        def reader():
            for ln in proc.stdout:
                captured.append(ln)
        t = threading.Thread(target=reader, daemon=True)
        t.start()
        time.sleep(8)
        try:
            proc.terminate()
        except Exception:
            pass
        print("    " + ("".join(captured[:50]).replace("\n", "\n    ")
              if captured else "（无任何输出，可能 ai_proxy 已在另一实例占端口或启动即成功但被本次探测端口冲突）"))
        # 再探一次端口
        try:
            s2 = socket.create_connection(("127.0.0.1", PORT), timeout=3)
            print("    [复测] 拉起 8 秒后端口 %s 已通 -> ai_proxy 能正常启动" % PORT)
            s2.close()
        except Exception as e:
            print("    [复测] 端口仍不通:", e)

print("\n" + "=" * 60)
print("诊断结束。请把以上全部内容复制回传给朱峰。")
print("=" * 60)
