# -*- coding: utf-8 -*-
"""5.7宣传片 像素风专项 · z_image_turbo 1280x720 无头批产
像素复古风格 × 6镜头 × 3个seed = 18张，串行提交 ComfyUI :8188，结果只写日志文件。
build_graph 与实测 60/60 成功的 gen_night10.py 完全一致（UNETLoader bf16 + qwen_3_4b + EmptySD3LatentImage），
仅改 filename_prefix 与 seed 段，勿乱改节点结构。
"""
import json, urllib.request, time, io, os

HOST = "http://127.0.0.1:8188"
W, H = 1280, 720
LOG = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server\public\宣传片\pixel_log.txt"

NEG = ("低质量, 模糊, 变形的手, 多余的手指, 水印, 文字, logo, 丑陋, 扭曲的面部, "
       "exposed, nsfw, bad anatomy, worst quality")

GIRL = "一位可爱的中国甜妹女主角，圆脸大眼，空气刘海，棕色长发"
STYLE = ("8bit 像素艺术风格，复古电子游戏画面，{g}，程序员装扮，像素化现代办公室场景，"
         "CRT显示器像素光效，16色复古调色板，像素艺术杰作；{v}")

VIEWS = [
    "镜头1 特写：角色面向镜头微笑，眼神发光",
    "镜头2 中景：角色操作悬浮界面，指尖点击光点",
    "镜头3 全景：角色身处场景中心，环境细节丰富",
    "镜头4 侧面：角色回眸，动态构图",
    "镜头5 俯视：角色仰头看向镜头，戏剧性视角",
    "镜头6 远景：剪影与光效，氛围拉满",
]
SEEDS = [8101, 8102, 8103]  # 3个seed × 6镜头 = 18张
PREFIX = "5.7宣传片_像素风专项/像素复古_镜头%d_seed%d"


def log(msg):
    with io.open(LOG, "a", encoding="utf-8") as f:
        f.write("[%s] %s\n" % (time.strftime("%m-%d %H:%M:%S"), msg))


def api(path, payload=None, timeout=60):
    url = HOST + path
    if payload is None:
        req = urllib.request.Request(url)
    else:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def build_graph(text, seed, prefix):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "z_image_turbo_bf16.safetensors", "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_4b.safetensors", "type": "qwen_image"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": "ae.safetensors"}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": text}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": NEG}},
        "6": {"class_type": "EmptySD3LatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "7": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["4", 0], "negative": ["5", 0],
              "latent_image": ["6", 0], "seed": seed, "steps": 8, "cfg": 2.0, "sampler_name": "euler",
              "scheduler": "simple", "denoise": 1.0}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def main():
    log("=== pixel START total=%d ===" % (len(VIEWS) * len(SEEDS)))
    ok, fail = 0, 0
    for seed in SEEDS:
        for vi, view in enumerate(VIEWS, 1):
            prompt = STYLE.format(g=GIRL, v=view)
            prefix = PREFIX % (vi, seed)
            try:
                r = api("/prompt", {"prompt": build_graph(prompt, seed, prefix)})
                pid = r.get("prompt_id")
                for _ in range(60):
                    time.sleep(5)
                    h = api("/history")
                    if pid in h and h[pid].get("status", {}).get("completed"):
                        ok += 1
                        log("OK seed%d 镜头%d" % (seed, vi))
                        break
                    if pid in h and h[pid].get("status", {}).get("status_str") == "error":
                        raise RuntimeError("comfy error")
                else:
                    raise RuntimeError("timeout")
            except Exception as e:
                fail += 1
                log("FAIL seed%d 镜头%d err=%s" % (seed, vi, e))
    log("=== pixel END ok=%d fail=%d ===" % (ok, fail))


if __name__ == "__main__":
    main()
