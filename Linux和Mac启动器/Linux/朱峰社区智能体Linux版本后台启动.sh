#!/usr/bin/env bash
# 朱峰社区智能体无限 — Linux 后台启动（关闭窗口后服务继续运行）
cd "$(dirname "$0")"
bash start.sh --daemon
echo ""
echo "服务已在后台运行，默认浏览器访问 http://127.0.0.1:8508（如 private/port.json 配置了其他端口，以配置为准）"
echo "如需停止，请运行「朱峰社区智能体Linux版本停止.sh」"
