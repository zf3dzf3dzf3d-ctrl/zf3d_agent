<!-- Language: 中文 | [English](#zf3d-agent-infinite--introduction) -->

# 朱峰智能体无限 —— 介绍

## 这是什么

智能体平铺在无限画布工作台上，多角色协作、多轮迭代，高完成度同时完成多个任务。允许同时跑几十个窗口保持通畅。

普通智能体是单兵作战，我们是**多角色集团作战**。

平均每日几百个对话任务。效率高、不卡顿，用户有想法立刻开做，不需要等待窗口计算。


![智能体界面 5.6.0](https://img.zf3d.com/agent/screenshots/%E6%99%BA%E8%83%BD%E4%BD%93%E7%95%8C%E9%9D%A2_5.6.0.jpg)
## 多角色流水线

- **多策划师**：把你的一个目标，通过多个窗口策划，发散到多角度，再多轮策划，让一个任务更加完整可靠。
- **多审核员**：多轮审核，可以把任务完成度从最开始的不足 60 分，经过多轮审核，达到 90 分以上再通过。
- **总结师**：让每个任务不丢失工作内容积累，长期积累下来，让你的每一个想法不丢失，并记住每一次修改的过程。

用户的问题，通过**多策划 → 多角色开工（可选）→ 自检（自我反驳）→ 多审核 → 总结师总结**，完成一整个流程。

在这个无限画布里，你可以同时开十几个问题，配合多策划师、审核师，窗口维持在三十几个，不会冲突和卡顿，网络通畅。

## 精妙的设计

### 车道系统（chat_gate v4）
帮你疏通多会话的通行问题。每一条"车道"是一个独立的发送通道，管理每个大模型的通信：
- 自动选道、按需扩缩容，几十个会话同时跑也不会卡顿；
- AIMD 自适应调节（像网络拥塞控制一样，慢启动、遇阻退让、恢复加速）；
- 优先级调度 + 网络退避，单个渠道被限流时自动换道，拒绝的请求可强制恢复；
- 全程监控记录，随时查看每条车道的实时快照。

![风筝和车道统计 5.6.0](https://img.zf3d.com/agent/screenshots/%E9%A3%8E%E7%AD%9D%E5%92%8C%E8%BD%A6%E9%81%93%E7%BB%9F%E8%AE%A1_5.6.0.jpg)

### 对话池系统（chat_pool）
随时保持和大模型的握手。请求的所有权在服务器手里：
- 槽位化托管：每个对话框在池中占一个常驻槽位，可擦除、可复用；
- 断点续读：回复事件先落槽缓冲，浏览器断线后带游标重连照收，对话和对话切换不需要重新读取；
- 请求幂等：Wi-Fi 瞬断重发不会重复计费；
- 内置连接池复用，减少重复握手开销。

### 守护系统（watchdog + supervisor）
多层守护，全程无人值守.

### 蜂群调度（dispatch_swarm）
任务像蜂群一样分发到各窗口协同执行，支持大规模窗口并发与断点续跑。

## 简洁的对话，避免冗余

用户的提问、AI 的回答、中途的 AI 回复——你看到的是最简洁的界面，里面没有复杂的工具内容。

## 操作简单

一个问题，点几下审核、策划箭头，人不需要输入任何中途文字，就能把问题完成得非常完美——事实上，比人类自己考虑的周全得多。

## 无限画布的优势

- 一个问题只要不关闭，就永远不会丢；随手标题让你记住它是什么。
- 各种对话窗口随时搜索查找；缩小整理模式让你看清全局并快速整理。
- 框选加审核、加策划、框选关闭，让工作超级快速。
- 画布上不止对话：浏览器、3D 引擎、视频、PPT 节点都是对话工作台一员。
- 小地图 + 一键整理排版 + 命令面板，窗口再多也井井有条。

## 用朱峰智能体能做出什么

如果平时你用智能体单个对话、多轮对话完成任务——

那么尝试朱峰智能体，你可以：
- 快速获取多策划师增加思路、多审核师对项目的多次审核，让方案彻底没有漏洞；
- 平时一个 bug 可能要修改很久的问题，在朱峰智能体里针对它点击几次审核，就解决了。

## 手机版

不止电脑，手机也能用。朱峰智能体无限支持手机端访问：
- 双系统,手机智能体+遥控桌面智能体
- 手机浏览器打开遥控,电脑版界面自动适配小屏幕，布局为竖屏优化；
- 对话池 + 断点续读加持：路上 Wi-Fi/信号切换也不怕，回复不丢、不重复计费；
- 电脑上发起的多角色任务，手机上随时查看进度、收结果，人不在电脑前任务照跑；
- 走到哪，画布上的想法跟到哪，随时随地下任务、看回复。

## 🌱 在研方向：能力进化树（我们的下一步）

> 说明：以下为正在研发的新能力，设计已定稿、尚未完全实装，实装后会随版本更新正式启用。

现在的工作台记住的是"你说了什么、AI 答了什么"。我们正在做的，是让它进一步看见"你做到了什么、长出了什么能力"。

普通 AI 助手是**记忆型**的——它忠实记录你提过的每个问题、每段对话（Karpathy 式的"上下文笔记"），但记录越厚，越像流水账，离"你这个人究竟会什么"反而越远。

我们做的是**涌现型**的——它不从"你说了什么"出发，而是从你反复**真实完成的任务**里，自动结晶出你具备的能力：

- AI 执行任务时，自动识别"这一步用了什么能力"，提议把它长到一棵能力树上；
- 你确认，它就在树上扎根、长大、变清晰；你不理它，它会自然衰减、淡去；
- 最终呈现的不是一堆聊天记录，而是一棵**从你真实行为里长出来的能力进化树**。

一句话：**不是记你说了什么，是长你做到了什么。**

这套"从实际行为自动结晶能力 → 人确认 → 自然遗忘"的闭环，目前在开源生态里没有完全对标的产品——做记忆图谱的工程师不做"自我认知"，做能力树的工具靠手动录入而非自动涌现。我们希望补上这个交集。

它的意义不在"每个人都必须用"，而在于：当一个人希望长期看清自己的成长轨迹、而不是被聊天记录淹没时，这是目前几乎独有的解法。

## 我们的追求

我们一直在研究更先进的智能体，我们不对标任何智能体。我们追求的是把用户的所有问题快速解决，我们争取做到让每个人的任务都成功实现。


---

<!-- English version below -->

# ZF3D Agent Infinite - Introduction

## What Is It

Agents are laid out flat on an infinite canvas workbench: multi-role collaboration, multi-round iteration, and high completion across many simultaneous tasks. Dozens of windows can run at the same time without lag.

Ordinary agents work alone; we operate as a **multi-role task force**.

Hundreds of conversation tasks per day on average. Efficient, smooth - the moment you have an idea, you start working; no waiting for the window to compute.

## Multi-Role Pipeline

- **Multiple Planners**: Your single goal is brainstormed across multiple windows, diverging into many angles, then refined over multiple rounds to make the task more complete and reliable.
- **Multiple Reviewers**: Multi-round review can lift task completion from under 60 points at the start to 90+ points before it passes.
- **Summarizer**: Every task preserves its accumulated work. Over time, none of your ideas get lost, and every modification process is remembered.

A user question goes through **Multi-Planning > Multi-Role Kickoff (optional) > Self-Check (self-refutation) > Multi-Review > Summarizer Wrap-up**, completing one full workflow.

On this infinite canvas, you can have a dozen questions open at once. With planners and reviewers, you can keep thirty-plus windows running - no conflicts, no lag, network stays smooth.

## Elegant Design

### Lane System (chat_gate v4)
Untangles multi-session traffic. Each lane is an independent send channel managing communication with each LLM:
- Automatic lane selection and on-demand scaling - dozens of concurrent sessions without stutter;
- AIMD adaptive control (like network congestion control: slow start, back off on blockage, speed up on recovery);
- Priority scheduling + network backoff; auto lane switch when one channel is rate-limited; rejected requests can be force-recovered;
- Full monitoring, with real-time snapshots of every lane available at any time.

### Conversation Pool (chat_pool)
Keeps a persistent handshake with the LLM. Request ownership lives on the server:
- Slot-based hosting: each conversation occupies a resident slot in the pool - erasable and reusable;
- Resumable streaming: reply events buffer into slot storage first; after a browser disconnect, reconnect with a cursor and pick up right where you left off - no re-reads when switching conversations;
- Idempotent requests: a brief Wi-Fi drop and resend will not cause double billing;
- Built-in connection pool reuse reduces repeated handshake overhead.

### Guardian System (watchdog + supervisor)
Multiple layers of guardianship, fully unattended operation.

### Swarm Dispatch (dispatch_swarm)
Tasks are distributed like a swarm across windows for coordinated execution, supporting large-scale window concurrency and resumable runs.

## Clean Conversations, No Clutter

Your questions, the AI answers, and intermediate replies - you see the cleanest possible interface, free of complex tooling content.

## Simple to Operate

One question, a few clicks on the review and planning arrows - no intermediate typing required - and the question gets completed beautifully. In fact, far more thoroughly than most humans would consider.

## Advantages of the Infinite Canvas

- A question never disappears as long as it stays open; quick titles help you remember what it is.
- Search any conversation window at any time; the zoomed-out organizing mode lets you see the big picture and tidy up fast.
- Box-select to add reviewers, add planners, or close windows - super fast workflow.
- The canvas is not just chat: browser, 3D engine, video, and PPT nodes are all part of the conversation workbench.
- Mini-map + one-click auto-layout + command palette - stay organized no matter how many windows you have.

## What You Can Build with ZF3D Agent

If you normally complete tasks with a single-agent, multi-turn conversation -

Try ZF3D Agent and you can:
- Quickly add multiple planners for more ideas and multiple reviewers for repeated reviews, leaving your plan airtight;
- A bug that used to take forever to fix? Click review on it a few times in ZF3D Agent and it is solved.

## Mobile Version

Not just for desktops - it works on phones too. ZF3D Agent Infinite supports mobile access:
- Dual systems: mobile agent + remote-desktop agent;
- Open the remote control in a phone browser; the desktop UI auto-adapts to small screens with a portrait-optimized layout;
- Conversation pool + resumable streaming: switching Wi-Fi or signal on the go is fine - replies are not lost and are not double-billed;
- Multi-role tasks started on your PC can be checked on your phone anytime for progress and results - tasks keep running while you are away;
- Take your canvas ideas anywhere - dispatch tasks and read replies whenever, wherever.

## In Development: Capability Evolution Tree (Our Next Step)

> Note: The following is a capability currently in development. The design is finalized but not yet fully implemented; it will ship officially in a future version.

Today workbench remembers what you said and what the AI answered. What we are building makes it see what you actually accomplished and what capabilities you grew.

Ordinary AI assistants are **memory-based** - they faithfully record every question and every conversation you have had (Karpathy-style context notes). But the thicker the record, the more it reads like a running log, and the further it drifts from what this person can actually do.

What we are building is **emergence-based** - it does not start from what you said, but automatically crystallizes your capabilities from the tasks you repeatedly and genuinely complete:

- While the AI executes a task, it identifies which capability this step used and proposes growing it onto a capability tree;
- You confirm it - it takes root, grows, and becomes clearer; ignore it - it naturally decays and fades;
- What you end up with is not a pile of chat logs, but a **capability evolution tree grown from your real behavior**.

In one sentence: **We do not record what you said - we grow what you did.**

This closed loop - automatically crystallize capabilities from real behavior, human confirmation, natural forgetting - has no fully comparable product in the open-source ecosystem today: engineers building memory graphs do not do self-cognition, and capability-tree tools rely on manual entry rather than automatic emergence. We aim to fill that intersection.

Its significance is not that everyone must use it, but rather: when someone wants to see their growth trajectory clearly over the long term - instead of drowning in chat logs - this is currently one of the few solutions available.

## Our Pursuit

We keep researching more advanced agents, and we benchmark against no one. We pursue rapidly solving every user problem, and we strive to make every user task succeed.
