// 生成测试用 docx/pptx/xlsx 样例（最小 OOXML 包，PowerShell 压缩）
const fs = require('fs'), { execSync } = require('child_process'), path = require('path');
function buildZip(name, files) {
  const tmp = name + '_pkg';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const [p, c] of Object.entries(files)) {
    const fp = path.join(tmp, p);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, c);
  }
  try {
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${tmp}\\*' -DestinationPath '${name}.zip' -Force"`, { stdio: 'inherit' });
    fs.renameSync(name + '.zip', name);
    console.log('BUILT ' + name);
  } catch (e) { console.error('FAIL ' + name + ': ' + e.message); }
  fs.rmSync(tmp, { recursive: true, force: true });
}

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
const RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
const para = (t, style) => '<w:p>' + (style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '') + `<w:r><w:t>${t}</w:t></w:r></w:p>`;
const doc = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`
  + para('季度报告', 'Heading1')
  + para('本季度销售额大幅增长，客户满意度达到 98%。')
  + para('重点事项', 'Heading2')
  + para('完成新版本发布')
  + para('修复线上问题')
  + `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>月份</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>销售额</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>1月</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>100万</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>2月</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>120万</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
  + '</w:body></w:document>';
buildZip('测试文档.docx', { '[Content_Types].xml': CT, '_rels/.rels': RELS, 'word/document.xml': doc });

// pptx
const PCT = CT.replace('/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"',
  '/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
function slide(title, bullets) {
  let s = '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>' + title + '</a:t></a:r></a:p>';
  for (const b of bullets) s += '<a:p><a:r><a:t>' + b + '</a:t></a:r></a:p>';
  return s + '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
}
buildZip('测试演示.pptx', {
  '[Content_Types].xml': PCT,
  '_rels/.rels': RELS,
  'ppt/slides/slide1.xml': slide('项目规划', ['目标一：提升性能', '目标二：降低成本']),
  'ppt/slides/slide2.xml': slide('时间表', ['Q1 调研', 'Q2 开发'])
});

// xlsx
const XCT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const XRELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const XWB = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="销量" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const XSH = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>产品</t></is></c><c r="B1" t="inlineStr"><is><t>数量</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>键盘</t></is></c><c r="B2"><v>50</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>鼠标</t></is></c><c r="B3"><v>80</v></c></row></sheetData></worksheet>`;
buildZip('数据表.xlsx', { '[Content_Types].xml': XCT, '_rels/.rels': XRELS, 'xl/workbook.xml': XWB, 'xl/worksheets/sheet1.xml': XSH });
console.log('ALL DONE');
