#!/data/data/com.termux/files/usr/bin/bash
# 峰控助手 Termux 一键安装脚本（手机端运行）
# 用法：把本目录整个拷到手机 /sdcard/bridge，然后 Termux 里执行：
#   bash /sdcard/bridge/termux/install.sh
set -e
echo "== 1. 更新源并安装基础包 =="
pkg update -y && pkg install -y cronie termux-services openssh git python curl jq termux-api ntfy 2>/dev/null || true

echo "== 2. 部署技能脚本 =="
SRC_DIR="$(dirname "$0")"
# 防复发守卫：被 crontab 引用的核心脚本一旦被误清成 0 字节，无差别 cp 会把空脚本
# 部署到手机，导致定时任务静默跑空（晨报/记忆备份/看门狗失效）。部署前逐一用 [ -s ]
# 校验非空（测字节，非 bash -n——空文件 bash -n 同样返回 0，不可作非空证据），空则中止。
for f in boot_bridge.sh morning_report.sh sync_memory.sh; do
  if [ ! -s "$SRC_DIR/$f" ]; then
    echo "!! 中止：核心脚本 $SRC_DIR/$f 为空或不存在，疑似被误清空。" >&2
    echo "   拒绝部署空脚本（会造成 crontab 定时任务静默失效）。请从 git 恢复后重试：" >&2
    echo "   git checkout <good-commit> -- 手机版/bridge/termux/$f" >&2
    exit 1
  fi
done
mkdir -p ~/bin ~/scripts
cp -f "$SRC_DIR"/*.sh ~/scripts/ 2>/dev/null || true
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

echo "== 6. 安装 termux-boot（开机自启）并注册桥启动脚本 =="
pkg install -y termux-boot >/dev/null 2>&1 || echo "termux-boot 安装失败，可稍后手动 pkg install termux-boot"
# 在 termux 开机触发目录放一个 boot.sh，重启后 Termux 自动跑它拉起桥
BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"
cat > "$BOOT_DIR/zf_bridge.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
bash "$HOME/scripts/boot_bridge.sh"
EOF
chmod +x "$BOOT_DIR/zf_bridge.sh" 2>/dev/null || true
echo "已写入开机自启脚本：$BOOT_DIR/zf_bridge.sh"

echo "== 7. 立即跑一次看门狗（无需等重启，先把桥拉起） =="
bash ~/scripts/boot_bridge.sh || true

echo "完成！"
echo " - 开机自启：重启手机后 Termux 会自动拉起桥（需保持 termux-boot 开机权限，并在系统设置里允许 Termux 自启动/后台运行）。"
echo " - 看门狗：cron 每 5 分钟复查一次心跳，桥死了会被自动重拉（见 crontab.txt）。"
echo " - 可配置：编辑 ~/.env_bridge 设 ZF_BRIDGE_CMD / ZF_BRIDGE_HEARTBEAT / ZF_BRIDGE_STALE（均见 boot_bridge.sh 顶部说明）。"
echo " - 记得编辑 ~/.bashrc 里的 NTFY_TOPIC 改成随机串，然后 source ~/.bashrc"
