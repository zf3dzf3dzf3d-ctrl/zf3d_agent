# -*- coding: utf-8 -*-
"""comfy_bridge —— ComfyUI → 图片工作台联动桥。

用法（AI 直接 run_code 调用）：
  python comfy_bridge.py z_image  --prompt "提示词"
  python comfy_bridge.py <工作流绝对路径.json> --set "71.value=提示词" --set "74:69.seed=123"
  python comfy_bridge.py list                 # 列出可用 _api 工作流

逻辑：把工作流 JSON 提交到 ComfyUI HTTP API (127.0.0.1:8188)，
完成后取回输出图，落盘 public/data/workbench/ 并写 .ai_latest.json 游标，
前端工作台抽屉 3s 内自动把结果回贴为新图层。
"""
import json, os, sys, time, random, urllib.request, urllib.parse, shutil, glob

API = "http://127.0.0.1:8188"
WF_ROOT = r"D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\user\default\workflows"
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "public", "data", "workbench")
CURSOR = os.path.join(OUT_DIR, ".ai_latest.json")

SHORTCUTS = {
    "z_image":   "01常用/02图片/常用_图片z_image文生图_api.json",
    "flux2":     "01常用/02图片/flux/常用_图片_flux2_单图_api.json",
    "qwen":      "01常用/02图片/qwen/常用_图片_qwen2511单图_api.json",
    "qwen2":     "01常用/02图片/qwen/常用_图片_qwen2511双图_api.json",
    "i2v_ltx":   "01常用/01视频/ltx2.3/常用_视频_ltx2.3_图生视频_api.json",
    "i2v_wan":   "01常用/01视频/wan/常用_视频_wan2.2图生视频_api.json",
    "t2v_wan":   "01常用/01视频/wan/常用_视频_wan2.2文生视频_api.json",
}

def list_workflows():
    for p in sorted(glob.glob(os.path.join(WF_ROOT, "**", "*_api.json"), recursive=True)):
        print(os.path.relpath(p, WF_ROOT))

def resolve(name):
    if name.lower().endswith(".json"):
        return name if os.path.isabs(name) else os.path.join(WF_ROOT, name)
    if name in SHORTCUTS:
        return os.path.join(WF_ROOT, SHORTCUTS[name])
    hits = glob.glob(os.path.join(WF_ROOT, "**", "*%s*_api.json" % name), recursive=True)
    if len(hits) == 1:
        return hits[0]
    if not hits:
        raise SystemExit("未找到含 %r 的 _api 工作流，先跑 list" % name)
    print("多个匹配，请用完整路径：")
    for h in hits:
        print(" ", h)
    raise SystemExit(1)

def api_post(path, payload):
    req = urllib.request.Request(API + path, json.dumps(payload).encode(),
                                 {"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=60).read())
    except urllib.error.HTTPError as e:
        print('提交被拒:', e.read().decode('utf-8', 'ignore')[:2000]); raise

def upload_file(fp):
    """上传本地图片/视频到 ComfyUI input，返回 [name, subfolder]"""
    import mimetypes, uuid
    boundary = uuid.uuid4().hex
    fn = os.path.basename(fp)
    body = (("--%s\r\nContent-Disposition: form-data; name=\"image\"; filename=\"%s\"\r\n"
             "Content-Type: %s\r\n\r\n" % (boundary, fn, mimetypes.guess_type(fn)[0] or "application/octet-stream"))
            .encode() + open(fp, "rb").read() + ("\r\n--%s--\r\n" % boundary).encode())
    req = urllib.request.Request(API + "/upload/image", body,
        {"Content-Type": "multipart/form-data; boundary=" + boundary})
    r = json.loads(urllib.request.urlopen(req, timeout=120).read())
    return r["name"] if not r.get("subfolder") else r["subfolder"] + "/" + r["name"]

def main():
    argv = sys.argv[1:]
    if not argv or argv[0] == "list":
        list_workflows(); return
    wf_path = resolve(argv[0])
    prompt_txt, sets, uploads = None, {}, {}   # uploads: 节点id -> 本地文件
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--prompt" and i + 1 < len(argv):
            prompt_txt = argv[i + 1]; i += 2
        elif a == "--set" and i + 1 < len(argv):
            k, v = argv[i + 1].split("=", 1)
            node, key = k.rsplit(".", 1)
            try: v = json.loads(v)
            except Exception: pass
            sets.setdefault(node, {})[key] = v; i += 2
        elif a == "--image" and i + 2 < len(argv):
            uploads[argv[i + 1]] = argv[i + 2]; i += 3
        else:
            i += 1

    wf = json.load(open(wf_path, encoding="utf-8"))
    # 上传素材：自动把 LoadImage 类节点的图片喂进去
    for nid, fp in uploads.items():
        wf[nid]["inputs"]["image"] = upload_file(fp)
    # 未显式指定时，自动定位提示词节点（PrimitiveStringMultiline 或空 CLIPTextEncode）
    if prompt_txt:
        done = False
        for nid, n in wf.items():
            if n.get("class_type") == "PrimitiveStringMultiline":
                wf[nid]["inputs"]["value"] = prompt_txt; done = True; break
        if not done:
            for nid, n in wf.items():
                if n.get("class_type") == "CLIPTextEncode" and isinstance(n["inputs"].get("text"), str):
                    n["inputs"]["text"] = prompt_txt; break
    for nid, kv in sets.items():
        wf[nid]["inputs"].update(kv)

    r = api_post("/prompt", {"prompt": wf})
    pid = r.get("prompt_id") or ""
    if not pid:
        print("提交失败:", r); return
    print("queued:", pid, flush=True)
    for _ in range(600):   # 最多20分钟（视频生成慢）
        time.sleep(2)
        h = json.loads(urllib.request.urlopen(f"{API}/history/{pid}", timeout=15).read())
        if pid in h:
            st = h[pid].get("status", {})
            if not st.get("completed", True):
                print("执行出错:", json.dumps(st.get("status_str"), ensure_ascii=False)); return
            break
    else:
        print("timeout"); return

    os.makedirs(OUT_DIR, exist_ok=True)
    from PIL import Image
    media, is_video = None, False
    for node, o in h[pid].get("outputs", {}).items():
        for img in o.get("images", []):
            if img.get("type") == "output" or True:
                sub, fn = img["subfolder"], img["filename"]
                url = API + "/view?" + urllib.parse.urlencode({"filename": fn, "subfolder": sub, "type": img.get("type", "output")})
                ext = os.path.splitext(fn)[1] or ".png"
                if ext.lower() in (".mp4", ".webm", ".mov"): is_video = True
                dst = os.path.join(OUT_DIR, "comfy_" + time.strftime("%H%M%S") + "_" + fn.replace("/", "_"))
                urllib.request.urlretrieve(url, dst)
                media = dst
    if not media:
        print("无输出文件"); return
    ext = os.path.splitext(media)[1].lower()
    if ext in (".mp4", ".webm", ".mov"):
        fname = os.path.basename(media); is_video = True
    else:
        im = Image.open(media)
        if im.mode not in ("RGB", "RGBA"): im = im.convert("RGB")
        fname = "comfy_" + time.strftime("%H%M%S") + ".png"
        im.save(os.path.join(OUT_DIR, fname))
        if os.path.basename(media) != fname:
            try: os.remove(media)
            except OSError: pass
    # 端口从本项目 private/port.json 读取（多版本共存时避免串台）
    _pj = os.path.join(BASE, "private", "port.json")
    try:
        _port = json.load(open(_pj, encoding="utf-8-sig")).get("api_port", 8555)
    except Exception:
        _port = 8555
    result_url = "http://127.0.0.1:%d/data/workbench/" % _port + fname
    json.dump({"url": result_url, "path": "/data/workbench/" + fname,
               "tool": "comfyui:" + os.path.splitext(os.path.basename(wf_path))[0],
               "video": is_video, "ts": time.time()},
              open(CURSOR, "w", encoding="utf-8"), ensure_ascii=False)
    print("DONE:", result_url)

if __name__ == "__main__":
    main()

