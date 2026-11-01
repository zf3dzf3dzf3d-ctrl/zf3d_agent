# -*- coding: utf-8 -*-
"""5.7宣传片 像素风80张批产 · 40镜头 × 首帧/尾帧 = 80张
build_graph 与实测 60/60 成功的 gen_night10.py / gen_pixel.py 完全一致，勿乱改节点结构。
首尾帧同 seed 同镜头描述，仅动作阶段不同（开场动作/收尾动作），构图一致利于后续 i2v。
"""
import json, urllib.request, time, io

HOST = "http://127.0.0.1:8188"
W, H = 1280, 720
LOG = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server\public\宣传片\pixel40_log.txt"

NEG = ("低质量, 模糊, 变形的手, 多余的手指, 水印, 文字, logo, 丑陋, 扭曲的面部, "
       "exposed, nsfw, bad anatomy, worst quality")

GIRL = "一位可爱的中国甜妹女主角，圆脸大眼，空气刘海，棕色长发"
STYLE = ("8bit 像素艺术风格，复古电子游戏画面，{g}，程序员装扮，{scene}，"
         "CRT显示器像素光效，16色复古调色板，像素艺术杰作；{v}，{phase}")

# 8 个场景 × 5 种机位 = 40 镜头
SCENES = [
    "像素化现代办公室场景，多台CRT显示器闪烁代码",
    "像素化深夜办公室，窗外城市霓虹夜景",
    "像素化会议室，全息投影像素图表悬浮",
    "像素化服务器机房，指示灯阵列闪烁",
    "像素化天台花园，黄昏天空渐变",
    "像素化咖啡角，咖啡机冒出像素蒸汽",
    "像素化走廊，尽头发光的门",
    "像素化控制中心，巨型屏幕墙显示智能体界面",
]
ANGLES = [
    "特写机位，角色面向镜头，眼神发光",
    "中景机位，角色操作悬浮像素界面，指尖点击光点",
    "全景机位，角色身处场景中心，环境细节丰富",
    "侧面机位，角色回眸，动态构图",
    "俯视机位，角色仰头看向镜头，戏剧性视角",
]
PHASES = [
    ("首帧first", "动作起始瞬间，姿态自然"),
    ("尾帧last", "动作完成瞬间，姿态呼应"),
]
SEED_BASE = 9001  # 镜头i -> seed 9000+i，同镜头首尾帧同seed

PREFIX = "5.7宣传片_像素风80/像素_镜头%02d_%s_seed%d"
LENSES = [(si * 5 + ai + 1, sc, an) for si, sc in enumerate(SCENES)
          for ai, an in enumerate(ANGLES)]  # (镜头号, 场景, 机位)


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
    total = len(LENSES) * 2
    log("=== pixel80 START total=%d ===" % total)
    ok, fail = 0, 0
    for (no, scene, angle) in LENSES:
        seed = SEED_BASE + no
        for pname, ptext in PHASES:
            prompt = STYLE.format(g=GIRL, scene=scene, v=angle, phase=ptext)
            prefix = PREFIX % (no, pname, seed)
            try:
                r = api("/prompt", {"prompt": build_graph(prompt, seed, prefix)})
                pid = r.get("prompt_id")
                for _ in range(60):
                    time.sleep(5)
                    h = api("/history")
                    if pid in h and h[pid].get("status", {}).get("completed"):
                        ok += 1
                        log("OK %d/%d 镜头%02d %s seed%d" % (ok + fail, total, no, pname, seed))
                        break
                    if pid in h and h[pid].get("status", {}).get("status_str") == "error":
                        raise RuntimeError("comfy error")
                else:
                    raise RuntimeError("timeout")
            except Exception as e:
                fail += 1
                log("FAIL 镜头%02d %s seed%d err=%s" % (no, pname, seed, e))
    log("=== pixel80 END ok=%d fail=%d ===" % (ok, fail))


if __name__ == "__main__":
    main()
