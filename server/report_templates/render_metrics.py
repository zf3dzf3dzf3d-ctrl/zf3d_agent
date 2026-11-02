# -*- coding: utf-8 -*-
"""metrics 模板 — 数据仪表型。
协议: {headline, metrics:[{label, value, max?, hint?}]}"""
EXTRA_CSS = """
.mgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:14px}
.mcard{border:1px solid var(--line);border-radius:12px;padding:14px;text-align:center}
.mval{font-size:24px;font-weight:700;color:var(--brand)}
.mbar{height:6px;border-radius:3px;background:var(--line);margin:8px 0 4px;overflow:hidden}
.mbar>i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,var(--brand),var(--brand2))}
.mhint{font-size:12px;color:var(--ink2)}
"""


def render_body(data, esc):
    out = ['<style>' + EXTRA_CSS + '</style><div class="mgrid">']
    for m in data.get('metrics', []):
        bar = ''
        try:
            if m.get('max'):
                pct = min(100, max(0, float(m['value']) / float(m['max']) * 100))
                bar = f"<div class=\"mbar\"><i style=\"width:{pct:.0f}%\"></i></div>"
        except Exception:
            pass
        hint = f"<div class=\"mhint\">{esc(m['hint'])}</div>" if m.get('hint') else ''
        out.append(f"<div class=\"mcard\"><div class=\"mval\">{esc(m.get('value',''))}</div>"
                   f"<div>{esc(m.get('label',''))}</div>{bar}{hint}</div>")
    out.append('</div>')
    return '\n'.join(out)
