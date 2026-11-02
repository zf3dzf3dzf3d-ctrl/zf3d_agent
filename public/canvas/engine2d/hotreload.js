// hotreload.js — 脚本/热重载调试：游戏脚本以文件挂载，SSE 推送变更，运行中游戏免刷新热替换
// 服务端配合：engine2d/server.py 增加 /api/hotreload/stream（watch 脚本目录 mtime 变化）
"use strict";
class HotReloader {
  constructor({ endpoint = "/api/hotreload/stream", onReload } = {}) {
    this.endpoint = endpoint;
    this.onReload = onReload || (() => {});
    this.registry = new Map();   // name -> {fn, version}
    this.es = null;
  }
  // 注册脚本模块：游戏逻辑写成 function(exports){...}，热替换时重跑
  register(name, fn) { this.registry.set(name, { fn, version: 0 }); return this; }
  get(name) { const r = this.registry.get(name); if (!r) throw new Error("未注册脚本: " + name); return r; }
  // 重载某脚本：编译新代码（new Function 沙箱），成功则替换并触发 onReload
  reload(name, code) {
    const r = this.get(name);
    let fn;
    try { fn = new Function("exports", "engine", code + "\n//# sourceURL=hot/" + name + ".js"); }
    catch (e) { return { ok: false, error: "编译失败: " + e.message }; }   // 编译失败不影响运行中的旧代码
    try { fn({}, (typeof window !== "undefined" && window.__ENGINE__) || null); }
    catch (e) { return { ok: false, error: "执行失败: " + e.message }; }
    r.fn = fn; r.version++;
    this.onReload(name, r.version);
    return { ok: true, version: r.version };
  }
  // 监听服务端文件变化（SSE: data: {"file":"scripts/enemy.js"}）
  watch() {
    if (typeof EventSource === "undefined") return false;
    this.es = new EventSource(this.endpoint);
    this.es.onmessage = ev => {
      try { const d = JSON.parse(ev.data); if (d.file && d.code !== undefined) this.reload(d.file, d.code); }
      catch (e) { console.warn("[hotreload] 消息解析失败", e); }
    };
    return true;
  }
  unwatch() { if (this.es) { this.es.close(); this.es = null; } }
  list() { return [...this.registry.entries()].map(([n, r]) => ({ name: n, version: r.version })); }
}
if (typeof module !== "undefined") module.exports = { HotReloader };
