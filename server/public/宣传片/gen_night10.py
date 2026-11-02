# -*- coding: utf-8 -*-
"""5.7宣传片 夜间10套风格竞赛 · z_image_turbo 1280x720 无头批产
10套风格 × 6镜头 = 60张，串行提交 ComfyUI :8188，结果写日志文件（run_code 下 sleep+print 会静默失败，故只写文件）。
"""
import json, urllib.request, time, os, io

HOST = "http://127.0.0.1:8188"
W, H = 1280, 720
OUT_ROOT = r"D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\output\5.7宣传片_风格竞赛"
LOG = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\server\public\宣传片\night10_log.txt"

NEG = ("低质量, 模糊, 变形的手, 多余的手指, 水印, 文字, logo, 丑陋, 扭曲的面部, "
       "exposed, nsfw, bad anatomy, worst quality")

# 统一女主人设锚点（各套加风格后缀）
GIRL = "一位可爱的中国甜妹女主角，圆脸大眼，空气刘海，棕色长发"
ANCHORS = [
    ("赛博霓虹",
     "赛博朋克霓虹夜景，{g}，黑色科技夹克配发光纹饰，站在霓虹招牌林立的未来街道，"
     "蓝紫粉霓虹光反射在湿润地面，雨夜氛围，高对比赛博美学，电影感构图，杰作；"
     "{v}"),
    ("国风水墨",
     "中国水墨画风格，大量留白，{g}，改良古风长衫，手持平板电脑立于山水画卷之间，"
     "墨色浓淡相宜，飞白笔触，宣纸质感，东方美学，杰作；{v}"),
    ("吉卜力治愈",
     "吉卜力工作室手绘动画风格，水彩质感，{g}，浅蓝连衣裙，在洒满阳光的田园小路上奔跑，"
     "远处绿色山丘与白云，柔和暖色调，治愈系，宫崎骏美学，杰作；{v}"),
    ("像素复古",
     "8bit 像素艺术风格，复古电子游戏画面，{g}，程序员装扮，像素化现代办公室场景，"
     "CRT显示器像素光效，16色复古调色板，像素艺术杰作；{v}"),
    ("美漫线条",
     "美式漫画风格，粗黑描边，高饱和撞色，{g}，动感姿势，半调网点阴影，"
     "漫画分镜式张力构图，动感速度线，波普艺术，杰作；{v}"),
    ("蒸汽波",
     "vaporwave 蒸汽波美学，粉紫渐变天空，网格地平线，{g}，复古80年代运动装，"
     "站在大理石雕像与老式CRT电脑之间，棕榈树剪影，霓虹粉青配色，复古未来主义，杰作；{v}"),
    ("暗黑哥特",
     "暗黑哥特风格，低明度烛光场景，{g}，深色哥特长裙配蕾丝，坐于古堡书房，"
     "烛台与古籍环绕，神秘深邃氛围，伦勃朗式布光，油画质感，杰作；{v}"),
    ("日系轻小说",
     "日系轻小说插画风格，细腻柔光，{g}，JK制服配针织开衫，午后教室窗边，"
     "逆光光斑飘散，唯美细腻笔触，天蓝色调，新海诚式光影，杰作；{v}"),
    ("极简扁平",
     "极简扁平插画风格，无描边几何色块，{g}，简洁商务装，抽象化的智能体协作场景，"
     "莫兰迪配色，大面积留白，现代商务插画，干净利落，杰作；{v}"),
    ("3D皮克斯",
     "3D渲染皮克斯动画风格，圆润Q版造型，{g}，大头身比，玩具质感材质，"
     "温馨的工作室场景，柔和全局光照，subsurface scattering 皮肤质感，超高质量3D渲染，杰作；{v}"),
]

VIEWS = [
    "镜头1 特写：角色面向镜头微笑，眼神发光",
    "镜头2 中景：角色操作悬浮界面，指尖点击光点",
    "镜头3 全景：角色身处场景中心，环境细节丰富",
    "镜头4 侧面：角色回眸，动态构图",
    "镜头5 俯视：角色仰头看向镜头，戏剧性视角",
    "镜头6 远景：剪影与光效，氛围拉满",
]


def log(msg):
    with io.open(LOG, "a", encoding="utf-8") as f:
        f.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), msg))


def api(path, payload=None, timeout=60):
    if payload is None:
        return json.loads(urllib.request.urlopen(HOST + path, timeout=timeout).read())
    req = urllib.request.Request(HOST + path, data=json.dumps(payload).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


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
    log("=== night10 start, total=%d ===" % (len(ANCHORS) * len(VIEWS)))
    ok_cnt, fail_cnt = 0, 0
    seed = 7000
    for name, tpl in ANCHORS:
        for vi, view in enumerate(VIEWS, 1):
            seed += 1
            prompt = tpl.format(g=GIRL, v=view)
            prefix = ("5.7宣传片_风格竞赛/" + name + "/" + name + "_镜头%d" % vi)
            try:
                r = api("/prompt", {"prompt": build_graph(prompt, seed, prefix)})
                pid = r.get("prompt_id")
                # 轮询完成
                for _ in range(60):
                    time.sleep(5)
                    h = api("/history")
                    if pid in h and h[pid].get("status", {}).get("completed"):
                        ok_cnt += 1
                        log("OK %s 镜头%d seed=%d" % (name, vi, seed))
                        break
                    if pid in h and h[pid].get("status", {}).get("status_str") == "error":
                        raise RuntimeError("comfy error")
                else:
                    raise RuntimeError("timeout")
            except Exception as e:
                fail_cnt += 1
                log("FAIL %s 镜头%d seed=%d err=%s" % (name, vi, seed, e))
    log("=== night10 END ok=%d fail=%d ===" % (ok_cnt, fail_cnt))


if __name__ == "__main__":
    main()
