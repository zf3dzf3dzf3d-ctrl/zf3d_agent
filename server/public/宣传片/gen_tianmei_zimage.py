# -*- coding: utf-8 -*-
"""5.7宣传片 z_image_turbo 文生图 · 中国甜妹女主 · 1280x720 三套方案（后台无头批产）"""
import json, urllib.request, urllib.error, time, sys, os

HOST = "http://127.0.0.1:8188"
W, H = 1280, 720
OUT_DIR = r"D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\output\5.7宣传片_甜妹"

NEG = ("低质量, 模糊, 变形的手, 多余的手指, 水印, 文字, logo, 丑陋, 扭曲的面部, "
       "exposed, nsfw, bad anatomy, worst quality")

# 三套方案：对应宣传片不同叙事阶段（S1痛点 / S2方案 / S3展望），女主统一=中国甜妹
PLANS = [
    ("方案A_痛点开场", "深夜办公室，一位可爱的中国甜妹女主角，圆脸大眼，空气刘海，棕色长发扎马尾，"
     "米色毛衣工作装，坐在多台显示器前，一脸疲惫烦躁，屏幕冷蓝光照亮她的脸，其中一块屏幕显示红色报错，"
     "低调冷色调布光，高对比，写实电影感，浅景深，35mm镜头，8k，杰作"),
    ("方案B_科技方案", "明亮的现代科技办公室，同一位可爱的中国甜妹女主角，圆脸大眼，空气刘海，棕色长发马尾，"
     "白色衬衫，自信微笑，面对悬浮的全息操作界面，界面上有多个智能体对话窗口整齐排列，"
     "青蓝色科技光效环绕，暖色主光与冷色点缀，高调布光，写实电影感，浅景深，8k，杰作"),
    ("方案C_展望收尾", "黄昏落地窗前的开放式办公室，同一位可爱的中国甜妹女主角，圆脸大眼，空气刘海，"
     "棕色长发披肩，浅色连衣裙外搭针织开衫，轻松惬意地端着咖啡望向窗外城市天际线，"
     "金色夕阳暖光洒满画面，温馨治愈氛围，写实电影感，逆光轮廓光，浅景深，8k，杰作"),
]

def build_prompt(text, seed):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "qwen_image"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": text}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": NEG}},
        "6": {"class_type": "EmptySD3LatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "7": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0],
              "latent_image": ["6", 0], "seed": seed, "steps": 8, "cfg": 2.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "5.7甜妹/%s" % text[:0] or "shot"}},
    }

def q(payload, timeout=120):
    req = urllib.request.Request(HOST + payload["path"], data=json.dumps(payload["body"]).encode() if "body" in payload else None,
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())

os.makedirs(OUT_DIR, exist_ok=True)
ws_jobs = []
for i, (name, pos) in enumerate(PLANS):
    wf = build_prompt(pos, seed=1000 + i)
    # 改 filename_prefix
    wf["9"]["inputs"]["filename_prefix"] = "5.7甜妹/%s" % name
    r = q({"path": "/prompt", "body": {"prompt": wf, "client_id": "headless-tianmei"}})
    pid = r["prompt_id"]
    ws_jobs.append((name, pid))
    print("[submit]", name, pid, flush=True)

# 轮询历史
done = {}
deadline = time.time() + 900
while len(done) < len(ws_jobs) and time.time() < deadline:
    h = q({"path": "/history"}) if False else json.loads(urllib.request.urlopen(HOST + "/history", timeout=30).read())
    for name, pid in ws_jobs:
        if pid in done: continue
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("completed"):
                outs = h[pid]["outputs"]
                imgs = []
                for node in outs.values():
                    for im in node.get("images", []):
                        imgs.append(im["filename"])
                done[pid] = (name, imgs)
                print("[done]", name, imgs, flush=True)
    time.sleep(5)

ok = all(pid in done for _, pid in ws_jobs)
print("RESULT", "ALL_OK" if ok else "PARTIAL", json.dumps([v for v in done.values()], ensure_ascii=False), flush=True)
sys.exit(0 if ok else 2)
