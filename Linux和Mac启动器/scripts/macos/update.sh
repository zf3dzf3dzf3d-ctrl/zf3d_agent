#!/usr/bin/env bash
# 朱峰社区智能体无限 — macOS 在线升级脚本（拉取最新代码并重启）
set -e
cd "$(dirname "$0")/../.."
if [ -d .git ]; then
  echo "⬇️ 拉取最新代码..."
  git pull --ff-only || echo "⚠️ git pull 失败，使用当前版本"
else
  echo "⚠️ 非 git 目录，请手动下载新版覆盖"
fi
./scripts/macos/restart.sh
