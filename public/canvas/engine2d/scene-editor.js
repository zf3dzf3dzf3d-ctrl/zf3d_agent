// scene-editor.js — 关卡编辑器核心（无头可测部分）
// 场景 JSON 格式：{ name, entities: [{type,x,y,w,h,color,rotation,name,props:{}}], gravity, tileSize }
// v2 加强：撤销/重做、复制/删除、层级调整、实体类型注册表、对齐分布、多选支持
"use strict";
const SceneEditor = (() => {
  const DEFAULT_ENT = () => ({ type: "rect", x: 0, y: 0, w: 64, h: 64, color: "#4a9", rotation: 0, name: "实体", props: {} });

  // ===== 实体类型注册表（新增关卡元素只需在这里登记） =====
  const TYPES = {
    rect:   { label: "方块",   w: 64, h: 64, color: "#4a9", physics: "solid" },
    circle: { label: "圆",     w: 64, h: 64, color: "#49c", physics: "solid" },
    spawn:  { label: "出生点", w: 32, h: 32, color: "#fd4", physics: "none"  },
    coin:   { label: "金币",   w: 24, h: 24, color: "#fc4", physics: "pickup", props: { value: 10 } },
    spike:  { label: "尖刺",   w: 48, h: 24, color: "#c55", physics: "hazard" },
    platform: { label: "移动平台", w: 96, h: 20, color: "#8ac", physics: "kinematic", props: { dx: 0, dy: -100, period: 3 } },
    goal:   { label: "终点旗", w: 32, h: 48, color: "#5c5", physics: "trigger", props: { next: "" } },
    text:   { label: "提示文字", w: 120, h: 24, color: "#ccc", physics: "none", props: { text: "按 E 交互" } },
  };

  function typeOf(t) { return TYPES[t] || TYPES.rect; }
  function makeEnt(type, x = 100, y = 100) {
    const d = typeOf(type);
    const e = DEFAULT_ENT();
    e.type = type; e.name = d.label; e.x = x; e.y = y;
    e.w = d.w; e.h = d.h; e.color = d.color;
    e.props = d.props ? JSON.parse(JSON.stringify(d.props)) : {};
    return e;
  }

  function newScene(name = "未命名场景") {
    return { name, entities: [], gravity: 1200, tileSize: 32 };
  }

  // 序列化：剔除函数/循环，仅保留白名单字段
  function serialize(scene) {
    return JSON.stringify({
      name: scene.name, gravity: scene.gravity || 0, tileSize: scene.tileSize || 32,
      entities: (scene.entities || []).map(e => ({
        type: e.type || "rect", name: e.name || "实体",
        x: +(+e.x).toFixed(2), y: +(+e.y).toFixed(2),
        w: +(+e.w).toFixed(2), h: +(+e.h).toFixed(2),
        color: e.color || "#4a9", rotation: e.rotation || 0,
        props: e.props && typeof e.props === "object" ? JSON.parse(JSON.stringify(e.props)) : {}
      }))
    }, null, 2);
  }

  function deserialize(json) {
    const s = typeof json === "string" ? JSON.parse(json) : json;
    if (!s || !Array.isArray(s.entities)) throw new Error("场景格式错误：缺少 entities 数组");
    return { name: s.name || "未命名场景", gravity: s.gravity || 0, tileSize: s.tileSize || 32, entities: s.entities.map(e => Object.assign(DEFAULT_ENT(), e)) };
  }

  // 命中测试（考虑旋转的逆变换点包含测试）
  function hitTest(scene, px, py) {
    for (let i = scene.entities.length - 1; i >= 0; i--) {
      const e = scene.entities[i];
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      const a = -(e.rotation || 0) * Math.PI / 180;
      const dx = px - cx, dy = py - cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a) + cx;
      const ly = dx * Math.sin(a) + dy * Math.cos(a) + cy;
      if (lx >= e.x && lx <= e.x + e.w && ly >= e.y && ly <= e.y + e.h) return i;
    }
    return -1;
  }

  // 网格吸附
  function snap(v, size) { return Math.round(v / size) * size; }

  // ===== v2 新增：编辑操作（均为纯函数，作用于 scene，UI 层负责快照入撤销栈） =====

  // 复制实体（深拷贝，含 props；偏移 offset 默认网格一格）
  function duplicate(scene, idx, offset = 32) {
    if (idx < 0 || idx >= scene.entities.length) return null;
    const src = scene.entities[idx];
    const copy = JSON.parse(JSON.stringify(src));
    copy.x += offset; copy.y += offset;
    copy.name = src.name + " 副本";
    scene.entities.splice(idx + 1, 0, copy);
    return idx + 1; // 返回新实体索引
  }

  function removeAt(scene, idx) {
    if (idx < 0 || idx >= scene.entities.length) return false;
    scene.entities.splice(idx, 1);
    return true;
  }

  // 层级：置顶 / 上移一层 / 下移一层 / 置底
  function layerOp(scene, idx, op) {
    const arr = scene.entities;
    if (idx < 0 || idx >= arr.length) return false;
    const [e] = arr.splice(idx, 1);
    let ni = idx;
    if (op === "front") ni = arr.length;
    else if (op === "back") ni = 0;
    else if (op === "up") ni = Math.min(idx + 1, arr.length);
    else if (op === "down") ni = Math.max(idx - 1, 0);
    arr.splice(ni, 0, e);
    return ni;
  }

  // 旋转（步进 step 度）
  function rotateEnt(scene, idx, step = 15) {
    const e = scene.entities[idx];
    if (!e) return false;
    e.rotation = ((e.rotation || 0) + step) % 360;
    return true;
  }

  // 对齐/分布（多选索引数组）
  function align(scene, idxs, mode, tileSize = 32) {
    const es = idxs.map(i => scene.entities[i]).filter(Boolean);
    if (es.length < 2) return false;
    if (mode === "left")   { const m = Math.min(...es.map(e => e.x)); es.forEach(e => e.x = m); }
    if (mode === "right")  { const m = Math.max(...es.map(e => e.x + e.w)); es.forEach(e => e.x = m - e.w); }
    if (mode === "top")    { const m = Math.min(...es.map(e => e.y)); es.forEach(e => e.y = m); }
    if (mode === "bottom") { const m = Math.max(...es.map(e => e.y + e.h)); es.forEach(e => e.y = m - e.h); }
    if (mode === "snap")   { es.forEach(e => { e.x = snap(e.x, tileSize); e.y = snap(e.y, tileSize); }); }
    if (mode === "hdist" || mode === "vdist") {
      const key = mode === "hdist" ? "x" : "y";
      const size = mode === "hdist" ? "w" : "h";
      es.sort((a, b) => a[key] - b[key]);
      const first = es[0], last = es[es.length - 1];
      const gap = (last[key] - first[key] - (es.length - 1) * es.reduce((s, e) => Math.max(s, e[size]), 0) / es.length) / (es.length - 1);
      // 简化：按中心均匀分布
      const c0 = first[key] + first[size] / 2, c1 = last[key] + last[size] / 2;
      const step = (c1 - c0) / (es.length - 1);
      es.forEach((e, i) => { e[key] = c0 + step * i - e[size] / 2; });
    }
    return true;
  }

  return { newScene, serialize, deserialize, hitTest, snap, DEFAULT_ENT,
           TYPES, typeOf, makeEnt, duplicate, removeAt, layerOp, rotateEnt, align };
})();
if (typeof module !== "undefined") module.exports = SceneEditor;
