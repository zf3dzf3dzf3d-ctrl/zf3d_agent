#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
【办公文档预览工具】独立模块 tools/office-viewer/office_viewer.py
PPTX 内置预览解析引擎：/api/fs/pptx 接口的实现。
不依赖主程序 mixin_project，只要求调用方 handler 提供：
  - handler._send_json(data, code=200)
  - handler._send_error(msg, code)
  - handler.send_response / send_header / end_headers / wfile  (标准 BaseHTTPRequestHandler)
主程序 mixin_project.py 通过薄接入点调用 handle_fs_pptx(self, parsed)。

后续 Word/Excel 预览引擎也可加在本模块，统一走「办公文档工具」。
"""

import os
import re
import traceback
from urllib.parse import parse_qs


def handle_fs_pptx(handler, parsed):
    """【PPTX 内置预览】/api/fs/pptx?path=...&slide=N：解析 pptx（zip+XML），无需 Office。
    不带 slide → 返回每页文字大纲 JSON；带 slide=N → 返回该页嵌入图片（原样二进制）。"""
    import zipfile, json as _json
    from xml.etree import ElementTree as ET
    qs = parse_qs(parsed.query)
    raw_path = (qs.get('path', [''])[0] or '').strip()
    slide_no = qs.get('slide', [''])[0]
    try:
        if not raw_path:
            handler._send_error('缺少 path 参数', 400)
            return
        rp = os.path.realpath(raw_path)
        if not os.path.isfile(rp):
            handler._send_error('文件不存在: ' + raw_path, 404)
            return
        if not rp.lower().endswith('.pptx'):
            handler._send_error('仅支持 .pptx（.ppt 老格式请用系统程序打开）', 403)
            return
        z = zipfile.ZipFile(rp)
        names = z.namelist()
        slide_re = re.compile(r'^ppt/slides/slide(\d+)\.xml$')
        slide_nums = sorted(int(slide_re.match(n).group(1)) for n in names if slide_re.match(n))

        # 带slide参数：返回该页某张图片二进制
        m_slide = re.match(r'^\d+$', slide_no or '')
        if m_slide:
            idx = int(slide_no)
            media_names = sorted(n for n in names if n.startswith('ppt/media/'))
            # 该页引用的图片（按 rels）
            rel_name = 'ppt/slides/_rels/slide%d.xml.rels' % idx
            targets = []
            if rel_name in names:
                rels = z.read(rel_name).decode('utf-8', 'ignore')
                targets = re.findall(r'Target="([^"]*media/[^"]+)"', rels)
            picked = []
            for t in targets:
                t = t.replace('../', 'ppt/')
                t = t.lstrip('/')
                if t in names:
                    picked.append(t)
            if not picked:
                # 兜底：按文件名顺序给该 slide 一张（尽量取图片）
                img = [n for n in media_names if re.search(r'\.(png|jpe?g|gif|bmp)$', n, re.I)]
                picked = img[idx - 1:idx] if idx - 1 < len(img) else []
            if not picked:
                handler._send_error('该页无图片', 404)
                return
            data = z.read(picked[0])
            ext = os.path.splitext(picked[0])[1].lower()
            ctype = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                     '.gif': 'image/gif', '.bmp': 'image/bmp'}.get(ext, 'application/octet-stream')
            handler.send_response(200)
            handler.send_header('Content-Type', ctype)
            handler.send_header('Content-Length', str(len(data)))
            handler.send_header('Cache-Control', 'no-cache')
            handler.end_headers()
            handler.wfile.write(data)
            return

        # 不带slide：返回大纲 JSON
        slides = []
        for num in slide_nums:
            try:
                root = ET.fromstring(z.read('ppt/slides/slide%d.xml' % num))
                paras = []
                for p_el in root.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}p'):
                    runs = [t.text or '' for t in p_el.iter('{http://schemas.openxmlformats.org/drawingml/2006/main}t')]
                    line = ''.join(runs).strip()
                    if line:
                        paras.append(line)
                # 该页是否有图片
                rel_name = 'ppt/slides/_rels/slide%d.xml.rels' % num
                has_img = False
                if rel_name in names:
                    rels = z.read(rel_name).decode('utf-8', 'ignore')
                    has_img = any(re.search(r'media/.*\.(png|jpe?g|gif|bmp)', t, re.I)
                                  for t in re.findall(r'Target="([^"]+)"', rels))
                slides.append({'no': num, 'lines': paras, 'hasImage': has_img})
            except Exception as se:
                slides.append({'no': num, 'lines': ['（第 %d 页解析失败: %s）' % (num, se)], 'hasImage': False})
        handler._send_json({'ok': True, 'path': rp, 'count': len(slides), 'slides': slides})
    except Exception as e:
        print(f'[GET /api/fs/pptx] 500 错误: {e}')
        traceback.print_exc()
        handler._send_error(str(e), 500)
