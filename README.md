# ZF3D Agent v2

> 全JSON配置驱动的AI智能体框架 — 纯Python标准库，零依赖，复制即用

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![零依赖](https://img.shields.io/badge/依赖-零-brightgreen.svg)](#)

## ✨ 特性

### 核心能力
- 🧠 **状态机ReAct推理引擎** — 思考→行动→观察→校验→终止循环，FC+文本双模式智能降级，批量任务进度拦截
- 📋 **全JSON配置驱动** — 用户只写配置不改代码，工具/技能/插件/MCP四层声明式扩展
- 🔒 **文件权限铁律** — 操作新文件夹弹窗询问，无权限绝对不动，3次后自动升级永久授权
- 📦 **零依赖** — 纯Python标准库，不pip install任何包，复制文件夹即用

### AI集成
- 🎨 **ComfyUI全流程** — 文生图、图生图、文生视频/图生视频、prompt反推，直接操作本地ComfyUI
- 🌐 **Playwright浏览器自动化** — 真实浏览器操作、页面分析、会话持久化，可作为RPA
- 📄 **Office文档处理** — Word读取/修改/创建、Excel文本替换、docx带格式HTML预览
- 🔊 **TTS语音合成** — edge-tts晓晓神经语音，30%语速，失败自动回退SAPI

### 记忆与上下文
- 🧠 **三层语义记忆** — 标签匹配→关键词匹配→LLM语义召回，事件归档+自动摘要+用户画像
- 💾 **检查点续跑** — 长任务中断可续，运行诊断+错误分类+监控规则引擎
- 📝 **框选文本直接编辑** — 框选即可让AI改写，自动区分Word/Excel/纯文本

### 架构与安全
- 🔄 **双引擎研发流水线** — 工作引擎实验→语法/JSON检测→备份→合并主引擎→可回滚
- 🔵🔴 **隐私分区** — 公共区可发布，隐私区绝不外泄，一键打包自动扫描泄露
- 🔑 **密钥加密存储** — XOR+机器码加密，明文密钥自动迁移，界面/日志全掩码
- 🎬 **本地多媒体一体化** — avi/wmv ffmpeg实时转码mp4、Range断点续传、图片/音频/视频流式服务
- 🇨🇳 **全中文命名** — 函数、变量、文件夹、配置全中文

## 🚀 快速开始

### 安装

```bash
# 方式一：git clone（推荐）
git clone https://github.com/zf3dzf3dzf3d-ctrl/zf3d_agent.git
cd zf3d_agent

# 方式二：下载zip
# 从GitHub页面下载zip，解压即可
```

### 配置

1. 复制密钥模板并填入你的API Key：
```bash
cp 隐私区/我的配置/密钥_模板.json 隐私区/我的配置/密钥.json
```

2. 编辑 `隐私区/我的配置/密钥.json`，填入你的API Key

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

浏览器打开 http://localhost:8765 即可使用。

## 📁 项目结构

```
zf3d_agent/
├── 公共区/                    🔵 公开区域，可发布可分享
│   ├── 内核/                  系统引擎
│   │   ├── 启动器.py           统一启动+模块调度
│   │   ├── 模型直连器.py        纯HTTP直连+密钥加密+流式+缓存
│   │   ├── 操作注册中心.py      90+操作注册/调度/别名/统计
│   │   ├── 网页服务.py          60+API端点+SSE流式+TTS+视频转码
│   │   ├── 文件管理器.py        权限校验+审计日志
│   │   ├── 存储引擎.py          SQLite+全文搜索
│   │   ├── 安全计算器.py        AST安全求值（零eval注入）
│   │   ├── 剧本管理器.py        操作序列录制/回放
│   │   ├── 插件加载器.py        热加载Python插件
│   │   ├── 技能加载器.py        技能包加载（如PDF编辑器）
│   │   ├── MCP客户端.py         MCP服务连接+工具自动发现
│   │   ├── 动态工具加载器.py     声明式JSON加工具
│   │   └── 操作/               90+内置操作实现
│   ├── 模块/                  功能模块
│   │   ├── 对话/               ReAct推理+意图解析+反思评估+上下文管理
│   │   ├── 记忆/               事件制记忆+三层语义召回+用户画像
│   │   ├── 任务/               LLM任务拆解+逐步执行+进度追踪
│   │   └── 浏览器/             Playwright引擎+页面分析+会话管理
│   ├── 插件/                  可插拔扩展
│   ├── 技能/                  技能模块（如pdf-editor）
│   ├── 配置/                  全JSON配置（13个配置文件）
│   └── 界面/                  前端页面（HTML/CSS/JS+编辑器+代码高亮）
├── 隐私区/                    🔴 隐私区域，绝不进发布包
│   ├── 我的配置/              密钥（加密存储）+模板
│   ├── 我的记忆/              记忆库/用户画像/摘要索引
│   ├── 我的数据/              用户个人数据
│   ├── 我的日志/              运行日志（含LLM原始记录）
│   ├── 对话记录/              对话历史
│   ├── 浏览器会话/            浏览器数据
│   ├── 我的工作引擎/          开发版引擎
│   ├── 我的剧本/              用户剧本
│   └── 我的知识库/            个人知识库
├── 引擎管理/                 双引擎调度与合并控制
├── tests/                    pytest测试套件（92个用例）
├── public/core/              ASCII安全入口（bat兼容）
├── 发布打包.py                一键打包（隐私泄露扫描）
├── 启动.bat / 启动.sh         启动脚本
├── 设计文档.md                完整设计文档（21章）
├── 帮助系统.md                使用帮助
└── CHANGELOG.md               更新日志
```

## 🛠 内置操作（90+）

| 类别 | 操作 |
|------|------|
| 🎨 ComfyUI | 文生图、图生图、文生视频、图生视频、prompt反推、工作流管理 |
| 🌐 浏览器 | 打开网页、截图、点击、填表、滚动、页面分析、会话保存 |
| 📄 Office | Word读取/修改/创建、Excel文本替换 |
| 📁 文件 | 创建/读取/写入/删除/替换/批量编辑、压缩/解压、回收站 |
| 💻 系统 | 打开程序、运行命令、截图、系统信息、等待、数学计算 |
| 🔍 代码 | 正则搜索、Glob搜索、AST符号搜索、语法验证、Git全套操作 |
| 🌍 网络 | 网页抓取、网络搜索、网页分析、图片分析、多线程下载 |
| 🤖 编排 | 子代理、并行执行、Pipeline、Barrier、LoopUntilDry、Job管理 |
| 📋 剧本 | 录制/回放/列表/删除 |
| 📚 知识库 | 导入文档、全文搜索、列表/删除 |
| 🔧 扩展 | 创建工具、导出对话、诊断监控 |

## 🔧 支持的模型

纯HTTP直连，不绑定任何SDK，已预配置：

| 模型 | 接口 |
|------|------|
| DeepSeek | api.deepseek.com |
| 豆包(字节) | ark.cn-beijing.volces.com |
| 智谱GLM | open.bigmodel.cn |
| Kimi(月之暗面) | api.moonshot.cn |
| Claude | api.anthropic.com |
| Gemini | generativelanguage.googleapis.com |
| 通义千问 | dashscope.aliyuncs.com |
| OpenAI | api.openai.com |
| 自定义 | 任意OpenAI兼容端点 |

只需在 `隐私区/我的配置/密钥.json` 中填入对应API Key即可。

## 🧪 测试

```bash
python -m pytest tests/ -v
```

覆盖：安全计算器、操作基类/注册中心、存储引擎、剧本管理器、配置加载器、文件管理器、知识库。

## 📦 发布打包

```bash
python 发布打包.py
```

自动扫描隐私泄露（API Key、邮箱、个人路径），只打包公共区，生成zip。

## 📜 License

MIT License - 详见 [LICENSE](LICENSE)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request
