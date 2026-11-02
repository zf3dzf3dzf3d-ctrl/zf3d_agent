// ⚠️ 警告：此脚本依赖旧版 5.2.5 目录的 _missing.json，产物为历史用途。
// 5.7.0 的 _union.json 已手工修正（未峰→朱峰，commit ff1f45ac）。
// 直接重跑本脚本会用旧数据覆盖手工修正——重跑前必须先修掉 5.2.5 路径依赖并核对数据源！
const fs = require('fs');
const dir = 'F:/朱峰社区智能体无限_新版本/朱峰社区智能体无限_5.2.5/public/js';
const miss = JSON.parse(fs.readFileSync(dir + '/_missing.json', 'utf8'));
const uni = new Set();
for (const lg in miss) miss[lg].forEach(k => uni.add(k));
// filter: drop pure-ASCII keys like 'SMTP 포트' handling not needed (has korean) keep
const arr = [...uni];
fs.writeFileSync(dir + '/_union.json', JSON.stringify(arr, null, 0), 'utf8');
console.log('union:', arr.length);
const N = 6, per = Math.ceil(arr.length / N);
for (let i = 0; i < N; i++) {
  const part = arr.slice(i * per, (i + 1) * per);
  fs.writeFileSync(dir + '/_u' + i + '.json', JSON.stringify(part, null, 0), 'utf8');
  console.log('chunk', i, part.length);
}
