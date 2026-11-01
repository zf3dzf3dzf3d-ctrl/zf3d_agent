#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
【Office 文档预览引擎扩展】Word(docx) / Excel(xlsx) 内置预览。
与 PPTX 同思路：直接 zip+XML 解析，无需安装 Office，不引入第三方依赖。
新增接口（由 server 薄接入点调用）：
  - handle_fs_docx(handler, parsed)   /api/fs/docx?path=...
  - handle_fs_xlsx(handler, parsed)   /api/fs/xlsx?path=...（含基础公式重算：SUM/AVERAGE/COUNT/MIN/MAX）
  - export_to_pdf(handler, parsed)    /api/fs/office_pdf?path=...（html 通道导出，前端打印为 PDF）
"""

import os
import re
import zipfile
import traceback
from urllib.parse import parse_qs
from xml.etree import ElementTree as ET

W_NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
S_NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def _check(handler, raw_path, exts):
    if not raw_path:
        handler._send_error('缺少 path 参数', 400)
        return None
    rp = os.path.realpath(raw_path)
    if not os.path.isfile(rp):
        handler._send_error('文件不存在: ' + raw_path, 404)
        return None
    if not rp.lower().endswith(exts):
        handler._send_error('仅支持 ' + '/'.join(exts), 403)
        return None
    return rp


def handle_fs_docx(handler, parsed):
    """【DOCX 内置预览】返回段落+表格的轻量 JSON（word/document.xml 直读）。"""
    qs = parse_qs(parsed.query)
    try:
        rp = _check(handler, (qs.get('path', [''])[0] or '').strip(), ('.docx',))
        if not rp:
            return
        z = zipfile.ZipFile(rp)
        xml = z.read('word/document.xml').decode('utf-8', 'ignore')
        root = ET.fromstring(xml)
        body = root.find(W_NS + 'body')
        blocks = []
        for el in body:
            tag = el.tag
            if tag == W_NS + 'p':
                text = ''.join(t.text or '' for t in el.iter(W_NS + 't'))
                style = el.find(W_NS + 'pPr/' + W_NS + 'pStyle')
                blocks.append({'type': 'p', 'style': style.get(W_NS + 'val') if style is not None else '',
                               'text': text})
            elif tag == W_NS + 'tbl':
                rows = []
                for tr in el.findall(W_NS + 'tr'):
                    rows.append([''.join(t.text or '' for t in tc.iter(W_NS + 't'))
                                 for tc in tr.findall(W_NS + 'tc')])
                blocks.append({'type': 'table', 'rows': rows})
        handler._send_json({'ok': True, 'path': rp, 'blocks': blocks})
    except Exception as e:
        print(f'[GET /api/fs/docx] 500: {e}')
        traceback.print_exc()
        handler._send_error(str(e), 500)


def _col_letters(ref):
    m = re.match(r'([A-Z]+)', ref or '')
    return m.group(1) if m else ''


def _cell_addr(col_letters, row_no):
    return '%s%d' % (col_letters, row_no)


def _letters_to_num(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n


# ---------- 基础公式重算（无第三方依赖，够预览用） ----------
def _eval_formula(expr, cells):
    """支持 =A1+B2、=SUM(A1:B3)、AVERAGE/COUNT/MIN/MAX/ROUND，四则+括号。"""
    def rng(a, b):
        ca, ra = re.match(r'([A-Z]+)(\d+)', a).groups()
        cb, rb = re.match(r'([A-Z]+)(\d+)', b).groups()
        return [_cell_addr(chr(64 + ci) if ci <= 26 else _letters_to_num.__name__ and '', ri)
                for ci in range(_letters_to_num(ca), _letters_to_num(cb) + 1)
                for ri in range(int(ra), int(rb) + 1)]

    def val(addr):
        v = cells.get(addr, '')
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    def fn_sum(a, b):
        return sum(val(x) for x in rng(a, b))

    def fn_avg(a, b):
        xs = [val(x) for x in rng(a, b)]
        return sum(xs) / len(xs) if xs else 0

    def fn_count(a, b):
        return float(len(rng(a, b)))

    def fn_min(a, b):
        xs = [val(x) for x in rng(a, b)]
        return min(xs) if xs else 0

    def fn_max(a, b):
        xs = [val(x) for x in rng(a, b)]
        return max(xs) if xs else 0

    try:
        s = expr.strip().lstrip('=').upper().replace(' ', '')
        # 简化：直接对常见模式逐一求值
        m = re.match(r'^(SUM|AVERAGE|COUNT|MIN|MAX)\(([A-Z]+\d+):([A-Z]+\d+)\)$', s)
        if m:
            fn = {'SUM': fn_sum, 'AVERAGE': fn_avg, 'COUNT': fn_count,
                  'MIN': fn_min, 'MAX': fn_max}[m.group(1)]
            return fn(m.group(2), m.group(3))
        # 单元格引用替换后安全求值（只留数字与运算符）
        s = re.sub(r'\b([A-Z]+\d+)\b', lambda m2: repr(val(m2.group(1))), s)
        if re.fullmatch(r'[-+*/().0-9eE\' ]+', s):
            return eval(s, {'__builtins__': {}})
    except Exception:
        pass
    return None


def handle_fs_xlsx(handler, parsed):
    """【XLSX 内置预览】返回各 sheet 单元格矩阵；对公式单元格做基础重算（显示计算值）。"""
    qs = parse_qs(parsed.query)
    try:
        rp = _check(handler, (qs.get('path', [''])[0] or '').strip(), ('.xlsx',))
        if not rp:
            return
        z = zipfile.ZipFile(rp)
        names = z.namelist()
        # 共享字符串
        shared = []
        if 'xl/sharedStrings.xml' in names:
            sroot = ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in sroot:
                shared.append(''.join(t.text or '' for t in si.iter(S_NS + 't')))
        # 工作簿 sheet 名与文件映射
        wb = ET.fromstring(z.read('xl/workbook.xml'))
        rels = {}
        if 'xl/_rels/workbook.xml.rels' in names:
            rroot = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
            for rel in rroot:
                rels[rel.get('Id')] = rel.get('Target')
        sheets = []
        for sh in wb.iter(S_NS + 'sheet'):
            rid = sh.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            target = rels.get(rid, '')
            if target and not target.startswith('xl/'):
                target = 'xl/' + target.lstrip('/')
            if target not in names:
                continue
            wroot = ET.fromstring(z.read(target))
            cells = {}   # addr -> 原始值
            fcells = {}  # addr -> 公式
            grid = []
            max_c = 0
            for row in wroot.iter(S_NS + 'row'):
                rno = int(row.get('r', '0'))
                rowdata = []
                for c in row.findall(S_NS + 'c'):
                    ref = c.get('r') or ''
                    cl = _col_letters(ref)
                    max_c = max(max_c, _letters_to_num(cl))
                    t = c.get('t')
                    v = c.find(S_NS + 'v')
                    f = c.find(S_NS + 'f')
                    raw = ''
                    if t == 's' and v is not None:
                        raw = shared[int(v.text)]
                    elif t == 'inlineStr':
                        is_el = c.find(S_NS + 'is')
                        raw = ''.join(t2.text or '' for t2 in is_el.iter(S_NS + 't')) if is_el is not None else ''
                    elif v is not None:
                        raw = v.text or ''
                    cells[ref] = raw
                    if f is not None and f.text:
                        fcells[ref] = f.text
                    rowdata.append((ref, raw))
                # 补齐本行空位到 max_c（按列号对齐）
                grid.append({'no': rno, 'cells': rowdata})
            # 第二遍：对公式单元格重算
            formulas = {ref: _eval_formula(f, cells) for ref, f in fcells.items()}
            handler._send_json({'ok': True, 'path': rp, 'sheets': [
                {'name': sh.get('name'), 'maxCol': max_c,
                 'rows': grid, 'recalculated': formulas}]})
            return
        handler._send_error('未找到工作表', 500)
    except Exception as e:
        print(f'[GET /api/fs/xlsx] 500: {e}')
        traceback.print_exc()
        handler._send_error(str(e), 500)


def export_to_pdf(handler, parsed):
    """【PDF 导出通道】返回适合打印的 HTML（window.print → 另存为 PDF）。
    纯标准库实现，避免引入 libreoffice/word 等重依赖；docx→HTML。"""
    qs = parse_qs(parsed.query)
    try:
        rp = _check(handler, (qs.get('path', [''])[0] or '').strip(), ('.docx', '.pptx'))
        if not rp:
            return
        z = zipfile.ZipFile(rp)
        body_html = ''
        if rp.lower().endswith('.docx'):
            root = ET.fromstring(z.read('word/document.xml'))
            for p in root.iter(W_NS + 'p'):
                text = ''.join(t.text or '' for t in p.iter(W_NS + 't'))
                body_html += '<p>%s</p>' % (text.replace('&', '&amp;').replace('<', '&lt;'))
        else:
            slide_re = re.compile(r'^ppt/slides/slide(\d+)\.xml$')
            a_ns = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
            for n in sorted(z.namelist(), key=lambda x: (slide_re.match(x) and int(slide_re.match(x).group(1)) or 0) if slide_re.match(x) else 999):
                if not slide_re.match(n):
                    continue
                texts = [''.join(t.text or '' for t in p.iter(a_ns + 't'))
                         for p in ET.fromstring(z.read(n)).iter(a_ns + 'p')]
                body_html += '<section><h2>第 %s 页</h2><p>%s</p></section>' % (
                    slide_re.match(n).group(1), '<br>'.join(t for t in texts if t))
        html = ('<!DOCTYPE html><html><head><meta charset="utf-8"><title>导出</title>'
                '<style>body{font-family:Microsoft YaHei;margin:40px}section{page-break-after:always}</style>'
                '</head><body onload="window.print()">' + body_html + '</body></html>')
        data = html.encode('utf-8')
        handler.send_response(200)
        handler.send_header('Content-Type', 'text/html; charset=utf-8')
        handler.send_header('Content-Length', str(len(data)))
        handler.end_headers()
        handler.wfile.write(data)
    except Exception as e:
        print(f'[GET /api/fs/office_pdf] 500: {e}')
        traceback.print_exc()
        handler._send_error(str(e), 500)
