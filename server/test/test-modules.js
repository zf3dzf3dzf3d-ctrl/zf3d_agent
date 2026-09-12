// test-modules.js — 新增模块无头测试：场景编辑器/粒子/瓦片/音频(Mock)/热重载
"use strict";
let pass = 0, fail = 0;
const T = (name, fn) => { try { fn(); pass++; console.log("  ✓", name); } catch (e) { fail++; console.log("  ✗", name, "—", e.message); } };
const eq = (a, b, msg) => { if (a !== b) throw new Error((msg || "") + ` 期望 ${b} 实得 ${a}`); };

/* 场景编辑器 */
const path = require("path");
const root = path.resolve(__dirname, "../../public/canvas/engine2d/");
const SE = require(path.join(root, "scene-editor.js"));
console.log("[scene-editor]");
T("新建场景结构", () => { const s = SE.newScene("t"); eq(s.entities.length, 0); eq(typeof s.gravity, "number"); });
T("序列化/反序列化往返", () => {
  const s = SE.newScene("t");
  s.entities.push({ type: "rect", x: 10.5678, y: 20, w: 64, h: 32, color: "#fff", rotation: 45, name: "块" });
  const j = SE.serialize(s);
  const s2 = SE.deserialize(j);
  eq(s2.entities[0].x, 10.57); eq(s2.entities[0].rotation, 45);
});
T("坏格式抛错", () => { let threw = false; try { SE.deserialize("{}"); } catch (e) { threw = true; } eq(threw, true); });
T("命中测试（含旋转）", () => {
  const s = SE.deserialize('{"entities":[{"type":"rect","x":0,"y":0,"w":100,"h":100,"rotation":0}]}');
  eq(SE.hitTest(s, 50, 50) >= 0, true); eq(SE.hitTest(s, 200, 50), -1);
});
T("网格吸附", () => { eq(SE.snap(37, 8), 40); eq(SE.snap(-37, 8), -40); });

/* 粒子 */
const { ParticleEmitter, ParticlePresets } = require(path.join(root, "particles.js"));
console.log("[particles]");
T("发射与消亡", () => {
  const e = new ParticleEmitter({ rate: 100, life: 0.5, speed: 50 });
  e.update(0.1); eq(e.aliveCount > 0, true);
  for (let i = 0; i < 50; i++) e.update(0.1);  // 5 秒后到达稳态（存活 ≈ rate×life）
  eq(e.aliveCount <= 65, true, "存活应不超过 rate×life上限");
});
T("爆发 burst", () => { const e = new ParticleEmitter({ burst: 30, life: 1 }); e.update(0.016); eq(e.aliveCount, 30); });
T("重力下坠", () => {
  const e = new ParticleEmitter({ burst: 1, life: 2, speed: 0, gravity: 100, angle: 0, spread: 0 });
  e.update(0.016); const p = e.pool[0]; const y0 = p.y;
  e.update(1.0); eq(p.y > y0, true, "应下落");
});
T("预设齐全", () => { ["fire", "smoke", "burst"].forEach(k => { if (!ParticlePresets[k]) throw new Error("缺 " + k); }); });

/* 瓦片 */
const { TileMap } = require(path.join(root, "tilemap.js"));
console.log("[tilemap]");
const mkMap = () => new TileMap({ w: 10, h: 10, tileSize: 32, layers: [
  { name: "bg", solid: false, data: new Array(100).fill(1) },
  { name: "collision", solid: true, data: (() => { const d = new Array(100).fill(0); for (let x = 0; x < 10; x++) d[9 * 10 + x] = 1; d[4 * 10 + 5] = 1; return d; })() }
]});
T("get/set", () => { const m = mkMap(); eq(m.get(5, 4, 1), 1); m.set(5, 4, 0, 1); eq(m.get(5, 4, 1), 0); });
T("solidAt 命中", () => { const m = mkMap(); eq(m.solidAt(5 * 32 + 5, 9 * 32 + 5), true); eq(m.solidAt(50, 50), false); });
T("hitRect 碰撞", () => { const m = mkMap(); eq(m.hitRect(5 * 32, 8 * 32 + 20, 32, 32), true); eq(m.hitRect(0, 0, 32, 32), false); });
T("Tiled JSON 转换", () => {
  const tiled = { width: 2, height: 2, tilewidth: 16, layers: [{ type: "tilelayer", name: "collision", data: [1, 0, 0, 2] }], tilesets: [{ firstgid: 1, columns: 4, imagewidth: 64 }] };
  const m = new TileMap(tiled);
  eq(m.w, 2); eq(m.get(0, 0, 0), 0); eq(m.get(1, 1, 0), 1);
});

/* 音频（Mock AudioContext） */
const { AudioManager } = require(path.join(root, "audio-pro.js"));
console.log("[audio-pro]");
T("分组音量边界", () => {
  const am = new AudioManager();
  am.setVolume("bgm", 0.5); eq(am.groups.bgm, 0.5);
  am.setVolume("bgm", 5); eq(am.groups.bgm, 1);
  am.setVolume("bgm", -1); eq(am.groups.bgm, 0);
  let threw = false; try { am.setVolume("xx", 1); } catch (e) { threw = true; } eq(threw, true);
});
T("Mock 下 BGM/音效流转", () => {
  const am = new AudioManager();
  am._mock = () => ({ currentTime: 0, destination: {}, createGain: () => ({ gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() { return {}; }, disconnect() {} }), createBufferSource: () => ({ start() {}, stop() {}, loop: false, connect() { return {}; }, disconnect() {} }) });
  const bgm = am.playBGM("主城", "x", { fadeIn: 0.5 });
  eq(am.currentBGM, "主城");
  am.playBGM("战斗", "y", { fadeIn: 0.5 });
  eq(am.currentBGM, "战斗");
  const s = am.playSFX("hit", { volume: 0.5 });
  eq(s.name, "hit");
  am.stopBGM(0.3); eq(am.currentBGM, null);
});

/* 热重载 */
const { HotReloader } = require(path.join(root, "hotreload.js"));
console.log("[hotreload]");
T("注册与版本递增", () => {
  const hr = new HotReloader();
  hr.register("enemy", () => {});
  eq(hr.get("enemy").version, 0);
  const r1 = hr.reload("enemy", "exports.init=function(){return 1}");
  eq(r1.ok, true); eq(r1.version, 1);
});
T("坏代码不影响运行中旧版", () => {
  const hr = new HotReloader();
  hr.register("enemy", () => {});
  const r = hr.reload("enemy", "this is !!! not valid (");
  eq(r.ok, false); eq(r.version, 0);
});
T("未注册抛错", () => { let threw = false; try { new HotReloader().get("nope"); } catch (e) { threw = true; } eq(threw, true); });

console.log(`\n合计: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
