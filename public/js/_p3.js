const fs = require('fs');
const path = 'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.2.5/public/js/i18n-data.js';
const P = {
"提示":"Notice","确定":"OK","取消":"Cancel","更多菜单":"More menu",
"语言模块尚未加载完成，请刷新页面后重试（Ctrl+F5 强制刷新）":"Language module not loaded yet. Refresh the page and retry (Ctrl+F5 to force refresh).",
"整合下拉按钮":"Combined dropdown button",
"把游戏引擎、内置浏览器、演示 PPT 三个顶栏入口收进一个下拉菜单，节省顶栏宽度。":"Combines the three topbar entries — Game Engine, Built-in Browser, Demo PPT — into one dropdown to save topbar width.",
"演示 PPT":"Demo PPT","已开启":"on","已关闭":"off","中文/EN":"Chinese/EN",
"朗读助手：开/关":"Read Aloud: on/off"
};
let c = fs.readFileSync(path, 'utf8');
const body = JSON.stringify(P).replace(/","/g, '",\n"');
const out = '\n/* ---- i18n patch v7b: more-menu leftovers ---- */\n(function(){\ntry{\nvar P=' + body + ';\nvar D=window.__I18N_DATA||{};var M=window.__I18N_MULTI||(window.__I18N_MULTI={});\nif(!D.CN2EN)D.CN2EN={};if(!D.en)D.en={};\nObject.keys(P).forEach(function(k){var e=P[k];\nif(D.CN2EN[k]===undefined)D.CN2EN[k]=e;\nif(D.en[k]===undefined||D.en[k]===k)D.en[k]=e;\n});\n[\'ja\',\'ko\',\'de\'].forEach(function(lg){M[lg]=M[lg]||{};Object.keys(P).forEach(function(k){if(M[lg][k]===undefined)M[lg][k]=P[k];});});\n}catch(e){console.warn("i18n patch v7b err",e);}\n})();\n';
fs.writeFileSync(path, c + out, 'utf8');
console.log('OK v7b', Object.keys(P).length);
