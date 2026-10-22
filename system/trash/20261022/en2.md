
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
