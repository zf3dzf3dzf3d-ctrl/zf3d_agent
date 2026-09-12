#!/usr/bin/env node
/**
 * 统一转换入口（守护版）：监视 转换收件箱/，新文件自动识别格式并转换。
 * 用法: node watch.js   （常驻运行；也可直接用 convert.js 单文件转换）
 * 转换完成后源文件移动到 转换收件箱/已处理/，失败移动到 转换收件箱/失败/
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const INBOX = path.resolve(__dirname, '../../..', '转换收件箱');
const DONE = path.join(INBOX, '已处理');
const FAIL = path.join(INBOX, '失败');
const CONVERT = path.join(__dirname, 'convert.js');
const SUPPORTED = ['.md', '.markdown', '.txt', '.docx', '.doc', '.csv', '.tsv', '.xlsx', '.xls', '.html', '.htm', '.rtf', '.odt', '.pptx', '.ppt', '.pdf'];

for (const d of [INBOX, DONE, FAIL]) fs.mkdirSync(d, { recursive: true });

function processFile(f) {
  const full = path.join(INBOX, f);
  const ext = path.extname(f).toLowerCase();
  if (!SUPPORTED.includes(ext)) { console.log('跳过不支持的格式:', f); return; }
  try {
    const out = execFileSync(process.execPath, [CONVERT, full], { encoding: 'utf8', timeout: 120000 });
    console.log(out.trim());
    fs.renameSync(full, path.join(DONE, f));
  } catch (e) {
    console.error('失败:', f, e.stderr || e.message);
    try { fs.renameSync(full, path.join(FAIL, f)); } catch (_) {}
  }
}

console.log('转换收件箱守护已启动:', INBOX);
setInterval(() => {
  try {
    for (const f of fs.readdirSync(INBOX)) {
      if (fs.statSync(path.join(INBOX, f)).isFile()) processFile(f);
    }
  } catch (e) { console.error('扫描异常:', e.message); }
}, 3000);
