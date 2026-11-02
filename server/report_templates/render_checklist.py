# -*- coding: utf-8 -*-
"""checklist 模板 — 清单核对型。
协议: {headline, checklist:[{text, done:bool, note?}]}"""
EXTRA_CSS = """
.ck{list-style:none;padding:0;margin-top:12px}
.ck li{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-bottom:1px dashed var(--line)}
.ck li:last-child{border-bottom:none}
.ck-box{flex:none;width:20px;height:20px;border-radius:6px;display:flex;align-items:center;
  justify-content:center;font-size:12px;color:#fff;margin-top:2px}
.ck-done .ck-box{background:var(--good)}
.ck-todo .ck-box{background:var(--bad)}
.ck-note{display:block;font-size:12px;color:var(--ink2)}
"""


def render_body(data, esc):
    out = ['<style>' + EXTRA_CSS + '</style><ul class="ck">']
    for it in data.get('checklist', []):
        done = bool(it.get('done'))
        cls = 'ck-done' if done else 'ck-todo'
        mark = '✓' if done else '✗'
        note = f"<span class=\"ck-note\">{esc(it['note'])}</span>" if it.get('note') else ''
        out.append(f"<li class=\"{cls}\"><span class=\"ck-box\">{mark}</span><span>{esc(it.get('text',''))}{note}</span></li>")
    out.append('</ul>')
    return '\n'.join(out)
