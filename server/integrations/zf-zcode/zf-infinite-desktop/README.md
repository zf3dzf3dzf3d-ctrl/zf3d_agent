# zf-infinite-desktop（v0.2 内嵌面板版）

ZCode「一键切换无限桌面」插件。策划案见上级目录《策划案-ZCode一键切换无限桌面插件.md》(v1.1)。

## v0.2 新增：ZCode 内嵌面板（本次核心）
`plugin.json` 声明 `ui.surfaces[0]`（id=panel, type=panel, entry=ui/panel.html, availability=session）——与 ZCode 官方 office 插件（docx/pdf/pptx-viewer）同款 UI surface 机制。效果：
- ZCode 会话右侧插件市场出现「朱峰无限桌面」卡片，点「打开」即在 **ZCode 界面内部** 加载无限桌面（不再是弹外部窗口）
- panel.html 自动探测 127.0.0.1:8791/api/health：服务在跑直接 iframe 内嵌；没在跑显示「启动无限桌面」按钮，点击轮询唤起（launch.py 幂等复用端口），15 秒超时给排查提示

## 结构
- `plugin.json`：插件壳（命令「打开无限桌面」+ MCP server 声明 + userConfig 朱峰 Token/线路）
- `bridge_lite/launch.py`：zf-bridge-lite 本地服务（纯标准库单文件）
  - 静态托管 UI（默认指向主项目 public/，`--root` 可改）
  - `/api/health` 健康检查、`/api/echo` 对话注入最小 API（引擎桥 D6-8 接朱峰线路）
  - 动态端口 + 写 `private/port.json` 的 `zf_bridge_lite` 字段
  - 窗口壳：优先 pywebview 原生窗口，WebView2/依赖缺失自动退回系统浏览器（v1.1 兜底）

## 实测记录（2026-10-24）
- 启动 `launch.py --mcp --port 8791`（朱峰嵌入式 python.exe）
- GET /api/health → `{"ok": true, "service": "zf-bridge-lite", "version": "0.1.0"}`
- POST /api/echo → `{"ok": true, "echo": "hi", "engine": "zhufeng"}`
- GET /index.html → 200

## 一键安装（新增 2026-10-24）
双击 `install.bat` 即可：自动查找系统 Python → 复制插件到 `%USERPROFILE%\.zcode\plugins\zf-infinite-desktop` → 启动自检（/api/health）→ 打印使用提示。装完重启 ZCode：
1. **内嵌入口（推荐）**：会话右侧插件市场 → 朱峰无限桌面 → 点「打开」→ ZCode 内部直接加载无限桌面
2. 兜底：命令面板输入「打开无限桌面」（pywebview 原生窗口）
手动等效三步（脚本失败时）：① 复制本目录到 ZCode 插件目录；② 确认 `plugin.json` 里 python 可用；③ 运行 `python bridge_lite/launch.py` 自检。

## 待办
- hello-world 探针：ZCode 客户端「个人市场」本地目录导入，验证命令注册（需 ZCode 客户端实测，用户操作或浏览器自动化）
- 引擎桥三通道（CLI headless / MCP / 展示面板兜底）调研
- 朱峰线路鉴权接口接通
