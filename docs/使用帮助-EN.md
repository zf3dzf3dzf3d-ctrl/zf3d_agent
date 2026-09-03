# Zhufeng Community Agent Unlimited (Infinity) 5.0.8 · Full Feature Help

> This document covers all current features of the software, written after a feature-by-feature code review (~150 frontend modules in public/js, server/ route Mixins and six engines, the three toolkits in tool/, extensions/, plugin modes in modes/, and archived notes in 项目记录/).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Startup & Quick Start](#2-startup--quick-start)
3. [Infinite Canvas Workbench](#3-infinite-canvas-workbench)
4. [Chat Boxes & Chat System](#4-chat-boxes--chat-system)
5. [Agent Execution Engine (Three Modes)](#5-agent-execution-engine-three-modes)
6. [Six Built-in Engines](#6-six-built-in-engines)
7. [Three Toolkits (83 Tools)](#7-three-toolkits-83-tools)
8. [Divergent-Convergent Multi-Perspective Chat](#8-divergent-convergent-multi-perspective-chat)
9. [Long Plan System](#9-long-plan-system)
10. [Dog Guard + Guard Ledger](#10-dog-guard--guard-ledger)
11. [Health Guard v2 (Sedentary Reminder)](#11-health-guard-v2-sedentary-reminder)
12. [Voice Feature Suite](#12-voice-feature-suite)
13. [AI Multimodal (Text-to-Image / Video / TTS / Pixel Animation)](#13-ai-multimodal)
14. [Chat Modes (Plugin Modes) & Model Config Agent](#14-chat-modes--model-config-agent)
15. [Extension Ecosystem (MCP / Skills / Declarative UI)](#15-extension-ecosystem)
16. [Project / File / Memory Systems](#16-project--file--memory-systems)
17. [Panels & Settings Center](#17-panels--settings-center)
18. [UI Personalization & Accessibility](#18-ui-personalization--accessibility)
19. [Security & Privacy](#19-security--privacy)
20. [Data Backup & Restore](#20-data-backup--restore)
21. [Desktop Helper Programs (Standalone Server Components)](#21-desktop-helper-programs)
22. [Directory Structure Quick Reference](#22-directory-structure-quick-reference)
23. [FAQ](#23-faq)

---

## 1. Overview

**Zhufeng Community Agent Unlimited (Infinity)** is a locally running AI agent workbench built around an "infinite canvas" that lays multi-turn chats, tool calls, text-to-image, video generation, and task management all on the same canvas. Core traits:

- **Truly autonomous execution**: the AI breaks your request into steps, calls tools one by one, verifies proactively, and reports "Task complete" when done.
- **Multi-chat in parallel**: give different tasks to multiple chat boxes at once.
- **Data stays local**: everything runs locally; API keys live in private/ and never leave your machine.
- **Zero-setup**: ships with a bundled Python 3.11 runtime — unzip and run.
- **Self-protection**: Health Guard + Dog Guard double safety net; failed tasks are auto-revived and stalls trigger intervention.

---

## 2. Startup & Quick Start

1. Download and unzip anywhere (Windows 10/11 64-bit; a Linux/start.sh startup script and instructions are also provided).
2. Double-click the start .bat (no Python installation needed).
3. Configure models / APIs as prompted and start chatting.

> Make sure the program directory has read/write permission on first run. Version number is in private/version.json.

---

## 3. Infinite Canvas Workbench

### 3.1 Canvas Basics
- **Free pan / zoom**: drag and scale the canvas freely (app-canvas.js).
- **Double-click create**: double-click empty canvas to open the creation panel — new chat / image / video / prompt panels, etc.
- **Right-click quick create**: right-click empty canvas for a "quick-create bar" (with send / voice input) that reuses all your last settings.
- **Tab quick create**: press Tab anywhere for a minimal create bar — start and send a new chat in one step.
- **Minimap** (app-minimap.js): thumbnail in the bottom-right corner for navigating large canvases.
- **Undo** (app-undo.js): canvas actions are undoable/redoable (including chat history restore).
- **Background effects** (background.js, space-meteors.js): canvas background effects (e.g. meteors) with separately persisted settings.
- **Click effects** (server click_effect.py): mouse click feedback.

### 3.2 Kite Node System
- **Kite nodes & links** (app-kite-core/links/nodes/panels.js): nodes shown as kites on the canvas, linked together (including port links, app-kiteportlink.js).
- **Kite vision** (app-kite-vision.js): vision capabilities.
- **Kite Voice Chat**: click the kite head (single click, not drag) to open a dedicated voice chat window (kite-voice-chat.js) — pure voice one-on-one: you speak, it listens; when the AI finishes it listens again, like a phone call.
- **Kite head drag**: drag to reposition the anchor without disturbing the voice panel.

### 3.3 Media Nodes
- **Image node / viewer** (app-imagenode.js, app-imageviewer.js, image-node.js): view and zoom images on canvas.
- **Media drag** (app-mediadrag.js): drag media files onto the canvas.
- **Media node** (app-medianode-x.js): video and other media nodes.
- **Channel panel** (panel-image-channels.js): image channel management.

---

## 4. Chat Boxes & Chat System

- **Multi-chat management** (app-chatmgr.js, app-chatbox-projects.js): many chat nodes on one canvas, each with its own task.
- **Chat interaction** (chatbox-03-chat-interaction.js): sending and streaming reply rendering (Markdown + code highlight + Mermaid diagrams), fully async with no lag.
- **Model selector** (chatbox-01-model-selector.js): pick a different model per chat.
- **Send status** (agent-00-send-status.js): sending / done status; chats stopped mid-run can still continue sending.
- **Success arrow & result jump** (chatbox-02-success-arrow.js): when done, shows "View success N" / "View verification result" buttons that fly the camera to the answer on canvas.
- **Message sanitizing** (agent-02b/02c): auto-cleans fake tool tags and other abnormal output.
- **Paste-as-card**: large pastes (>80 chars or containing newlines) become small removable cards; the AI can distinguish typed text from pasted content.
- **Ask User** (agent-04-ask-user.js): the AI can ask you questions (single-line / form mode) and pause for your answer.
- **Task list panel** (app-taskpanel.js): live progress display of the AI's task list.
- **Toasts** (chatbox-00-toast.js, toast-stack.js): global lightweight notifications.

---

## 5. Agent Execution Engine (Three Modes)

Each chat can choose an execution mode (agent-02-loop-core.js loop core + mode picker):

| Mode | Description |
|---|---|
| Direct chat | Pure conversation, no tools |
| Tool loop | AI may call tools before answering |
| Autonomous loop | Fully autonomous: break into steps, execute, verify, report — until the task is done |

Supporting capabilities:
- **Tool result management** (agent-03-tool-results.js): result card rendering, archiving and retrieval of oversized results.
- **Reasoning levels** (reasoning-levels.js): adjustable model thinking depth.
- **Project memory** (agent-01-project-memory.js): chats auto-record working memory, recalled across turns.
- **Error handling** (agent-errors.js): retry and hints on failure.
- **Chat mode memory**: the currently selected mode becomes the default for next time.

---

## 6. Six Built-in Engines

The server ships with six pluggable engine styles (server/engines/), each with its own toolset:

| Engine | Style / Tools |
|---|---|
| Claude Code style | Read / Write / Edit / Bash etc. |
| Codex style | codex_* tool family |
| DeepSeek direct | ds_* tool family |
| Hermes style | hermes tool family |
| OpenClaw style | openclaw tool family |
| Pi style | pi tool family |

- All engine toolsets fully re-tested with correct schemas; a lost registry falls back to an empty one with a warning.
- Tool injection works in both cloud and local modes (import path issue fixed).
- See server/engines/how-to-add-agent.md for adding new engines.

---

## 7. Three Toolkits (83 Tools)

Tool definitions are split across files (tools-defs-*.js frontend + tool/ server implementations), switched by category (tools-00-category-state.js, tools-02-category-switch.js):

| Toolkit | Count | Main abilities |
|---|---|---|
| Minimal | 16 | Read/write files, run commands, directory search, task lists, ask-user, etc. |
| Coding | 27 | Git commits, scheduled tasks, monitoring queues, database read/write, canvas positioning, long plans (create/update/claim/report/handoff), etc. |
| Writing | 40 | Polishing, summarization, sensitivity checks, SEO optimization, multi-role review, etc. |

- **Execution chain**: tools-04-execute.js + tools-05-execute-api.js call the server; tools-06-card-render.js renders results as cards.
- **System prompt injection** (tools-03-system-prompt.js): per-toolkit instructions injected automatically.
- **Tool stats** (project-toolstats.js): per-chat tool call counts.
- **Video generation engine** (tool/video_gen_engine.py, tools/): server-side video generation.

---

## 8. Divergent-Convergent Multi-Perspective Chat

(diverge.js, see the archived project note)

- Send out a squad of AIs in one sentence: engineer, designer, programmer and other **perspectives** (2–6, customizable) each speak.
- Built-in presets: **Project Development / SWOT / Brainstorm**.
- Sub-chats appear on canvas with live animated links showing each viewpoint.
- **One-click convergence**: summaries merge back into the parent chat; loop "diverge then converge" to approach the best solution.

---

## 9. Long Plan System

(app-longplan-panel.js + toolset tools-defs-longplan.js, persisted in the project-record folder)

For large tasks of 5+ steps:

- The AI automatically **breaks a big task into batches of steps** and creates a plan file (goal / steps / deliverables / acceptance criteria).
- **Batched execution**: claim, execute, per-step report, handoff — preventing context overflow.
- **Cross-chat continuation**: close the software and come back tomorrow; a new chat resumes seamlessly (progress overview + next pending steps).
- Plan panel visualizes progress and execution logs.

---

## 10. Dog Guard + Guard Ledger

(app-dog-guard.js, dog avatar tied to the theme)

- **All-day patrol**: automatically checks all chats on a schedule.
- **Auto-revive**: when a task fails outright, it injects fix guidance so it can continue.
- **Stall intervention**: on run timeouts / tool-call stalls (suspected dead loops), pauses and injects a plan.
- **Idle patrol**: idle chats get routine checks, all logged.
- **Guard Ledger**: everything the guard does (revivals, patrols, intervention reasons, times) is recorded and always viewable.
- **Integration**: guard supports voice input and session-theme linkage.

---

## 11. Health Guard v2 (Sedentary Reminder)

(app-health.js + server config)

- **Sedentary reminders**: reminds you to rest after long continuous work.
- **Forced break lock**: locks the screen at break time.
- **Only counts "you're present" time**: pauses when it detects you're away, resumes after the break — smarter than a Pomodoro timer.
- **Monitoring dashboard** (app-monitor.js, panel-log-health.js): system status and log health visualization.

---

## 12. Voice Feature Suite

| Feature | Description |
|---|---|
| Voice input | Mic buttons in every chat window (chats, butler, guard, Kite voice chat); speech-to-text (voice-input.js) |
| Voice auto-send | Say "send / submit" after your message to auto-submit without misfires |
| Kite voice chat | Click the kite head for a voice window: Web Speech continuous recognition + Edge TTS replies, auto re-listening after each answer |
| TTS read-aloud | Edge online voices read AI replies aloud (tts.js + server tts_engine.py) |
| Audio recording | Server audio_recorder.py, audio resources, audio/video plugin support |

---

## 13. AI Multimodal

- **Text-to-image**: agent-02a-imagegen-direct.js direct generation; images land on canvas image nodes.
- **Video generation**: server-side video engine (tool/video_gen_engine.py, tools/), played in media nodes.
- **TTS voice engine**: see previous section.
- **Pixel animation** (pixel-display.js, pixel-panel.js + server mixin_pixel.py): pixel animation display and GIF export.
- **RAG knowledge base** (server/rag_engine.py, rag_api.py, kb.db): local knowledge retrieval to enhance answers.

---

## 14. Chat Modes & Model Config Agent

- **Plugin mode system** (modes/ + mode_loader.py + mode_panel_loader.js): extensible chat modes with a _template starter; currently includes **config_agent (Model Config Butler)**:
  - Add/edit/remove model configs conversationally, look up upstream model lists online, panels sync in real time after changes.
  - Route dropdowns, collapsible tools, theme adaptation.
- **Model config management** (panel-models.js, models.js, model-config-rewrite.js + server mixin_models.py, model_config.py): multi-model multi-route configs, prompt generation, masked-key restore.
- **Chat mode rules** (chat_mode_rules.py): per-mode system rule injection.

---

## 15. Extension Ecosystem

(extensions/)

- **MCP protocol integration** (mcp.py): a full **Model Context Protocol client gateway**. External MCP server configs live in `private/extensions/mcp_servers.json`; supports both **HTTP(SSE) and stdio** transports; implements initialize / tools/list / tools/call over JSON-RPC 2.0; external MCP tools are auto-converted into OpenAI function calling schemas for the main agent. API: `GET /api/ext/mcp/tools`, `POST /api/ext/mcp/call`. Standalone file design — can be removed without affecting the core.
- **Skills system** (skills.py, skills/): installable skill packs that inject capability prompts into the AI.
- **Declarative UI** (declarative_ui.py): extensions can declare their own interfaces.
- **Extension manager panel** (ext-manager.js, ext-settings-panel.js, ext-ui-render.js): enable/disable and settings.
- **Frontend bridge** (ext-bridge.js): async communication between extensions and the main app (fully async, doesn't block sending).
- **Plugin mode system** (modes/ + mode_loader.py + mode_panel_loader.js): extensible chat-mode plugins with a `_template` scaffold for writing new plugin modes (built-in: config_agent Model Config Butler).
- **Plugins** (plugins/audio-video-plugin): audio/video processing.
- **Office preview** (tools/office-viewer): PPT and other Office file preview (standalone module).

---

## 16. Project / File / Memory Systems

- **Project switcher** (project-switcher.js): multi-project switching; the current project is injected as context.
- **Project folder** (project-folder.js + server mixin_project.py): project file read/write and filesystem ops.
- **File tree** (app-filetree.js): side file tree browsing (first-project display bug fixed).
- **Project sessions** (project-sessions.js): session management within a project.
- **Project sync** (project-sync.js): project data syncing.
- **Project memory**: see section 5.
- **Project record system**: every feature and fix is auto-archived as Markdown notes (bugfix-/feature- series + worklogs) — the software's "medical chart".
- **Project log panel** (project-logpanel.js).
- **Upload** (app-upload.js): upload files into a project.
- **Update check** (app-update.js, app-version.js, tool/check_release.py): version check and updates.

---

## 17. Panels & Settings Center

(app-panels.js and panel-* modules + server mixin_settings.py)

- **Settings panel** (panel-settings.js, user-settings.js, settings-rewrite.js): JSON read/write for various configs (health guard / loop modes / user settings, etc.).
- **Models panel** (panel-models.js).
- **Mail panel** (panel-mail.js).
- **Tools settings** (tools-settings.js): tool toggles and categories.
- **User info** (app-userinfo.js).
- **Panel copy** (panel-copy.js): copy panel contents.
- **Backup panel** (app-backup.js): see section 20.
- **ZF3D panel** (app-zf3d.js + server mixin_zf3d.py): community integration.

---

## 18. UI Personalization & Accessibility

- **Theme system** (theme.js): multiple themes (incl. guard-theme linkage).
- **Bilingual UI (EN/CN)** (i18n.js): 1000+ entries fully covered, one-click language switch.
- **Hot reload** (hot-reload.js + server mixin_hotreload.py, hot_reload.py): frontend/server modules take effect on save, no restart; hot-reload status view and manual reload.
- **Lazy loading** (lazy-loader.js): scripts lazy-loaded in order for faster startup.
- **UI proxy** (server/mixin_proxy.py): API proxy for third-party AI services, streaming SSE, system prompt injection.
- **API security** (server/security.py, _scan_auth*): auth and security scanning.

---

## 19. Security & Privacy

- All data stays local; no privacy content is uploaded.
- API keys and sensitive configs live in private/, excluded from Git.
- **Settings export / import**: one-click migration; "privacy zone" export is controllable; **exports never contain API keys**.
- High-risk operations (file deletion, system config changes) require manual confirmation (Ask User mechanism).

---

## 20. Data Backup & Restore

(app-backup.js + server mixin_backup.py)

- **Zip snapshot backup**: one-click project snapshots.
- **Restore / delete**: restore or delete from snapshots.
- File-modifying tools auto-create timestamped .bak backups so mistakes can be rolled back.

---

## 21. Desktop Helper Programs

A set of standalone desktop components shipped with the server (server/*.py, incl. tray / quick entries):

| Component | Function |
|---|---|
| quick_launcher.py + config | Quick launcher |
| quick_wheel.py | Quick wheel menu |
| global_hotkey.py | Global hotkeys |
| screenshot_capture.py | Screenshot capture |
| area_selector.py | Area selection |
| screen_recorder.py | Screen recording |
| desktop_chat.py | Desktop chat floating window |
| audio_recorder.py | Audio recording |
| drag_listener.pyw + start/stop scripts | Drag listener (one-click on/off) |
| watchdog.py, zf3d_heartbeat.py, monitor_watch.js | Watchdog and heartbeat monitoring |
| zf3d.ico | Program icon |

---

## 22. Directory Structure Quick Reference

```
ZhufengAgentUnlimited_5.0.8/
├── server/      # App server (HTTP route Mixin, six engines, RAG/TTS, hot reload, desktop components)
├── public/      # Frontend (infinite canvas, diverge-converge, dog guard, long-plan panel, voice)
├── python/      # Bundled Python 3.11 runtime
├── tool/        # Three toolkits (minimal / coding / writing) + video generation engine
├── tools/       # Video generation engine, Office preview
├── plugins/     # Audio/video plugin
├── extensions/  # MCP, skills, declarative UI
├── modes/       # Plugin modes (config_agent)
├── scripts/     # Release & script generation tools
├── tests/       # Tests
├── demo/        # Demo
├── docs/        # Docs & history
├── private/     # Private configs (API keys, not committed)
├── Linux/       # Linux startup script and instructions
└── ProjectRecords/  # Auto-archived feature & fix notes
```

---

## 23. FAQ

**Q: How do I start?**
Unzip, double-click the start .bat, configure model API, then double-click empty canvas (or right-click / press Tab) to create your first chat.

**Q: Sending feels laggy?**
The old synchronous-request blocking is fully fixed; hard-refresh the browser with Ctrl+F5.

**Q: Task too big to finish?**
Just hand it over — it auto-creates a "Long Plan" and executes in batches; close the software and a new chat continues seamlessly tomorrow.

**Q: Chat frozen?**
Dog Guard auto-revives it (on stall timeouts it pauses and injects fix guidance to continue); check the "Guard Ledger" to see what it did.

**Q: Migrating to a new computer?**
Use "Settings export / import"; the privacy zone is controllable and API keys are never exported — configure them separately.

**Q: Will the AI delete my files?**
High-risk operations like deletion and system config changes require your confirmation; file modifications also keep automatic .bak backups, and canvas actions support Undo.

**Q: What must be done before releasing a new version?**
⚠️ Read and execute the release checklist at `private/用户设置/release_checklist.json` first. Key items: 1) clear the pinned projects (ft_pins) — pinned paths are personal state and must be emptied (`ft_pins: []` in user_settings.json); 2) clean personal data in private/ (empty api_keys.json, remove db/, server.pid, worklog.json, backups/); 3) confirm version.json and port.json are updated.

---

---
