#!/usr/bin/env bash
# 朱峰社区智能体无限 - 重启服务（Linux）
cd "$(dirname "$0")"
bash "朱峰社区智能体Linux版本停止.sh"
sleep 1
bash start.sh
