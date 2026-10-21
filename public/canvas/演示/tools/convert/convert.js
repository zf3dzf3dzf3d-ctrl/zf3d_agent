#!/usr/bin/env node
/**
 * 朱峰格式转换器 v1 —— 市面常用格式 → 自有大模型格式
 * 用法: node convert.js <输入文件> [输出目录]
 * 支持: md txt → *.doc.json | docx → *.doc.json | csv tsv → *.sheet.json
 *       xlsx → *.sheet.json | html htm → *.doc.json | rtf → *.doc.json
 *       odt → *.doc.json | pptx → *.pres.json | pdf → *.doc.json
 *       doc xls ppt → 占位文件
 * 零第三方依赖（zip 解包走 PowerShell Expand-Archive）。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '../../..');
const OUT = {
  doc: path.join(ROOT, '文档', 'docs'),
  sheet: path.join(ROOT, '表格', 'sheets'),
  pres: path.join(ROOT, '演示', 'slides'),
};
const INDEX = {
  doc: path.join(ROOT, '文档', 'index.json'),
  sheet: path.join(ROOT, '表格', 'index.json'),
  pres: path.join(ROOT, '演示', 'index.json'),
};

// ---------- 通用 ----------
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const today = () => new Date().toISOString().slice(0, 10);
const clean = s => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();

function stripXml(s) {
  return clean(String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
}

function unzip(src, destDir) {
  const tmp = path.join(os.tmpdir(), 'zfconv-' + Date.now() + '.zip');
  fs.copyFileSync(src, tmp);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${tmp.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`, { timeout: 60000 });
  fs.rmSync(tmp, { force: true });
  return destDir;
}

function readIndex(kind) {
  try { return JSON.parse(fs.readFileSync(INDEX[kind], 'utf8')); } catch (e) { return []; }
}
function writeIndex(kind, arr) {
  fs.writeFileSync(INDEX[kind], JSON.stringify(arr, null, 2), 'utf8');
}
function register(kind, file, title) {
  const arr = readIndex(kind);
  const entry = { file: path.basename(file), title };
  const i = arr.findIndex(x => x.file === entry.file);
  if (i >= 0) arr[i] = { ...arr[i], ...entry }; else arr.push(entry);
  writeIndex(kind, arr);
}

function saveDoc(name, title, blocks) {
  const obj = { meta: { title, author: '朱峰格式转换器', created: today() }, blocks };
  const f = path.join(OUT.doc, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2), 'utf8');
  register('doc', f, title);
  return f;
}
function saveSheet(name, title, sheets) {
  const obj = { meta: { title, author: '朱峰格式转换器', created: today() }, sheets };
  const f = path.join(OUT.sheet, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2), 'utf8');
  register('sheet', f, title);
  return f;
}
function savePres(name, title, slides) {
  const obj = { meta: { title, author: '朱峰格式转换器', created: today() }, slides };
  const f = path.join(OUT.pres, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2), 'utf8');
  register('pres', f, title);
  return f;
}

function placeholderDoc(name, title, note) {
  return saveDoc(name, title, [
    { type: 'p', text: note },
    { type: 'quote', text: '该文件为占位转换结果：原始格式为老式二进制/扫描件，无法在零依赖环境下完整解析。' },
  ]);
}

// ---------- Markdown / TXT → doc.json ----------
function mdToBlocks(text) {
  const blocks = [];
  const lines = String(text).split(/\r?\n/);
  let i = 0;
  const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) { // 代码块
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push({ type: h[1].length === 1 ? 'h2' : 'h3', text: h[2].trim() }); i++; continue; }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) { // 表格
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const columns = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ type: 'table', columns, rows });
      continue;
    }
    if (/^>\s?/.test(line)) { blocks.push({ type: 'quote', text: line.replace(/^>\s?/, '') }); i++; continue; }
    if (/^[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^[-*+]\s+/, ''));
      blocks.push({ type: 'ul', items }); continue;
    }
    if (/^\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\d+[.)]\s+/, ''));
      blocks.push({ type: 'ol', items }); continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push({ type: 'hr' }); i++; continue; }
    // 普通段落（连续非空行合并）
    const para = [clean(line.replace(/[*_`#>]/g, ''))];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#|```|[-*+]\s|\d+[.)]\s|>|\|)/.test(lines[i])) para.push(clean(lines[i++].replace(/[*_`]/g, '')));
    blocks.push({ type: 'p', text: para.join(' ') });
  }
  return blocks;
}
const convertMd = (src, base) => {
  const title = base;
  return saveDoc(base + '.doc.json', title, mdToBlocks(fs.readFileSync(src, 'utf8')));
};

// ---------- docx → doc.json ----------
function convertDocx(src, base) {
  const dest = path.join(os.tmpdir(), 'zfdocx-' + Date.now());
  unzip(src, dest);
  const docXml = fs.readFileSync(path.join(dest, 'word', 'document.xml'), 'utf8');
  const blocks = [];
  // 表格
  const tables = docXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
  let rest = docXml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '\u0000TABLE\u0000');
  const paras = rest.split(/<\/w:p>/);
  for (const p of paras) {
    if (p.includes('\u0000TABLE\u0000') && tables.length) {
      const t = tables.shift();
      const rows = (t.match(/<w:tr[\s\S]*?<\/w:tr>/g) || []).map(tr =>
        (tr.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || []).map(tc =>
          clean((tc.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map(x => x.replace(/<[^>]+>/g, '')).join(''))));
      if (rows.length) blocks.push({ type: 'table', columns: rows[0], rows: rows.slice(1) });
      continue;
    }
    const text = clean((p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map(x => stripXml(x)).join(''));
    if (!text) continue;
    const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    if (/^heading1$/i.test(style) || /^Heading1/i.test(style)) blocks.push({ type: 'h2', text });
    else if (/^heading[2-4]$/i.test(style)) blocks.push({ type: 'h3', text });
    else if (/<w:numPr>/.test(p)) {
      if (blocks.length && blocks[blocks.length - 1].type === 'ul') blocks[blocks.length - 1].items.push(text);
      else blocks.push({ type: 'ul', items: [text] });
    } else blocks.push({ type: 'p', text });
    if (/<w:drawing>|<pic:pic/.test(p)) blocks.push({ type: 'p', text: '[图片：docx 内嵌图片暂以占位标注]' });
  }
  fs.rmSync(dest, { recursive: true, force: true });
  return saveDoc(base + '.doc.json', base, blocks.length ? blocks : [{ type: 'p', text: '(空文档)' }]);
}

// ---------- CSV/TSV → sheet.json ----------
function convertCsv(src, base) {
  const raw = fs.readFileSync(src, 'utf8');
  const delim = raw.includes('\t') && !raw.includes(',') ? '\t' : ',';
  const lines = raw.split(/\r?\n/).filter(l => l !== '');
  // 简易 CSV 解析（支持引号）
  function parseLine(line) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur); return out;
  }
  const rows = lines.map(parseLine);
  const sheets = [{ name: base, columns: rows[0] || [], rows: rows.slice(1) }];
  return saveSheet(base + '.sheet.json', base, sheets);
}

// ---------- xlsx → sheet.json ----------
function convertXlsx(src, base) {
  const dest = path.join(os.tmpdir(), 'zfxlsx-' + Date.now());
  unzip(src, dest);
  const shared = [];
  const ssPath = path.join(dest, 'xl', 'sharedStrings.xml');
  if (fs.existsSync(ssPath)) {
    const ss = fs.readFileSync(ssPath, 'utf8');
    for (const m of ss.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(clean((m.match(/<t[^>]*>([^<]*)<\/t>/g) || []).map(x => stripXml(x)).join('')));
    }
  }
  const wb = fs.readFileSync(path.join(dest, 'xl', 'workbook.xml'), 'utf8');
  const names = (wb.match(/<sheet[^>]*name="([^"]+)"/g) || []).map(x => (x.match(/name="([^"]+)"/) || [])[1]);
  const sheets = [];
  (fs.readdirSync(path.join(dest, 'xl', 'worksheets'))).filter(f => f.endsWith('.xml')).sort((a, b) => (parseInt(a.replace(/\D/g, '')) || 0) - (parseInt(b.replace(/\D/g, '')) || 0)).forEach((f, idx) => {
    const xml = fs.readFileSync(path.join(dest, 'xl', 'worksheets', f), 'utf8');
    const rows = [];
    for (const tr of xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
      const cells = {};
      for (const c of tr.match(/<c[^>]*>[\s\S]*?<\/c>|<c[^>]*\/>/g) || []) {
        const ref = (c.match(/r="([A-Z]+)\d+"/) || [])[1] || '';
        let col = 0; for (const ch of ref) col = col * 26 + (ch.charCodeAt(0) - 64);
        const t = (c.match(/t="([^"]+)"/) || [])[1];
        const v = (c.match(/<v>([^<]*)<\/v>/) || [])[1];
        let val = '';
        if (t === 's') val = shared[parseInt(v)] || '';
        else if (t === 'inlineStr') val = clean((c.match(/<t[^>]*>([^<]*)<\/t>/g) || []).map(x => stripXml(x)).join(''));
        else val = v == null ? '' : stripXml(v);
        cells[col] = val;
      }
      if (Object.keys(cells).length) {
        const maxC = Math.max(...Object.keys(cells).map(Number));
        const arr = []; for (let k = 1; k <= maxC; k++) arr.push(cells[k] || '');
        rows.push(arr);
      }
    }
    sheets.push({ name: names[idx] || ('Sheet' + (idx + 1)), columns: rows[0] || [], rows: rows.slice(1) });
  });
  fs.rmSync(dest, { recursive: true, force: true });
  return saveSheet(base + '.sheet.json', base, sheets.length ? sheets : [{ name: base, columns: [], rows: [] }]);
}

// ---------- HTML → doc.json ----------
function convertHtml(src, base) {
  let html = fs.readFileSync(src, 'utf8');
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || base;
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const blocks = [];
  const tokenRe = /<(h1|h2|h3|h4|p|li|blockquote|tr)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m, lastList = null;
  while ((m = tokenRe.exec(html))) {
    const tag = m[1].toLowerCase();
    let text = clean(stripXml(m[2].replace(/<[^>]+>/g, ' ')));
    if (!text) continue;
    if (tag === 'h1' || tag === 'h2') { lastList = null; blocks.push({ type: 'h2', text }); }
    else if (tag === 'h3' || tag === 'h4') { lastList = null; blocks.push({ type: 'h3', text }); }
    else if (tag === 'blockquote') { lastList = null; blocks.push({ type: 'quote', text }); }
    else if (tag === 'li') {
      if (lastList) lastList.items.push(text);
      else { lastList = { type: 'ul', items: [text] }; blocks.push(lastList); }
    }
    else if (tag === 'tr') {
      const cells = (m[2].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []).map(c => clean(stripXml(c.replace(/<[^>]+>/g, ' '))));
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === 'table' && !prev._sealed) prev.rows.push(cells);
      else blocks.push(Object.defineProperty({ type: 'table', columns: cells, rows: [] }, '_sealed', { enumerable: false, writable: true }));
    }
    else { lastList = null; blocks.push({ type: 'p', text }); }
  }
  blocks.forEach(b => { if (b.type === 'table') delete b._sealed; });
  return saveDoc(base + '.doc.json', clean(title), blocks.length ? blocks : [{ type: 'p', text: '(未抽取到内容)' }]);
}

// ---------- RTF → doc.json ----------
function convertRtf(src, base) {
  let rtf = fs.readFileSync(src, 'latin1');
  rtf = rtf.replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  let text = rtf
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\line\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '');
  const blocks = text.split(/\n+/).map(clean).filter(Boolean).map(t => ({ type: 'p', text: t }));
  return saveDoc(base + '.doc.json', base, blocks.length ? blocks : [{ type: 'p', text: '(空 RTF)' }]);
}

// ---------- ODT → doc.json ----------
function convertOdt(src, base) {
  const dest = path.join(os.tmpdir(), 'zfodt-' + Date.now());
  unzip(src, dest);
  const xml = fs.readFileSync(path.join(dest, 'content.xml'), 'utf8');
  const blocks = [];
  for (const m of xml.match(/<text:h[^>]*>[\s\S]*?<\/text:h>|<text:p[^>]*>[\s\S]*?<\/text:p>|<table:table[\s\S]*?<\/table:table>/g) || []) {
    if (m.startsWith('<table:table')) {
      const rows = (m.match(/<table:table-row[\s\S]*?<\/table:table-row>/g) || []).map(r =>
        (r.match(/<table:table-cell[^>]*>[\s\S]*?<\/table:table-cell>/g) || []).map(c => clean(stripXml(c))));
      if (rows.length) blocks.push({ type: 'table', columns: rows[0], rows: rows.slice(1) });
      continue;
    }
    const text = clean(stripXml(m.replace(/<[^>]+>/g, ' ')));
    if (!text) continue;
    const lvl = (m.match(/outline-level="(\d+)"/) || [])[1];
    if (lvl) blocks.push({ type: lvl <= 1 ? 'h2' : 'h3', text });
    else blocks.push({ type: 'p', text });
  }
  fs.rmSync(dest, { recursive: true, force: true });
  return saveDoc(base + '.doc.json', base, blocks.length ? blocks : [{ type: 'p', text: '(空文档)' }]);
}

// ---------- pptx → pres.json ----------
function convertPptx(src, base) {
  const dest = path.join(os.tmpdir(), 'zfpptx-' + Date.now());
  unzip(src, dest);
  const slideDir = path.join(dest, 'ppt', 'slides');
  const files = fs.readdirSync(slideDir).filter(f => /^slide\d+\.xml$/.test(f))
    .sort((a, b) => parseInt(a.replace(/\D/g, '')) - parseInt(b.replace(/\D/g, '')));
  const slides = [];
  files.forEach((f, i) => {
    const xml = fs.readFileSync(path.join(slideDir, f), 'utf8');
    const paras = (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []).map(p =>
      clean((p.match(/<a:t>([^<]*)<\/a:t>/g) || []).map(x => stripXml(x)).join(''))).filter(Boolean);
    const title = paras[0] || ('第 ' + (i + 1) + ' 页');
    const bullets = paras.slice(1);
    if (bullets.length) slides.push({ title, bullets });
    else if (paras.length) slides.push({ title, text: paras.slice(1).join(' ') || title });
    else slides.push({ title, text: '(空页)' });
  });
  fs.rmSync(dest, { recursive: true, force: true });
  if (slides.length) slides.unshift({ type: 'cover', title: base, subtitle: '由 pptx 转换生成' });
  return savePres(base + '.pres.json', base, slides.length ? slides : [{ type: 'cover', title: base, subtitle: '(空演示)' }]);
}

// ---------- PDF → doc.json（尽力抽取文本流） ----------
function convertPdf(src, base) {
  const buf = fs.readFileSync(src);
  const raw = buf.toString('latin1');
  if (/\/Image\b|DCTDecode|JPXDecode/.test(raw) && !/BT\s/.test(raw)) {
    return placeholderDoc(base + '.doc.json', base, 'PDF 疑似扫描件（无文本层），仅生成占位文档。');
  }
  const blocks = [];
  // 抽取文本流中 Tj/TJ 操作
  const streams = raw.match(/BT[\s\S]*?ET/g) || [];
  let pageText = [];
  for (const s of streams) {
    const parts = [];
    const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>/g;
    let m;
    while ((m = re.exec(s))) {
      let t = m[0];
      if (t[0] === '(') {
        t = t.slice(1, -1).replace(/\\([nrt()\\])/g, (x, c) => ({ n: '\n', r: '', t: '\t' }[c] || c));
        parts.push(t);
      } else {
        const hex = t.slice(1, -1).replace(/\s/g, '');
        let out = '';
        if (hex.length % 4 === 0 && /[\u4e00-\u9fff]/.test(decodeUtf16(hex))) { out = decodeUtf16(hex); }
        else { for (let i = 0; i + 1 < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16)); }
        parts.push(out);
      }
    }
    const line = parts.join('').trim();
    if (line) pageText.push(line);
  }
  function decodeUtf16(hex) {
    let out = '';
    for (let i = 0; i + 3 < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    return out;
  }
  if (!pageText.length) return placeholderDoc(base + '.doc.json', base, 'PDF 未抽取到文本（可能为扫描件或使用了字体子集编码），仅生成占位文档。');
  for (const line of pageText) blocks.push({ type: 'p', text: line });
  return saveDoc(base + '.doc.json', base, blocks);
}

// ---------- 主入口 ----------
function main() {
  const [input, outArg] = process.argv.slice(2);
  if (!input) { console.log('用法: node convert.js <输入文件> [输出目录覆盖]'); process.exit(1); }
  const src = path.resolve(input);
  if (!fs.existsSync(src)) { console.error('文件不存在: ' + src); process.exit(1); }
  const base = path.basename(src).replace(/\.[^.]+$/, '');
  const ext = path.extname(src).toLowerCase();
  let result, kind = 'doc';
  switch (ext) {
    case '.md': case '.markdown': case '.txt': result = convertMd(src, base); break;
    case '.docx': result = convertDocx(src, base); break;
    case '.doc': result = placeholderDoc(base + '.doc.json', base, '老式 .doc 二进制格式暂不支持完整解析（需安装 Office/反解析库）。'); break;
    case '.csv': case '.tsv': result = convertCsv(src, base); kind = 'sheet'; break;
    case '.xlsx': result = convertXlsx(src, base); kind = 'sheet'; break;
    case '.xls': result = saveSheet(base + '.sheet.json', base, [{ name: base, columns: ['占位'], rows: [['老式 .xls 二进制格式暂不支持完整解析']]}]); kind = 'sheet'; break;
    case '.html': case '.htm': result = convertHtml(src, base); break;
    case '.rtf': result = convertRtf(src, base); break;
    case '.odt': result = convertOdt(src, base); break;
    case '.pptx': result = convertPptx(src, base); kind = 'pres'; break;
    case '.ppt': result = savePres(base + '.pres.json', base, [{ type: 'cover', title: base, subtitle: '老式 .ppt 二进制格式暂不支持完整解析（占位）' }]); kind = 'pres'; break;
    case '.pdf': result = convertPdf(src, base); break;
    default: console.error('不支持的格式: ' + ext); process.exit(1);
  }
  console.log('OK ' + kind + ' -> ' + result);
}
main();
