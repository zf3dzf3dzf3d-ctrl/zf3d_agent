# ZF3D Agent v2

> 全能桌面AI助手 — 管理文件、浏览网页、编辑文档、AI生图/视频、图片加工、自动化任务，120+内置操作，ReAct推理引擎，语义记忆，Tavily智能搜索，纯Python零依赖

[![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://python.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![零依赖](https://img.shields.io/badge/依赖-零-brightgreen.svg)](#)
[![操作数](https://img.shields.io/badge/内置操作-120+-blue.svg)](#)
[![模型支持](https://img.shields.io/badge/模型支持-9+-orange.svg)](#)
[![Tavily](https://img.shields.io/badge/搜索-Tavily-purple.svg)](https://tavily.com)

一个帮你管理文件夹、图片、视频等所有文件的AI智能体。系统做手脚（调度、执行），大模型做大脑（思考、决策）。你只需写JSON配置，不改代码，一切行为由配置驱动。

---

## 🧠 核心引擎

| 引擎 | 能力 |
|------|------|
| **ReAct推理引擎** | 状态机驱动的思考→行动→观察→校验→终止循环，Function Calling + 文本双模式智能降级，批量任务进度拦截（不让AI半途而废） |
| **模型直连器** | 纯HTTP直连，不依赖任何SDK，自定义请求模板适配任意API，密钥XOR+机器码加密存储，响应缓存+Token统计+流式输出 |
| **操作注册中心** | 120+内置操作统一注册调度，中英文别名映射，模糊匹配，调用统计与历史，依赖注入 |
| **存储引擎** | SQLite + FTS5全文搜索，对话记录结构化存储与检索 |
| **安全计算器** | AST安全求值，零eval注入风险 |
| **运行诊断器** | 运行错误自动记录，监控规则引擎（按模块/函数/异常类型/关键字匹配） |

## ⚡ 内置操作（120+）

### 🎨 AI生成（ComfyUI集成）
文生图、图生图、文生视频、图生视频、prompt反推、工作流提交/查询/管理、模型列表、队列控制、图片上传

### 🌐 浏览器自动化（Playwright）
打开网页、截图、点击元素、填写表单、滚动、返回/切标签页、页面内容/结构/元素读取、搜索页面、会话保存/加载（Cookie+localStorage持久化）、网页分析

### 📄 Office文档处理
Word读取/修改/创建/段落操作、Excel文本替换、docx带格式HTML预览（保留字体/颜色/粗体/表格）

### 📁 文件与系统
文件创建/读取/写入/追加/删除/替换/批量编辑、目录浏览、移动/复制、压缩/解压、回收站管理、打开程序、运行命令、截图、系统信息、数学计算

### 🎨 图片处理
去水印（涂抹遮罩+羽化混合）、去杂物、亮度对比度调整、裁剪、缩放、模糊、灰度化、旋转

### 🔍 代码与Git
正则搜索、Glob搜索、AST符号搜索、语法验证、Git状态/提交/回滚/差异/日志/分支、自动测试、构建验证

### 🌍 网络与媒体
网页抓取（Tavily Extract优先）、网络搜索（Tavily Search优先，返回正文摘要+相关度评分+AI总结答案）、网页分析（Tavily正文+LLM分析）、图片分析（LLM Vision）、下载网页图片、多线程下载、avi/wmv ffmpeg实时转码mp4、Range断点续传

### 🤖 任务编排
子代理（mini ReAct）、并行执行、Pipeline、Barrier、LoopUntilDry、Job创建/更新/列表/详情、后台执行

### 📋 其他
剧本录制/回放、知识库导入/搜索、对话导出、工具创建、TTS语音合成（edge-tts晓晓神经语音）、诊断监控、询问用户、股票预测

## 🧩 四层扩展体系

| 层级 | 方式 | 示例 |
|------|------|------|
| **声明式工具** | 写JSON即加工具 | 查天气、查IP、汇率查询、倒数日、计算器 |
| **插件** | 放Python文件到插件目录 | 示例插件 |
| **技能** | 放技能包到技能目录 | PDF编辑器（含SKILL.md+脚本） |
| **MCP服务** | 配置MCP服务端连接 | filesystem、github、sqlite |

## 🧠 记忆系统

- **三层语义召回**：标签匹配 → 关键词匹配 → LLM语义匹配
- **事件制存储**：每段对话归类为事件，frontmatter格式，`[[]]`交叉引用
- **自动摘要**：LLM自动生成事件摘要 + 用户画像更新
- **检查点续跑**：长任务中断后可从检查点恢复
- **反思评估器**：任务执行后自动反思，错误分类 + 自动恢复
- **经验师**：任务成功后自动提炼可复用经验文档，任务开始前召回匹配经验注入提示词

## 💬 对话模块

- **意图解析**：闲聊 / 任务执行 / 批量任务 / 查看文件 / 框选编辑
- **4种工作模式**：商量 / 执行 / 无人值守 / 规划
- **多对话管理**：新建/切换/删除/自动命名
- **上下文管理**：Token预算 + 历史压缩 + 记忆注入
- **流式输出**：SSE实时推送token
- **框选编辑**：框选文本直接让AI改写，自动区分Word/Excel/纯文本

## 🔧 支持的模型（9+）

纯HTTP直连，不绑定任何SDK：

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

## 🔄 双引擎研发流水线

```
工作引擎(实验) → 语法/JSON检测 → 自动备份 → 合并主引擎 → 可回滚
```

- 主引擎（公共区）：稳定发布版本，只接受合并
- 工作引擎（隐私区）：大模型实验开发，随便改
- 合并前自动检测：语法检查 + JSON完整性 + 配置校验
- 检测失败阻止合并，保留10个备份可一键回滚

## 🔒 安全与隐私

| 机制 | 说明 |
|------|------|
| **文件权限铁律** | 操作新文件夹弹窗询问，无权限绝对不动，3次后自动升级永久授权 |
| **隐私分区** | 公共区可发布，隐私区绝不外泄，一键打包自动扫描泄露 |
| **密钥加密** | XOR + 机器码加密存储，界面/日志全掩码 |
| **审计日志** | 所有文件操作记录：谁、何时、做了什么 |
| **API鉴权** | Bearer Token认证，localhost免鉴权 |

## 🖥 前端界面

纯HTML/CSS/JS，无框架依赖，内置：
- 对话（流式输出 + 多对话管理 + TTS语音）
- 文件管理（目录树 + 权限管理 + 审计日志）
- 代码编辑器（语法高亮 + KaTeX数学公式）
- 文档预览（PDF + docx + xlsx）
- 引擎管理（差异分析 + 合并 + 回滚）
- 配置编辑（全JSON表单化）
- LLM日志透明查看
- 图片/音频/视频播放

## 🚀 快速开始

### Windows 安装

```bash
git clone https://github.com/zf3dzf3dzf3d-ctrl/zf3d_agent.git
cd zf3d_agent
启动.bat
```

### Linux 安装（一键脚本）

```bash
# 方式1: clone后安装
git clone https://gitee.com/zf3d/zf3d_agent.git
cd zf3d_agent
bash install.sh

# 方式2: 解压便携包后安装
tar xzf zf3d_agent_v2.1.1_linux.tar.gz
cd zf3d_agent
bash install.sh
```

install.sh 自动完成：检查Python3 → 创建隐私区目录 → 初始化密钥模板 → 创建桌面快捷方式

### 配置密钥

```bash
cp 隐私区/我的配置/密钥_模板.json 隐私区/我的配置/密钥.json
```

编辑 `隐私区/我的配置/密钥.json`，填入你的API Key。也可启动后在 **设置 → 模型 → 工具密钥** 界面配置。

### 启动

```bash
# Windows
启动.bat

# Linux/Mac
bash 启动.sh

# 或命令行
python3 公共区/内核/启动器.py
```

浏览器打开 http://localhost:8765 即可使用。

## 📁 项目结构

```
zf3d_agent/
├── 公共区/                    🔵 公开区域，可发布可分享
│   ├── 内核/                  系统引擎（19个组件 + 操作/24个文件）
│   ├── 模块/                  对话(含经验师)/记忆/任务/浏览器
│   ├── 插件/                  可插拔扩展
│   ├── 技能/                  技能模块（如pdf-editor）
│   ├── 配置/                  全JSON配置（13个文件）
│   └── 界面/                  前端页面 + 编辑器 + 图片加工工具 + 去背景工具
├── 隐私区/                    🔴 隐私区域，绝不进发布包
│   ├── 我的配置/              密钥（加密）+ 模板
│   ├── 我的记忆/              记忆库/用户画像/摘要索引
│   ├── 我的数据/              用户个人数据
│   ├── 我的日志/              运行日志（含LLM原始记录）
│   ├── 对话记录/              对话历史
│   ├── 浏览器会话/            浏览器数据
│   ├── 我的工作引擎/          开发版引擎
│   ├── 我的经验/              经验师自动提炼的经验文档
│   ├── 我的剧本/              用户剧本
│   └── 我的知识库/            个人知识库
├── 引擎管理/                 双引擎调度与合并控制
├── tests/                    pytest测试（165+个用例）
├── public/core/              ASCII安全入口（bat兼容）
├── 发布打包.py                一键打包（隐私泄露扫描）
├── 打包linux.py              Linux tar.gz打包
├── install.sh                Linux一键安装脚本
├── 启动.bat / 启动.sh         启动脚本
├── 设计文档.md                完整设计文档（21章）
├── 帮助系统.md                开发者帮助参考
├── 说明.md                    用户使用说明
└── CHANGELOG.md               更新日志
```

## 🧪 测试

```bash
python -m pytest tests/ -v
```

覆盖：安全计算器、操作基类/注册中心、存储引擎、剧本管理器、配置加载器、文件管理器、知识库。

## 📦 发布打包

```bash
# Windows zip包
python 发布打包.py

# Linux tar.gz包
python 打包linux.py
```

自动扫描隐私泄露（API Key、邮箱、个人路径），只打包公共区，生成zip/tar.gz。

## 🇨🇳 全中文命名

函数、变量、文件夹、配置全中文，方便中国开发者阅读和维护。

## 📜 License

MIT License - 详见 [LICENSE](LICENSE)

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request
