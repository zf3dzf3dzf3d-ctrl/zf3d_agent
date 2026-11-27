# -*- coding: utf-8 -*-
"""narrative 模板 — 图文叙述型（兜底）。
协议: {headline, sections:[{h?, text}]}"""
EXTRA_CSS = ""


def render_body(data, esc):
    out = []
    for sec in data.get('sections', []):
        if sec.get('h'):
            out.append(f"<h2>{esc(sec['h'])}</h2>")
        if sec.get('text'):
            for para in str(sec['text']).split('\n'):
                para = para.strip()
                if para:
                    out.append(f"<p>{esc(para)}</p>")
    return '\n'.join(out)
