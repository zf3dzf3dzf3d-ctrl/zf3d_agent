# -*- coding: utf-8 -*-
"""comparison 模板 — 红蓝对比条（对标 WorkBuddy 报告页）。
协议: {headline, compare:{left:{label,score?,points:[]}, right:{label,score?,points:[]}}, verdict?}"""
EXTRA_CSS = """
.vs{display:flex;gap:12px;margin-top:12px;flex-wrap:wrap}
.vs-col{flex:1 1 260px;border-radius:12px;padding:16px;border:1px solid var(--line)}
.vs-left{background:rgba(59,110,246,.07)}
.vs-right{background:rgba(229,72,77,.07)}
.vs-col h3{margin-top:0}
.vs-score{font-size:26px;font-weight:700}
.vs-left .vs-score{color:var(--brand)}
.vs-right .vs-score{color:var(--bad)}
.verdict{margin-top:14px;padding:12px 14px;border-radius:10px;background:rgba(24,160,88,.08);
  border:1px solid rgba(24,160,88,.25);font-size:14px}
"""


def render_body(data, esc):
    cmp_ = data.get('compare') or {}
    left, right = cmp_.get('left', {}), cmp_.get('right', {})
    out = ['<style>' + EXTRA_CSS + '</style><div class="vs">']
    for cls, col in (('vs-left', left), ('vs-right', right)):
        pts = ''.join(f"<li>{esc(p)}</li>" for p in col.get('points', []))
        score = f"<div class=\"vs-score\">{esc(col['score'])}</div>" if col.get('score') else ''
        out.append(f"<div class=\"vs-col {cls}\"><h3>{esc(col.get('label',''))}</h3>{score}<ul>{pts}</ul></div>")
    out.append('</div>')
    if data.get('verdict'):
        out.append(f"<div class=\"verdict\">✅ {esc(data['verdict'])}</div>")
    return '\n'.join(out)


# 统一暴露名：与其他模板 render_xxx 命名对齐
render_comparison = render_body
