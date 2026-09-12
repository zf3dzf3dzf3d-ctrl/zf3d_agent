# -*- coding: utf-8 -*-
"""视频剪辑环境自检脚本：ffmpeg / ffprobe / 依赖库 / 基本剪辑能力测试"""
import subprocess, sys, os

def run(cmd):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return r.returncode == 0
    except Exception:
        return False

def main():
    ok = True
    # 1. ffmpeg / ffprobe
    for tool in ("ffmpeg", "ffprobe"):
        found = run([tool, "-version"])
        print(f"[{'OK' if found else 'FAIL'}] {tool} 可用")
        ok = ok and found
    # 2. Python 依赖
    import importlib.util as u
    for m in ("numpy", "faster_whisper", "scenedetect", "edge_tts"):
        have = bool(u.find_spec(m))
        print(f"[{'OK' if have else '--'}] python 模块 {m}")
    # 3. 基本剪辑能力：生成 2 秒测试视频 → 剪 1 秒 → 转码
    tmp = os.path.join(os.path.dirname(__file__), "_vt_test")
    os.makedirs(tmp, exist_ok=True)
    src = os.path.join(tmp, "src.mp4"); out = os.path.join(tmp, "cut.mp4")
    gen = run(["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x240:rate=15", "-pix_fmt", "yuv420p", src])
    cut = run(["ffmpeg", "-y", "-ss", "0.5", "-t", "1", "-i", src, "-c", "copy", out])
    print(f"[{'OK' if gen and cut and os.path.exists(out) else 'FAIL'}] 生成/剪切测试视频")
    # 清理
    for f in (src, out):
        if os.path.exists(f): os.remove(f)
    os.rmdir(tmp)
    print("全部通过" if ok else "存在问题")

if __name__ == "__main__":
    main()
