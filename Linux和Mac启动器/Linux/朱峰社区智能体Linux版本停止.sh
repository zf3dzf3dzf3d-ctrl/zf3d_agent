#!/usr/bin/env bash
# 朱峰社区智能体无限 — 停止服务（Linux）
cd "$(dirname "$0")/../.."

# 端口：优先读 private/port.json，默认 8508
PORT=8508
if [ -f "private/port.json" ]; then
    P=$(grep -oE '[0-9]+' private/port.json | head -1)
    [ -n "$P" ] && PORT="$P"
fi

# 优先按端口找进程，其次按命令行匹配
PIDS=$(lsof -t -i:"$PORT" 2>/dev/null || true)
if [ -z "$PIDS" ]; then
    PIDS=$(pgrep -f "server/server.py" 2>/dev/null || true)
fi
if [ -z "$PIDS" ]; then
    echo "[提示] 没有发现正在运行的服务"
    exit 0
fi
kill $PIDS 2>/dev/null
sleep 1
# 仍未退出则强杀
PIDS2=$(lsof -t -i:"$PORT" 2>/dev/null || true)
[ -n "$PIDS2" ] && kill -9 $PIDS2 2>/dev/null
echo "[完成] 服务已停止"
