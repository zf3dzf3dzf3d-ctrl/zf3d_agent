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
