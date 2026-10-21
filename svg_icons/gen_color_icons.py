# -*- coding: utf-8 -*-
"""生成彩色精致风 SVG 图标预览页（渐变+配色，接近 emoji 质感）"""
import os

GRADS = """
<linearGradient id="gArrNav" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7DD0FF"/><stop offset="1" stop-color="#2F7BFF"/></linearGradient>
<linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6EC6FF"/><stop offset="1" stop-color="#2196F3"/></linearGradient>
<linearGradient id="gGreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7DE38B"/><stop offset="1" stop-color="#34A853"/></linearGradient>
<linearGradient id="gOrange" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFC46B"/><stop offset="1" stop-color="#F57C00"/></linearGradient>
<linearGradient id="gPurple" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C89BFF"/><stop offset="1" stop-color="#7B3FE4"/></linearGradient>
<linearGradient id="gRed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8A8A"/><stop offset="1" stop-color="#E53935"/></linearGradient>
<linearGradient id="gTeal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#64E0D0"/><stop offset="1" stop-color="#009688"/></linearGradient>
<linearGradient id="gPink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF9BC0"/><stop offset="1" stop-color="#EC407A"/></linearGradient>
<linearGradient id="gGold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE082"/><stop offset="1" stop-color="#F9A825"/></linearGradient>
<linearGradient id="gIndigo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8C9EFF"/><stop offset="1" stop-color="#3D5AFE"/></linearGradient>
<linearGradient id="gGray" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B0BEC5"/><stop offset="1" stop-color="#607D8B"/></linearGradient>
"""

# name, 原emoji, 渐变, svg body(24x24)
ICONS = [
 ("clipboard","📋","gBlue",'<rect x="5" y="4" width="14" height="17" rx="2.5" fill="url(#gBlue)"/><rect x="9" y="2" width="6" height="4" rx="1.5" fill="#546E7A"/><rect x="8" y="10" width="8" height="1.8" rx="0.9" fill="#fff" opacity=".9"/><rect x="8" y="14" width="6" height="1.8" rx="0.9" fill="#fff" opacity=".7"/>'),
 ("gear","⚙️","gGray",'<path d="M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zm9 4.5l-2.2-.6a7 7 0 00-.7-1.7l1.2-2-1.5-1.5-2 1.2a7 7 0 00-1.7-.7L13.5 3h-3l-.6 2.2a7 7 0 00-1.7.7l-2-1.2L4.7 6.2l1.2 2a7 7 0 00-.7 1.7L3 10.5v3l2.2.6c.2.6.4 1.2.7 1.7l-1.2 2 1.5 1.5 2-1.2c.5.3 1.1.5 1.7.7l.6 2.2h3l.6-2.2c.6-.2 1.2-.4 1.7-.7l2 1.2 1.5-1.5-1.2-2c.3-.5.5-1.1.7-1.7l2.2-.6v-3z" fill="url(#gGray)"/><circle cx="12" cy="12" r="3.5" fill="#ECEFF1"/>'),
 ("chat","💬","gBlue",'<path d="M4 4h16a2 2 0 012 2v10a2 2 0 01-2 2H9l-5 4V6a2 2 0 012-2z" fill="url(#gBlue)"/><circle cx="9" cy="11" r="1.4" fill="#fff"/><circle cx="13" cy="11" r="1.4" fill="#fff"/><circle cx="17" cy="11" r="1.4" fill="#fff"/>'),
 ("robot","🤖","gIndigo",'<rect x="4" y="8" width="16" height="12" rx="3" fill="url(#gIndigo)"/><circle cx="12" cy="4" r="1.6" fill="#FFC46B"/><rect x="5" y="3" width="2.5" height="6" rx="1.2" fill="#3D5AFE"/><rect x="16.5" y="3" width="2.5" height="6" rx="1.2" fill="#3D5AFE"/><circle cx="9" cy="14" r="1.8" fill="#fff"/><circle cx="15" cy="14" r="1.8" fill="#fff"/><circle cx="9" cy="14" r="0.8" fill="#1A237E"/><circle cx="15" cy="14" r="0.8" fill="#1A237E"/><rect x="10" y="17.5" width="4" height="1.4" rx="0.7" fill="#fff" opacity=".8"/>'),
 ("palette","🎨","gPink",'<path d="M12 3a9 9 0 000 18c1.5 0 2-1 1.5-2-.6-1.2.2-2.5 1.7-2.5H18a3.5 3.5 0 003.5-3.5C21.5 7.5 17.3 3 12 3z" fill="url(#gPink)"/><circle cx="8" cy="9" r="1.5" fill="#FFEB3B"/><circle cx="12" cy="7.2" r="1.5" fill="#4FC3F7"/><circle cx="16" cy="9" r="1.5" fill="#81C784"/><circle cx="7.5" cy="13.5" r="1.5" fill="#FF8A65"/>'),
 ("lock","🔒","gGold",'<rect x="5" y="10" width="14" height="11" rx="2.5" fill="url(#gGold)"/><path d="M8 10V7.5a4 4 0 018 0V10" fill="none" stroke="#B8860B" stroke-width="2.2"/><circle cx="12" cy="15" r="1.8" fill="#795548"/><rect x="11.2" y="15.5" width="1.6" height="3" rx="0.8" fill="#795548"/>'),
 ("save","💾","gIndigo",'<path d="M4 6a2 2 0 012-2h11l3 3v11a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" fill="url(#gIndigo)"/><rect x="8" y="4" width="8" height="5" rx="1" fill="#C5CAE9"/><rect x="7" y="13" width="10" height="7" rx="1.5" fill="#E8EAF6"/><rect x="13.5" y="5" width="1.8" height="3" rx="0.9" fill="#3D5AFE"/>'),
 ("folder","📁","gGold",'<path d="M3 6a2 2 0 012-2h5l2 2.5h7a2 2 0 012 2V18a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" fill="url(#gGold)"/><path d="M3 10h18v8a2 2 0 01-2 2H5a2 2 0 01-2-2v-8z" fill="#FFC93A"/>'),
 ("image","🖼️","gTeal",'<rect x="3" y="4" width="18" height="16" rx="2.5" fill="url(#gTeal)"/><circle cx="8.5" cy="9.5" r="2" fill="#FFF59D"/><path d="M3 17l5-5 4 4 3.5-3.5L21 18v.5a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5V17z" fill="#B2DFDB"/>'),
 ("search","🔍","gBlue",'<circle cx="10.5" cy="10.5" r="6.5" fill="url(#gBlue)"/><circle cx="10.5" cy="10.5" r="4" fill="#E3F2FD"/><rect x="15" y="14" width="8" height="3.2" rx="1.6" transform="rotate(45 15 14)" fill="#546E7A"/>'),
 ("check","✅","gGreen",'<rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="url(#gGreen)"/><path d="M7 12.5l3.4 3.5L17.5 8.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>'),
 ("cross","❌","gRed",'<rect x="2.5" y="2.5" width="19" height="19" rx="5" fill="url(#gRed)"/><path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>'),
 ("warning","⚠️","gOrange",'<path d="M12 3L22 20H2L12 3z" fill="url(#gOrange)"/><rect x="11" y="9.5" width="2" height="5.5" rx="1" fill="#fff"/><circle cx="12" cy="17.3" r="1.2" fill="#fff"/>'),
 ("sparkles","✨","gGold",'<path d="M9 3l1.8 4.7L15.5 9.5l-4.7 1.8L9 16l-1.8-4.7L2.5 9.5l4.7-1.8L9 3z" fill="url(#gGold)"/><path d="M17.5 12l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2 1.2-3z" fill="#FFC46B"/>'),
 ("bulb","💡","gGold",'<path d="M12 2.5a6.5 6.5 0 00-3.8 11.8c.8.6 1.3 1.3 1.3 2.2h5c0-.9.5-1.6 1.3-2.2A6.5 6.5 0 0012 2.5z" fill="url(#gGold)"/><rect x="9.5" y="17.5" width="5" height="1.6" rx="0.8" fill="#8D6E63"/><rect x="10" y="19.8" width="4" height="1.6" rx="0.8" fill="#8D6E63"/>'),
 ("bolt","⚡","gGold",'<path d="M13.5 2L5 13.5h5L9 22l9-12h-5.5L13.5 2z" fill="url(#gGold)" stroke="#F57F17" stroke-width="0.8" stroke-linejoin="round"/>'),
 ("trash","🗑️","gGray",'<rect x="4" y="6" width="16" height="3" rx="1.5" fill="#78909C"/><path d="M6 9h12l-1 11a2 2 0 01-2 1.8H9A2 2 0 017 20L6 9z" fill="url(#gGray)"/><rect x="9.5" y="3" width="5" height="3" rx="1.2" fill="#546E7A"/><rect x="9" y="11.5" width="1.6" height="7" rx="0.8" fill="#CFD8DC"/><rect x="13.4" y="11.5" width="1.6" height="7" rx="0.8" fill="#CFD8DC"/>'),
 ("pencil","📝","gOrange",'<rect x="4" y="4" width="16" height="16" rx="2.5" fill="#E3F2FD" stroke="#64B5F6" stroke-width="1.2"/><path d="M14.5 5.5l4 4L10 18l-4.5.5L6 14l8.5-8.5z" fill="url(#gOrange)"/><path d="M13 7l4 4" stroke="#E65100" stroke-width="1"/><path d="M6.5 17.8l2.8-.5-2.3-2.3-.5 2.8z" fill="#5D4037"/>'),
 ("star","⭐","gGold",'<path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5L2.6 9.3l6.5-.9L12 2.5z" fill="url(#gGold)" stroke="#F57F17" stroke-width="0.8" stroke-linejoin="round"/>'),
 ("heart","❤️","gRed",'<path d="M12 21S3 14.7 3 8.8C3 5.6 5.4 3.5 8 3.5c1.7 0 3.2.9 4 2.3.8-1.4 2.3-2.3 4-2.3 2.6 0 5 2.1 5 5.3C21 14.7 12 21 12 21z" fill="url(#gRed)"/>'),
 ("user","👤","gBlue",'<circle cx="12" cy="8" r="4.5" fill="url(#gBlue)"/><path d="M3.5 21c.8-4.2 4.3-6.5 8.5-6.5s7.7 2.3 8.5 6.5h-17z" fill="url(#gBlue)"/>'),
 ("users","👥","gTeal",'<circle cx="9" cy="8.5" r="3.8" fill="url(#gTeal)"/><path d="M2 20c.7-3.6 3.6-5.5 7-5.5s6.3 1.9 7 5.5H2z" fill="url(#gTeal)"/><circle cx="17" cy="9" r="3" fill="#80CBC4"/><path d="M16 14.7c3 .3 5.4 2 6 5.3h-4.5" fill="#80CBC4"/>'),
 ("bell","🔔","gOrange",'<path d="M12 3a6 6 0 00-6 6v4l-2 3.5h16L18 13V9a6 6 0 00-6-6z" fill="url(#gOrange)"/><path d="M9.5 17.5a2.5 2.5 0 005 0h-5z" fill="#F57C00"/><circle cx="12" cy="3" r="1.4" fill="#5D4037"/>'),
 ("clock","🕐","gBlue",'<circle cx="12" cy="12" r="9" fill="url(#gBlue)"/><circle cx="12" cy="12" r="6.8" fill="#E3F2FD"/><path d="M12 7.5V12l3.2 2" stroke="#1565C0" stroke-width="1.8" stroke-linecap="round" fill="none"/>'),
 ("calendar","📅","gRed",'<rect x="3" y="5" width="18" height="16" rx="2.5" fill="url(#gRed)"/><rect x="3" y="5" width="18" height="5" rx="2.5" fill="#E53935"/><rect x="7" y="3" width="2.4" height="4" rx="1.2" fill="#B71C1C"/><rect x="14.6" y="3" width="2.4" height="4" rx="1.2" fill="#B71C1C"/><g fill="#FFCDD2"><rect x="7" y="12.5" width="3" height="2.6" rx="0.8"/><rect x="10.5" y="12.5" width="3" height="2.6" rx="0.8"/><rect x="14" y="12.5" width="3" height="2.6" rx="0.8"/><rect x="7" y="16.3" width="3" height="2.6" rx="0.8"/><rect x="10.5" y="16.3" width="3" height="2.6" rx="0.8"/></g>'),
 ("download","⬇️","gGreen",'<path d="M11 3h2a1.5 1.5 0 011.5 1.5v7.2h3L12 18.5 6.5 11.7h3V4.5A1.5 1.5 0 0111 3z" fill="url(#gGreen)"/><rect x="4" y="19.5" width="16" height="2.6" rx="1.3" fill="#2E7D32"/>'),
 ("upload","⬆️","gBlue",'<path d="M11 18.5h2a1.5 1.5 0 001.5-1.5V9.8h3L12 3 6.5 9.8h3V17a1.5 1.5 0 001.5 1.5z" fill="url(#gBlue)"/><rect x="4" y="19.5" width="16" height="2.6" rx="1.3" fill="#1565C0"/>'),
 ("link","🔗","gIndigo",'<path d="M10.5 13.5l3-3" stroke="#3D5AFE" stroke-width="2.4" stroke-linecap="round"/><path d="M8 16l-1.5 1.5a3.5 3.5 0 01-5-5L5 9a3.5 3.5 0 015 0" transform="translate(3 3)" fill="none" stroke="url(#gIndigo)" stroke-width="2.4" stroke-linecap="round"/><path d="M13 5l1.5-1.5a3.5 3.5 0 015 5L16 12a3.5 3.5 0 01-5 0" transform="translate(0 -1)" fill="none" stroke="url(#gIndigo)" stroke-width="2.4" stroke-linecap="round"/>'),
 ("eye","👁️","gTeal",'<path d="M12 5C6.5 5 2.7 9.3 1.5 12c1.2 2.7 5 7 10.5 7s9.3-4.3 10.5-7C21.3 9.3 17.5 5 12 5z" fill="url(#gTeal)"/><circle cx="12" cy="12" r="4.2" fill="#fff"/><circle cx="12" cy="12" r="2.3" fill="#004D40"/><circle cx="13.2" cy="10.8" r="0.8" fill="#fff"/>'),
 ("fire","🔥","gOrange",'<path d="M12 2s1 3-1.5 6C8 11 6 12.5 6 15.5A6 6 0 0018 16c0-2-1-3.5-2-5-.3 1.5-1.2 2.2-2 2.5.8-2.5.5-6.5-2-11.5z" fill="url(#gOrange)"/><path d="M12 11c-1.5 1.8-3 3-3 5a3 3 0 006 0c0-1.6-1.5-3.2-3-5z" fill="#FFE082"/>'),
 ("rocket","🚀","gIndigo",'<path d="M12 2c3.5 1.5 5.5 5 5.5 9l-2 6h-7l-2-6c0-4 2-7.5 5.5-9z" fill="url(#gIndigo)"/><circle cx="12" cy="9.5" r="2.3" fill="#E8EAF6"/><path d="M8.5 15.5L5 19l4-1M15.5 15.5L19 19l-4-1" fill="#FF7043"/><path d="M10.5 18.5c0 2 1.5 3.5 1.5 3.5s1.5-1.5 1.5-3.5h-3z" fill="#FFC46B"/>'),
 ("gift","🎁","gPink",'<rect x="3.5" y="10" width="17" height="11" rx="1.8" fill="url(#gPink)"/><rect x="3.5" y="7" width="17" height="4" rx="1.5" fill="#F06292"/><rect x="10.8" y="7" width="2.4" height="14" fill="#FFF176"/><path d="M12 7C10 3 5.5 3.5 6.5 6c.6 1.4 3 1.5 5.5 1zm0 0c2-4 6.5-3.5 5.5-1-.6 1.4-3 1.5-5.5 1z" fill="#FFF176"/>'),
 ("crown","👑","gGold",'<path d="M3 8l4 3 5-6.5L17 11l4-3-2 10.5H5L3 8z" fill="url(#gGold)" stroke="#F57F17" stroke-width="0.8" stroke-linejoin="round"/><circle cx="3.5" cy="7" r="1.5" fill="#FFD54F"/><circle cx="12" cy="4" r="1.5" fill="#FFD54F"/><circle cx="20.5" cy="7" r="1.5" fill="#FFD54F"/><circle cx="9" cy="14.5" r="1" fill="#E53935"/><circle cx="15" cy="14.5" r="1" fill="#2196F3"/>'),
 ("shield","🛡️","gTeal",'<path d="M12 2l8.5 3v6.5c0 5-3.5 8.8-8.5 10.5C7 20.3 3.5 16.5 3.5 11.5V5L12 2z" fill="url(#gTeal)"/><path d="M8.5 12l2.5 2.6 4.5-5" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
 ("key","🔑","gGold",'<circle cx="8" cy="8" r="5" fill="url(#gGold)"/><circle cx="8" cy="8" r="2" fill="#FFF8E1"/><path d="M11.5 11.5L20 20M17 17l2-2M14.5 14.5l2-2" stroke="#F9A825" stroke-width="2.6" stroke-linecap="round" fill="none"/>'),
 ("book","📖","gGreen",'<path d="M12 6c-1.5-1.5-4-2-7-2v14c3 0 5.5.5 7 2 1.5-1.5 4-2 7-2V4c-3 0-5.5.5-7 2z" fill="url(#gGreen)"/><path d="M12 6v14" stroke="#1B5E20" stroke-width="1.4"/>'),
 ("flag","🚩","gRed",'<path d="M5 3v18" stroke="#6D4C41" stroke-width="2" stroke-linecap="round"/><path d="M6.5 4h11l-2.5 3.5L17.5 11h-11V4z" fill="url(#gRed)"/>'),
 ("moon","🌙","gIndigo",'<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" fill="url(#gIndigo)"/><circle cx="17" cy="6" r="1" fill="#FFD54F"/><circle cx="20" cy="9.5" r="0.7" fill="#FFD54F"/>'),
 ("sun","☀️","gGold",'<circle cx="12" cy="12" r="5" fill="url(#gGold)"/><g stroke="#F9A825" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/></g>'),
]

cards = "\n".join(
    f'<div class="card"><div class="ic"><svg viewBox="0 0 24 24" width="64" height="64"><defs>{GRADS}</defs>{body}</svg></div>'
    f'<div class="nm">{name}</div><div class="em">{em}</div></div>'
    for name, em, g, body in ICONS)

html = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>朱峰图标库 · 彩色精致风 SVG 预览</title><style>
body{{font-family:"Microsoft YaHei",sans-serif;background:#f2f4f8;margin:0;padding:24px}}
h1{{text-align:center;color:#333;font-size:20px}}
p.sub{{text-align:center;color:#888;font-size:13px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;max-width:1200px;margin:0 auto}}
.card{{background:#fff;border-radius:12px;padding:16px 8px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.06);transition:.2s}}
.card:hover{{transform:translateY(-3px);box-shadow:0 6px 16px rgba(0,0,0,.12)}}
.nm{{font-size:12px;color:#555;margin-top:8px}}
.em{{font-size:20px;margin-top:4px;opacity:.85}}
</style></head><body>
<h1>朱峰图标库 · 彩色精致风 SVG（第2版）</h1>
<p class="sub">上=新 SVG 彩色版　下=原 emoji 对照</p>
<div class="grid">{cards}</div></body></html>"""

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "preview.html")
with open(out, "w", encoding="utf-8") as f:
    f.write(html)
print("OK", out)
