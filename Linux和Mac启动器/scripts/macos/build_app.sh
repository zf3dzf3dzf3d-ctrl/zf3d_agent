#!/usr/bin/env bash
# 朱峰社区智能体无限 — macOS 打包脚本（产出 朱峰社区智能体无限.app）
# 依赖: pip3 install pyinstaller
set -e
cd "$(dirname "$0")/../.."

PY=${PY:-python3}
"$PY" -m PyInstaller --noconfirm \
  --name "朱峰社区智能体无限" \
  --windowed \
  --osx-bundle-identifier "com.zfcommunity.agent" \
  --add-data "server/public:public" \
  --add-data "server/config.py:." \
  --hidden-import platform_compat \
  --collect-submodules server \
  server/server.py

echo ""
echo "✅ 打包完成: dist/朱峰社区智能体无限.app"
echo "提示:"
echo "  1. 首次运行需在 系统设置→隐私与安全性 允许"
echo "  2. 全局热键/鼠标控制需在 辅助功能 中勾选本 App"
echo "  3. 录屏/截屏需授权 屏幕录制，麦克风需授权 麦克风"
