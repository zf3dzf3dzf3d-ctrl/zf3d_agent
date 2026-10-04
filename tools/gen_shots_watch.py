# -*- coding: utf-8 -*-
"""监督器：轮询 ComfyUI 队列，逐个等 shot{n}.mp4 落地。
先把全部 9 镜的 I2V 任务排队（利用 ComfyUI 自身队列串行），
再轮询 history 逐个下载。用法：python gen_shots_watch.py
"""
import json, os, sys, time, urllib.request, urllib.parse, glob, shutil

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(BASE, "python", "python.exe")
BRIDGE = os.path.join(BASE, "tools", "comfy_bridge.py")
SB = os.path.join(BASE, "promo2", "storyboard_ai.json")
SHOTS = os.path.join(BASE, "promo2", "shots")
API = "http://127.0.0.1:8188"

def submit(n, s):
    png = os.path.join(SHOTS, f"shot{n}.png")
    frames = min(s["frames"], 112)
    args = [PY, BRIDGE, "i2v_wan",
            "--image", "53", png,
            "--prompt", f'{s["name"]}。{s["motion"]}。全程{min(s["sec"],7)}秒，16:9横幅。',
            "--set", "77:54.width=1280", "--set", "77:54.height=720",
            "--set", f"77:54.length={frames}"]
    print("提交 shot", n, flush=True)
    r = subprocess_run(args)
    return r

def subprocess_run(args):
    import subprocess
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")

def fetch(pid, dst):
    h = json.loads(urllib.request.urlopen(f"{API}/history/{pid}", timeout=15).read())
    if pid not in h:
        return None
    st = h[pid].get("status", {})
    if not st.get("completed", True):
        return "error:" + str(st.get("status_str"))
    for node, o in h[pid].get("outputs", {}).items():
        for img in o.get("images", []):
            if img["filename"].lower().endswith((".mp4", ".webm")):
                url = API + "/view?" + urllib.parse.urlencode(
                    {"filename": img["filename"], "subfolder": img["subfolder"], "type": img.get("type", "output")})
                urllib.request.urlretrieve(url, dst)
                return "done"
    return "done"  # 完成但无视频？标记完成

def main():
    shots = json.load(open(SB, encoding="utf-8"))["shots"]
    todo = []
    for s in shots:
        n = s["no"]
        png = os.path.join(SHOTS, f"shot{n}.png")
        mp4 = os.path.join(SHOTS, f"shot{n}.mp4")
        if os.path.exists(mp4):
            continue
        # 底图先保证有（文生图快，直接同步跑）
        if not os.path.exists(png):
            STYLE = json.load(open(SB, encoding="utf-8"))["meta"]["style_suffix"]
            r = subprocess_run([PY, BRIDGE, "z_image", "--prompt", s["prompt"] + ", " + STYLE,
                                "--set", "74:68.width=1280", "--set", "74:68.height=720"])
            cands = sorted(glob.glob(os.path.join(BASE, "public", "data", "workbench", "comfy_*.png")), key=os.path.getmtime)
            if "DONE:" in (r.stdout or "") and cands:
                shutil.copy(cands[-1], png); print(f"shot{n} 底图 OK", flush=True)
            else:
                print(f"shot{n} 底图失败:\n", (r.stdout or "")[-500:], (r.stderr or "")[-300:], flush=True); continue
        todo.append((n, s))
    # 全部排队
    pids = []
    for n, s in todo:
        r = submit(n, s)
        m = [l for l in (r.stdout or "").splitlines() if l.startswith("queued:")]
        if m:
            pids.append((n, m[0].split(":")[1].strip()))
        else:
            print(f"shot{n} 提交失败:\n", (r.stdout or "")[-500:], (r.stderr or "")[-500:], flush=True)
    print("排队完成:", [(n, p[:8]) for n, p in pids], flush=True)
    # 轮询
    remain = dict(pids)
    t0 = time.time()
    while remain and time.time() - t0 < 4 * 3600:
        time.sleep(30)
        for n, pid in list(remain.items()):
            try:
                res = fetch(pid, os.path.join(SHOTS, f"shot{n}.mp4"))
            except Exception as e:
                res = None
            if res == "done":
                print(f"shot{n} ✅ 完成", flush=True); remain.pop(n)
            elif res and res.startswith("error"):
                print(f"shot{n} ❌ {res}", flush=True); remain.pop(n)
        if remain:
            print(f"[{int(time.time()-t0)}s] 剩余: {sorted(remain)}", flush=True)
    print("结束，未完成:", sorted(remain), flush=True)

if __name__ == "__main__":
    main()
