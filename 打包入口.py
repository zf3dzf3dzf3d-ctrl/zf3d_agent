"""
打包入口 — PyInstaller专用入口
处理 frozen 模式下资源目录(sys._MEIPASS)与工作目录(exe同级)的分离
"""
import sys
import os
import shutil
import json
from pathlib import Path


def 获取资源目录():
    """打包后资源在sys._MEIPASS，开发时在脚本目录"""
    if getattr(sys, 'frozen', False):
        return Path(sys._MEIPASS)
    return Path(__file__).parent


def 获取工作目录():
    """exe运行时的工作目录（放配置/隐私区的地方）"""
    if getattr(sys, 'frozen', False):
        return Path(sys.executable).parent
    return Path(__file__).parent


def 首次运行初始化(资源目录, 工作目录):
    """首次运行：从exe内部释放公共区配置和隐私区模板"""
    # 1. 释放公共区配置（如果工作目录没有）
    目标公共区 = 工作目录 / "公共区"
    资源公共区 = 资源目录 / "公共区"
    if not 目标公共区.exists() and 资源公共区.exists():
        shutil.copytree(资源公共区, 目标公共区)

    # 2. 创建隐私区目录结构（空模板）
    隐私区 = 工作目录 / "隐私区"
    if not 隐私区.exists():
        子目录 = ["我的配置", "我的记忆", "我的日志", "我的数据", "对话记录"]
        for d in 子目录:
            (隐私区 / d).mkdir(parents=True, exist_ok=True)

    # 3. 创建引擎管理目录
    引擎管理 = 工作目录 / "引擎管理"
    if not 引擎管理.exists():
        引擎管理.mkdir(parents=True, exist_ok=True)

    # 4. 释放 public/core/main.py（ASCII入口兼容）
    目标public = 工作目录 / "public" / "core"
    if not 目标public.exists():
        资源public = 资源目录 / "public" / "core"
        if 资源public.exists():
            shutil.copytree(资源public, 目标public)


if __name__ == "__main__":
    # Windows控制台UTF-8
    if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')

    资源目录 = 获取资源目录()
    工作目录 = 获取工作目录()

    # 首次运行初始化
    首次运行初始化(资源目录, 工作目录)

    # 将中文内核目录加入搜索路径（优先用工作目录的，其次用exe内部的）
    工作内核 = 工作目录 / "公共区" / "内核"
    资源内核 = 资源目录 / "公共区" / "内核"
    if 工作内核.exists():
        sys.path.insert(0, str(工作内核))
    if 资源内核.exists():
        sys.path.insert(0, str(资源内核))

    # 启动
    try:
        from 启动器 import 启动器类
        启动器 = 启动器类()
        启动器.项目根目录 = 工作目录
        启动器.启动()
    except KeyboardInterrupt:
        print("\n系统已停止。")
    except Exception as e:
        print(f"\n启动失败: {e}")
        import traceback
        traceback.print_exc()
        # 有控制台时等待用户确认，无控制台时直接退出
        try:
            input("按回车键退出...")
        except (EOFError, RuntimeError):
            pass
