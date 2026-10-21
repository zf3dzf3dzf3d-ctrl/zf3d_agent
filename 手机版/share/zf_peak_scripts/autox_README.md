# AutoX.js 第二操控桥（预装）

峰控助手的持久化操控通道：助手把动作写成 JSON 任务文件，AutoX.js 轮询执行并写回执，绕开故障的无障碍桥。

## 安装步骤（在手机上）
1. 从 GitHub `autojsx/AutoX-v7` releases 下载 APK 安装（免 root）。
2. 给 AutoX.js 授予「无障碍服务」和「悬浮窗」权限。
3. 把 `zf_autox_bridge.js` 复制到 AutoX 的脚本目录，运行它（出现"峰控操控桥已启动"即成）。

## 目录约定
- 任务下发：`/sdcard/zf_peak/autox_queue/*.json`
- 结果回执：`/sdcard/zf_peak/autox_done/<同名>.res`

## 任务格式
```json
{"action":"tap","x":100,"y":200}
{"action":"swipe","x":100,"y":800,"x2":100,"y2":300,"dur":300}
{"action":"text","text":"你好"}
{"action":"key","key":"back"}
{"action":"launch","pkg":"com.tencent.mm"}
{"action":"screen"}
{"action":"find","target":"发送"}
{"action":"stop"}
```

助手侧收到「装AutoX操控」口令时按上面步骤引导用户即可。
