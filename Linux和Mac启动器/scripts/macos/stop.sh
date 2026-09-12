#!/usr/bin/env bash
# 朱峰社区智能体无限 — macOS 停止服务
cd "$(dirname "$0")/../.."

PIDFILE="server/server.pid"
if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && echo "✅ 已停止服务 (PID $PID)"
    exit 0
  fi
  rm -f "$PIDFILE"
fi

# 兜底：按端口/命令名查找
pkill -f "server/server.py" 2>/dev/null && echo "✅ 已停止服务" || echo "⚠️ 未发现运行中的服务"
