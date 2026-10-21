#!/system/bin/sh
# 峰控每日晨报（天气+一言 -> ntfy 推送）。手机装有 Termux 时可由 termux cronie 定时执行。
# 用法：sh morning_report.sh
# 修改 TOPIC 为你在 ntfy 客户端订阅的同一主题名；修改 CITY 为你的城市（wttr.in 支持中文）。
# 抓取/推送优先用 curl（Android 自带 /system/bin/curl，Termux 也有），busybox wget 作兜底。
TOPIC="请改成你的主题"
CITY="深圳"

# GET <URL>：输出响应正文；curl 优先，busybox wget / wget 兜底
GET() {
  if command -v curl >/dev/null 2>&1; then
    curl -sL --max-time 15 "$1" 2>/dev/null && return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox wget -q -T 15 -O- "$1" 2>/dev/null && return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -q -T 15 -O- "$1" 2>/dev/null && return 0
  fi
  return 1
}

# PUSH <正文>：推送到 ntfy；curl 优先，busybox wget 兜底
PUSH() {
  if command -v curl >/dev/null 2>&1; then
    curl -s -m 15 -X POST -d "$1" "https://ntfy.sh/$TOPIC" >/dev/null 2>&1 && return 0
  fi
  if command -v busybox >/dev/null 2>&1; then
    busybox wget -q -T 15 -O- --post-data="$1" "https://ntfy.sh/$TOPIC" >/dev/null 2>&1 && return 0
  fi
  return 1
}

WEATHER=$(GET "wttr.in/$CITY?format=3&lang=zh")
HITOSAI=$(GET "https://v1.hitokoto.cn" | sed -n 's/.*"hitokoto":"\([^"]*\)".*/\1/p')
[ -z "$WEATHER" ] && WEATHER="天气获取失败（检查网络或 curl 是否可用）"
[ -z "$HITOSAI" ] && HITOSAI="一言获取失败"

MSG="晨报到：$WEATHER | 今日一言：$HITOSAI"
if PUSH "$MSG"; then
  echo "已推送 $MSG"
else
  echo "推送失败：未找到可用的 curl/busybox，或网络/主题名有误" >&2
  exit 1
fi
