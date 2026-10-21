# 峰控桥（mobile-app/bridge）——手机峰控助手 ⇆ PC 工具箱

给手机端峰控助手预置的全套工具，Termux 一激活即可用。

## 目录结构
```
bridge/
├── termux/                  # 手机侧（拷到手机 /sdcard/bridge 后执行 install.sh）
│   ├── install.sh           # 一键安装：pkg 依赖 + cron + ntfy 配置
│   ├── morning_report.sh    # 定时晨报（天气+待办+追剧）经 ntfy 推送
│   ├── sync_memory.sh       # 记忆/待办打包备份到 PC、可拉回
│   └── crontab.txt          # 定时任务表（晨报 7:00、备份 23:30）
└── pc/                      # PC 侧接收端
    ├── bridge_server.py     # HTTP 服务：备份上传/下载 + 白名单远程命令
    ├── 启动峰控桥.bat       # 一键后台启动（端口 8765）
    └── bridge_store/        # 备份文件落盘目录（自动创建）
```

## 手机端峰控助手使用步骤
1. PC 上双击 `pc/启动峰控桥.bat`（峰控助手也可让我远程启动）。
2. 把 `termux/` 整个目录拷到手机 `/sdcard/bridge`（USB 或峰控助手的文件共享均可）。
3. Termux 里执行：
   ```bash
   termux-setup-storage          # 授权存储（首次）
   bash /sdcard/bridge/termux/install.sh
   ```
4. 编辑 `~/.bashrc`，把 `NTFY_TOPIC` 改成随机串（只有自己知道的通知频道）。
5. 创建 `~/.env_bridge`：
   ```bash
   echo 'PC_HOST=<电脑局域网IP>'  >> ~/.env_bridge
   echo 'PC_PORT=8765'           >> ~/.env_bridge
   ```
6. 测试：`bash ~/scripts/sync_memory.sh push` → PC 端 `bridge_store/` 应出现备份文件。

## PC 端接口一览
| 接口 | 说明 |
|---|---|
| GET /ping | 存活检查 |
| POST /upload?name=x | 手机上传备份（raw body） |
| GET /latest | 拉最近一份备份 |
| GET /list, /download?name=x | 列表/下载 |
| POST /cmd {"cmd":"dir"} | 白名单远程命令（dir/type/python/pip/git/tasklist 等） |

## 安全说明
- /cmd 有白名单，仅允许只读类和 python/pip/git，超时保护。
- 局域网明文 HTTP，勿暴露公网；公网场景建议走 Tailscale。
- NTFY_TOPIC 即通知频道名，务必改成随机串防偷听。
