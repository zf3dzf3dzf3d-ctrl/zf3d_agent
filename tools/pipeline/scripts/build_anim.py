# -*- coding: utf-8 -*-
"""步骤4：生成 idle / walk / jump 三套动画关键帧 -> animation.json。

idle  : 呼吸 + 手臂微摆 + 眨眼
walk  : 双腿交替摆动 + 手臂反向摆 + hips 上下起伏
jump  : 下蹲蓄力 -> 蹬伸腾空 -> 滞空收腿 -> 落地缓冲（非循环单次播放）
"""
import sys, os, json, math

FPS = 30

def keys(times, values, prop, bone):
    return {"bone": bone, "property": prop,
            "keyframes": [{"t": round(t, 4), "v": v} for t, v in zip(times, values)]}

def sine_track(times, dur, cycles, amp, prop, bone, phase=0.0):
    vals = [round(amp * math.sin(2 * math.pi * cycles * t / dur + phase), 3) for t in times]
    return keys(times, vals, prop, bone)

def build_idle(skel):
    DUR = 3.0
    n = int(DUR * FPS)
    times = [i / FPS for i in range(n + 1)]
    names = {s["name"] for s in skel["slots"]}
    tracks = []
    if "torso" in names:
        tracks.append(sine_track(times, DUR, 2, 0.03, "scaleY", "torso"))
        tracks.append(sine_track(times, DUR, 2, 0.01, "scaleX", "torso"))
    for side, sign in [("arm_l", 1), ("arm_r", -1)]:
        if side in names:
            tracks.append(sine_track(times, DUR, 1, 3, "rotate", side, 0 if sign > 0 else math.pi))
    tracks.append(sine_track(times, DUR, 1, 2, "y", "hips"))
    if "head" in names:
        blink = []
        for t in times:
            phase = t % 1.5
            v = 0.7 if 1.30 < phase < 1.36 or 1.42 < phase < 1.48 else 1.0
            blink.append(v)
        tracks.append(keys(times, blink, "scaleY", "head"))
    return {"name": "idle", "fps": FPS, "duration": DUR, "loop": True, "tracks": tracks}

def build_walk(skel):
    """步态周期 0.8s：腿前后摆 ±28°，膝感用 scaleY 微缩，臂反向摆 ±20°，hips 上下弹 2 次/周期。"""
    DUR = 0.8
    n = int(DUR * FPS)
    times = [i / FPS for i in range(n + 1)]
    names = {s["name"] for s in skel["slots"]}
    tracks = []
    # 双腿：反相摆动
    if "leg_l" in names:
        tracks.append(sine_track(times, DUR, 1, 28, "rotate", "leg_l", 0))
        tracks.append(sine_track(times, DUR, 2, 0.04, "scaleY", "leg_l"))
    if "leg_r" in names:
        tracks.append(sine_track(times, DUR, 1, 28, "rotate", "leg_r", math.pi))
        tracks.append(sine_track(times, DUR, 2, 0.04, "scaleY", "leg_r", math.pi))
    # 双臂：与同侧腿反相
    if "arm_l" in names:
        tracks.append(sine_track(times, DUR, 1, 20, "rotate", "arm_l", math.pi))
    if "arm_r" in names:
        tracks.append(sine_track(times, DUR, 1, 20, "rotate", "arm_r", 0))
    # 躯干轻微前倾 + hips 每周期弹跳 2 次（左右脚各一次触地）
    if "torso" in names:
        tracks.append(keys(times, [4.0] * len(times), "rotate", "torso"))
    tracks.append(sine_track(times, DUR, 2, 3, "y", "hips", math.pi / 2))
    return {"name": "walk", "fps": FPS, "duration": DUR, "loop": True, "tracks": tracks}

def build_jump(skel):
    """单次 1.1s：0-0.15 下蹲(腿弯/躯干压低) 0.15-0.3 蹬伸 0.3-0.85 滞空收腿 0.85-1.1 落地缓冲。"""
    DUR = 1.1
    marks = [0.0, 0.15, 0.30, 0.55, 0.85, 1.10]
    names = {s["name"] for s in skel["slots"]}
    tracks = []

    def multi(prop, bone, vals, base=0.0):
        """分段关键帧，marks 与 vals 一一对应，线性插值。"""
        tracks.append({"bone": bone, "property": prop,
                       "keyframes": [{"t": t, "v": base + v} for t, v in zip(marks, vals)]})

    # hips：下蹲下移 -> 蹬伸上移(腾空) -> 滞空 -> 落地回位
    multi("y", "hips", [14, -10, -46, -40, -6, 0])
    # 双腿：下蹲后摆 -> 蹬伸直腿 -> 滞空收腿(前后分开) -> 落地站直
    multi("rotate", "leg_l", [32, -18, -26, -20, 8, 0])
    multi("rotate", "leg_r", [-32, 18, 22, 26, -8, 0])
    multi("scaleY", "leg_l", [-0.12, 0.06, 0.04, 0.02, -0.04, 0], base=1.0)
    multi("scaleY", "leg_r", [-0.12, 0.06, 0.04, 0.02, -0.04, 0], base=1.0)
    # 双臂：下蹲后甩 -> 蹬伸上摆 -> 滞空保持 -> 落地回落
    multi("rotate", "arm_l", [26, -40, -70, -60, 15, 0])
    multi("rotate", "arm_r", [-26, 40, 70, 60, -15, 0])
    # 躯干：下蹲前倾压 -> 蹬伸挺直 -> 滞空微后仰 -> 落地回正
    multi("rotate", "torso", [12, -6, -4, -8, 4, 0])
    multi("scaleY", "torso", [-0.08, 0.08, 0.05, 0.03, -0.05, 0], base=1.0)
    # 头：滞空微抬
    if "head" in names:
        multi("rotate", "head", [6, -4, -8, -8, 2, 0])

    return {"name": "jump", "fps": FPS, "duration": DUR, "loop": False, "tracks": tracks}

def build_anim(skel_path, out):
    skel = json.load(open(skel_path, encoding="utf-8"))
    anims = [build_idle(skel), build_walk(skel), build_jump(skel)]
    json.dump(anims, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print("animations ->", out, [a["name"] for a in anims])

if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    skel = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, "output", "skeleton.json")
    out = os.path.join(root, "output", "animation.json")
    build_anim(skel, out)
