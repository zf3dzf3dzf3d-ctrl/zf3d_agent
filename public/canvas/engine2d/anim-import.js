// 动画兼容层 v0.1：把 Unity Animation Clip (.anim YAML) / Spine JSON
// 转换为引擎内置 OMA（Open Motion Asset）格式，直接喂给 SkeletonPlayer 播放。
// 目标：用户无需重做动画，导入即用；同时保留一份"大模型可读"的中间格式。
//
// OMA 格式（与 assets/skeleton.json 一致，扩展了 x/y 平移轨道）：
// {
//   name, fps, loop,
//   bones: [{ id, name, parent, x, y, len, angle }],
//   animations: { [name]: { duration, tracks: { [boneName]: { angle:[...], x:[...], y:[...] } } } }
// }
// 轨道数组为均匀采样关键帧（与 SkeletonPlayer._sample 的线性插值约定一致）。
"use strict";

const OMA_VERSION = "oma-1.0";

// ---------- 工具：把任意时间轴关键帧重采样为均匀 N 个点 ----------
function resample(times, values, duration, samples) {
  if (!times || times.length === 0) return null;
  if (times.length === 1) return [values[0]];
  const out = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / (samples - 1)) * duration;
    let j = 0;
    while (j < times.length - 2 && times[j + 1] < t) j++;
    const t0 = times[j], t1 = times[j + 1];
    const f = t1 > t0 ? Math.min(Math.max((t - t0) / (t1 - t0), 0), 1) : 0;
    out.push(values[j] + (values[j + 1] - values[j]) * f);
  }
  return out;
}

function snapTrack(track, duration, samples) {
  // track: [{t, v}, ...] 时间轴关键帧 → 均匀数组
  if (!track || track.length === 0) return null;
  return resample(track.map(k => k.t), track.map(k => k.v), duration, samples);
}

// ---------- 格式识别 ----------
function detectFormat(json) {
  if (typeof json === "string") {
    const s = json.trim();
    if (s.startsWith("%YAML") || (s.includes("m_FloatCurves") || s.includes("Attribute:"))) return "unity";
    if (s.startsWith("{")) { try { return detectFormat(JSON.parse(s)); } catch (e) { return "unknown"; } }
    return "unknown";
  }
  if (json.bones && json.animations && json.slots) return "spine";
  if (json.skeleton || (json.bones && json.bones[0] && json.bones[0].parent !== undefined && !json.animations)) return "spine";
  if (json.animations && json.bones && Array.isArray(json.bones) && json.bones[0] && "tracks" in (json.animations[Object.keys(json.animations)[0]] || {})) return "oma";
  if (json.bones && json.animations && !json.slots) return "oma";
  if (json.m_FloatCurves || json.Attribute || json.path !== undefined) return "unity";
  return "unknown";
}

// ---------- Unity .anim（YAML）解析 ----------
// 提取 m_FloatCurves 中的 rotation 曲线（attribute: m_LocalRotation 或 path+attribute 组合）。
// Unity 四元数 → 欧拉角：对 2D 常用的 z 轴旋转，取 2*atan2(qz, qw)（deg）。
function parseUnityAnim(yamlText) {
  const lines = yamlText.split(/\r?\n/);
  const curves = {}; // path -> {angle: [{t,v}...], posx: [...], posy: [...]}
  let curPath = null, curAttr = null, inCurve = false, curTime = 0, timeSeen = false;
  const quat = { x: 0, y: 0, z: 0, w: 1, has: false };
  // value 行可能出现在 time 行之前（或之后），先挂起、见到 time 再提交
  let pending = null; // { kind: "angle"|"pos", axis, v, quat }
  const commit = () => {
    if (!pending || curPath === null) { pending = null; return; }
    if (!curves[curPath]) curves[curPath] = {};
    if (pending.kind === "angle") {
      if (!curves[curPath].angle) curves[curPath].angle = [];
      curves[curPath].angle.push({ t: curTime, v: pending.v });
    } else {
      const key = "pos" + pending.axis;
      if (!curves[curPath][key]) curves[curPath][key] = [];
      curves[curPath][key].push({ t: curTime, v: pending.v });
    }
    pending = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    const pm = L.match(/^\s*-\s*path:\s*(.+)$/);
    if (pm) { commit(); curPath = pm[1].trim().replace(/^['"]|['"]$/g, ""); inCurve = false; curTime = 0; timeSeen = false; continue; }
    const am = L.match(/^\s*-?\s*attribute:\s*(.+)$/);
    if (am) { commit(); curAttr = am[1].trim(); inCurve = false; curTime = 0; timeSeen = false; continue; }
    // Unity 关键帧里 time 可能在 value 之前或之后
    const tm = L.match(/^\s*-?\s*time:\s*([\d.eE+]+)/);
    if (tm) { curTime = parseFloat(tm[1]); timeSeen = true; commit(); continue; }
    if (/^\s*m_FloatCurves:/.test(L) || /curve:/.test(L)) { inCurve = true; continue; }
    if (inCurve && curPath !== null) {
      // 新的关键帧开始（"- value"）时清掉上一帧挂起数据
      if (/^\s*-\s*value:/.test(L)) { commit(); timeSeen = false; }
      // 四元数分量（keyframe 行可能带 "- " 前缀）
      const cx = L.match(/^\s*-?\s*value:\s*\{?\s*x:\s*([-\d.eE+]+)/);
      if (cx) quat.x = parseFloat(cx[1]);
      const cy = L.match(/[{,]\s*y:\s*([-\d.eE+]+)/);
      const cz = L.match(/[{,]\s*z:\s*([-\d.eE+]+)/);
      const cw = L.match(/[{,]\s*w:\s*([-\d.eE+]+)/);
      if (curAttr && curAttr.includes("LocalRotation") && cx && cw) {
        quat.y = cy ? parseFloat(cy[1]) : 0;
        quat.z = cz ? parseFloat(cz[1]) : 0;
        quat.w = parseFloat(cw[1]);
        // z 轴角度（2D）
        const ang = 2 * Math.atan2(quat.z, quat.w) * 180 / Math.PI;
        pending = { kind: "angle", v: ang };
        if (timeSeen) commit();
        continue;
      }
      const pos = L.match(/^\s*-?\s*value:\s*([-\d.eE+]+)\s*$/);
      if (curAttr && /m_LocalPosition\.(x|y)$/.test(curAttr) && pos) {
        const axis = curAttr.endsWith(".x") ? "x" : "y";
        pending = { kind: "pos", axis, v: parseFloat(pos[1]) };
        if (timeSeen) commit();
      }
    }
  }
  commit();
  return curves;
}

// unityCurves -> OMA animations（取 path 最后一段作为骨骼名）
function unityToOMA(curves, opts = {}) {
  const samples = opts.samples || 16;
  // 先算总时长，再烘焙（duration 传 0 会导致所有采样点压在 t=0）
  let duration = 0;
  for (const ch of Object.values(curves)) {
    for (const key of Object.keys(ch)) {
      const arr = ch[key];
      if (arr && arr.length) {
        const last = arr[arr.length - 1].t;
        if (last > duration) duration = last;
      }
    }
  }
  if (duration <= 0) duration = 1;
  const boneTracks = {};
  for (const [path, ch] of Object.entries(curves)) {
    const bone = path.split("/").pop();
    const tr = {};
    const angle = snapTrack(ch.angle, duration, samples);
    if (angle) tr.angle = angle;
    for (const ax of ["posx", "posy"]) {
      const arr = snapTrack(ch[ax], duration, samples);
      if (arr) tr[ax === "posx" ? "x" : "y"] = arr;
    }
    if (Object.keys(tr).length) boneTracks[bone] = tr;
  }
  return {
    duration,
    tracks: boneTracks,
  };
}

// ---------- Spine JSON 解析 ----------
// Spine: bones[].{name,parent,x,y,rotation,length}
// animations[name].rotate[bone].{time:..,angle:..}[]  (数组按 time 升序)
function spineToOMA(spineJson) {
  const scale = (spineJson.skeleton && spineJson.skeleton.width ? 1 : 1); // 坐标系保持原样
  const bones = (spineJson.bones || []).map((b, i) => ({
    id: i,
    name: b.name,
    parent: b.parent ? (spineJson.bones.findIndex(x => x.name === b.parent)) : -1,
    x: (b.x || 0) * scale,
    y: (b.y || 0) * scale,
    len: (b.length || 0) * scale,
    angle: b.rotation || 0,
  }));
  const animations = {};
  const anims = spineJson.animations || {};
  for (const [name, a] of Object.entries(anims)) {
    const tracks = {};
    let duration = 0;
    for (const [bone, keys] of Object.entries(a.rotate || {})) {
      const tr = keys.map(k => ({ t: k.time || 0, v: k.angle || 0 }));
      const last = tr[tr.length - 1];
      if (last && last.t > duration) duration = last.t;
      tracks[bone] = { angle: tr };
    }
    for (const [bone, keys] of Object.entries(a.translate || {})) {
      const tx = keys.map(k => ({ t: k.time || 0, v: (k.x || 0) * scale }));
      const ty = keys.map(k => ({ t: k.time || 0, v: (k.y || 0) * scale }));
      const last = keys[keys.length - 1];
      if (last && (last.time || 0) > duration) duration = last.time || 0;
      if (!tracks[bone]) tracks[bone] = {};
      if (tx.length) tracks[bone].x = tx;
      if (ty.length) tracks[bone].y = ty;
    }
    // 把每条轨道都烘焙成均匀采样（兼容 SkeletonPlayer._sample）
    const baked = {};
    for (const [bone, tr] of Object.entries(tracks)) {
      const bt = {};
      for (const ch of ["angle", "x", "y"]) {
        if (tr[ch]) {
          const arr = resample(tr[ch].map(k => k.t), tr[ch].map(k => k.v), duration, 16);
          if (arr) bt[ch] = arr;
        }
      }
      if (Object.keys(bt).length) baked[bone] = bt;
    }
    animations[name] = { duration: duration || 1, tracks: baked };
  }
  return {
    name: spineJson.skeleton && spineJson.skeleton.name || "spine_import",
    fps: 30,
    loop: true,
    bones,
    animations,
  };
}

// ---------- 统一入口 ----------
const AnimImporter = {
  version: OMA_VERSION,
  detectFormat,

  // 输入：任意支持格式（JSON 对象 / YAML 字符串 / {format, data}）
  // 输出：OMA 对象（大模型可直接读写：纯 JSON、语义化字段名、无私有二进制）
  load(input, opts = {}) {
    let format, data;
    if (input && typeof input === "object" && input.format && input.data !== undefined) {
      format = input.format; data = input.data;
    } else {
      format = detectFormat(input); data = input;
    }
    switch (format) {
      case "oma": return data;
      case "spine": return spineToOMA(typeof data === "string" ? JSON.parse(data) : data);
      case "unity": {
        const text = typeof data === "string" ? data : JSON.stringify(data);
        const curves = parseUnityAnim(text);
        const skeleton = opts.skeleton || null;
        return {
          name: opts.name || "unity_import",
          fps: 30,
          loop: opts.loop !== false,
          bones: skeleton && skeleton.bones || [{ id: 0, name: "root", parent: -1, x: 0, y: 0, len: 20 }],
          animations: { clip: unityToOMA(curves, opts) },
        };
      }
      default:
        throw new Error("AnimImporter: 无法识别的格式（支持 oma / spine / unity .anim）");
    }
  },

  // 给大模型的格式说明（自描述）
  describe() {
    return {
      format: OMA_VERSION,
      description: "引擎骨骼动画交换格式。bones 为父子链（parent=-1 为根），animations 每条含 duration 与 tracks（bone -> {angle/x/y: 均匀采样关键帧数组，线性插值}）。",
      supportedInputs: [
        "oma（原生）",
        "spine（Esoteric Spine 导出的 JSON，骨骼+rotate/translate 轨道）",
        "unity（Unity Animation Clip 的 .anim YAML 文本，提取 LocalRotation/LocalPosition 曲线）",
      ],
      example: {
        bones: [{ id: 0, name: "root", parent: -1, x: 0, y: 0, len: 20 }],
        animations: { walk: { duration: 1, tracks: { legL: { angle: [20, 45, 20, -5, 20] } } } },
      },
    };
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = { AnimImporter, detectFormat, spineToOMA, parseUnityAnim, unityToOMA };
if (typeof window !== "undefined") window.AnimImporter = AnimImporter;
