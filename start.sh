#!/bin/sh
# 朱峰社区智能体无限 — Linux/macOS 启动脚本
# 用法: ./start.sh  （在项目根目录）
# 说明: 自带 python/python.exe 是 Windows 版，此脚本自动回退系统 python3，
#       并自动创建 venv、安装依赖（仅首次）。
set -e
cd "$(dirname "$0")"

# 1) 选解释器：优先 venv，其次系统 python3
if ! command -v python3 >/dev/null 2>&1; then
    echo "[启动] 未找到 python3，请先安装 Python 3.8+"
    exit 1
fi
PY="python3"

# 2) 首次运行：建 venv 装依赖
if [ ! -d ".venv" ]; then
    echo "[启动] 首次运行：创建虚拟环境并安装依赖（需要联网）..."
    "$PY" -m venv .venv
    ./.venv/bin/python -m pip install --upgrade pip -q
    if [ -f server/requirements.txt ]; then
        ./.venv/bin/python -m pip install -r server/requirements.txt -q
    fi
fi

# 3) 启动服务器（前台）
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8
echo "[启动] 使用解释器: ./.venv/bin/python"
exec ./.venv/bin/python -X utf8 server/server.py
