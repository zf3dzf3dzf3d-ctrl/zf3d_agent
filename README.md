# ZF3D Agent v2

> 全JSON配置驱动的AI智能体框架 — 纯Python标准库，零依赖，复制即用

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![零依赖](https://img.shields.io/badge/依赖-零-brightgreen.svg)](#)

## ✨ 特性

- 🧠 **大模型全权决策** — 系统是手脚（调度、搬运、执行），大模型是大脑（思考、决策、优化）
- 📋 **全JSON配置驱动** — 用户只写配置，不改代码，一切行为由JSON决定
- 🔒 **文件权限铁律** — 操作任何新文件夹必须弹窗询问，无权限绝对不动
- 🧩 **模块化+可插拔** — 各模块独立运行互不依赖，插件即插即用热插拔
- 📝 **事件制记忆** — 对话归类为事件而非消息流，自动摘要、冗余清理、长上下文适应
- 🔄 **双引擎自我进化** — 主引擎稳定发布 + 工作引擎大模型开发，人决定何时合并
- 🔍 **全透明** — LLM原始请求/响应完全可见，不做封装、过滤、隐藏
- 🔵🔴 **隐私分区** — 公共区可发布，隐私区绝不外泄，一键打包自动检查泄露
- 🇨🇳 **全中文命名** — 函数、变量、文件夹、配置全中文，方便中国开发者
- 📦 **零依赖** — 不pip install任何包，纯Python标准库，复制文件夹即可运行

## 🚀 快速开始

### 安装

```bash
# 方式一：git clone（推荐）
git clone https://github.com/你的用户名/zf3d_agent.git
cd zf3d_agent

# 方式二：下载zip
# 从GitHub页面下载zip，解压即可
```

### 配置

1. 复制密钥模板并填入你的API Key：
```bash
cp 隐私区/我的配置/密钥_模板.json 隐私区/我的配置/密钥.json
```

2. 编辑 `隐私区/我的配置/密钥.json`，填入你的API Key：
```json
{
  "密钥列表": {
    "LLM_API_KEY": "你的API Key",
    "LLM_MODEL": "deepseek-chat"
  }
}
```

3. 编辑 `公共区/配置/模型规则.json`，填入接口地址（已预配置DeepSeek）

### 启动

```bash
# Windows
启动.bat

# 或命令行
python public/core/main.py

# Linux/Mac
bash 启动.sh
```

浏览器打开 http://localhost:8080 即可使用。

## 📁 项目结构

```
zf3d_agent/
├── 公共区/                    🔵 公开区域，可发布可分享
│   ├── 内核/                  系统引擎（启动器/配置加载器/模型直连器/操作注册中心/网页服务）
│   ├── 模块/                  功能模块（对话/记忆/任务/浏览器）
│   ├── 插件/                  可插拔扩展
│   ├── 技能/                  技能模块（如PDF编辑器）
│   ├── 配置/                  公共配置（全JSON，13个配置文件）
│   └── 界面/                  前端页面（HTML/CSS/JS，含编辑器）
├── 隐私区/                    🔴 隐私区域，绝不进发布包
│   ├── 我的配置/              密钥配置（含模板）
│   ├── 我的记忆/              记忆库/用户画像/摘要索引
│   ├── 我的数据/              用户个人数据
│   ├── 我的日志/              运行日志（含LLM原始记录）
│   ├── 对话记录/              对话历史
│   ├── 浏览器会话/            浏览器数据
│   ├── 我的工作引擎/          开发版引擎
│   ├── 我的剧本/              用户剧本
│   └── 我的知识库/            个人知识库
├── 引擎管理/                 双引擎调度与合并控制
├── tests/                    测试文件
├── public/core/              ASCII安全入口（bat兼容）
├── 发布打包.py                一键打包（只打公共区）
├── 启动.bat / 启动.sh         启动脚本
├── 设计文档.md                完整设计文档（含21章详细设计）
├── 帮助系统.md                使用帮助
└── 开发日志.md                开发记录
```

## 🛠 系统架构

```
大模型(大脑) ←→ 全局层(命令中心+事件中心) ←→ 用户层(Web界面)
                       ↕
                   配置层(全JSON)
                       ↕
        ┌──── 内核(极小，仅调度) ────┐
        ├ 启动器 / 配置加载器         │
        ├ 模型直连器 / 文件管理器      │
        ├ 操作注册中心 / 网页服务      │
        └─────────────────────────────┘
           ↕        ↕        ↕
        [对话模块] [记忆模块] [任务模块]
```

## 📦 内置功能

| 功能 | 说明 |
|------|------|
| 💬 对话 | 与大模型对话，支持流式输出 |
| 📁 文件管理 | 浏览文件、授权权限、审计日志 |
| 📝 编辑器 | 内置代码编辑器，语法高亮 |
| 🧠 记忆 | 事件制记忆，自动摘要，冗余清理 |
| 📋 日志 | 查看LLM原始请求响应 |
| ⚙️ 引擎 | 双引擎管理、代码合并 |
| 🔧 配置 | 编辑所有JSON配置 |
| 🌐 浏览器 | 内置浏览器自动化 |
| 🔌 插件 | 可插拔扩展系统 |

## 🔧 支持的模型

通过OpenAI兼容格式直连，已预配置：

| 模型 | 接口 |
|------|------|
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` |
| 豆包(字节) | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` |
| 智谱GLM | `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| Kimi(月之暗面) | `https://api.moonshot.cn/v1/chat/completions` |
| Claude | `https://api.anthropic.com/v1/messages` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/models` |

只需在 `隐私区/我的配置/密钥.json` 中填入对应API Key即可。

## 🧪 测试

```bash
python -m pytest tests/ -v
```

## 📦 发布打包

```bash
python 发布打包.py
```

打包脚本会：
1. 自动扫描隐私泄露（API Key、邮箱、个人路径）
2. 只打包公共区 + 引擎管理 + 根目录文档
3. 排除所有隐私区数据、缓存、日志
4. 生成 `智能体_v2_发布_v{版本号}.zip`

## 📝 开发日志

详见 [开发日志.md](开发日志.md)

## 📄 设计文档

详见 [设计文档.md](设计文档.md) — 包含21章完整设计文档

## 📜 License

MIT License - 详见 [LICENSE](LICENSE)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request
