/*
 * verify_spider_legs.js — 爬虫六腿几何自检（防回归守卫）
 * ===================================================================
 * 背景：app-kite-modes.js 的 spider 模式反复"看不到腿/脚"又"拖拽范围不对"，
 *       根因是 脚锚点(foot) + 骨骼长(len) + 强制膝下限(kneeBend≥0.95) + 脚尖硬钳制
 *       四者尺度耦合，过去每次只调其一，按下葫芦起了瓢。
 * 用法：改动 LEGS 的 foot/len 或步态 tick 的 kneeBend/clamp 后，必须运行：
 *         node tools/verify_spider_legs.js
 *       退出码 0 = 六腿静止+呼吸+抬脚全在画面安全区；非 0 = 几何回归，禁止提交。
 * 本脚本【忠实复刻】生产 draw 路径（app-kite-modes.js startGait tick 内 872~905 行）
 *       的坐标换算与 IK，确保校验的就是线上真正跑的那套数学。
 */
'use strict';
const fs = require('fs');
const path = require('path');

// 直接解析源文件里的 LEGS，避免校验脚本与实现脱节（单一事实来源）
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-kite-modes.js'), 'utf8');
const m = src.match(/LEGS:\s*\[([\s\S]*?)\]\s*,\s*\n\s*ensure:/);
if (!m) { console.error('❌ 未能在 app-kite-modes.js 中定位 spider.LEGS，源结构可能已变动'); process.exit(2); }
const LEGS = eval('[' + m[1] + ']');

// 复刻生产 draw：世界锚点→局部坐标（含脚尖硬钳制）→2节IK→踝角平分线
const VB = { w: 60, h: 48 };            // viewBox
const SAFE = { x0: 4, x1: 56, y0: 4, y1: 44 }; // 脚尖硬钳制边界（与源 877 行一致）
const IN = { x0: 1, x1: 59, y0: 1, y1: 47 };    // 画面安全区（膝/踝/脚必须落在此）
const BOB = 1.2;   // 呼吸沉浮幅度（源 869 行）
const LIFT = 9;    // 抬脚高度（源 805 行）

function solveLeg(L, footOff, bobY) {
    // 静止时 f.x≈f.def.x=g.x+foot；draw 中 lx = f.x - cx + 30 = 30 + foot.x（cx=g.x 抵消）
    let lx = 30 + footOff[0];
    let ly = (footOff[1]) + 24 - bobY;          // 呼吸时身体 cy=g.y+bob → 脚相对身体上移 bob
    // 脚尖硬钳制（与源 877 行逐字一致）
    lx = Math.max(SAFE.x0, Math.min(SAFE.x1, lx));
    ly = Math.max(SAFE.y0, Math.min(SAFE.y1, ly));
    const hx = 30 + L.sx, hy = 24 + L.sy;
    const vx = lx - hx, vy = ly - hy;
    let d = Math.hypot(vx, vy);
    const l1 = L.len[0] + L.len[1], l2 = L.len[2] + 2;
    d = Math.max(4, Math.min(d, l1 + l2 - 0.5));
    const a1 = Math.atan2(vy, vx);
    const cosK = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    let kneeBend = Math.acos(Math.max(-1, Math.min(1, cosK)));
    kneeBend = Math.max(kneeBend, 0.95);          // 山峰式拱腿下限（与源 890 行一致）
    const aHip = (L.sx < 0) ? (a1 + kneeBend) : (a1 - kneeBend);
    const kx = hx + Math.cos(aHip) * l1, ky = hy + Math.sin(aHip) * l1;
    const rkx = lx - kx, rky = ly - ky, rd = Math.hypot(rkx, rky) || 1;
    const at = 0.62;
    const d1x = (kx - hx) / l1, d1y = (ky - hy) / l1;
    const d2x = rkx / rd, d2y = rky / rd;
    let bx = d1x + d2x, by = d1y + d2y;
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    const ax = kx + rkx * at + bx * 2.6, ay = ky + rky * at + by * 2.6;
    return { kx, ky, ax, ay, lx, ly };
}

function inBox(x, y) { return x >= IN.x0 && x <= IN.x1 && y >= IN.y0 && y <= IN.y1; }

let fail = 0;
console.log('爬虫六腿几何自检（静止 bob=0 / 呼吸±' + BOB + ' / 抬脚-' + LIFT + '）\n');
LEGS.forEach((L, i) => {
    if (!L.foot) { console.log('腿' + i + ' ❌ 缺 foot 字段（根治后必须显式声明脚锚点偏移）'); fail++; return; }
    const states = [{ n: '静止', bob: 0 }, { n: '吸顶', bob: BOB }, { n: '吸底', bob: -BOB }, { n: '抬脚', bob: -LIFT }];
    let legOK = true;
    states.forEach(s => {
        const r = solveLeg(L, L.foot, s.bob);
        const checks = [['膝', r.kx, r.ky], ['踝', r.ax, r.ay], ['脚', r.lx, r.ly]];
        checks.forEach(c => {
            if (!inBox(c[1], c[2])) { legOK = false; console.log('腿' + i + ' ' + s.n + ' ❌ ' + c[0] + '(' + c[1].toFixed(1) + ',' + c[2].toFixed(1) + ') 出画面'); }
        });
        if (s.n === '静止') console.log('腿' + i + ' 静止  膝(' + r.kx.toFixed(1) + ',' + r.ky.toFixed(1) + ') 踝(' + r.ax.toFixed(1) + ',' + r.ay.toFixed(1) + ') 脚(' + r.lx.toFixed(1) + ',' + r.ly.toFixed(1) + ')');
    });
    if (legOK) console.log('腿' + i + ' ✅ 全部状态在安全区');
    else fail++;
});

// 左右对称性：腿 i 与 i+3 的 |foot.x| 应镜像、|foot.y| 相等
for (let i = 0; i < 3; i++) {
    const a = LEGS[i], b = LEGS[i + 3];
    if (!a.foot || !b.foot) continue;
    if (Math.abs(a.foot[0] + b.foot[0]) > 0.01 || Math.abs(a.foot[1] - b.foot[1]) > 0.01)
        console.log('⚠ 腿' + i + '/腿' + (i + 3) + ' 左右不对称（foot 应 x 镜像、y 相等）');
}

if (fail) { console.log('\n❌ 几何回归：' + fail + ' 条腿存在关节/脚出画面。请重新标定 foot 或 len，禁止提交。'); process.exit(1); }
console.log('\n✅ 六腿几何自洽，全部关节与脚在画面安全区，可提交。');
process.exit(0);
