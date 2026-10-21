// 生成 JA/KO/DE 词典并追加到 i18n-data.js（一次性脚本）
const fs = require('fs');
const path = 'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.2.5/public/js/i18n-data.js';
// 先加载现有数据
global.window = {};
delete require.cache[require.resolve(path)];
require(path);
const D = global.window.__I18N_DATA;
const CN2EN = D.CN2EN;
const EXTRA = D.EXTRA;
for (const k in EXTRA) if (CN2EN[k] === undefined) CN2EN[k] = EXTRA[k];

// 反转：英文 -> 中文（en2cn）
const en2cn = {};
for (const cn in CN2EN) {
  const en = CN2EN[cn];
  if (en && !en2cn[en]) en2cn[en] = cn;
}

// 翻译映射表：英文 -> [日, 韩, 德]
// 未覆盖的条目回落到英文（框架已有 fallback：查不到就用英文显示，比中文好）
const T = {
  'Switch language': ['言語切替', '언어 전환', 'Sprache wechseln'],
  'About': ['について', '정보', 'Über'],
  'ZF3D AGENT': ['ZF3D AGENT', 'ZF3D AGENT', 'ZF3D AGENT'],
};

function buildDict(map) {
  const out = {};
  for (const en in en2cn) {
    if (map[en]) out[en2cn[en]] = map[en];
  }
  return out;
}

const JA = buildDict(T), KO = buildDict(T), DE = buildDict(T);

function fmt(name, obj) {
  const lines = Object.keys(obj).map(k => `        ${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`).join(',\n');
  return `/* ${name} 词典：中文原文 -> ${name}（基础词条，未覆盖条目运行时回落英文） */\nconst ${name}={\n${lines}\n    };\n`;
}

let add = '';
add += fmt('JA', JA) + '\n';
add += fmt('KO', KO) + '\n';
add += fmt('DE', DE) + '\n';

let src = fs.readFileSync(path, 'utf8');
if (src.includes('const JA={')) { console.log('ALREADY_ADDED'); process.exit(0); }
src = src.replace('return {CN2EN:CN2EN', add + 'return {CN2EN:CN2EN');
fs.writeFileSync(path, src, 'utf8');
console.log('OK JA', Object.keys(JA).length, 'KO', Object.keys(KO).length, 'DE', Object.keys(DE).length);
