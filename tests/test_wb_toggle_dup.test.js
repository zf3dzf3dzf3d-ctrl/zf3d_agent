// 【永久回归】对话框工作台扳手图标堆积 bug（20261124）。
// 背景：对话框存在嵌套结构（皮肤/角色节点再包一层 .chatbox），
//   ① app-workbench-drawer.js 注入守卫用 box.querySelector('.wb-toggle-btn') 深搜，
//     嵌套时外层命中内层按钮误判「已有」→ 外层拒绝注入；
//   ② chatbox-header-relocate.js 兜底搬运同样深搜 box.querySelector('.wb-toggle-btn')，
//     会把内层按钮搬进外层 inputrow；
//   → 外层判「无按钮」补注新按钮 × relocate 周期搬入内层按钮 = 「搬走+补注」正反馈，
//     扳手图标在输入排里无限堆积成网格（用户截图实锤）。
// 修复：①② 全部改为「同层直属子节点」判定（_sameLayerHasWbBtn / inputrow.children），
//   并在 injectToggle 加存量清扫（多余 wb 按钮自动移除）。
// 用法：node tests/test_wb_toggle_dup.test.js   （退出码 0 = PASS）
// 静态扫描源码即可，无需 DOM 环境。
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var DRAWER = path.join(ROOT, 'public', 'js', 'app-workbench-drawer.js');
var RELOC = path.join(ROOT, 'public', 'js', 'chatbox-header-relocate.js');

var ok = 0, fail = 0;
function assert(name, cond, detail) {
    if (cond) { ok++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (detail ? ' | ' + detail : '')); }
}

var drawer = fs.readFileSync(DRAWER, 'utf8');
var reloc = fs.readFileSync(RELOC, 'utf8');

// ===== 一、注入守卫必须同层化（app-workbench-drawer.js） =====

// 断言1：同层守卫函数 _sameLayerHasWbBtn 已定义，且只看直属子节点（children 遍历）
assert('同层守卫函数已定义', /function _sameLayerHasWbBtn\(box\)/.test(drawer));
assert('守卫只遍历直属 children', /for \(var k = 0; k < ch\.length; k\+\+\)/.test(drawer));

// 断言2：注入入口改用同层守卫，旧的深搜守卫写法必须消失
assert('注入入口用同层守卫', /if \(!box \|\| _sameLayerHasWbBtn\(box\)\) return;/.test(drawer));
assert('深搜守卫写法已消失', !/if \(!box \|\| box\.querySelector\('\.wb-toggle-btn'\)\) return;/.test(drawer),
    '仍存在 if (!box || box.querySelector(\'.wb-toggle-btn\')) return;');

// ===== 二、relocate 兜底搬运必须同层化（chatbox-header-relocate.js） =====

// 断言3：relocateBox 不再深搜 wb 按钮
assert('relocate 深搜写法已消失', !/box\.querySelector\('\.wb-toggle-btn'\)/.test(reloc),
    '仍存在 box.querySelector(\'.wb-toggle-btn\')');
// 断言4：改为同层 inputrow.children 判定
assert('relocate 同层判定已接入', /inputrow\.children\[_i\]\.classList\.contains\('wb-toggle-btn'\)/.test(reloc));

// ===== 三、存量清扫 =====

// 断言5：injectToggle 内含清扫逻辑（发现非同层注入位的 wb 按钮直接移除）
assert('injectToggle 存量清扫存在', /存量清扫/.test(drawer) && drawer.indexOf('b.remove()') > drawer.indexOf('function injectToggle('));

console.log('');
console.log('结果: ' + ok + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
