# -*- coding: utf-8 -*-
# 拆分分段模块：由原 screen_recorder.py 按行段【无改动】切分，由同名门面加载合并。
"""
录屏器 — 使用 ffmpeg gdigrab 抓取屏幕 + dshow/soundcard 抓取音频
输出 MP4 (H.264 + AAC)
停止录制分两步：1.立即杀ffmpeg返回 2.后台线程转码
全流程写入JSONL录屏日志文件，便于排查问题
"""
import os
import json
import time
import threading
import subprocess
import sys
from pathlib import Path
from datetime import datetime

import shutil as _shutil
_ffmpeg = _shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"

# ==================== JSONL 日志（独立实现，不依赖旧项目存储引擎） ====================
_日志路径 = Path(__file__).parent / "录屏诊断.jsonl"
_会话ID = ""

def _写日志(步骤, 状态, 详情="", ffmpeg输出=""):
    """写一条录屏日志到 JSONL 文件"""
    if not _会话ID:
        _启动新会话()
    记录 = {
        "时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "会话ID": _会话ID,
        "步骤": 步骤, "状态": 状态,
        "详情": str(详情)[:500], "ffmpeg输出": str(ffmpeg输出)[-1500:],
    }
    try:
        _日志路径.parent.mkdir(parents=True, exist_ok=True)
        with open(_日志路径, "a", encoding="utf-8") as f:
            f.write(json.dumps(记录, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[录屏日志] {步骤} | {状态} | {详情} | {e}")

def _启动新会话():
    """开始新的录屏会话，生成会话ID"""
    global _会话ID
    _会话ID = datetime.now().strftime("%Y%m%d_%H%M%S_") + str(int(time.time() * 1000) % 100000)

_录屏状态 = {
    "录制中": False,
    "正在停止": False,
    "开始时间": 0,
    "保存目录": "",
    "输出路径": "",
    "最终路径": "",
    "帧率": 30,
    "音频模式": "mic",
    "麦克风音量": 1.0,
    "麦克风静音": False,
    "系统音量": 1.0,
    "系统静音": False,
    "进程": None,
    "stderr数据": b"",
    "系统音频wav": "",
    "系统音频线程": None,
    "系统音频recorder": None,
    "区域": None,
    "点击效果进程": None,
    # 转码状态
    "转码中": False,
    "转码完成": False,
    "转码结果": None,
}

_锁 = threading.Lock()


from screen_recorder_transcode import 录屏转码Mixin


