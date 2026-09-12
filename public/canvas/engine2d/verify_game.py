#!/usr/bin/env python3
# verify_game.py — 一条命令验证 AI 生成游戏：语法检查 + 起服务 + 浏览器实测 + telemetry 采集
# 用法: python verify_game.py space-shooter
import sys, os, json, subprocess, threading, time, urllib.request, socket

ROOT = os.path.dirname(os.path.abspath(__file__))
PY = r"C:\Users\Administrator\AppData\Local\Programs\Python\Python311\python.exe"

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "space-shooter"
    gdir = os.path.join(ROOT, "games", name)
    ok = True
    # 1) 目录与文件齐备
    for f in ("index.html", "game.js", "config.json", "telemetry.js"):
        p = os.path.join(gdir, f)
        if not os.path.isfile(p):
            print(f"[FAIL] 缺少 {f}"); ok = False
    if not ok: sys.exit(1)
    print("[OK] 目录结构齐备")

    # 2) JS 语法检查（Node 无则跳过，浏览器实测兜底）
    node = None
    for c in ("node",): 
        try:
            subprocess.run([c, "-v"], capture_output=True); node = c; break
        except OSError: pass
    if node:
        for f in ("game.js", "telemetry.js"):
            r = subprocess.run([node, "--check", os.path.join(gdir, f)], capture_output=True, text=True)
            print(("[OK] " if r.returncode == 0 else "[FAIL] ") + f + (" 语法通过" if r.returncode == 0 else " 语法错误:\n" + r.stderr))
            ok = ok and r.returncode == 0
    else:
        print("[SKIP] 无 Node，语法由浏览器实测验证")

    # 3) 起服务 + 请求入口页
    port = free_port()
    proc = subprocess.Popen([PY, os.path.join(ROOT, "server.py"), "--port", str(port)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(1.2)
        url = f"http://127.0.0.1:{port}/games/{name}/index.html"
        try:
            html = urllib.request.urlopen(url, timeout=5).read().decode("utf-8")
            print(f"[OK] 入口页可访问 {url} ({len(html)} bytes)")
            for dep in ('game.js', 'config.json', 'telemetry.js'):
                u = f"http://127.0.0.1:{port}/games/{name}/{dep}"
                urllib.request.urlopen(u, timeout=5)
            print("[OK] game.js / config.json / telemetry.js 均可加载")
        except Exception as e:
            print(f"[FAIL] 页面请求失败: {e}"); ok = False
    finally:
        proc.terminate()

    # 4) 浏览器实测（有内置浏览器工具时由 AI 手动执行；此处输出指令）
    print(f"""
[浏览器实测] 请用浏览器打开 {url.replace('127.0.0.1','localhost')} 检查：
  1. 控制台无红色报错  2. 能移动/射击/得分  3. 死亡后可重开  4. console 有 [telemetry] JSON
""")
    print("验证结果:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
