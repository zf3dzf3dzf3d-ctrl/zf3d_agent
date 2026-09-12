# 启动脚本目录说明

本目录集中存放各平台的启动/停止/重启/升级脚本。

## Windows
Windows 的启动脚本在项目根目录（bat 文件需要相对根目录定位 `python\` 和 `server\`，不宜下移）：
- `.启动朱峰社区智能体无限.bat` — 一键启动
- `重启后台服务器.bat`
- `.在线升级.bat`

## Linux（本目录 `Linux\`）
- `朱峰社区智能体Linux版本启动.sh` — 前台启动
- `朱峰社区智能体Linux版本后台启动.sh` — 后台启动
- `朱峰社区智能体Linux版本停止.sh` / `重启.sh`
- `start.sh` — 通用入口（脚本内部 `cd ../..` 回项目根）

## macOS（本目录 `Mac\` + `scripts\macos\`）
- `*.command` 双击即可运行；内部通过 `cd ../..` 回项目根，
  并调用同级 `..\scripts\macos\*.sh`（含启动/停止/重启/更新/打包 build_app.sh）。

注意：`Mac\*.command` 与 `scripts\` 必须保持在同一个父目录下（现在同为 `启动脚本\`），
否则 `.command` 里的 `../scripts/macos/...` 相对路径会失效。
