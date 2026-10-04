// ui.js — UI 模块 v1.0：HUD/面板/按钮（DOM 实现，零依赖，样式内联可覆盖）
"use strict";
class UIManager {
  constructor(parent = document.body) {
    this.root = document.createElement("div");
    Object.assign(this.root.style, { position: "fixed", left: "0", top: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: 100, fontFamily: "monospace" });
    parent.appendChild(this.root);
    this.widgets = [];
  }

  // ---- HUD 文本：hud.set("score", "分数: 10")，垂直排列左上角 ----
  hud(id, x = 10, y = 10) {
    const el = document.createElement("div");
    Object.assign(el.style, { position: "absolute", left: x + "px", top: y + "px", color: "#fff", textShadow: "0 0 4px #000, 1px 1px 0 #000", fontSize: "14px", whiteSpace: "pre", pointerEvents: "none" });
    this.root.appendChild(el);
    const w = { id, el, lines: {} };
    this.widgets.push(w);
    return {
      set(key, text) { w.lines[key] = text; el.textContent = Object.values(w.lines).join("\n"); },
      clear() { w.lines = {}; el.textContent = ""; },
    };
  }

  // ---- 面板：居中/指定位置的容器，返回面板 el（可往里塞内容）----
  panel({ x, y, w = 320, h = 200, title = "", visible = false } = {}) {
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "absolute", width: w + "px", height: h + "px",
      left: x != null ? x + "px" : "50%", top: y != null ? y + "px" : "50%",
      transform: x != null ? "none" : "translate(-50%,-50%)",
      background: "rgba(10,16,28,.92)", border: "1px solid #3af", borderRadius: "8px",
      color: "#cde", padding: "12px", boxSizing: "border-box", display: visible ? "block" : "none",
      pointerEvents: "auto", boxShadow: "0 0 20px rgba(0,120,255,.25)",
    });
    if (title) {
      const t = document.createElement("div");
      t.textContent = title;
      Object.assign(t.style, { borderBottom: "1px solid #3af", paddingBottom: "6px", marginBottom: "8px", color: "#6cf" });
      el.appendChild(t);
    }
    this.root.appendChild(el);
    const api = {
      el,
      show() { el.style.display = "block"; },
      hide() { el.style.display = "none"; },
      toggle() { el.style.display = el.style.display === "none" ? "block" : "none"; },
      get visible() { return el.style.display !== "none"; },
    };
    this.widgets.push(api);
    return api;
  }

  // ---- 按钮（可放任意容器里）----
  button(parent, text, onClick, { w = "100%" } = {}) {
    const b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, {
      width: w, margin: "4px 0", padding: "6px 12px", cursor: "pointer",
      background: "rgba(0,90,160,.35)", border: "1px solid #4af", borderRadius: "5px",
      color: "#cde", fontFamily: "inherit", fontSize: "13px",
    });
    b.onmouseenter = () => b.style.background = "rgba(0,120,220,.55)";
    b.onmouseleave = () => b.style.background = "rgba(0,90,160,.35)";
    b.addEventListener("click", onClick);
    (parent || this.root).appendChild(b);
    return b;
  }

  // ---- 屏幕提示（toast），2 秒自动消失 ----
  toast(text, ms = 2000) {
    const t = document.createElement("div");
    t.textContent = text;
    Object.assign(t.style, {
      position: "absolute", left: "50%", top: "20%", transform: "translateX(-50%)",
      background: "rgba(0,0,0,.75)", color: "#fff", padding: "8px 18px",
      borderRadius: "6px", border: "1px solid #3af", transition: "opacity .4s",
    });
    this.root.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 450); }, ms);
  }
}
if (typeof module !== "undefined") module.exports = { UIManager };
