# -*- coding: utf-8 -*-
"""timeline 模板 — 步骤/时间线型。
协议: {headline, steps:[{t:标题, d:描述?, time?}]}"""
EXTRA_CSS = """
.tl{margin-top:14px;padding-left:6px}
.tl-item{position:relative;padding:0 0 18px 26px;border-left:2px solid var(--line)}
.tl-item:last-child{border-left-color:transparent}
.tl-item::before{content:'';position:absolute;left:-7px;top:4px;width:12px;height:12px;
  border-radius:50%;background:var(--brand);box-shadow:0 0 0 3px rgba(59,110,246,.2)}
.tl-time{font-size:12px;color:var(--ink2)}
.tl-item h3{margin:2px 0 4px}
"""


def render_body(data, esc):
    out = ['<style>' + EXTRA_CSS + '</style><div class="tl">']
    for s in data.get('steps', []):
        time = f"<span class=\"tl-time\">{esc(s['time'])}</span>" if s.get('time') else ''
        d = f"<p>{esc(s['d'])}</p>" if s.get('d') else ''
        out.append(f"<div class=\"tl-item\">{time}<h3>{esc(s.get('t',''))}</h3>{d}</div>")
    out.append('</div>')
    return '\n'.join(out)
