#!/data/data/com.termux/files/usr/bin/bash
# 峰控桥 · 开机自启 + 看门狗自愈脚本（手机端 Termux 运行）
#
# 解决痛点：你反复遇到的「Termux 桥每次开机都得手动拉起、不会自启、死了没人管」。
# 本脚本做一件事：检查桥是否活着，不活就自动拉起来；拉了还不活就熔断 + 发 ntfy 告警。
# 同一个脚本可被两种方式调用，逻辑一致：
#   1) 开机自启：termux-boot 放一个 boot.sh 调本脚本（见 install.sh 第 6 步）
#   2) 看门狗：crontab 每 N 分钟调一次，桥一死很快被救活（见 crontab.txt）
#
# 可配置项（写进 ~/.env_bridge 或 export 后即可，都有合理默认）：
#   ZF_BRIDGE_CMD      启动桥的命令。默认调用 v4 一键启动脚本。
#   ZF_BRIDGE_HEARTBEAT 桥心跳文件路径（桥启动后应持续 touch 它）。
#   ZF_BRIDGE_STALE    心跳超过多少秒视为桥已死。默认 180。
#   ZF_BRIDGE_PROCPAT  进程存活匹配的关键词（辅助判断，可选）。
#   ZF_BRIDGE_MAX_FAIL 连续拉起多少次仍无心跳则熔断停手 + 告警。默认 3。
#   NTFY_TOPIC         ntfy 通知频道名（为空则不发通知；会从 ~/.bashrc 兜底提取）。
#   NTFY_URL           ntfy 服务器地址。默认 https://ntfy.sh。
#
# 说明：本脚本不依赖桥的内部实现，只要你的桥脚本会写「心跳文件」即可被看护。
#       若桥不写心跳文件，可只配 ZF_BRIDGE_PROCPAT 用进程名判断。
#       自愈有「熔断」保护：连续 MAX_FAIL 次拉起心跳仍异常，则停止重拉并 ntfy 告警，
#       避免「桥启动即崩 / 不写心跳」时被反复 nohup 堆成僵尸进程（自愈变自伤）。

set -u

# 加载用户配置（若存在）
[ -f "$HOME/.env_bridge" ] && . "$HOME/.env_bridge"

# ---- 默认值（可被 ~/.env_bridge 覆盖）----
BRIDGE_HOME="${ZF_BRIDGE_HOME:-/sdcard/Download/朱峰智能体/termux_bridge}"
BRIDGE_CMD="${ZF_BRIDGE_CMD:-bash ${BRIDGE_HOME}/start_bridge_v4.sh}"
HEARTBEAT="${ZF_BRIDGE_HEARTBEAT:-${BRIDGE_HOME}/heartbeat.txt}"
STALE="${ZF_BRIDGE_STALE:-180}"
PROCPAT="${ZF_BRIDGE_PROCPAT:-}"   # 留空则不启用进程名判断
MAX_FAIL="${ZF_BRIDGE_MAX_FAIL:-3}"
LOG="${BRIDGE_HOME}/watchdog.log"
STATE_DIR="${BRIDGE_HOME}/.wd_state"
FAIL_FILE="${STATE_DIR}/fail_count"

# ntfy topic 兜底：cron 环境不读 ~/.bashrc，若 .env_bridge 没配则从 ~/.bashrc 提取
if [ -z "${NTFY_TOPIC:-}" ] && [ -f "$HOME/.bashrc" ]; then
  NTFY_TOPIC=$(grep -oE 'NTFY_TOPIC="[^"]+"' "$HOME/.bashrc" 2>/dev/null | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
fi
NTFY_URL="${NTFY_URL:-https://ntfy.sh}"

mkdir -p "$BRIDGE_HOME" 2>/dev/null || true
mkdir -p "$STATE_DIR" 2>/dev/null || true
ts() { date '+%Y-%m-%d %H:%M:%S'; }
say() { echo "[$(ts)] $1" | tee -a "$LOG" 2>/dev/null || echo "$1"; }

# ntfy 推送：未配 topic 或无 curl 则静默跳过，绝不影响主逻辑
notify() {
  _title="$1"; _body="$2"; _pri="${3:-low}"
  _topic="${NTFY_TOPIC:-}"
  [ -z "$_topic" ] && return 0
  command -v curl >/dev/null 2>&1 || return 0
  curl -s -o /dev/null --max-time 8 -H "Title: $_title" -H "Priority: $_pri" -d "$_body" "${NTFY_URL}/${_topic}" 2>/dev/null || true
}

# 0. 确保后台运行权（防止 Android 杀进程）
termux-wake-lock 2>/dev/null || true

# 1. 判断桥是否「活着」：优先看心跳新鲜度，其次看进程名
alive=0
if [ -f "$HEARTBEAT" ]; then
  # 用文件 mtime 与当前时间差判断（跨 stat 实现，兼容 toybox/coreutils）
  hb_mtime=$(date -r "$HEARTBEAT" +%s 2>/dev/null || stat -c %Y "$HEARTBEAT" 2>/dev/null || echo 0)
  now=$(date +%s)
  age=$(( now - hb_mtime ))
  if [ "$hb_mtime" -gt 0 ] && [ "$age" -le "$STALE" ]; then
    alive=1
    say "心跳正常（${age}s 前，阈值 ${STALE}s），桥在线。"
  else
    say "心跳超时（${age}s 前，阈值 ${STALE}s）→ 判定桥已死。"
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

# 2. 桥活着 → 清零熔断计数（若之前熔断过，恢复后补一条恢复通知）
if [ "$alive" -eq 1 ]; then
  prev_fail=$(cat "$FAIL_FILE" 2>/dev/null || echo 0)
  if [ "$prev_fail" -ge "$MAX_FAIL" ] 2>/dev/null; then
    notify "✅峰控桥已恢复" "心跳恢复正常，熔断已解除（此前连续 ${prev_fail} 次拉起失败）。" low
  fi
  echo 0 > "$FAIL_FILE" 2>/dev/null || true
  exit 0
fi

# 3. 桥死了 → 先查是否已熔断（连续拉起 N 次仍无心跳 = 拉了也没用，停手防堆进程）
fail=$(cat "$FAIL_FILE" 2>/dev/null || echo 0)
case "$fail" in ''|*[!0-9]*) fail=0;; esac

if [ "$fail" -ge "$MAX_FAIL" ]; then
  say "已熔断（连续 ${fail} 次拉起后心跳仍异常）→ 停止重拉。请人工排查桥为何启动即崩/不写心跳。"
  notify "🛑峰控桥熔断停手" "连续 ${fail} 次拉起心跳仍超时，已停止自动重拉（防僵尸进程堆叠）。多为桥启动即崩或不写 heartbeat.txt，需人工检查 bridge.out。" high
  exit 0
fi

# 4. 未达熔断阈值 → 计数 +1，后台重拉（nohup，绕开看门狗自身退出）+ 报警
fail=$((fail + 1))
echo "$fail" > "$FAIL_FILE" 2>/dev/null || true
say "执行拉起（第 ${fail}/${MAX_FAIL} 次）：$BRIDGE_CMD"
nohup sh -c "$BRIDGE_CMD" >> "${BRIDGE_HOME}/bridge.out" 2>&1 &
disown 2>/dev/null || true
say "已投递拉起命令（PID $!），稍后看门狗下轮会复查心跳。"
notify "⚠️峰控桥掉线重拉" "心跳超时，已第 ${fail}/${MAX_FAIL} 次自动重拉（阈值 ${STALE}s）。达 ${MAX_FAIL} 次将熔断。" low

exit 0
