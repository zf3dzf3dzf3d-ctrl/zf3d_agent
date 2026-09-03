# I Built an AI Agent Workspace That Runs 400+ Conversations at Once — No JS Frameworks, No Node Modules, Just Python

**Cross-post note:** This project is open source and free. If you like ambitious local-first tools, the repo links are at the bottom.

## The problem

Most AI chat apps share one limitation: they're built around a **single conversation**. If you want to run 10 tasks in parallel, you open 10 tabs, babysit each one, and copy-paste context between them.

I wanted something different: a workspace where the LLM is not a chat partner but a **team of workers on your computer**. So I built **Zhufeng Agent Unlimited (Infinity)** — a local-first AI agent workspace for Windows.

## What it is

One infinite canvas + one AI that actually gets things done. It doesn't just chat — it plans, acts, verifies, and repairs itself when it breaks things.

Highlights:

- **400+ simultaneous AI conversations.** Each conversation is an independent agent with its own model, tools, and context. Agents can delegate, monitor each other, and collect results.
- **83 built-in tools across 4 categories** (daily tasks, coding, writing, canvas) — read/write files, run code, fetch the web, Git commits, scheduled tasks, text-to-image, video generation.
- **Infinite canvas multi-agent graphs:** create nodes, wire dependencies, run them, fix broken nodes, lock finished ones. Think of it as a visual pipeline where each node is a full agent.
- **Self-healing:** when an agent hits an error, it re-reads the code, diagnoses the root cause, patches, and verifies. I watched it fix a real bug in its own frontend during testing.
- **Long plans:** tasks longer than one chat session get persisted as shareable plans, so a new conversation can pick up where the last one stopped.
- **Zero-dependency startup:** pure Python standard library server. Double-click to run, no `pip install`, no Node, no Docker.

## Why pure Python stdlib?

Because setup friction kills adoption. If a user has to install Node, run three commands, and configure an API key before seeing anything, most of them are gone. With Infinity you download a folder, double-click, and the browser opens.

The trade-off: no WebSocket frameworks, no async megastack. Instead there's a hand-rolled HTTP layer with keep-alive, a small routing system, and a frontend with zero build step — plain JS files, versioned with cache-busting query params. It's ~6MB of JavaScript with no bundler. Ugly? Maybe. It works, and anyone can read every line.

## The multi-agent canvas

The most interesting part is the node graph. You describe a goal, and the agent decomposes it into nodes on an infinite canvas — forward decomposition or backward reasoning from the goal. Each node:

1. Holds its own conversation and context
2. Can read results from upstream nodes
3. Writes conclusions into a **global context pool** other nodes can read
4. Can be locked ("fixed") when done, so later runs don't redo finished work

It's a different mental model from linear chat: you stop prompting and start **orchestrating**.

## Who is it for?

People who use AI for real work: batch file processing, codebase-wide refactors, content pipelines, research with many parallel threads. If your workflow involves more than 2 chat tabs, this is for you.

## Try it

| Channel | Link |
|---|---|
| 🏠 Intro & Download | https://www.zf3d.com/agent.asp |
| 🇨🇳 Gitee (fast in China) | https://gitee.com/zf3d/zf3d_agent |
| 🌍 GitHub (Mirror) | https://github.com/zf3dzf3dzf3d-ctrl/zf3d_agent |

MIT licensed, free forever.

---

**Tags:** `ai`, `agents`, `python`, `opensource`, `llm`, `productivity`, `showdev`, `devtools`

**封面图建议：** 用 docs/images/1.jpg（界面截图），Dev.to 发布时上传本地图片即可。
