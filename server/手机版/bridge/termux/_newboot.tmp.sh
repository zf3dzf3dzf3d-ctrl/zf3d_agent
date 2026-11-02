#!/data/data/com.termux/files/usr/bin/bash
# 峰控桥 · 开机自启 + 看门狗自愈 + 掉线报警（手机端 Termux 运行）
#
# 解决痛点：你反复遇到的「Termux 桥每次开机都得手动拉起、不会自启、死了没人管，
# 甚至停摆十几天无人察觉」。本脚本把「被动等死」变成「主动探活 + 自愈 + 报警」。
# 同一个脚本可被两种方式调用，逻辑一致：
#   1) 开机自启：termux-boot 放一个 boot.sh 调本脚本（见 install.sh 第 6 步）
#   2) 看门狗：crontab 每 N 分钟调一次，桥一死很快被救活并推送报警（见 crontab.txt）
#
# 可配置项（写进 ~/.env_bridge 或 export 后即可，都有合理默认）：
#   ZF_BRIDGE_CMD        启动桥的命令。默认调用 v4 一键启动脚本。
#   ZF_BRIDGE_HEARTBEAT  桥心跳文件路径（桥启动后应持续 touch 它）。
#   ZF_BRIDGE_STALE      心跳超过多少秒视为桥已死。默认 180。
#   ZF_BRIDGE_PROCPAT    进程存活匹配的关键词（辅助判断，可选，避免误拉）。
#   NTFY_TOPIC           ntfy 通知频道名（务必改成只有自己知道的随机串）。
#   NTFY_URL             ntfy 服务地址，默认 https://ntfy.sh。
#   ZF_ALERT_COOLDOWN    重复报警冷却秒数，默认 3600（1 小时内只报警一次，防刷屏）。
#   ZF_ALERT_DISABLE     置 1 则只自愈不推送报警。
#
# 手动测试：
#   bash ~/scripts/boot_bridge.sh            # 正常巡检（判死则报警+拉起）
#   ZF_ALERT_DISABLE=1 bash ~/scripts/boot_bridge.sh --status  # 只看状态不报警不拉起
#
# 说明：本脚本不依赖桥的内部实现，只要桥会写「心跳文件」即可被看护；
#       心跳文件名统一为 heartbeat.txt（与 start_bridge_v4 约定一致），勿与
#       其它看门狗脚本混用不同文件名，否则会把活桥误判成死桥反复重拉。

set -u

# 加载用户配置（若存在）
[ -f "$HOME/.env_bridge" ] && . "$HOME/.env_bridge"

# ---- 默认值（可被 ~/.env_bridge 覆盖）----
BRIDGE_HOME="${ZF_BRIDGE_HOME:-/sdcard/Download/朱峰智能体/termux_bridge}"
BRIDGE_CMD="${ZF_BRIDGE_CMD:-bash ${BRIDGE_HOME}/start_bridge_v4.sh}"
HEARTBEAT="${ZF_BRIDGE_HEARTBEAT:-${BRIDGE_HOME}/heartbeat.txt}"
STALE="${ZF_BRIDGE_STALE:-180}"
PROCPAT="${ZF_BRIDGE_PROCPAT:-}"   # 留空则不启用进程名判断
LOG="${BRIDGE_HOME}/watchdog.log"

# 报警配置
NTFY_TOPIC="${NTFY_TOPIC:-zfengkong-CHANGE-ME}"
NTFY_URL="${NTFY_URL:-https://ntfy.sh}"
ALERT_COOLDOWN="${ZF_ALERT_COOLDOWN:-3600}"
ALERT_DISABLE="${ZF_ALERT_DISABLE:-0}"
LAST_ALERT_FILE="${BRIDGE_HOME}/.watchdog_last_alert"

MODE="run"
[ "${1:-}" = "--status" ] && MODE="status"

mkdir -p "$BRIDGE_HOME" 2>/dev/null || true
ts() { date '+%Y-%m-%d %H:%M:%S'; }
say() { echo "[$(ts)] $1" | tee -a "$LOG" 2>/dev/null || echo "$1"; }

# 报警推送（ntfy）：status 模式或已禁用时不发；带冷却防刷屏
notify() {  # notify "标题" "正文" "tag"
  [ "$MODE" = "status" ] && return 0
  [ "$ALERT_DISABLE" = "1" ] && return 0
  [ "$NTFY_TOPIC" = "zfengkong-CHANGE-ME" ] && { say "未配置 NTFY_TOPIC，跳过报警推送。"; return 0; }
  now=$(date +%s)
  last=0
  [ -f "$LAST_ALERT_FILE" ] && last=$(cat "$LAST_ALERT_FILE" 2>/dev/null || echo 0)
  if [ $(( now - last )) -lt "$ALERT_COOLDOWN" ]; then
    say "报警冷却中（距上次 $(( now - last ))s < ${ALERT_COOLDOWN}s），本次不重复推送。"
    return 0
  fi
  printf '%s' "$2" | curl -s -H "Title: $1" -H "Tags: $3" "$NTFY_URL/$NTFY_TOPIC" >/dev/null 2>&1 \
    && say "已推送 ntfy 报警：$1" || say "ntfy 报警推送失败（检查网络/NTFY_URL）。"
  echo "$now" > "$LAST_ALERT_FILE" 2>/dev/null || true
}

# 0. 确保后台运行权（防止 Android 杀进程）
termux-wake-lock 2>/dev/null || true

# 1. 判断桥是否「活着」：优先看心跳新鲜度，其次看进程名
alive=0
hb_age="missing"
if [ -f "$HEARTBEAT" ]; then
  # 用文件 mtime 与当前时间差判断（跨 stat 实现，兼容 toybox/coreutils）
  hb_mtime=$(date -r "$HEARTBEAT" +%s 2>/dev/null || stat -c %Y "$HEARTBEAT" 2>/dev/null || echo 0)
  now=$(date +%s)
  hb_age=$(( now - hb_mtime ))
  if [ "$hb_mtime" -gt 0 ] && [ "$hb_age" -le "$STALE" ]; then
    alive=1
    say "心跳正常（${hb_age}s 前，阈值 ${STALE}s），桥在线。"
  else
    say "心跳超时（${hb_age}s 前，阈值 ${STALE}s）→ 判定桥已死。"
  fi
else
  say "未找到心跳文件 $HEARTBEAT，改用进程判断。"
fi

# 进程名兜底判断（仅当配了 PROCPAT 且上面判为死时才再确认一次，避免误拉）
if [ "$alive" -eq 0 ] && [ -n "$PROCPAT" ]; then
  if pgrep -f "$PROCPAT" >/dev/null 2>&1; then
    alive=1
    say "进程匹配 '$PROCPAT' 仍存在，暂不重复拉起（可能桥还没开始写心跳）。"
  fi
fi

# 2. 不活 → 报警 + 拉起桥（后台 nohup，绕开看门狗自身退出）
if [ "$alive" -eq 0 ]; then
  notify "⚠️ 峰控桥已掉线" "心跳龄 ${hb_age}s（阈值 ${STALE}s），尝试自动拉起。" "warning"
  say "执行拉起：$BRIDGE_CMD"
  nohup sh -c "$BRIDGE_CMD" >> "${BRIDGE_HOME}/bridge.out" 2>&1 &
  disown 2>/dev/null || true
  say "已投递拉起命令（PID $!），稍后看门狗下轮会复查心跳。"
  notify "🔄 峰控桥已尝试重启" "已执行拉起命令，稍后再巡检确认是否恢复。" "arrows_counterclockwise"
fi

exit 0
