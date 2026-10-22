#!/data/data/com.termux/files/usr/bin/bash
# 记忆同步：把峰控助手的记忆/待办/追剧推到 PC 端备份，也可对接私有 git 仓库
# 用法：bash ~/scripts/sync_memory.sh push  （push 到 PC）或 pull（从 PC 拉回）
# 配置文件 ~/.env_bridge 内容示例：
#   PC_HOST=192.168.1.100
#   PC_PORT=8765
MODE="${1:-push}"
[ -f "$HOME/.env_bridge" ] && . "$HOME/.env_bridge" || { echo "缺 ~/.env_bridge"; exit 1; }
SRC="$HOME/storage/shared/脚本"   # 峰控助手脚本/记录目录
[ -d "$SRC" ] || { echo "目录不存在: $SRC"; exit 1; }

case "$MODE" in
  push)
    tar czf /tmp/mem.tgz -C "$(dirname "$SRC")" "$(basename "$SRC")"
    curl -s --max-time 30 -X POST --data-binary @/tmp/mem.tgz \
      "http://${PC_HOST}:${PC_PORT}/upload?name=mem_$(date +%Y%m%d_%H%M).tgz" \
      && echo "已备份到 PC"
    ;;
  pull)
    curl -s --max-time 30 -o /tmp/mem.tgz "http://${PC_HOST}:${PC_PORT}/latest"
    mkdir -p /tmp/mem_restore && tar xzf /tmp/mem.tgz -C /tmp/mem_restore
    echo "已下载到 /tmp/mem_restore，确认后手动覆盖 $SRC"
    ;;
  *) echo "用法: sync_memory.sh push|pull";;
esac
