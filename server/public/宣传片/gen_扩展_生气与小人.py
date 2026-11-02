# -*- coding: utf-8 -*-
"""5.7宣传片补充镜头批产：生气拍电脑动作组 + 智能体团队小人组，每镜头4版本，1280x720"""
import json, urllib.request, time, sys, os

HOST = "http://127.0.0.1:8188"
W, H = 1280, 720
OUT_DIR = r"D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\output\5.7宣传片_甜妹扩展"
os.makedirs(OUT_DIR, exist_ok=True)

NEG = ("低质量, 模糊, 变形的手, 多余的手指, 水印, 文字, logo, 丑陋, 扭曲的面部, "
       "nsfw, bad anatomy, worst quality")

SWEET = "一位可爱的中国甜妹女主角，圆脸大眼，空气刘海，棕色长发"

ANGER_SHOTS = [
    ("A1_猛拍键盘", "{s}扎马尾，米色毛衣，怒气冲冲猛拍机械键盘，双手砸向键盘，键帽飞起，"
     "怒目圆睁咬牙切齿，脸颊气鼓鼓，屏幕红色报错冷蓝光，深夜办公室，动感瞬间，写实电影感，8k，杰作"),
    ("A2_拍显示器", "{s}扎马尾，米色毛衣，生气地用手掌拍打显示器顶部，身体前倾，眉毛拧成一团，"
     "嘟嘴瞪眼，显示器震动特效，冷色调办公室，戏剧性瞬间，写实电影感，8k，杰作"),
    ("A3_摔鼠标", "{s}披肩发，米色毛衣，气得把鼠标摔在桌面上，双手叉腰，鼓着腮帮子，眼睛里全是怒火，"
     "鼠标线甩动，深夜冷蓝光，卡通化的真实感，写实电影感，8k，杰作"),
    ("A4_捂脸崩溃", "{s}扎双马尾，米色毛衣，双手捂脸半张，从指缝里瞪着屏幕，崩溃绝望的表情，"
     "屏幕幽蓝光照脸，桌上散乱文件，深夜办公室，情绪张力，写实电影感，8k，杰作"),
    ("A5_叉腰瞪屏", "{s}披肩发，米色毛衣，双手叉腰站在显示器前，身体前倾瞪屏幕，撅嘴生闷气，"
     "眉毛倒竖，屏幕显示红色警告，冷光侧脸，戏剧光影，写实电影感，8k，杰作"),
    ("A6_合盖抗议", "{s}扎马尾，米色毛衣，生气地一把合上笔记本电脑，身体后仰，气鼓鼓地哼着别过头，"
     "马尾甩动，俏皮又愤怒，室内暖光与冷光对比，写实电影感，8k，杰作"),
    ("A7_揉太阳穴", "{s}披肩发，米色毛衣，一手揉着太阳穴一手撑桌，眉头紧锁咬下唇，又气又累的表情，"
     "多屏蓝光映照，深夜加班氛围，写实电影感，8k，杰作"),
]

AGENT_SHOTS = [
    ("B1_小人列队", "俯视视角的宽大深蓝色科技桌面，{n}个可爱的迷你卡通小人智能体排成整齐的队列，"
     "每个小人头顶有发光的对话框气泡，气泡里是代码和任务清单图标，{s}俯身微笑看着他们，"
     "青蓝色全息光效，温暖主光，科幻可爱风格，写实电影感，8k，杰作"),
    ("B2_小人修bug", "{s}惊讶地看着屏幕上的一群迷你卡通小人智能体，他们正抬着一颗巨大的红色bug图标零件搬走，"
     "有的举着扳手，有的推着小车，分工合作，可爱忙碌，青蓝科技光效，深蓝科技背景，"
     "科幻可爱风格，写实电影感，8k，杰作"),
    ("B3_小人开会议", "全息投影平台上，{n}个不同颜色的迷你卡通小人围成一圈开圆桌会议，头顶悬浮发光的全息图表，"
     "中央升起一个发光的任务节点树，{s}站在一旁托腮好奇围观，青蓝色光效，"
     "科幻可爱风格，写实电影感，8k，杰作"),
    ("B4_小人接力", "发光的数字化流水线上，{n}个迷你卡通小人排成接力队形，传递一个发光的任务包裹，"
     "每个小人脚下有流动的光带，动感动势，{s}在画面边缘开心鼓掌，深蓝科技背景，"
     "青蓝色光轨，科幻可爱风格，写实电影感，8k，杰作"),
    ("B5_小人庆功", "{n}个迷你卡通小人围着堆成小山的任务清单图标欢呼庆祝，有的抛帽有的跳跃，"
     "彩色纸屑纷飞，{s}笑着弯腰与他们击掌，暖色主光配科技青蓝点缀，"
     "科幻可爱风格，写实电影感，8k，杰作"),
    ("B6_小人指挥台", "{s}自信地站在发光的全息指挥台前，台面上{n}个迷你卡通小人各守一个光柱站点，"
     "头顶有进度环在转动，多条光线汇向中央大脑图标，深蓝科技大厅，青蓝色光效，"
     "科幻可爱风格，写实电影感，8k，杰作"),
]

# 每镜头4个版本 = 4个不同seed
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
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": "TITLE"}},
    }

jobs = []
seed_base = 2000
i = 0
for name, tpl in ANGER_SHOTS:
    for v in range(4):
        text = tpl.format(s=SWEET)
        p = build_prompt(text, seed_base + i)
        p["9"]["inputs"]["filename_prefix"] = name + f"_v{v+1}"
        jobs.append((f"{name}_v{v+1}", p))
        i += 1
for name, tpl in AGENT_SHOTS:
    for v in range(4):
        text = tpl.format(s=SWEET, n=["六","七","八","五"][v % 4])
        p = build_prompt(text, seed_base + i)
        p["9"]["inputs"]["filename_prefix"] = name + f"_v{v+1}"
        jobs.append((f"{name}_v{v+1}", p))
        i += 1

# 串行提交+轮询
r = urllib.request.urlopen(urllib.request.Request(f"{HOST}/queue", data=b"", method="GET"))
time.sleep(0.5)
pids = []
for name, p in jobs:
    body = json.dumps({"prompt": p}).encode("utf-8")
    req = urllib.request.Request(f"{HOST}/prompt", data=body, headers={"Content-Type": "application/json"})
    resp = json.loads(urllib.request.urlopen(req, timeout=30).read())
    pids.append((name, resp.get("prompt_id")))

done = {}
t0 = time.time()
while len(done) < len(pids) and time.time() - t0 < 1500:
    try:
        h = json.loads(urllib.request.urlopen(f"{HOST}/history", timeout=15).read())
        for name, pid in pids:
            if pid in h and pid not in done:
                outs = h[pid].get("outputs", {})
                imgs = [im["filename"] for node in outs.values() for im in node.get("images", [])]
                done[pid] = (name, imgs)
    except Exception:
        pass
    time.sleep(4)

with open(os.path.join(OUT_DIR, "_result.txt"), "w", encoding="utf-8") as f:
    f.write(f"TOTAL {len(pids)} DONE {len(done)}\n")
    for _, (name, imgs) in sorted(done.items()):
        f.write(f"{name}: {imgs}\n")
print("RESULT", len(done), "/", len(pids))
