#!/usr/bin/env bash
# 朱峰社区智能体无限 — 首次使用初始化（给所有 .command 加执行权限）
# Mac 从网上下载的脚本默认没有执行权限，双击会提示"无法执行"。
# 双击本文件一次即可自动修复（本文件自身由终端允许一次后可执行）。

DIR="$(cd "$(dirname "$0")" && pwd)"
chmod +x "$DIR"/*.command 2>/dev/null
chmod +x "$DIR/../scripts/macos/"*.sh 2>/dev/null
echo "✅ 初始化完成！"
echo "现在可以双击「双击启动.command」启动了。"
echo ""
read -n 1 -s -r -p "按任意键关闭窗口..."
