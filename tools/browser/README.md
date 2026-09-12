# 内置持久化浏览器（免安装，复制包即用）

## 组成
- `python/browsers/` — Chrome 内核（Chromium for Testing，随包分发，不依赖系统安装）
- `python/` — 内置 Python（已含 playwright 库，含 pip）
- `tools/browser/` — 服务与脚本
  - `browser_service.py` — HTTP 控制服务（默认端口 8765）
  - `memory_store.py` — 浏览记忆存储（存于 browser_data/memory/）
  - `login_helper.py` — 手动登录助手
  - `browser_data/profile/` — 登录态存储（首次运行自动生成）

## 使用
1. 登录网站（只需一次）：双击 `手动登录.bat`，在弹出的浏览器里手动登录阿里云/朱峰社区等，按提示回车。登录态保存在 browser_data/profile，长期有效。
2. 启动服务：双击 `启动浏览器服务.bat`（默认有头可见窗口；后台运行加参数 `--headless`）。
3. 智能体通过 HTTP 接口操作：
   - `GET  http://127.0.0.1:8765/status` — 状态
   - `POST /open    {"url": "..."}` — 打开网页并返回正文
   - `POST /html    {"url": "..."}` — 返回原始 HTML
   - `POST /click   {"selector": "..."}` — 点击
   - `POST /type    {"selector": "...", "text": "..."}` — 输入
   - `POST /screenshot {"url": "..."}` — 截图（存 screenshots/）
   - `POST /eval    {"script": "..."}` — 执行 JS
   - `POST /open    {"url": "...", "incognito": true}` — 无痕打开（不留 Cookie/历史，不入记忆）
   - `POST /incognito/close {}` — 销毁无痕上下文
   - `GET  /memory?keyword=xx&limit=20` — 检索浏览记忆（/open 会自动存摘要）
   - `POST /memory/get {"id": ...}` — 读单条记忆
   - `POST /memory/clear {}` — 清空记忆

## 复制分发
整个项目文件夹复制到其他电脑即可，无需安装任何东西（Chrome 内核和 Python 库都在包内）。唯一注意：目标机器需为 Windows x64 且已装 VC 运行库（绝大多数系统自带）。
