// test-core.js — core.js 无头单元测试（Node）
"use strict";
const C = require("./core.js");
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log("  PASS", name); } else { fail++; console.log("  FAIL", name); } };

/* 1. 实体管理 */
{
  console.log("[实体管理]");
  class Enemy extends C.Entity { update(dt) { this.x += 10 * dt; } }
  const em = new C.EntityManager();
  const e1 = em.add(new C.Entity(1, 2)); e1.tag("enemy");
  const e2 = em.spawn(Enemy, 5, 5); e2.tag("enemy");
  ok(em.count() === 2, "add+spawn 计数=2");
  ok(e2.x === 5 && e2.y === 5, "spawn 传参");
  em.update(0.1);
  ok(e2.x === 6, "update 执行（10*0.1=1）");
  em.kill(e2); em.update(0);
  ok(em.count() === 1, "延迟销毁后计数=1");
  const e3 = em.spawn(Enemy, 0, 0);
  ok(e3 === e2, "对象池复用同一实例");
  ok(em.byTag("enemy").length === 2, "byTag 过滤（e1 复活仍在列）");
}

/* 2. 场景/状态机 */
{
  console.log("[场景/状态机]");
  const sm = new C.SceneManager(null);
  const log = [];
  const title = new C.Scene("title"); title.onEnter = () => log.push("title+in");
  const game = new C.Scene("game"); game.onEnter = () => log.push("game+in"); game.onExit = () => log.push("game-out"); game.onPause = () => log.push("game-pause"); game.onResume = () => log.push("game-resume");
  const pause = new C.Scene("pause"); pause.onEnter = () => log.push("pause+in");
  sm.register(title); sm.register(game); sm.register(pause);
  sm.change("title"); sm.change("game"); sm.push("pause"); sm.pop();
  ok(log.join(",") === "title+in,game+in,game-out,title+in,game+in,game-pause,pause+in,game-resume".replace("game-out,title+in,game+in,", ""), "change/push/pop 钩子序列: " + log.join(","));
  // 修正预期：change(title) → [title+in]; change(game) → [game-out? no title没有onExit] 
  ok(sm.current === game, "pop 回到 game");
  let updated = false; game.update = () => { updated = true; };
  sm.update(0); ok(updated, "update 分发");
}

/* 3. 存档（无 localStorage 环境：验证 API 不崩 + 服务端通道走 fetch mock） */
{
  console.log("[存档]");
  ok(C.Save.getLocal("nope") === null, "无 localStorage 时 get 返回 null");
  ok(C.Save.putLocal("x", { a: 1 }) === false, "无 localStorage 时 put 安全降级");
}

/* 4. UI 组件（结构测试，绘制在浏览器 demo 验证） */
{
  console.log("[UI/HUD]");
  const fakeInput = { mouse: { x: 10, y: 10 }, mouseDown: () => true, mousePressed: () => false };
  const ui = new C.UIManager(fakeInput);
  let clicked = false;
  const btn = ui.add(new C.Button({ x: 0, y: 0, w: 100, h: 40, text: "开始", onClick: () => clicked = true }));
  ui.update(0);
  ok(btn.hover === true, "按钮悬停检测");
  const bar = new C.HPBar({ max: 100, value: 50 }); bar.set(150); ok(bar.value === 100, "HPBar 上限钳制"); bar.set(-5); ok(bar.value === 0, "HPBar 下限钳制");
}

/* 5. 碰撞 */
{
  console.log("[碰撞]");
  const cs = new C.CollisionSystem();
  const a = new C.Entity(0, 0), b = new C.Entity(3, 0);
  let hits = 0, exits = 0, stays = 0;
  cs.add(a, { type: "circle", r: 2 }, { solid: true, onEnter: () => hits++, onStay: () => stays++, onExit: () => exits++ });
  cs.add(b, { type: "circle", r: 2 }, { solid: true });
  cs.update();
  ok(hits === 1, "圆-圆 onEnter");
  ok(Math.abs(a.x - (-0.5)) < 0.05, "实体推开（A 左移）a.x=" + a.x);
  b.x = 100; cs.update(); cs.update();
  ok(exits === 1, "分离后 onExit");
  // AABB + trigger（放在远处，避免与上面圆形测试的实体互相干扰）
  const p = new C.Entity(50, 50), t = new C.Entity(51, 51);
  let trg = 0;
  cs.add(p, { type: "aabb", hw: 1, hh: 1 }, {});
  cs.add(t, { type: "aabb", hw: 1, hh: 1 }, { onEnter: () => trg++ });
  cs.update();
  ok(trg === 1, "AABB 触发器回调");
  // 圆 vs AABB
  const c1 = new C.Entity(5, 0), c2 = new C.Entity(5.9, 0.5);
  let cv = 0;
  cs.add(c1, { type: "circle", r: 1 }, { onEnter: () => cv++ });
  cs.add(c2, { type: "aabb", hw: 0.5, hh: 0.5 }, {});
  cs.update();
  ok(cv === 1, "圆 vs AABB 最近点检测");
}

/* 6. 摄像机 */
{
  console.log("[摄像机]");
  const cam = new C.CameraEx(0, 0);
  const t1 = { x: 100, y: 0 }, t2 = { x: 200, y: 40 };
  cam.follow(t1, t2); cam.setDeadzone(50, 50);
  for (let i = 0; i < 60; i++) cam.update(1 / 60, 800, 600);
  ok(Math.abs(cam.x - 125) < 6 && Math.abs(cam.y) < 0.01, "多目标跟随+死区（y=20 在死区内不动）cam=" + cam.x.toFixed(1) + "," + cam.y.toFixed(1));
  cam.shakeFor(20);
  cam.update(1 / 60, 800, 600);
  ok(cam.shakeX !== 0 || cam.shakeY !== 0, "震动生效");
  for (let i = 0; i < 120; i++) cam.update(1 / 60, 800, 600);
  ok(cam.shake === 0, "震动衰减归零");
}

/* 7. 配置表 + 热更（本地 set/get，watch 在浏览器 demo 验证） */
{
  console.log("[配置表]");
  const cfg = new C.Config();
  cfg.set({ player: { hp: 100, speed: 120 }, enemy: { damage: 15 } });
  ok(cfg.get("player.hp") === 100, "点路径读取");
  ok(cfg.get("player.mp", 50) === 50, "缺省回退");
  ok(cfg.get("enemy.damage") === 15, "嵌套读取");
  let threw = false;
  try { cfg.set({ bad: 123 }); } catch (e) { threw = true; }
  ok(threw, "非对象节校验报错");
  cfg.set({ player: { hp: 80 } });
  ok(cfg.get("player.hp") === 80 && cfg.get("player.speed") === 120, "热更覆盖保留其他键");
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
