#!/usr/bin/env bash
# 朱峰社区智能体无限 — 后台启动（双击后窗口可关闭，服务在后台运行）
cd "$(dirname "$0")"
bash ../scripts/macos/start.sh --daemon
echo ""
echo "服务已在后台运行，浏览器访问 http://127.0.0.1:5000"
echo "如需停止，请双击「双击停止.command」"
