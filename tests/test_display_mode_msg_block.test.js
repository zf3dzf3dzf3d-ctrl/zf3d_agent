// 【回归测试·2026-11-23】极简显示档 .msg 放行规则必须是 block，不能是 flex
// 背景：chatbox-display-modes.css 曾用 display:flex !important 放行 .msg.zf-minimal-show，
// flex 默认 row 方向把气泡内 markdown 块级子元素(p/h3/ul/table…)变成并排 flex item、
// 各自被压到 min-content 宽(~2-6字)，整条消息呈"竖排细条"错乱(用户实测截图+全量CSS复现页实证)。
// 本测试锁死：放行档=block；隐藏档(:not)=none 不得回退。
'use strict';
const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'public', 'css', 'chatbox-display-modes.css');
const css = fs.readFileSync(cssPath, 'utf8');

let fails = 0;
function check(name, cond) {
    if (cond) { console.log('  PASS ' + name); }
    else { console.error('  FAIL ' + name); fails++; }
}

// 1) 放行规则存在且为 block
const showRe = /\.chatbox\.zf-minimal\s+\.chatbox-body\s*>\s*\.msg\.zf-minimal-show\s*\{[^}]*\}/;
const showMatch = css.match(showRe);
check('放行规则 .msg.zf-minimal-show 存在', !!showMatch);
check('放行规则 display: block !important', !!showMatch && /display:\s*block\s*!important/.test(showMatch[0]));
check('放行规则不再是 flex', !(showMatch && /display:\s*flex/.test(showMatch[0])));

// 2) 隐藏规则仍在（极简档只看最后一轮的过滤口径不被误伤）
const hideRe = /\.chatbox\.zf-minimal\s+\.chatbox-body\s*>\s*\.msg:not\(\.zf-minimal-show\)\s*\{[^}]*\}/;
const hideMatch = css.match(hideRe);
check('隐藏规则 .msg:not(.zf-minimal-show) 存在', !!hideMatch);
check('隐藏规则 display: none !important', !!hideMatch && /display:\s*none\s*!important/.test(hideMatch[0]));

// 3) index.html 缓存号已 bump（防旧 CSS 常驻）
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const vm = html.match(/css\/chatbox-display-modes\.css\?v=(\d+)/);
check('index.html 引用存在', !!vm);
check('缓存号 >= 2（v1 为缺陷版）', !!vm && parseInt(vm[1], 10) >= 2);

if (fails > 0) { console.error('FAIL: ' + fails + ' 项未过'); process.exit(1); }
console.log('OK: 极简档 .msg 放行规则回归全部通过');
