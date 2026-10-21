#!/data/data/com.termux/files/usr/bin/bash
# 峰控助手 Termux 一键安装脚本（手机端运行）
# 用法：把本目录整个拷到手机 /sdcard/bridge，然后 Termux 里执行：
#   bash /sdcard/bridge/termux/install.sh
set -e
echo "== 1. 更新源并安装基础包 =="
pkg update -y && pkg install -y cronie termux-services openssh git python curl jq termux-api ntfy 2>/dev/null || true

echo "== 2. 部署技能脚本 =="
mkdir -p ~/bin ~/scripts
cp -f "$(dirname "$0")"/*.sh ~/scripts/ 2>/dev/null || true
chmod +x ~/scripts/*.sh

echo "== 3. 允许后台运行（防杀） =="
termux-wake-lock 2>/dev/null || echo "请手动: 通知栏 Termux Acquire wakelock"

echo "== 4. 启动 cron 并注册任务 =="
crontab ~/scripts/crontab.txt 2>/dev/null || true
pgrep crond >/dev/null || crond

echo "== 5. 配置 ntfy（自愈通知） =="
# 用公共 ntfy 服务器，主题名即频道名，改成只有你知道的随机串
if ! grep -q NTFY_TOPIC ~/.bashrc 2>/dev/null; then
  echo 'export NTFY_TOPIC="zfengkong-CHANGE-ME"' >> ~/.bashrc
fi

echo "完成！请编辑 ~/.bashrc 里的 NTFY_TOPIC 改成随机串，然后 source ~/.bashrc"
