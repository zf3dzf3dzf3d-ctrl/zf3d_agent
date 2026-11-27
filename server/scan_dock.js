// 临时排查脚本：提取 zf-app-dock.js 中所有应用定义的 label/id/path，找文字重复
const fs = require('fs');
const s = fs.readFileSync('public/js/zf-app-dock.js', 'utf8');

// 提取对象字面量风格的 label/title/name
const grab = (key) => {
  const re = new RegExp(key + '\\s*[:=]\\s*[\'"]([^\'"]+)[\'"]', 'g');
  let m, arr = [];
  while ((m = re.exec(s))) arr.push(m[1]);
  return arr;
};
const labels = grab('label');
const titles = grab('title');
const names = grab('name');

const countDup = (arr, tag) => {
  const seen = {};
  arr.forEach(t => { seen[t] = (seen[t] || 0) + 1; });
  const dups = Object.entries(seen).filter(([k, v]) => v > 1);
  console.log('--- ' + tag + ' 总数:' + arr.length + ' ---');
  dups.forEach(([k, v]) => console.log('  重复x' + v + ': ' + k));
  if (!dups.length) console.log('  (无重复)');
};

countDup(labels, 'label');
countDup(titles, 'title');
countDup(names, 'name');

// 找出含"重复嫌疑"关键词的中文标签全清单
console.log('\n--- 全部 label 清单 ---');
console.log(JSON.stringify(labels, null, 0));
