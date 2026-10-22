#!/data/data/com.termux/files/usr/bin/bash
# 晨报脚本：cron 每天早上跑，聚合内容经 ntfy 推送到峰控助手通知
# crontab 示例：0 7 * * * bash ~/scripts/morning_report.sh
[ -f "$HOME/.env_bridge" ] && . "$HOME/.env_bridge"
TOPIC="${NTFY_TOPIC:-zfengkong-CHANGE-ME}"
NTFY_URL="${NTFY_URL:-https://ntfy.sh}"

# 需要抓取的源（峰控助手可在手机端自行编辑扩充）
WEATHER_CITY="${WEATHER_CITY:-Beijing}"
TXT="【晨报】$(date '+%m-%d %a')\n"

# 天气（wttr.in 免key）
W=$(curl -s --max-time 8 "https://wttr.in/${WEATHER_CITY}?format=3" 2>/dev/null)
[ -n "$W" ] && TXT="${TXT}${W}\n"

# 今日待办（从峰控助手待办导出文件读取，若存在）
TODO_FILE="${TODO_FILE:-$HOME/storage/shared/脚本/待办.txt}"
if [ -f "$TODO_FILE" ]; then
  TXT="${TXT}\n【待办】\n$(head -20 "$TODO_FILE")\n"
fi

# 追剧更新（峰控助手追剧记录）
SHOW_FILE="${SHOW_FILE:-$HOME/storage/shared/脚本/追剧.txt}"
if [ -f "$SHOW_FILE" ]; then
  TXT="${TXT}\n【追剧】\n$(tail -10 "$SHOW_FILE")\n"
fi

curl -s -d "$(printf "$TXT")" "$NTFY_URL/$TOPIC" >/dev/null && echo "晨报已推送" || echo "推送失败"
