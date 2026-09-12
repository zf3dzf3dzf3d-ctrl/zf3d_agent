# 技能：介绍/帮助文档同步（docs_sync）

> 目标：**介绍与帮助永远只人工维护一份**——本项目 `docs/` 下的 Markdown，
> 其余展示处（设置面板、GitHub、Gitee、官网 agent.asp）全部从它派生。
> 触发场景：用户说"同步文档/更新介绍/更新帮助/发布到官网"等。
> 详细渠道档案见 `docs/线上同步/三处同步流程.md`，本技能是它的执行手册。

## 一、唯一维护源（改这里才算改内容）

| 文件 | 用途 |
|---|---|
| `docs/软件介绍-5.1.2.md` | 简介面板 + 官网"软件介绍"区 |
| `docs/使用帮助-5.1.2.md` | 帮助面板 + 官网"使用帮助"区 |
| `docs/软件介绍-EN.md` / `docs/使用帮助-EN.md` | 英文版（面板语言切换用） |
| `README.md`（项目根） | GitHub/Gitee 仓库首页，内容对齐 docs，排版是仓库风格 |

规则：
1. 内容修改只改 `docs/` 的 MD，**不要直接改面板 HTML 或 agent.asp 里的正文**。
2. 版本号文件名带版本（如 `使用帮助-5.1.2.md`），发新版时改名并同步改引用点（见第四节）。

## 二、四处展示位与同步方式

| # | 展示位 | 内容来源 | 同步方式 | 验证方法 |
|---|---|---|---|---|
| 1 | 设置面板·简介/帮助 | 直接 fetch `docs/*.md` 渲染（`public/js/panel-docs-sync.js`） | **零操作**，改 MD 刷新页面即生效 | 打开面板看内容 |
| 2 | GitHub 仓库 | `README.md` | git push 两个仓库（见下） | jsdelivr CDN：`cdn.jsdelivr.net/gh/<owner>/<repo>@main/README.md` |
| 3 | Gitee 仓库 | 同一份 `README.md` | git push + 简介版本号走 API | 打开 gitee.com/zf3d/zf3d_agent |
| 4 | 官网 agent.asp | `C:\work\web\agent.asp`（排版独立，正文对齐 docs） | curl 触发同步（**禁止在 C:\work\web 执行 git push**，该目录 origin 是 zf3d_agent 仓库） | 30 秒后 curl 官网页面核对 |

### git push 两个仓库（内容相同时一次提交两处推送）
```
cd /d F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版
git add docs README.md
git commit -m "docs: ..."
git push gitee main
git push github main
```
（remote 名以 `git remote -v` 实际输出为准）

### 官网发布（C:\work\web 仓库）
```
cd /d C:\work\web
curl "https://www.zf3d.com/api/agent_api.asp?key=<见private/heartbeat_key.json，不入库>&a=sync"
# 等 30 秒后验证 https://www.zf3d.com/agent.asp
```

> ⚠️ 千万不要执行 `git add agent.asp; git push`：C:\work\web 的 origin 指向 zf3d_agent 仓库且未跟踪 agent.asp，会误推。线上部署只靠 curl 触发服务器同步（2026-09-09 实测有效）。

### Gitee 仓库简介（含版本号）
```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\work\web\_zf_gitee_desc.ps1
```
- PAT 在 Windows 凭据管理器（gitee.com 条目，账号 zf3d）
- 注意：PATCH 接口必须带 `name` 字段，否则 400

## 三、标准执行顺序（用户喊"同步"时照此走）

1. **改源**：只改 `docs/` MD（若用户直接给了别处的改动，先把内容搬回 docs 再继续）。
2. **面板**：无需操作，本地刷新验证。
3. **仓库**：提交 `docs/ + README.md`，push 到 Gitee 与 GitHub 两个 remote。
4. **Gitee 简介**：版本号变了才跑 `_zf_gitee_desc.ps1`。
5. **官网**：改 `C:\work\web\agent.asp` 对应区块（正文对齐 docs，不改排版结构）→ curl 触发同步（勿 git push）→ 30 秒后验证。
6. **回报**：列出四处各自的状态（改了什么/验证结果），不要只说"完成"。

## 四、发新版的版本号检查点（全部要过一遍）

1. `docs/` 两个 MD 改名/新增为 `-{新版本}.md`，EN 版对应更新
2. `public/js/panel-docs-sync.js` 里 `MD_URLS` 的中文帮助文件名
3. `README.md` 内容与版本号（两仓库 push）
4. Gitee/GitHub 仓库简介里的 vX.Y.Z
5. `C:\work\web\agent.asp`：agentVersion / 下载地址 / 更新日志时间线 / 页脚
6. 本地 server 启动横幅版本

## 五、坑与注意

- panel-docs-sync.js 在 panel-settings.js **之前**加载，靠补丁挂载器挂 switchSettingsTab，别调整加载顺序。
- GitHub raw 直连常超时，验证一律走 jsdelivr CDN。
- 官网 agent.asp 是独立排版（GitHub Releases 风格时间线、左侧 zf-float-nav 浮动导航在左下角不挡正文），同步正文时**保留其结构与样式**。
- `_agent_head.asp`、`_agent_server.asp` 是旧实验残留，agent.asp 未引用，不部署、不清理（除非用户发话）。
- 面板 fetch 的路径是相对路径 `docs/...`，文件改名后若 404，先查 MD_URLS。
- 本技能与 `docs/线上同步/三处同步流程.md` 配套：技能是执行手册，那个文档是渠道档案；两处若不一致，以实际验证过的流程为准并回改文档。
