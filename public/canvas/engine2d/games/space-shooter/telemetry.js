// telemetry.js — 玩法埋点采集 v0.1（规范见 docs/ai-generation-spec.md 第4节）
"use strict";
const Telemetry = {
  game: "space-shooter",
  session: Math.random().toString(36).slice(2, 8),
  data: null,
  begin() {
    this.data = { game: this.game, session: this.session, start: Date.now(),
      duration_sec: 0, score: 0, deaths: 0, max_progress: "wave-1", events: [] };
  },
  event(type, extra = {}) {
    if (!this.data) return;
    this.data.events.push(Object.assign({ t: +(performance.now() / 1000).toFixed(1), type }, extra));
    if (this.data.events.length > 500) this.data.events.shift();
  },
  end(status) {
    if (!this.data) return;
    this.data.duration_sec = +((Date.now() - this.data.start) / 1000).toFixed(1);
    this.data.status = status;
    try {
      const list = JSON.parse(localStorage.getItem("telemetry_" + this.game) || "[]");
      list.push(this.data); while (list.length > 20) list.shift();
      localStorage.setItem("telemetry_" + this.game, JSON.stringify(list));
    } catch (e) {}
    console.log("[telemetry]", JSON.stringify(this.data));
  },
  // 验证脚本读取入口
  last() {
    try { return JSON.parse(localStorage.getItem("telemetry_" + this.game) || "[]").slice(-1)[0] || null; }
    catch (e) { return null; }
  }
};
