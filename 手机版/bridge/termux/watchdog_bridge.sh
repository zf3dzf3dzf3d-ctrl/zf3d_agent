#!/data/data/com.termux/files/usr/bin/bash
# 峰控桥看门狗：定时检查 Termux 桥是否「假死/掉线」，死亡则 ntfy 报警 + 自动尝试拉起。
# 设计初衷：历史上桥进程一死就静默好几天（如停摆 11 天无人察觉），本脚本把「被动等死」
#            变成「主动探活 + 自愈 + 报警」，让手机峰控通道随时可知可用。
# 安装：随 install.sh 一起 cp 到 ~/scripts；crontab.txt 已注册每 10 分钟跑一次。
# 手动测试：bash ~/scripts/watchdog_bridge.sh            # 正常巡检
#          bash ~/scripts/watchdog_bridge.sh --status    # 只看状态不报警不拉起
#          bash ~/scripts/watchdog_bridge.sh --force     # 强制报警+拉起（调试用）
set -u

# ── 可配置项（路径约定若与实机不同，改这几行即可）───────────────────
# 桥工作目录：粘贴记录中实际使用的路径（start_bridge_v4.sh 所在处）
BRIDGE_DIR="${BRIDGE_DIR:-/sdcard/Download/朱峰智能体/termux_bridge}"
# 心跳文件：桥每次循环 touch 它；mtime 超过 STALE_SEC 即判为掉线
HB_FILE="${HB_FILE:-$BRIDGE_DIR/heartbeat}"
# 心跳判定阈值（秒），默认 30 分钟无更新即认为桥已停摆
STALE_SEC="${STALE_SEC:-1800}"
# 重复报警冷却（秒），防止每 10 分钟刷屏；默认 1 小时内只报警一次
ALERT_COOLDOWN="${ALERT_COOLDOWN:-3600}"
LAST_ALERT_FILE="$BRIDGE_DIR/.watchdog_last_alert"
# 优先拉起的脚本名（v2 是旧坑，已弃用，这里默认 v4）
START_SCRIPT="${START_SCRIPT:-start_bridge_v4.sh}"

# ── 通知配置 ──────────────────────────────────────────────────
[ -f "$HOME/.env_bridge" ] && . "$HOME/.env_bridge"
TOPIC="${NTFY_TOPIC:-zfengkong-CHANGE-ME}"
NTFY_URL="${NTFY_URL:-https://ntfy.sh}"

MODE="run"
[ "${1:-}" = "--status" ] && MODE="status"
[ "${1:-}" = "--force" ]  && MODE="force"

now=$(date +%s)
notify() {  # notify 标题 正文
  [ "$MODE" = "status" ] && return 0
  printf '%s' "$2" | curl -s -H "Title: $1" -H "Tags: $3" "$NTFY_URL/$TOPIC" >/dev/null 2>&1
}

# ── 读心跳新鲜度 ───────────────────────────────────────────────
hb_age="missing"
if [ -f "$HB_FILE" ]; then
  # 兼容 GNU/BSD date 与 termux coreutils
  hb_mtime=$(stat -c %Y "$HB_FILE" 2>/dev/null || stat -f %m "$HB_FILE" 2>/dev/null || echo 0)
  hb_age=$(( now - hb_mtime ))
fi

is_stale=0
if [ "$hb_age" = "missing" ] || [ "$hb_age" -gt "$STALE_SEC" ]; then
  is_stale=1
fi

# 进程是否活着（按启动脚本名匹配，避免误杀其它 java/bash）
proc_alive=0
if pgrep -f "$START_SCRIPT" >/dev/null 2>&1 || pgrep -f "termux_bridge" >/dev/null 2>&1; then
  proc_alive=1
fi

echo "[watchdog] 桥目录=$BRIDGE_DIR  心跳龄=${hb_age}s  阈值=${STALE_SEC}s  进程存活=$proc_alive  模式=$MODE"

# ── 判定与处置 ─────────────────────────────────────────────────
if [ "$is_stale" = "0" ] && [ "$MODE" != "force" ]; then
  echo "[watchdog] ✅ 桥健康（心跳 ${hb_age}s 前更新）"
  exit 0
fi

echo "[watchdog] ⚠️ 桥疑似停摆：心跳=${hb_age} 进程=$proc_alive"

# 冷却检查：距上次报警不足 ALERT_COOLDOWN 则不重复刷屏
in_cooldown=0
if [ -f "$LAST_ALERT_FILE" ] && [ "$MODE" != "status" ]; then
  last=$(cat "$LAST_ALERT_FILE" 2>/dev/null || echo 0)
  [ $(( now - last )) -lt "$ALERT_COOLDOWN" ] && in_cooldown=1
fi

if [ "$MODE" = "status" ]; then
  echo "[watchdog] (--status) 仅报告，不报警不拉起"
  exit 1
fi

if [ "$in_cooldown" = "1" ]; then
  echo "[watchdog] 冷却中（距上次报警 $(( now - last ))s），本次仅尝试拉起，不再重复推送"
else
  notify "峰控桥掉线" "心跳 ${hb_age}s 未更新，进程存活=${proc_alive}，正在尝试自动拉起 ${START_SCRIPT}…" "warning"
  [ -d "$BRIDGE_DIR" ] && echo "$now" > "$LAST_ALERT_FILE" 2>/dev/null
fi

# ── 自动拉起（后台 nohup，脱离看门狗自身生命周期）───────────────
if [ -d "$BRIDGE_DIR" ] && [ -f "$BRIDGE_DIR/$START_SCRIPT" ]; then
  cd "$BRIDGE_DIR" || exit 1
  nohup bash "$START_SCRIPT" >> "$BRIDGE_DIR/watchdog_restart.log" 2>&1 &
  echo "[watchdog] 已后台拉起 $START_SCRIPT（pid=$!），日志 $BRIDGE_DIR/watchdog_restart.log"
  notify "峰控桥已尝试重启" "已执行 $START_SCRIPT，稍后再巡检确认是否恢复。" "arrows_counterclockwise"
else
  echo "[watchdog] ❌ 未找到 $BRIDGE_DIR/$START_SCRIPT，无法自动拉起，请手动在 Termux 里输 zf 或重建桥"
  notify "峰控桥拉起失败" "找不到 $BRIDGE_DIR/$START_SCRIPT，需人工介入（Termux 里输 zf）。" "exclamation_mark"
  exit 2
fi
