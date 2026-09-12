#!/usr/bin/env bash
# 朱峰社区智能体无限 - Linux 启动脚本
# 用法: cd 项目根目录 && bash Linux/start.sh
# 需求: Python 3.11+（which python3 检查）
set -e
cd "$(dirname "$0")/../.."   # 切到项目根目录（脚本在 启动脚本/Linux/ 下，需上两级）

PY=""
for c in python3.11 python3 python; do
    if command -v "$c" >/dev/null 2>&1; then
        v=$("$c" -c 'import sys;print(sys.version_info[0]*10+sys.version_info[1])' 2>/dev/null || echo 0)
        if [ "$v" -ge 31 ]; then PY="$c"; break; fi
    fi
done
if [ -z "$PY" ]; then
    echo "[错误] 未找到 Python 3.11+，请先安装: sudo apt install python3 (或访问 https://www.python.org)" >&2
    exit 1
fi
echo "[启动] 使用 $PY ($($PY -V 2>&1))"
echo "[提示] 桌面增强（全局热键/滚轮弹窗）为 Windows 专属，Linux 下自动跳过"

# ---------- 依赖检查 ----------
if ! "$PY" -c "import flask" >/dev/null 2>&1; then
    echo "[依赖] 首次运行，安装依赖..."
    "$PY" -m pip install -r server/requirements-mac.txt \
        || "$PY" -m pip install -r server/requirements-mac.txt --break-system-packages \
        || { echo "[错误] 依赖安装失败，请手动执行: $PY -m pip install -r server/requirements-mac.txt" >&2; exit 1; }
fi

export PYTHONPATH="$(pwd)/server"
exec "$PY" server/server.py
