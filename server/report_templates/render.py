# -*- coding: utf-8 -*-
"""
report_templates/render.py — 总结师美化报告渲染器 (2026-XX)

输入：轻量 JSON 协议（dict 或纯文本），输出：自包含 HTML 字符串。
- 5 种布局模板：comparison / timeline / checklist / metrics / narrative(兜底)
- 共享设计 token（CSS 变量，自动暗色适配）
- 空区块自动隐藏；layout 缺省时按内容启发式自动选模板
非硬编码：新增布局只需在 report_templates/ 加一个 render_<layout>.py 并注册 LAYOUTS。
"""
import html
import importlib
import json
import os
import re

_BASE = os.path.dirname(os.path.abspath(__file__))

# 布局注册表：模块名 -> 优先级（启发式匹配时按序尝试）
LAYOUTS = ['comparison', 'timeline', 'checklist', 'metrics', 'narrative']

# ---------- 设计 token（所有模板共享） ----------
TOKENS_CSS = """
:root{
  --bg:#f6f7fb; --card:#ffffff; --ink:#1c2333; --ink2:#5b6478; --line:#e6e9f2;
  --brand:#3b6ef6; --brand2:#8a4bF6; --good:#18a058; --bad:#e5484d; --warn:#f5a623;
  --radius:14px; --shadow:0 6px 24px rgba(28,35,51,.08);
}
@media (prefers-color-scheme: dark){
  :root{ --bg:#12151d; --card:#1b2030; --ink:#e8ebf4; --ink2:#9aa3ba; --line:#2a3044;
         --shadow:0 6px 24px rgba(0,0,0,.4); }
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);
  font-family:-apple-system,"PingFang SC","Microsoft YaHei",system-ui,sans-serif;
  line-height:1.7;padding:24px 16px}
.wrap{max-width:760px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:var(--shadow);padding:22px;margin-bottom:18px}
.badge{display:inline-block;font-size:12px;color:#fff;background:linear-gradient(135deg,var(--brand),var(--brand2));
  padding:3px 12px;border-radius:999px;margin-bottom:10px}
h1{font-size:22px;margin-bottom:6px}
.sub{color:var(--ink2);font-size:13px;margin-bottom:4px}
h2{font-size:16px;margin:18px 0 10px;padding-left:10px;border-left:3px solid var(--brand)}
h3{font-size:14px;margin:12px 0 6px}
p,li{font-size:14px;color:var(--ink)}
ul{padding-left:20px}
.footer{color:var(--ink2);font-size:12px;text-align:center;margin-top:8px}
a{color:var(--brand)}
"""


def esc(v):
    return html.escape(str(v if v is not None else ''))


def _load_layout(name):
    try:
        mod = importlib.import_module('report_templates.render_' + name)
        return mod
    except Exception:
        return None


def _guess_layout(data):
    """内容启发式：按 JSON 字段特征自动选模板"""
    if data.get('compare') or data.get('versus'):
        return 'comparison'
    if data.get('steps') or data.get('timeline'):
        return 'timeline'
    if data.get('checklist') or data.get('items'):
        return 'checklist'
    if data.get('metrics') or data.get('scores'):
        return 'metrics'
    return 'narrative'


def render(data, title='智能体总结报告'):
    """渲染入口。data: dict(JSON协议) 或 str(纯文本走 narrative 兜底)。
    返回完整自包含 HTML 字符串。"""
    if isinstance(data, str):
        data = {'layout': 'narrative', 'sections': [{'h': '', 'text': data}]}
    if not isinstance(data, dict):
        try:
            data = json.loads(str(data))
        except Exception:
            data = {'layout': 'narrative', 'sections': [{'text': str(data)}]}

    layout = data.get('layout')
    if layout not in LAYOUTS:
        layout = _guess_layout(data)

    mod = _load_layout(layout) or _load_layout('narrative')
    body = mod.render_body(data, esc)  # 各模板实现 render_body(data, esc)->str

    head = data.get('headline') or title
    meta = data.get('meta') or {}
    meta_bits = ' · '.join(esc(v) for v in meta.values() if v)
    return f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(head)}</title>
<style>{TOKENS_CSS}</style></head>
<body><div class="wrap">
<div class="card">
  <span class="badge">朱峰智能体 · 总结报告</span>
  <h1>{esc(head)}</h1>
  {f'<div class="sub">{meta_bits}</div>' if meta_bits else ''}
  {body}
</div>
<div class="footer">由朱峰社区智能体自动生成 · {esc(data.get('date', ''))}</div>
</div></body></html>"""


def render_to_file(data, path, **kw):
    html_text = render(data, **kw)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html_text)
    return path
