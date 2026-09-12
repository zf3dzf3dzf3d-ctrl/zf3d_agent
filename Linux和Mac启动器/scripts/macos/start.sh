#!/usr/bin/env bash
# 朱峰社区智能体无限 — macOS 启动脚本
# 用法: ./start.sh [后台模式: --daemon]
set -e
cd "$(dirname "$0")/../.."

# ---------- 找 Python ----------
PY=""
for cand in python3 python3.12 python3.11 python3.10; do
  if command -v "$cand" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  echo "❌ 未找到 python3，请先安装: brew install python3 或从 python.org 下载"
  exit 1
fi
echo "✅ Python: $($PY --version)  路径: $(command -v $PY)"

# ---------- 依赖检查 ----------
if ! "$PY" -c "import flask" >/dev/null 2>&1; then
  echo "📦 首次运行，安装依赖..."
  "$PY" -m pip install --upgrade pip || "$PY" -m pip install --upgrade pip --break-system-packages
  # Homebrew Python (PEP 668) 需要 --break-system-packages
  "$PY" -m pip install -r server/requirements-mac.txt || \
    "$PY" -m pip install -r server/requirements-mac.txt --break-system-packages
  "$PY" -m pip install pyobjc-framework-Quartz || \
    "$PY" -m pip install pyobjc-framework-Quartz --break-system-packages || \
    echo "⚠️ pyobjc 安装失败(仅影响全局热键，不影响主功能)"
fi

# ---------- 启动 ----------
export PYTHONPATH="$(pwd)/server"
export OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES   # mac 上避免某些库 fork 崩溃
if [ "$1" = "--daemon" ]; then
  nohup "$PY" server/server.py > server.log 2>&1 &
  echo "✅ 已后台启动，日志: server.log  (PID $!)"
else
  echo "🚀 启动服务... (Ctrl+C 停止)"
  exec "$PY" server/server.py
fi
