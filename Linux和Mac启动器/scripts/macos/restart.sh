#!/usr/bin/env bash
# 朱峰社区智能体无限 — macOS 重启脚本
set -e
cd "$(dirname "$0")/../../"
echo "⏹ 停止旧进程..."
pkill -f "python3? .*server/server.py" 2>/dev/null || true
sleep 1
echo "🔄 重启..."
./scripts/macos/start.sh --daemon
