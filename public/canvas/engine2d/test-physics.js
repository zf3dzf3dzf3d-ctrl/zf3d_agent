// test-physics.js — 物理系统无头测试
const P = require("./physics.js");
let pass = 0, fail = 0;
const t = (name, cond) => { cond ? pass++ : (fail++, console.log("FAIL: " + name)); };

// 1. AABB 碰撞检测
const A = new P.RigidBody({ x: 0, y: 0, hw: 10, hh: 10 });
const B = new P.RigidBody({ x: 15, y: 0, hw: 10, hh: 10 });
t("AABB 重叠检测", !!P.collide(A, B));
B.x = 100;
t("AABB 分离检测", P.collide(A, B) === null);

// 2. 圆碰撞
const C1 = new P.RigidBody({ type: "circle", x: 0, y: 0, r: 10 });
const C2 = new P.RigidBody({ type: "circle", x: 15, y: 0, r: 10 });
const cc = P.collide(C1, C2);
t("圆碰撞", !!cc && cc.nx === 1 && cc.depth === 5);

// 3. 圆 vs AABB
const box = new P.RigidBody({ x: 0, y: 0, hw: 10, hh: 10 });
const ball = new P.RigidBody({ type: "circle", x: 14, y: 0, r: 6 });
t("圆vs盒", !!P.collide(ball, box));

// 4. 重力 + 地面弹跳（静态体）
const world = new P.World({ gravity: 980 });
world.bounds = { l: -500, t: -500, r: 500, b: 0 };
const ball2 = world.add(new P.RigidBody({ type: "circle", x: 0, y: -100, r: 10, restitution: 0.5 }));
for (let i = 0; i < 600; i++) world.step(1 / 60);
t("球落到地面 y≈-10", ball2.y < -5 && ball2.y > -20);

// 5. 静态体不被推动
const wall = world.add(new P.RigidBody({ x: 0, y: -50, hw: 30, hh: 30, mass: 0 }));
const ball3 = world.add(new P.RigidBody({ type: "circle", x: -100, y: -50, r: 10, vx: 300 }));
for (let i = 0; i < 120; i++) world.step(1 / 60);
t("静态墙不动", wall.x === 0 && wall.y === -50);
t("球被墙挡住未穿墙", ball3.x < 20 && wall.x === 0);

// 6. 传感器不产生位移
const w2 = new P.World({ gravity: 0 });
const s1 = w2.add(new P.RigidBody({ x: 0, y: 0, hw: 10, hh: 10, isSensor: true, vx: 100 }));
const s2 = w2.add(new P.RigidBody({ x: 5, y: 0, hw: 10, hh: 10 }));
let hit = 0; s2.onHit = () => hit++;
for (let i = 0; i < 10; i++) w2.step(1 / 60);
t("传感器触发onHit但不阻挡", hit > 0 && s1.x > 5);

// 7. 布娃娃：落地后保持骨架连接
const w3 = new P.World({ gravity: 980 });
w3.bounds = { l: -500, t: -500, r: 500, b: 0 };
const rd = w3.addRagdoll(new P.Ragdoll(w3, 0, -300, {}));
for (let i = 0; i < 600; i++) w3.step(1 / 60);
const headHip = Math.hypot(rd.head.x - rd.hips.x, rd.head.y - rd.hips.y);
t("布娃娃落地且头臀距离合理(≤60)", rd.hips.y > -60 && headHip < 60);

console.log(`physics: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
