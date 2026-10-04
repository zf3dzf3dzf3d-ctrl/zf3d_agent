// ========== theme.js v30 - 20 种预制风格系统 ==========
// 彻底移除：颜色滑块、黑天/白天切换、跟随强度、色轮、背景图片
// 保留：20 种预制风格（每种自带全套配色）、对话框归属（ChatTheme）
// 背景色/背景特效归 Background 管（纯色 + 特效），风格只管 UI 配色

(function () {
    'use strict';

    /* ===== 20 种预制风格 =====
       每种风格自带完整 CSS 变量配置：背景/卡片/悬停/边框/文字/主色/特效色
       bg: 推荐背景色（用户仍可自行改背景色，风格切换不改背景除非勾选）
       fx: 推荐背景特效（仅提示，不自动改） */
    var STYLES = [
        { id: 'inkblack',  name: '墨黑极暗', mode: 'dark',  bg: '#060607', fx: 'none',
          vars: { bg: '#060607', card: '#111114', hover: '#17171b', border: '#1e1e22', text: '#c8c8cc', text2: '#6a6a72', accent: '#8a8a92' },
          extra: { '--radius': '4px', '--green': '#8a8a92', '--blue-rgb': '138, 138, 146' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: #060607 !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: #0e0e11 !important; border: 1px solid #1e1e22 !important; box-shadow: none !important; border-radius: 4px !important; } .zf-style-glow .card { background: #111114 !important; border: 1px solid #1c1c20 !important; box-shadow: none !important; border-radius: 4px !important; } .zf-style-glow .card:hover { background: #17171b !important; border-color: #26262c !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #d0d0d4 !important; font-weight: 500; text-shadow: none; } .zf-style-glow button, .zf-style-glow .btn { background: #1a1a1f !important; color: #b0b0b6 !important; border: 1px solid #2a2a30 !important; border-radius: 3px !important; box-shadow: none !important; font-weight: 500; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: #24242a !important; color: #d8d8dc !important; border-color: #3a3a42 !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #0c0c0f !important; border: 1px solid #22222a !important; color: #c8c8cc !important; border-radius: 3px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #3a3a44 !important; box-shadow: none !important; } .zf-style-glow .chatbox { background: #0e0e11 !important; border-color: #1e1e22 !important; } .zf-style-glow .status-dot.status-active { background: #6a6a72 !important; box-shadow: none; } .zf-style-glow a { color: #9a9aa2; } .zf-style-glow a:hover { color: #c0c0c8; } .zf-style-glow ::selection { background: #2e2e36; color: #e8e8ec; } .zf-style-glow * { text-shadow: none !important; }' },
        { id: 'hacker',    name: '黑客帝国', mode: 'dark', bg: '#000900', fx: 'none',
          vars: { bg: '#000900', card: '#03160a', hover: '#062812', border: '#0f4d22', text: '#7dff9e', text2: '#3d9e5c', accent: '#00ff41' },
          extra: { '--radius': '2px', '--green': '#00ff41', '--blue-rgb': '0, 255, 65' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: radial-gradient(1000px 600px at 50% 0%, rgba(0,255,65,0.06), transparent 60%), #000900 !important; } .zf-style-glow, .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow button { font-family: "Cascadia Code","Consolas","Courier New","Segoe UI Emoji",monospace; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *) { background: rgba(3,22,10,0.92) !important; border: 1px solid #0f4d22 !important; box-shadow: 0 0 14px rgba(0,255,65,0.15), inset 0 0 20px rgba(0,255,65,0.04) !important; border-radius: 2px !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #00ff41; text-shadow: 0 0 8px rgba(0,255,65,0.6); letter-spacing: 0.08em; } .zf-style-glow button, .zf-style-glow .btn { background: #04220f !important; color: #00ff41 !important; border: 1px solid #00ff41 !important; border-radius: 2px !important; text-transform: uppercase; letter-spacing: 0.1em; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: #00ff41 !important; color: #001a08 !important; box-shadow: 0 0 14px rgba(0,255,65,0.7); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #010d05 !important; border: 1px solid #0f4d22 !important; color: #7dff9e !important; caret-color: #00ff41; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #00ff41 !important; box-shadow: 0 0 8px rgba(0,255,65,0.4); } .zf-style-glow a { color: #00ff41; text-decoration: underline; } .zf-style-glow ::selection { background: #00ff41; color: #001a08; }' },
        { id: 'blackgold', name: '黑金奢华', mode: 'dark',  bg: '#0a0906', fx: 'none',
          vars: { bg: '#0a0906', card: '#15130d', hover: '#1d1a11', border: '#3a321c', text: '#e8ddc0', text2: '#9c8a5e', accent: '#d4af37' },
          extra: { '--radius': '4px', '--green': '#d4af37', '--blue-rgb': '212, 175, 55' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: radial-gradient(900px 500px at 50% -10%, rgba(212,175,55,0.07), transparent 60%), #0a0906 !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #17140c 0%, #100e08 100%) !important; border: 1px solid #3a321c !important; box-shadow: 0 2px 12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(212,175,55,0.08) !important; border-radius: 4px !important; } .zf-style-glow .card { background: #15130d !important; border: 1px solid #2e2817 !important; border-radius: 4px !important; box-shadow: none !important; } .zf-style-glow .card:hover { background: #1d1a11 !important; border-color: #4a3f22 !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #d4af37 !important; text-shadow: none; font-weight: 500; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #2a2415 0%, #1a160d 100%) !important; color: #e0c878 !important; border: 1px solid #4a3f22 !important; border-radius: 3px !important; box-shadow: none !important; font-weight: 500; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: linear-gradient(180deg, #3a321c 0%, #2a2415 100%) !important; color: #f0d890 !important; border-color: #6b5c30 !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #0e0c07 !important; border: 1px solid #2e2817 !important; color: #e8ddc0 !important; border-radius: 3px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #6b5c30 !important; box-shadow: none !important; } .zf-style-glow .chatbox { background: #15130d !important; border-color: #2e2817 !important; } .zf-style-glow .status-dot.status-active { background: #d4af37 !important; box-shadow: none; } .zf-style-glow a { color: #d4af37; } .zf-style-glow a:hover { color: #f0d890; } .zf-style-glow ::selection { background: #4a3f22; color: #f0d890; } .zf-style-glow * { text-shadow: none !important; }' },
        { id: 'iceaurora', name: '极光冰原', mode: 'dark', bg: '#060b14', fx: 'grid', vars: { bg: '#060b14', card: '#151e2e', hover: '#142036', border: '#1f3454', text: '#e0f2ff', text2: '#6e8bb0', accent: '#5cf2c8' }, extra: { '--radius': '14px', '--green': '#5cf2c8', '--blue-rgb': '92, 242, 200' }, extraCss: '.zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, rgba(92,242,200,0.06) 0%, rgba(92,140,242,0.05) 30%, rgba(13,22,38,0.94) 100%) !important; border: 1px solid rgba(92,242,200,0.28) !important; box-shadow: 0 0 30px rgba(92,242,200,0.12), inset 0 0 40px rgba(92,140,242,0.06) !important;  } .zf-style-glow .card { background: rgba(13,22,38,0.85); border: 1px solid rgba(92,242,200,0.18); } .zf-style-glow .card:hover { border-color: rgba(92,242,200,0.6); box-shadow: 0 0 20px rgba(92,242,200,0.25); transform: translateY(-2px); } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(120deg, rgba(92,242,200,0.2), rgba(92,140,242,0.25)) !important; color: #dffff5 !important; border: 1px solid rgba(92,242,200,0.4) !important; } .zf-style-glow button:hover { box-shadow: 0 0 18px rgba(92,242,200,0.45); } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(90deg, #5cf2c8, #7ab8ff, #c07aff); -webkit-background-clip: text; background-clip: text; color: transparent; } .zf-style-glow .status-dot.status-active { background: #5cf2c8 !important; }' },
        { id: 'toxicshroom', name: '毒蘑菇骷髅', mode: 'dark', bg: '#12081c', fx: 'none',
          vars: { bg: '#12081c', card: '#1e0f2c', hover: '#2a1540', border: '#5e2d8a', text: '#e6d9f5', text2: '#9a7cb8', accent: '#7ef23a' },
          extra: { '--radius': '10px', '--green': '#7ef23a', '--blue-rgb': '126, 242, 58' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: radial-gradient(900px 500px at 15% 0%, rgba(94,45,138,0.35), transparent 60%), radial-gradient(800px 500px at 90% 100%, rgba(126,242,58,0.10), transparent 55%), #12081c !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(165deg, rgba(42,21,64,0.9) 0%, rgba(24,12,36,0.95) 100%) !important; border: 1px solid #5e2d8a !important; box-shadow: 0 0 18px rgba(126,242,58,0.12), 0 6px 20px rgba(0,0,0,0.5) !important; border-radius: 10px !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #c9a0ff; text-shadow: 0 0 10px rgba(126,242,58,0.35); } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #6dd42e 0%, #4ea81a 100%) !important; color: #12081c !important; border: 1px solid #8bff4d !important; border-radius: 8px !important; font-weight: 700; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { box-shadow: 0 0 16px rgba(126,242,58,0.6); filter: brightness(1.08); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #180b26 !important; border: 1px solid #5e2d8a !important; color: #e6d9f5 !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #7ef23a !important; box-shadow: 0 0 8px rgba(126,242,58,0.4); } .zf-style-glow a { color: #9dff5e; } .zf-style-glow ::selection { background: #5e2d8a; color: #e6d9f5; }' },
        { id: 'plaindark', name: '黑暗朴素', mode: 'dark',  bg: '#0d0d0f', fx: 'netmouse',
          vars: { bg: '#0d0d0f', card: '#28282b', hover: '#1c1c20', border: '#2a2a30', text: '#d6d6d8', text2: '#7a7a82', accent: '#a0a0a8' },
          extra: { '--radius': '0px', '--green': '#a0a0a8', '--blue-rgb': '160, 160, 168' },
          extraCss: '* { border-radius: 0 !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { border: 1px solid #2a2a30 !important; box-shadow: none !important; border-radius: 0 !important; } .zf-style-glow .card { border-radius: 0 !important; border: 1px solid #2a2a30; box-shadow: none !important; } .zf-style-glow button, .zf-style-glow .btn { border-radius: 0 !important; box-shadow: none !important; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { border-radius: 0 !important; } .zf-style-glow .zf-style-card.active { background: #1c1c20; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { letter-spacing: 0.12em; font-weight: 300; text-transform: uppercase; } .zf-style-glow, .zf-style-glow * { border-left: 0 none !important; } .zf-style-glow .tool-wrap, .zf-style-glow [class*="tool-wrap"], .zf-style-glow blockquote, .zf-style-glow [style*="border-left"], .zf-style-glow .context-loop-step { border-left: none !important; box-shadow: none !important; padding-left: 10px !important; } .zf-style-glow .status-dot.status-active { background: #8c8c94 !important; } .zf-style-glow .chatbox.active { border-color: #3a3a42 !important; }' },
        { id: 'greenbolt', name: '绿色闪电', mode: 'dark', bg: '#081008', fx: 'none',
          vars: { bg: '#081008', card: '#101c10', hover: '#152615', border: '#1f3a1f', text: '#d8f0d0', text2: '#6a9a6a', accent: '#4dff4d' },
          extra: { '--radius': '4px', '--green': '#4dff4d', '--blue-rgb': '77, 255, 77' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: radial-gradient(900px 500px at 50% -10%, rgba(77,255,77,0.06), transparent 60%), linear-gradient(180deg, #0a140a 0%, #060c06 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #122012 0%, #0b130b 100%) !important; border: 1px solid #1f3a1f !important; border-top: 2px solid #3dff3d !important; border-radius: 4px !important; box-shadow: 0 2px 12px rgba(0,0,0,0.6), 0 0 18px rgba(77,255,77,0.10) !important; } .zf-style-glow .card { background: #101c10 !important; border: 1px solid #1c331c !important; border-radius: 4px !important; box-shadow: none !important; } .zf-style-glow .card:hover { background: #152615 !important; border-color: #3dff3d !important; box-shadow: 0 0 12px rgba(77,255,77,0.28) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #4dff4d !important; text-shadow: 0 0 8px rgba(77,255,77,0.45); font-weight: 600; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #14301a 0%, #0c1e10 100%) !important; color: #7dff8d !important; border: 1px solid #2a5a2a !important; border-radius: 4px !important; box-shadow: none !important; font-weight: 500; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: linear-gradient(180deg, #1c4022 0%, #123018 100%) !important; color: #a5ffae !important; border-color: #3dff3d !important; box-shadow: 0 0 10px rgba(77,255,77,0.35) !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #0a120a !important; border: 1px solid #1c331c !important; color: #d8f0d0 !important; border-radius: 4px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #3dff3d !important; box-shadow: 0 0 8px rgba(77,255,77,0.25) !important; } .zf-style-glow .chatbox { background: #0e180e !important; border-color: #1c331c !important; } .zf-style-glow .status-dot.status-active { background: #4dff4d !important; box-shadow: 0 0 8px rgba(77,255,77,0.8); } .zf-style-glow a { color: #4dff4d; } .zf-style-glow a:hover { color: #a5ffae; text-shadow: 0 0 6px rgba(77,255,77,0.6); } .zf-style-glow ::selection { background: #1c4022; color: #d8ffd8; }' },
        { id: 'redgreen', name: '红绿撞色', mode: 'dark', bg: '#120d0d', fx: 'none',
          vars: { bg: '#120d0d', card: '#1e1414', hover: '#251818', border: '#3d2020', text: '#f0e0e0', text2: '#a87878', accent: '#e04040' },
          extra: { '--radius': '4px', '--green': '#3fae5a', '--blue-rgb': '224, 64, 64' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: radial-gradient(900px 500px at 50% -10%, rgba(224,64,64,0.07), transparent 60%), #120d0d !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #221515 0%, #171010 100%) !important; border: 1px solid #3d2020 !important; border-radius: 4px !important; box-shadow: 0 2px 12px rgba(0,0,0,0.6) !important; } .zf-style-glow .card { background: #1e1414 !important; border: 1px solid #33201f !important; border-left: 3px solid #3fae5a !important; border-radius: 4px !important; box-shadow: none !important; } .zf-style-glow .card:hover { background: #251818 !important; border-color: #5a2a2a !important; border-left-color: #e04040 !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #e04040 !important; text-shadow: none; font-weight: 600; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #7a2020 0%, #4e1414 100%) !important; color: #ffe0e0 !important; border: 1px solid #8a2828 !important; border-radius: 4px !important; box-shadow: none !important; font-weight: 500; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: linear-gradient(180deg, #8f2626 0%, #5e1a1a 100%) !important; color: #fff !important; border-color: #3fae5a !important; box-shadow: 0 0 10px rgba(63,174,90,0.3) !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #140d0d !important; border: 1px solid #33201f !important; color: #f0e0e0 !important; border-radius: 4px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #3fae5a !important; box-shadow: 0 0 8px rgba(63,174,90,0.2) !important; } .zf-style-glow .chatbox { background: #1a1212 !important; border-color: #33201f !important; } .zf-style-glow .status-dot.status-active { background: #3fae5a !important; box-shadow: 0 0 6px rgba(63,174,90,0.6); } .zf-style-glow a { color: #3fae5a; } .zf-style-glow a:hover { color: #6fd689; } .zf-style-glow ::selection { background: #7a2020; color: #ffe8e8; } .zf-style-glow * { text-shadow: none !important; }' },
        { id: 'midnight',  name: '极简暗夜', mode: 'dark',  bg: '#0a0e1a', fx: 'none',
          vars: { bg: '#0a0e1a', card: '#212634', hover: '#1a2135', border: '#252d42', text: '#e8eef8', text2: '#8b94a8', accent: '#4a9eff' } },
        { id: 'bronzeiron', name: '铜铁纪元', mode: 'dark', bg: '#120e08', fx: 'none',
          vars: { bg: '#120e08', card: '#241c12', hover: '#2a2014', border: '#4a3820', text: '#e8dcc8', text2: '#a08860', accent: '#c8862e' },
          extra: { '--radius': '4px', '--green': '#c8862e', '--blue-rgb': '200, 134, 46' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: radial-gradient(900px 500px at 50% -10%, rgba(200,134,46,0.07), transparent 60%), linear-gradient(180deg, #171208 0%, #0d0a06 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #2c2214 0%, #1c150c 100%) !important; border: 1px solid #4a3820 !important; border-top-color: #6e5428 !important; box-shadow: 0 2px 14px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,190,100,0.12) !important; border-radius: 4px !important; } .zf-style-glow .card { background: linear-gradient(180deg, #262012 0%, #1c160c 100%) !important; border: 1px solid #42341e !important; border-top-color: #644e26 !important; border-radius: 4px !important; box-shadow: inset 0 1px 0 rgba(255,190,100,0.08) !important; } .zf-style-glow .card:hover { border-color: #c8862e !important; box-shadow: 0 0 14px rgba(200,134,46,0.2), inset 0 1px 0 rgba(255,190,100,0.12) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(180deg, #f2e0b8 0%, #c8862e 100%); -webkit-background-clip: text; background-clip: text; color: transparent !important; text-shadow: none; font-weight: 600; letter-spacing: 0.04em; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #5a4424 0%, #332410 100%) !important; color: #f2e0b8 !important; border: 1px solid #6e5428 !important; border-top-color: #8a6c34 !important; border-radius: 3px !important; box-shadow: inset 0 1px 0 rgba(255,200,120,0.15), 0 1px 3px rgba(0,0,0,0.5) !important; font-weight: 600; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: linear-gradient(180deg, #6e5428 0%, #42301a 100%) !important; border-color: #c8862e !important; box-shadow: inset 0 1px 0 rgba(255,200,120,0.2), 0 0 10px rgba(200,134,46,0.25) !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #140f08 !important; border: 1px solid #42341e !important; color: #e8dcc8 !important; border-radius: 3px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #8a6c34 !important; box-shadow: 0 0 8px rgba(200,134,46,0.2) !important; } .zf-style-glow .chatbox { background: #1e180e !important; border-color: #42341e !important; } .zf-style-glow .status-dot.status-active { background: #c8862e !important; box-shadow: 0 0 6px rgba(200,134,46,0.6); } .zf-style-glow a { color: #d8a850; } .zf-style-glow a:hover { color: #f2d8a0; } .zf-style-glow ::selection { background: #5a4424; color: #f8eccc; }' },
      /* ===== 白色渐变系列（5 款浅色风格，配白色背景）===== */
        { id: 'silverempire', name: '白银帝国', mode: 'dark',  bg: '#0d0f12', fx: 'none',
          vars: { bg: '#0d0f12', card: '#191d23', hover: '#21262e', border: '#3a4048', text: '#e8ecf0', text2: '#8a929c', accent: '#c8d0da' },
          extra: { '--radius': '5px', '--green': '#c8d0da', '--blue-rgb': '200, 208, 218' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: radial-gradient(900px 500px at 50% -10%, rgba(200,210,225,0.08), transparent 60%), linear-gradient(180deg, #12151a 0%, #0b0d10 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #232830 0%, #171b21 100%) !important; border: 1px solid #454c56 !important; border-top-color: #7c8592 !important; box-shadow: 0 2px 14px rgba(0,0,0,0.6), inset 0 1px 0 rgba(230,236,244,0.12) !important; border-radius: 5px !important; } .zf-style-glow .card { background: linear-gradient(180deg, #20252c 0%, #181c22 100%) !important; border: 1px solid #3a4048 !important; border-top-color: #6a727e !important; border-radius: 5px !important; box-shadow: inset 0 1px 0 rgba(230,236,244,0.08) !important; } .zf-style-glow .card:hover { border-color: #8a93a0 !important; box-shadow: 0 0 16px rgba(200,210,225,0.18), inset 0 1px 0 rgba(230,236,244,0.12) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(180deg, #f2f5f8 0%, #9aa3ae 100%); -webkit-background-clip: text; background-clip: text; color: transparent !important; text-shadow: none; font-weight: 600; letter-spacing: 0.03em; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #4a525e 0%, #2b313a 100%) !important; color: #eef1f5 !important; border: 1px solid #5c6570 !important; border-top-color: #8a93a0 !important; border-radius: 4px !important; box-shadow: inset 0 1px 0 rgba(230,236,244,0.15), 0 1px 3px rgba(0,0,0,0.5) !important; font-weight: 600; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: linear-gradient(180deg, #5f6874 0%, #3a414c 100%) !important; border-color: #9aa3b0 !important; box-shadow: inset 0 1px 0 rgba(230,236,244,0.2), 0 0 12px rgba(200,210,225,0.25) !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #12151a !important; border: 1px solid #3a4048 !important; color: #e8ecf0 !important; border-radius: 4px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #8a93a0 !important; box-shadow: 0 0 8px rgba(200,210,225,0.2) !important; } .zf-style-glow .chatbox { background: #191d23 !important; border-color: #3a4048 !important; } .zf-style-glow .status-dot.status-active { background: #c8d0da !important; box-shadow: 0 0 6px rgba(200,210,225,0.6); } .zf-style-glow a { color: #b8c2ce; } .zf-style-glow a:hover { color: #eef1f5; } .zf-style-glow ::selection { background: #5c6570; color: #f2f5f8; }' },
        { id: 'rainbow',   name: '彩虹缤纷', mode: 'dark', bg: '#150a26', fx: 'none',
          vars: { bg: '#150a26', card: '#221436', hover: '#2d1b46', border: '#4a2f6e', text: '#f2e9ff', text2: '#a68ccc', accent: '#ff7ad9' },
          extra: { '--radius': '12px', '--green': '#5ef2a0', '--blue-rgb': '255, 122, 217' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(160deg, #1d0b33 0%, #0d1030 40%, #0a2520 70%, #2a0d26 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *) { background: rgba(30,18,48,0.9) !important; border: 1px solid #4a2f6e !important; box-shadow: 0 0 0 1px rgba(255,154,61,0.25), 0 0 24px rgba(120,80,255,0.25) !important; border-radius: 12px !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(90deg, #ff5d5d, #ff9a3d, #ffd23f, #5ef2a0, #4cc9f0, #b07aff); -webkit-background-clip: text; background-clip: text; color: transparent; font-weight: 800; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(90deg, #ff5d5d 0%, #ff9a3d 25%, #ffd23f 50%, #5ef2a0 75%, #4cc9f0 100%) !important; color: #1c1030 !important; font-weight: 800; border: none !important; border-radius: 10px !important; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { filter: brightness(1.12); box-shadow: 0 0 18px rgba(255,122,217,0.5); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #241540 !important; border: 1px solid #4a2f6e !important; color: #f2e9ff !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #ff7ad9 !important; box-shadow: 0 0 8px rgba(255,122,217,0.4); } .zf-style-glow a { color: #4cc9f0; } .zf-style-glow a:hover { color: #5ef2a0; } .zf-style-glow ::selection { background: #ff7ad9; color: #1c1030; }' },
        { id: 'mono', name: '灰白黑·中性', mode: 'dark',  bg: '#101010', fx: 'none',
          vars: { bg: '#101010', card: '#181818', hover: '#1f1f1f', border: '#2a2a2a', text: '#e0e0e0', text2: '#888888', accent: '#ffffff' },
          extra: { '--radius': '3px', '--green': '#cccccc', '--blue-rgb': '200, 200, 200' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: #101010 !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: #161616 !important; border: 1px solid #2a2a2a !important; box-shadow: none !important; border-radius: 3px !important; } .zf-style-glow .card { background: #181818 !important; border: 1px solid #262626 !important; box-shadow: none !important; border-radius: 3px !important; } .zf-style-glow .card:hover { background: #1f1f1f !important; border-color: #333333 !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #f0f0f0 !important; font-weight: 500; text-shadow: none; } .zf-style-glow button, .zf-style-glow .btn { background: #222222 !important; color: #d8d8d8 !important; border: 1px solid #333333 !important; border-radius: 3px !important; box-shadow: none !important; font-weight: 500; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: #2c2c2c !important; color: #ffffff !important; border-color: #444444 !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #131313 !important; border: 1px solid #282828 !important; color: #e0e0e0 !important; border-radius: 3px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #444444 !important; box-shadow: none !important; } .zf-style-glow .chatbox { background: #161616 !important; border-color: #2a2a2a !important; } .zf-style-glow .status-dot.status-active { background: #aaaaaa !important; box-shadow: none; } .zf-style-glow a { color: #d0d0d0; } .zf-style-glow a:hover { color: #ffffff; } .zf-style-glow ::selection { background: #3a3a3a; color: #ffffff; } .zf-style-glow * { text-shadow: none !important; filter: none !important; }' },
        { id: 'cobweb',    name: '蛛网暗尘', mode: 'dark', bg: '#101014', fx: 'netmouse',
          vars: { bg: '#101014', card: '#1a1a20', hover: '#232330', border: '#3a3a4a', text: '#d8d5e0', text2: '#8a8798', accent: '#9d8cff' },
          extra: { '--radius': '4px', '--green': '#7f96a8', '--blue-rgb': '157, 140, 255' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(170deg, #121218 0%, #0e0e13 60%, #14121c 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *) { background: rgba(24,24,32,0.94) !important; border: 1px solid #34324a !important; box-shadow: 0 4px 16px rgba(0,0,0,0.55), inset 0 1px 0 rgba(157,140,255,0.06) !important; border-radius: 4px !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #cfc6e8; letter-spacing: 0.06em; font-weight: 300; } .zf-style-glow button, .zf-style-glow .btn { background: #1e1c2c !important; color: #b3a8e8 !important; border: 1px solid #4a4468 !important; border-radius: 3px !important; letter-spacing: 0.06em; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: #2a2740 !important; color: #d0c8ff !important; border-color: #9d8cff !important; box-shadow: 0 0 10px rgba(157,140,255,0.25); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #131318 !important; border: 1px solid #34324a !important; color: #d8d5e0 !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #9d8cff !important; box-shadow: 0 0 6px rgba(157,140,255,0.3); } .zf-style-glow a { color: #a99cf0; } .zf-style-glow a:hover { color: #d0c8ff; } .zf-style-glow ::selection { background: #4a4468; }' },
/* ===== 金属系列（灰色底部）===== */
        { id: 'abyss',     name: '蓝绿海水', mode: 'dark',  bg: '#03151b', fx: 'bubbles',
          vars: { bg: '#03151b', card: 'rgba(7, 40, 50, 0.72)', hover: '#0d3a48', border: 'rgba(0, 229, 195, 0.28)', text: '#d8f6ff', text2: '#6fa8b8', accent: '#00e5c3' },
          extra: { '--radius': '18px', '--green': '#00e5c3', '--blue-rgb': '0, 229, 195' },
          extraCss: '.zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(160deg, rgba(0,229,195,0.10) 0%, rgba(7,34,43,0.85) 40%, rgba(3,21,27,0.92) 100%) !important;  border: 1px solid rgba(0,229,195,0.30); box-shadow: 0 0 30px rgba(0,229,195,0.18), inset 0 0 24px rgba(0,229,195,0.06); border-radius: 18px !important; } .zf-style-glow .card { background: linear-gradient(145deg, rgba(13,58,72,0.6), rgba(7,34,43,0.8)); border: 1px solid rgba(0,229,195,0.22); box-shadow: 0 0 18px rgba(0,229,195,0.15); border-radius: 14px !important; } .zf-style-glow .card:hover { transform: translateY(-2px); box-shadow: 0 6px 26px rgba(0,229,195,0.30); } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(135deg, rgba(0,229,195,0.16) 0%, rgba(0,150,160,0.28) 55%, rgba(0,229,195,0.30) 100%) !important; color: #bff5ec !important; border: 1px solid rgba(0,229,195,0.45) !important; font-weight: 600; border-radius: 12px !important; box-shadow: inset 0 1px 0 rgba(190,255,245,0.18), 0 0 10px rgba(0,229,195,0.12); text-shadow: 0 0 8px rgba(0,229,195,0.5); transition: all 0.15s; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: linear-gradient(135deg, rgba(0,229,195,0.30) 0%, rgba(0,180,180,0.42) 55%, rgba(0,229,195,0.46) 100%) !important; box-shadow: inset 0 1px 0 rgba(190,255,245,0.25), 0 0 18px rgba(0,229,195,0.28); } .zf-style-glow button:active, .zf-style-glow .btn:active { transform: translateY(1px); box-shadow: inset 0 2px 6px rgba(0,20,20,0.4); } .zf-style-glow input, .zf-style-glow textarea { border-radius: 12px !important; border-color: rgba(0,229,195,0.3) !important; } .zf-style-glow .zf-style-card.active, .zf-style-glow .active { text-shadow: 0 0 12px rgba(0,229,195,0.6); } .zf-style-glow ::selection { background: rgba(0,229,195,0.35); }' },
        { id: 'egypt', name: '古埃及法老', mode: 'dark', bg: '#1a1206', fx: 'star', vars: { bg: '#1a1206', card: '#362a18', hover: '#38280f', border: '#8a6a24', text: '#f7ecd2', text2: '#c0a05e', accent: '#e8b84b' }, extra: { '--radius': '6px', '--green': '#e8b84b', '--blue-rgb': '212, 165, 74' }, extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background-image: radial-gradient(ellipse at 50% -20%, rgba(255,200,90,0.14), transparent 55%), linear-gradient(180deg, rgba(212,165,74,0.05), transparent 45%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(170deg, rgba(80,58,20,0.5) 0%, rgba(42,30,12,0.96) 40%, #1a1206 100%) !important; border: 1px solid #8a6a24 !important; box-shadow: 0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,140,0.18) !important; } .zf-style-glow .panel::before { content: ""; display: block; height: 4px; background: repeating-linear-gradient(90deg, #e8b84b 0 14px, #1a1206 14px 20px, #c0a05e 20px 34px, #1a1206 34px 40px); margin: -1px -1px 0; opacity: 0.85; } .zf-style-glow .card { background: linear-gradient(150deg, rgba(90,66,26,0.55), rgba(42,30,12,0.92)); border: 1px solid #6b5220; border-radius: 6px !important; } .zf-style-glow .card:hover { border-color: #e8b84b; box-shadow: 0 0 20px rgba(232,184,75,0.3); transform: translateY(-2px); } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(135deg, #f5d87a 0%, #d4a532 50%, #8a6a24 100%) !important; color: #2a1e0c !important; font-weight: 700; border-radius: 4px !important; border: 1px solid #f5d87a !important; box-shadow: 0 3px 10px rgba(232,184,75,0.35), inset 0 1px 0 rgba(255,245,200,0.5); } .zf-style-glow button:hover { filter: brightness(1.1); box-shadow: 0 0 18px rgba(232,184,75,0.55); } .zf-style-glow input, .zf-style-glow textarea { background: #221808 !important; border: 1px solid #6b5220 !important; border-radius: 4px !important; color: #f7ecd2 !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #e8b84b !important; box-shadow: 0 0 10px rgba(232,184,75,0.35); } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(100deg, #f9e7b0 10%, #e8b84b 45%, #b08a3a 65%, #f9e7b0 95%); -webkit-background-clip: text; background-clip: text; color: transparent; letter-spacing: 0.1em; } .zf-style-glow a { color: #e8b84b; } .zf-style-glow a:hover { color: #f5d87a; text-shadow: 0 0 8px rgba(232,184,75,0.6); } .zf-style-glow .status-dot.status-active { background: #e8b84b !important; box-shadow: 0 0 8px rgba(232,184,75,0.8); }' },
        { id: 'inkwash', name: '水墨山水', mode: 'dark', bg: '#14161a', fx: 'none', vars: { bg: '#14161a', card: '#2c2f34', hover: '#23262c', border: 'transparent', text: '#d8d5cf', text2: '#8b8880', accent: '#a8b0a8' }, extra: { '--radius': '0px', '--green': '#a8b0a8', '--blue-rgb': '168, 176, 168' }, extraCss: '.zf-style-glow * { border-radius: 0 !important; border-color: rgba(255,255,255,0.04) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #1c1f24 0%, #171a1f 100%) !important; border: none !important; box-shadow: none !important; } .zf-style-glow .card { background: #1c1f24 !important; border: none !important; box-shadow: 0 1px 0 rgba(255,255,255,0.03) !important; } .zf-style-glow .card:hover { background: #22252b !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #e6e2d8 !important; text-shadow: none; letter-spacing: 2px; } .zf-style-glow strong { color: #cfd4cc !important; } .zf-style-glow button, .zf-style-glow .btn { background: #262a30 !important; color: #d8d5cf !important; border: none !important; border-radius: 0 !important; box-shadow: none !important; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: #33383f !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #101215 !important; border: none !important; border-bottom: 1px solid #3a3e45 !important; border-radius: 0 !important; color: #d8d5cf !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-bottom-color: #a8b0a8 !important; box-shadow: none; } .zf-style-glow .status-dot.status-active { background: #a8b0a8 !important; box-shadow: none; } .zf-style-glow a { color: #b9c0b6; } .zf-style-glow a:hover { color: #e6e2d8; } body.zf-style-glow, .zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #14161a 0%, #171a20 60%, #1a1e25 100%) !important; }' },
        { id: 'irongray', name: '铁色·灰底', mode: 'dark', bg: '#1b1c1d', fx: 'none', vars: { bg: '#1b1c1d', card: '#282a2c', hover: '#303234', border: '#404448', text: '#e4e6e8', text2: '#8d9196', accent: '#8a929c' }, extra: { '--radius': '6px', '--green': '#8a929c', '--blue-rgb': '#8a929c' }, extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #28292a 0%, #191a1b 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #343638 0%, #282a2c 100%) !important; border: 1px solid #404448 !important; border-bottom: 2px solid #66696c !important; box-shadow: 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(138,146,156,0.10) !important; border-radius: 6px !important; } .zf-style-glow .card { background: #282a2c !important; border: 1px solid #242628 !important; border-radius: 6px !important; } .zf-style-glow .card:hover { border-color: #8a929c !important; box-shadow: 0 0 12px rgba(138,146,156,0.25) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(180deg, #dce0e4 0%, #8a929c 100%); -webkit-background-clip: text; background-clip: text; color: transparent !important; font-weight: 600; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #565c62 0%, #40464c 100%) !important; color: #e8ebee !important; border: 1px solid #6e747a !important; border-radius: 6px !important; font-weight: 600; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { box-shadow: 0 0 14px rgba(138,146,156,0.5); filter: brightness(1.1); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #191a1b !important; border: 1px solid #232426 !important; color: #e4e6e8 !important; border-radius: 6px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #8a929c !important; box-shadow: 0 0 8px rgba(138,146,156,0.3) !important; } .zf-style-glow a { color: #8a929c; } .zf-style-glow a:hover { color: #dce0e4; } .zf-style-glow ::selection { background: #40464c; color: #e8ebee; } .zf-style-glow .status-dot.status-active { background: #8a929c !important; }' },
        { id: 'coppergray', name: '铜色·灰底', mode: 'dark', bg: '#1d1c1a', fx: 'none', vars: { bg: '#1d1c1a', card: '#2b2925', hover: '#34312c', border: '#4d4438', text: '#eee6da', text2: '#9c8f7c', accent: '#c87d3e' }, extra: { '--radius': '8px', '--green': '#c87d3e', '--blue-rgb': '#c87d3e' }, extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #2a2927 0%, #1b1a18 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #373532 0%, #2b2925 100%) !important; border: 1px solid #4d4438 !important; border-bottom: 2px solid #70695f !important; box-shadow: 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(200,125,62,0.10) !important; border-radius: 8px !important; } .zf-style-glow .card { background: #2b2925 !important; border: 1px solid #272522 !important; border-radius: 8px !important; } .zf-style-glow .card:hover { border-color: #c87d3e !important; box-shadow: 0 0 12px rgba(200,125,62,0.25) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(180deg, #f0c49a 0%, #c87d3e 100%); -webkit-background-clip: text; background-clip: text; color: transparent !important; font-weight: 600; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #8a5c30 0%, #6b4524 100%) !important; color: #f5e2cc !important; border: 1px solid #a0703c !important; border-radius: 8px !important; font-weight: 600; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { box-shadow: 0 0 14px rgba(200,125,62,0.5); filter: brightness(1.1); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #1b1a18 !important; border: 1px solid #252420 !important; color: #eee6da !important; border-radius: 8px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #c87d3e !important; box-shadow: 0 0 8px rgba(200,125,62,0.3) !important; } .zf-style-glow a { color: #c87d3e; } .zf-style-glow a:hover { color: #f0c49a; } .zf-style-glow ::selection { background: #6b4524; color: #f5e2cc; } .zf-style-glow .status-dot.status-active { background: #c87d3e !important; }' },
        { id: 'goldgray', name: '金色·灰底', mode: 'dark', bg: '#1c1c1e', fx: 'none', vars: { bg: '#1c1c1e', card: '#2a2a2c', hover: '#333330', border: '#4a4438', text: '#ece8dc', text2: '#9a927e', accent: '#d4af37' }, extra: { '--radius': '8px', '--green': '#d4af37', '--blue-rgb': '#d4af37' }, extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #29292b 0%, #1a1a1c 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #363638 0%, #2a2a2c 100%) !important; border: 1px solid #4a4438 !important; border-bottom: 2px solid #6e695f !important; box-shadow: 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(212,175,55,0.10) !important; border-radius: 8px !important; } .zf-style-glow .card { background: #2a2a2c !important; border: 1px solid #262628 !important; border-radius: 8px !important; } .zf-style-glow .card:hover { border-color: #d4af37 !important; box-shadow: 0 0 12px rgba(212,175,55,0.25) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(180deg, #f0dd9a 0%, #d4af37 100%); -webkit-background-clip: text; background-clip: text; color: transparent !important; font-weight: 600; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #8a7430 0%, #6b5a24 100%) !important; color: #f5ecc8 !important; border: 1px solid #a08a3c !important; border-radius: 8px !important; font-weight: 600; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { box-shadow: 0 0 14px rgba(212,175,55,0.5); filter: brightness(1.1); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #1a1a1c !important; border: 1px solid #242426 !important; color: #ece8dc !important; border-radius: 8px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #d4af37 !important; box-shadow: 0 0 8px rgba(212,175,55,0.3) !important; } .zf-style-glow a { color: #d4af37; } .zf-style-glow a:hover { color: #f0dd9a; } .zf-style-glow ::selection { background: #6b5a24; color: #f5ecc8; } .zf-style-glow .status-dot.status-active { background: #d4af37 !important; }' },
        { id: 'metal',    name: '灰色金属', mode: 'dark', bg: '#1a1d21', fx: 'none',
          vars: { bg: '#1a1d21', card: '#32353a', hover: '#31353b', border: '#3d4148', text: '#d7dade', text2: '#8b9098', accent: '#9aa4ae' },
          extra: { '--radius': '3px', '--blue-rgb': '154, 164, 174' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(160deg, #22262b 0%, #16181c 40%, #1d2126 70%, #141619 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .dialog, .zf-style-glow [class*="dialog"], .zf-style-glow .popup, .zf-style-glow [class*="popup"], .zf-style-glow .dropdown, .zf-style-glow [class*="dropdown"], .zf-style-glow .menu, .zf-style-glow [class*="menu"], .zf-style-glow .drawer, .zf-style-glow [class*="drawer"] { background: linear-gradient(135deg, #2c3036 0%, #22262b 45%, #2a2e34 60%, #1e2226 100%) !important; border: 1px solid #4a4f57 !important; border-top-color: #5d636c !important; border-radius: 3px !important; box-shadow: 0 2px 8px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.07), inset 0 -1px 0 rgba(0,0,0,0.4) !important; } .zf-style-glow .panel::before, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *)::before { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(90deg, rgba(255,255,255,0.028) 0 1px, transparent 1px 3px); pointer-events: none; border-radius: inherit; } .zf-style-glow .card, .zf-style-glow [class*="card"], .zf-style-glow [class*="bubble"], .zf-style-glow [class*="msg"] { background: linear-gradient(145deg, #2b2f35 0%, #23262b 50%, #292d33 100%) !important; border: 1px solid #43484f !important; border-top-color: #565c65 !important; border-radius: 3px !important; box-shadow: 0 2px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06) !important; } .zf-style-glow .card:hover { border-color: #6b727c !important; box-shadow: 0 3px 10px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.09) !important; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #4a5058 0%, #383d44 48%, #2e3339 52%, #41464d 100%) !important; color: #e2e5e9 !important; border: 1px solid #565c65 !important; border-radius: 3px !important; box-shadow: 0 1px 3px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.45) !important; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: linear-gradient(180deg, #575e67 0%, #43494f 48%, #383e45 52%, #4c525a 100%) !important; box-shadow: 0 2px 5px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.16) !important; } .zf-style-glow button:active, .zf-style-glow .btn:active { background: linear-gradient(180deg, #2e3339 0%, #3a3f46 100%) !important; box-shadow: inset 0 2px 4px rgba(0,0,0,0.55) !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: linear-gradient(180deg, #17191d 0%, #1e2126 100%) !important; border: 1px solid #3d4148 !important; border-radius: 3px !important; box-shadow: inset 0 2px 4px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.04) !important; color: #d7dade !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #7d8792 !important; box-shadow: 0 0 0 1px rgba(154,164,174,0.35), inset 0 2px 4px rgba(0,0,0,0.5) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; background: linear-gradient(180deg, #e8eaed 0%, #9aa0a8 55%, #6b727b 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; } .zf-style-glow .zf-style-card.active { border-color: #8b929c; box-shadow: 0 0 0 1px rgba(154,164,174,0.4); } .zf-style-glow a { color: #b9c2cc; text-decoration-color: #6b727c; } .zf-style-glow ::selection { background: #4a5058; color: #fff; } .zf-style-glow [style*="background: #fff"], .zf-style-glow [style*="background:#fff"], .zf-style-glow [style*="background: white"], .zf-style-glow [style*="background-color: #fff"], .zf-style-glow [style*="background-color:#fff"] { background-color: #26292e !important; }'
        },
        { id: 'diamondgray', name: '钻石·灰底', mode: 'dark', bg: '#1b1d20', fx: 'none', vars: { bg: '#1b1d20', card: '#282b30', hover: '#31353a', border: '#3f4a54', text: '#e8f0f5', text2: '#8f9aa4', accent: '#9adef5' }, extra: { '--radius': '10px', '--green': '#9adef5', '--blue-rgb': '#9adef5' }, extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #282a2d 0%, #191b1e 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #34373c 0%, #282b30 100%) !important; border: 1px solid #3f4a54 !important; border-bottom: 2px solid #656e76 !important; box-shadow: 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(154,222,245,0.10) !important; border-radius: 10px !important; } .zf-style-glow .card { background: #282b30 !important; border: 1px solid #24272c !important; border-radius: 10px !important; } .zf-style-glow .card:hover { border-color: #9adef5 !important; box-shadow: 0 0 12px rgba(154,222,245,0.25) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(135deg, #e8f7fd 0%, #9adef5 40%, #5ba8cc 70%, #d5f2fc 100%); -webkit-background-clip: text; background-clip: text; color: transparent !important; font-weight: 600; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #4a7a94 0%, #375a70 100%) !important; color: #eef8fc !important; border: 1px solid #5ba8cc !important; border-radius: 10px !important; font-weight: 600; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { box-shadow: 0 0 14px rgba(154,222,245,0.5); filter: brightness(1.1); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #191b1e !important; border: 1px solid #23252a !important; color: #e8f0f5 !important; border-radius: 10px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #9adef5 !important; box-shadow: 0 0 8px rgba(154,222,245,0.3) !important; } .zf-style-glow a { color: #9adef5; } .zf-style-glow a:hover { color: #e8f7fd; } .zf-style-glow ::selection { background: #375a70; color: #eef8fc; } .zf-style-glow .status-dot.status-active { background: #9adef5 !important; }' },
        { id: 'silvergray', name: '银色·灰底', mode: 'dark', bg: '#1c1d1f', fx: 'none', vars: { bg: '#1c1d1f', card: '#2a2b2d', hover: '#333436', border: '#45484c', text: '#eceef0', text2: '#96999e', accent: '#c8ccd4' }, extra: { '--radius': '8px', '--green': '#c8ccd4', '--blue-rgb': '#c8ccd4' }, extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #292a2c 0%, #1a1b1d 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #363739 0%, #2a2b2d 100%) !important; border: 1px solid #45484c !important; border-bottom: 2px solid #6a6c6f !important; box-shadow: 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(200,204,212,0.10) !important; border-radius: 8px !important; } .zf-style-glow .card { background: #2a2b2d !important; border: 1px solid #262729 !important; border-radius: 8px !important; } .zf-style-glow .card:hover { border-color: #c8ccd4 !important; box-shadow: 0 0 12px rgba(200,204,212,0.25) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(180deg, #f5f7fa 0%, #aab0b8 100%); -webkit-background-clip: text; background-clip: text; color: transparent !important; font-weight: 600; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #7a808a 0%, #5c626c 100%) !important; color: #f2f4f7 !important; border: 1px solid #9aa0aa !important; border-radius: 8px !important; font-weight: 600; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { box-shadow: 0 0 14px rgba(200,204,212,0.5); filter: brightness(1.1); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #1a1b1d !important; border: 1px solid #242527 !important; color: #eceef0 !important; border-radius: 8px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #c8ccd4 !important; box-shadow: 0 0 8px rgba(200,204,212,0.3) !important; } .zf-style-glow a { color: #c8ccd4; } .zf-style-glow a:hover { color: #f5f7fa; } .zf-style-glow ::selection { background: #5c626c; color: #f2f4f7; } .zf-style-glow .status-dot.status-active { background: #c8ccd4 !important; }' },
        { id: 'woodgrain', name: '原木工坊', mode: 'dark', bg: '#2a1d12', fx: 'none', vars: { bg: '#2a1d12', card: '#453322', hover: '#4a3520', border: '#5c4327', text: '#f3e3c8', text2: '#a98b62', accent: '#e8a952' }, extra: { '--radius': '10px', '--green': '#e8a952', '--blue-rgb': '232, 169, 82' }, extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background-image: repeating-linear-gradient(90deg, rgba(0,0,0,0.12) 0px, rgba(0,0,0,0) 3px, rgba(0,0,0,0) 9px, rgba(0,0,0,0.10) 12px, rgba(255,255,255,0.02) 15px, rgba(0,0,0,0) 22px), repeating-linear-gradient(88deg, rgba(255,220,160,0.03) 0px, rgba(0,0,0,0) 6px, rgba(0,0,0,0.08) 11px, rgba(0,0,0,0) 18px) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #463category019, #3d2b1a) !important; background: linear-gradient(180deg, #463019, #3a2917) !important; border: 1px solid #6b4e2c !important; box-shadow: inset 0 0 24px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,220,160,0.10) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background-image: repeating-linear-gradient(90deg, rgba(0,0,0,0.10) 0px, rgba(0,0,0,0) 4px, rgba(0,0,0,0) 10px, rgba(0,0,0,0.08) 13px, rgba(255,220,160,0.02) 17px, rgba(0,0,0,0) 24px) !important; } .zf-style-glow .card { background: linear-gradient(180deg, #452f1b, #3a2917); border: 1px solid #6b4e2c; box-shadow: inset 0 1px 0 rgba(255,220,160,0.08); border-radius: 10px; } .zf-style-glow .card:hover { border-color: #a3763f; box-shadow: 0 4px 14px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,160,0.12); } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #7a5628, #5c4019) !important; border: 1px solid #8f6a34 !important; color: #ffe9c4 !important; box-shadow: inset 0 1px 0 rgba(255,220,160,0.25), 0 2px 4px rgba(0,0,0,0.4); border-radius: 8px; } .zf-style-glow button:hover { background: linear-gradient(180deg, #8f6a34, #6b4e2c) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #e8a952; text-shadow: 0 1px 0 rgba(0,0,0,0.6); } .zf-style-glow input, .zf-style-glow textarea { background: #241810 !important; border: 1px solid #5c4327 !important; color: #f3e3c8 !important; border-radius: 8px; } .zf-style-glow .status-dot.status-active { background: #e8a952 !important; }' },
        { id: 'oldpaper',  name: '纸张怀旧', mode: 'light', bg: '#e9dcc0', fx: 'none',
          vars: { bg: '#e9dcc0', card: '#f4ecd8', hover: '#e3d4ae', border: '#b39a63', text: '#3d3020', text2: '#857452', accent: '#a4551e' },
          extra: { '--radius': '6px', '--green': '#7d6a3a', '--blue-rgb': '164, 85, 30' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(160deg, #efe3c6 0%, #e6d6ae 50%, #dbc899 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(178deg, #f7efdc 0%, #efe2c0 100%) !important; border: 1px solid #c3ab74 !important; box-shadow: 0 6px 18px rgba(96,74,34,0.18), inset 0 1px 0 #fffdf2 !important; border-radius: 6px !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { font-family: Georgia, "Times New Roman", "Songti SC", serif; color: #4a3818; border-bottom: 2px double #b39a63; padding-bottom: 4px; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #c99044 0%, #a4551e 100%) !important; color: #fdf6e3 !important; border: 1px solid #7d4a14 !important; border-radius: 5px !important; font-family: Georgia, serif; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: linear-gradient(180deg, #d9a45c 0%, #b56428 100%) !important; box-shadow: 0 3px 8px rgba(125,74,20,0.35); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #fbf5e4 !important; border: 1px solid #c3ab74 !important; color: #3d3020 !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #a4551e !important; box-shadow: 0 0 6px rgba(164,85,30,0.3); } .zf-style-glow a { color: #8a4212; text-decoration: underline; } .zf-style-glow ::selection { background: #d9c48f; }' },
        { id: 'sakuragrey', name: '灰调樱粉', mode: 'light', bg: '#e9e6ea', fx: 'none',
          vars: { bg: '#e9e6ea', card: '#f5f3f6', hover: '#f0dde4', border: '#c9b8c2', text: '#3f3a42', text2: '#8a8290', accent: '#d16a8a' },
          extra: { '--radius': '12px', '--green': '#7fae94', '--blue-rgb': '209, 106, 138' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(150deg, #ece8ee 0%, #e7e2e8 55%, #f2e2e8 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *) { background: rgba(250,248,251,0.92) !important; border: 1px solid #d5c3cd !important; box-shadow: 0 4px 14px rgba(120,100,115,0.14) !important; border-radius: 12px !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #57424e; font-weight: 600; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #e2809c 0%, #d16a8a 100%) !important; color: #fff !important; border: none !important; border-radius: 10px !important; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { filter: brightness(1.06); box-shadow: 0 4px 10px rgba(209,106,138,0.4); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #faf8fb !important; border: 1px solid #cfc0c8 !important; color: #3f3a42 !important; border-radius: 9px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #d16a8a !important; box-shadow: 0 0 6px rgba(209,106,138,0.3); } .zf-style-glow a { color: #c05a78; } .zf-style-glow ::selection { background: #f0cdd8; }' },
        { id: 'sakura', name: '樱粉梦境', mode: 'light', bg: '#f6e3ec', fx: 'none', vars: { bg: '#f6e3ec', card: '#ffffff', hover: '#fdeef3', border: '#f5cfdd', text: '#5c3a4a', text2: '#9c6a82', accent: '#e05685' }, extra: { '--radius': '22px', '--green': '#ff7fa5', '--blue-rgb': '255, 127, 165' }, extraCss: '.zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(160deg, rgba(255,214,228,0.55) 0%, rgba(255,255,255,0.92) 40%, rgba(253,238,243,0.9) 100%) !important; border: 1px solid rgba(255,160,190,0.5); box-shadow: 0 8px 32px rgba(255,127,165,0.18); border-radius: 22px !important; } .zf-style-glow .card { background: rgba(255,255,255,0.85); border: 1px solid #f5cfdd; border-radius: 18px !important; box-shadow: 0 4px 16px rgba(255,127,165,0.12); } .zf-style-glow .card:hover { transform: translateY(-2px) scale(1.01); box-shadow: 0 8px 26px rgba(255,127,165,0.28); } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(135deg, #ffa8c2 0%, #ff7fa5 60%, #f5568a 100%) !important; color: #fff !important; border-radius: 999px !important; box-shadow: 0 4px 14px rgba(255,127,165,0.4); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { border-radius: 14px !important; border-color: #f5cfdd; } .zf-style-glow .status-dot.status-active { background: #ff7fa5 !important; }' },
        { id: 'cozywarm',  name: '暖色夕橙', mode: 'light', bg: '#f7ead9', fx: 'none',
          vars: { bg: '#f7ead9', card: '#fff8ee', hover: '#fbe4c4', border: '#dfb98a', text: '#4a3220', text2: '#96755a', accent: '#e07b39' },
          extra: { '--radius': '10px', '--green': '#8aa84e', '--blue-rgb': '224, 123, 57' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(160deg, #fdf2e2 0%, #f8e6cd 55%, #f3d9ba 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *) { background: rgba(255,250,241,0.95) !important; border: 1px solid #e5c79e !important; box-shadow: 0 4px 14px rgba(160,110,60,0.15) !important; border-radius: 10px !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #6b3d14; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #f0924e 0%, #e07b39 100%) !important; color: #fff !important; border: none !important; border-radius: 8px !important; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: linear-gradient(180deg, #f7a05c 0%, #e8873f 100%) !important; box-shadow: 0 4px 10px rgba(224,123,57,0.35); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #fffcf5 !important; border: 1px solid #e0c298 !important; color: #4a3220 !important; border-radius: 8px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #e07b39 !important; box-shadow: 0 0 6px rgba(224,123,57,0.3); } .zf-style-glow a { color: #c9601f; } .zf-style-glow ::selection { background: #f7ddba; }' },
        { id: 'coolbreeze', name: '冷色冰蓝', mode: 'light', bg: '#e4eef6', fx: 'none',
          vars: { bg: '#e4eef6', card: '#f6fafd', hover: '#dcedf8', border: '#a9c6dd', text: '#1e3348', text2: '#5d7a92', accent: '#1f7fc4' },
          extra: { '--radius': '10px', '--green': '#2ba88a', '--blue-rgb': '31, 127, 196' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(165deg, #eaf3fa 0%, #dfeaf4 55%, #d5e6f2 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *) { background: rgba(248,251,253,0.94) !important; border: 1px solid #b9d2e4 !important; box-shadow: 0 4px 14px rgba(60,110,150,0.14) !important; border-radius: 10px !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #16405e; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #3a9bd8 0%, #1f7fc4 100%) !important; color: #fff !important; border: none !important; border-radius: 8px !important; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: linear-gradient(180deg, #4dade8 0%, #2b90d4 100%) !important; box-shadow: 0 4px 10px rgba(31,127,196,0.35); } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #fbfdfe !important; border: 1px solid #b9d2e4 !important; color: #1e3348 !important; border-radius: 8px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #1f7fc4 !important; box-shadow: 0 0 6px rgba(31,127,196,0.3); } .zf-style-glow a { color: #1a6ea8; } .zf-style-glow ::selection { background: #cfe6f7; }' },
        { id: 'toon',      name: '卡通描边', mode: 'light', bg: '#fdf3e0', fx: 'none',
          vars: { bg: '#fdf3e0', card: '#ffffff', hover: '#fff3c4', border: '#1c1c1c', text: '#1c1c1c', text2: '#6d6d6d', accent: '#ff5d73' },
          extra: { '--radius': '14px', '--green': '#22b573', '--blue-rgb': '255, 93, 115' },
          extraCss: '.zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .card { background: #ffffff !important; border: 3px solid #1c1c1c !important; border-radius: 14px !important; box-shadow: 6px 6px 0 #1c1c1c !important; } .zf-style-glow button, .zf-style-glow .btn { background: #ffd23f !important; color: #1c1c1c !important; border: 3px solid #1c1c1c !important; border-radius: 999px !important; box-shadow: 3px 3px 0 #1c1c1c !important; font-weight: 800; transition: transform 0.1s; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: #ff5d73 !important; color: #fff !important; transform: translate(-1px,-1px); box-shadow: 5px 5px 0 #1c1c1c !important; } .zf-style-glow button:active, .zf-style-glow .btn:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 #1c1c1c !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #fff !important; border: 2.5px solid #1c1c1c !important; border-radius: 10px !important; color: #1c1c1c !important; font-weight: 600; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { outline: 3px solid #4cc9f0; outline-offset: 1px; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { font-weight: 900; text-shadow: 2px 2px 0 #ffd23f; } .zf-style-glow a { color: #ff5d73; font-weight: 800; text-decoration-thickness: 2.5px; } .zf-style-glow ::selection { background: #ffd23f; }' },
        { id: 'mistgray', name: '雾白·灰阶', mode: 'light', bg: '#f7f7f7', fx: 'none',
        vars: { bg: '#f7f7f7', card: '#eeeeee', hover: '#e4e4e4', border: '#dcdcdc', text: '#2b2b2b', text2: '#8c8c8c', accent: '#4a4a4a' },
        extra: { '--radius': '6px', '--green': '#4a4a4a', '--blue-rgb': '74, 74, 74' },
        extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #ffffff 0%, #f1f1f1 100%) !important; border: 1px solid #dcdcdc !important; box-shadow: 0 1px 4px rgba(0,0,0,0.05) !important; border-radius: 6px !important; } .zf-style-glow .card { background: linear-gradient(180deg, #ffffff 0%, #f2f2f2 100%) !important; border: 1px solid #dedede !important; border-radius: 6px !important; } .zf-style-glow .card:hover { border-color: #b5b5b5 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.09) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #2b2b2b !important; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #ffffff 0%, #ececec 100%) !important; color: #2b2b2b !important; border: 1px solid #cfcfcf !important; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { border-color: #4a4a4a !important; box-shadow: 0 1px 5px rgba(0,0,0,0.12) !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #ffffff !important; border: 1px solid #d8d8d8 !important; color: #2b2b2b !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #4a4a4a !important; } .zf-style-glow a { color: #3d3d3d; } .zf-style-glow .status-dot.status-active { background: #4a4a4a !important; }' },
        { id: 'sunny',     name: '云白清爽', mode: 'light', bg: '#f6f8fb', fx: 'clouds',
          vars: { bg: '#f6f8fb', card: '#dfdfdf', hover: '#eef3fa', border: '#c9d6e6', text: '#0a0a0a', text2: '#3a3a3a', accent: '#2f7de1' },
          extra: { '--radius': '14px', '--green': '#189a46', '--blue-rgb': '47, 125, 225' },
          extraCss: '.zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #ffffff 0%, #f4f8fd 100%) !important; border: 1px solid #dde6f0; box-shadow: 0 8px 28px rgba(47,125,225,0.10); border-radius: 16px !important; } .zf-style-glow .card { border-radius: 14px !important; border: 1px solid #e3ebf5; box-shadow: 0 4px 14px rgba(47,125,225,0.08); } .zf-style-glow .card:hover { box-shadow: 0 6px 22px rgba(47,125,225,0.18); border-color: #bcd6f5; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(135deg, #2f7de1, #56a2f0) !important; color: #ffffff !important; border-radius: 999px !important; box-shadow: 0 3px 12px rgba(47,125,225,0.35); text-shadow: 0 1px 2px rgba(20,70,140,0.35); } .zf-style-glow button *, .zf-style-glow .btn * { color: #ffffff !important; } .zf-style-glow button svg, .zf-style-glow .btn svg { fill: #ffffff !important; stroke: #ffffff !important; } .zf-style-glow input, .zf-style-glow textarea { border-radius: 10px !important; background: #fbfcfe !important; border-color: #dfe8f3 !important; } .zf-style-glow .zf-style-card.active { border-left: 3px solid #2f7de1; background: #f2f7ff; } .zf-style-glow .text-muted, .zf-style-glow [class*="muted"], .zf-style-glow .text-secondary, .zf-style-glow small, .zf-style-glow .meta, .zf-style-glow [class*="meta"], .zf-style-glow time { color: #3a3a3a !important; }' },
        { id: 'mintwhite', name: '薄荷白·清新', mode: 'light', bg: '#f7fbf8', fx: 'none',
        vars: { bg: '#f7fbf8', card: '#eef6f0', hover: '#e4f0e8', border: '#d5e6da', text: '#26332b', text2: '#7e948a', accent: '#2fa05c' },
        extra: { '--radius': '8px', '--green': '#2fa05c', '--blue-rgb': '47, 160, 92' },
        extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #ffffff 0%, #edf6f0 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #ffffff 0%, #f0f8f3 100%) !important; border: 1px solid #d5e6da !important; box-shadow: 0 1px 5px rgba(47,110,70,0.07) !important; border-radius: 8px !important; } .zf-style-glow .card { background: linear-gradient(180deg, #ffffff 0%, #f1f8f4 100%) !important; border: 1px solid #daeadf !important; border-radius: 8px !important; } .zf-style-glow .card:hover { border-color: #8fc9a6 !important; box-shadow: 0 2px 8px rgba(47,160,92,0.14) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #1f4530 !important; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #ffffff 0%, #e9f5ee 100%) !important; color: #1f4530 !important; border: 1px solid #c8e0d0 !important; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { border-color: #2fa05c !important; box-shadow: 0 1px 6px rgba(47,160,92,0.2) !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #ffffff !important; border: 1px solid #d2e4d8 !important; color: #26332b !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #2fa05c !important; } .zf-style-glow a { color: #26874e; } .zf-style-glow .status-dot.status-active { background: #2fa05c !important; }' },
        { id: 'pearlwhite', name: '珍珠白·温润', mode: 'light', bg: '#fbfaf8', fx: 'none',
        vars: { bg: '#fbfaf8', card: '#f6f4f0', hover: '#efece6', border: '#e5e1d8', text: '#33302a', text2: '#948e82', accent: '#b08d4f' },
        extra: { '--radius': '8px', '--green': '#b08d4f', '--blue-rgb': '176, 141, 79' },
        extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #fdfcfa 0%, #f7f5f0 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #fefdfb 0%, #f6f4ef 100%) !important; border: 1px solid #e5e1d8 !important; box-shadow: 0 1px 5px rgba(120,100,60,0.07) !important; border-radius: 8px !important; } .zf-style-glow .card { background: linear-gradient(180deg, #fdfcfa 0%, #f5f3ee 100%) !important; border: 1px solid #e7e3d9 !important; border-radius: 8px !important; } .zf-style-glow .card:hover { border-color: #cbb68c !important; box-shadow: 0 2px 8px rgba(176,141,79,0.14) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #4a3f2a !important; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #fbf9f4 0%, #efe9dd 100%) !important; color: #4a3f2a !important; border: 1px solid #ddd5c4 !important; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { border-color: #b08d4f !important; box-shadow: 0 1px 6px rgba(176,141,79,0.2) !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #ffffff !important; border: 1px solid #e2ddd1 !important; color: #33302a !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #b08d4f !important; } .zf-style-glow a { color: #a37c3e; } .zf-style-glow .status-dot.status-active { background: #b08d4f !important; }' },
        { id: 'cloudblue', name: '云白·天青', mode: 'light', bg: '#f8fbfd', fx: 'none',
        vars: { bg: '#f8fbfd', card: '#f0f6fa', hover: '#e6f0f6', border: '#d8e6ef', text: '#26333c', text2: '#7e93a2', accent: '#2d8fc4' },
        extra: { '--radius': '8px', '--green': '#2d8fc4', '--blue-rgb': '45, 143, 196' },
        extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #ffffff 0%, #eef5fa 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #ffffff 0%, #f1f7fb 100%) !important; border: 1px solid #d8e6ef !important; box-shadow: 0 1px 5px rgba(45,110,150,0.07) !important; border-radius: 8px !important; } .zf-style-glow .card { background: linear-gradient(180deg, #ffffff 0%, #f2f8fc 100%) !important; border: 1px solid #ddeaf3 !important; border-radius: 8px !important; } .zf-style-glow .card:hover { border-color: #8ec3de !important; box-shadow: 0 2px 8px rgba(45,143,196,0.14) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #22475c !important; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #ffffff 0%, #e9f3f9 100%) !important; color: #22475c !important; border: 1px solid #c9dce8 !important; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { border-color: #2d8fc4 !important; box-shadow: 0 1px 6px rgba(45,143,196,0.2) !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #ffffff !important; border: 1px solid #d5e4ee !important; color: #26333c !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #2d8fc4 !important; } .zf-style-glow a { color: #2478a8; } .zf-style-glow .status-dot.status-active { background: #2d8fc4 !important; }' },
        { id: 'snowwhite', name: '雪白·纯净', mode: 'light', bg: '#ffffff', fx: 'none',
        vars: { bg: '#ffffff', card: '#f7f8fa', hover: '#eef0f4', border: '#e2e5ea', text: '#2a2d33', text2: '#8a8f98', accent: '#3a6fd8' },
        extra: { '--radius': '6px', '--green': '#3a6fd8', '--blue-rgb': '58, 111, 216' },
        extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #ffffff 0%, #f4f6f9 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg, #ffffff 0%, #f5f7fa 100%) !important; border: 1px solid #e2e5ea !important; box-shadow: 0 1px 4px rgba(0,0,0,0.05) !important; border-radius: 6px !important; } .zf-style-glow .card { background: linear-gradient(180deg, #ffffff 0%, #f7f8fa 100%) !important; border: 1px solid #e4e7ec !important; border-radius: 6px !important; box-shadow: 0 1px 3px rgba(0,0,0,0.04) !important; } .zf-style-glow .card:hover { border-color: #b9c6dd !important; box-shadow: 0 2px 8px rgba(58,111,216,0.1) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #2a2d33 !important; font-weight: 600; } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(180deg, #ffffff 0%, #eef1f6 100%) !important; color: #2a2d33 !important; border: 1px solid #d4d9e0 !important; border-radius: 5px !important; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { border-color: #3a6fd8 !important; box-shadow: 0 1px 6px rgba(58,111,216,0.18) !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #ffffff !important; border: 1px solid #dfe3e9 !important; color: #2a2d33 !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #3a6fd8 !important; box-shadow: 0 0 0 2px rgba(58,111,216,0.12) !important; } .zf-style-glow a { color: #3a6fd8; } .zf-style-glow .status-dot.status-active { background: #3a6fd8 !important; }' },
    
        /* ===== Apple macOS 系列 ===== */
        { id: 'macoslight', name: '苹果·浅色', mode: 'light', bg: '#f5f5f7', fx: 'none',
          vars: { bg: '#f5f5f7', card: 'rgba(255,255,255,0.82)', hover: 'rgba(0,0,0,0.05)', border: 'rgba(0,0,0,0.10)', text: '#1d1d1f', text2: '#86868b', accent: '#007aff' },
          extra: { '--radius': '12px', '--green': '#34c759', '--blue-rgb': '0, 122, 255' },
          extraCss: '.zf-style-glow, .zf-style-glow button, .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; } .zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #f5f5f7 0%, #eef0f4 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .chatbox { background: rgba(255,255,255,0.78) !important;   border: 1px solid rgba(0,0,0,0.08) !important; box-shadow: 0 12px 40px rgba(0,0,0,0.14), 0 1px 2px rgba(0,0,0,0.05) !important; border-radius: 12px !important; } .zf-style-glow .card { background: rgba(255,255,255,0.85) !important; border: 1px solid rgba(0,0,0,0.07) !important; border-radius: 12px !important; box-shadow: 0 2px 10px rgba(0,0,0,0.06) !important; } .zf-style-glow .card:hover { border-color: rgba(0,0,0,0.14) !important; box-shadow: 0 6px 20px rgba(0,0,0,0.10) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #1d1d1f !important; font-weight: 600; text-shadow: none; letter-spacing: -0.01em; } .zf-style-glow button, .zf-style-glow .btn { background: #007aff !important; color: #fff !important; border: none !important; border-radius: 8px !important; font-weight: 500; box-shadow: 0 1px 3px rgba(0,122,255,0.25) !important; transition: all .15s ease; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: #0a84ff !important; box-shadow: 0 3px 10px rgba(0,122,255,0.35) !important; } .zf-style-glow button:active, .zf-style-glow .btn:active { transform: scale(0.97); } .zf-style-glow button.secondary, .zf-style-glow .btn-secondary, .zf-style-glow .theme-reset-btn { background: rgba(0,0,0,0.05) !important; color: #007aff !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: #ffffff !important; border: 1px solid #d2d2d7 !important; color: #1d1d1f !important; border-radius: 8px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #007aff !important; box-shadow: 0 0 0 3px rgba(0,122,255,0.18) !important; outline: none !important; } .zf-style-glow a { color: #007aff; text-decoration: none; } .zf-style-glow a:hover { text-decoration: underline; } .zf-style-glow * { text-shadow: none !important; } .zf-style-glow ::selection { background: rgba(0,122,255,0.22); } .zf-style-glow .status-dot.status-active { background: #34c759 !important; }' },
        { id: 'macosdark', name: '苹果·深色', mode: 'dark', bg: '#1e1e20', fx: 'none',
          vars: { bg: '#1e1e20', card: 'rgba(45,45,48,0.75)', hover: 'rgba(255,255,255,0.08)', border: 'rgba(255,255,255,0.12)', text: '#f5f5f7', text2: '#98989d', accent: '#0a84ff' },
          extra: { '--radius': '12px', '--green': '#30d158', '--blue-rgb': '10, 132, 255' },
          extraCss: '.zf-style-glow, .zf-style-glow button, .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; } .zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(180deg, #242426 0%, #1a1a1c 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .modal, .zf-style-glow [class*="modal"]:not(.mo-panel):not(.mo-panel *), .zf-style-glow .chatbox { background: rgba(45,45,48,0.72) !important;   border: 1px solid rgba(255,255,255,0.10) !important; box-shadow: 0 12px 40px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.4) !important; border-radius: 12px !important; } .zf-style-glow .card { background: rgba(58,58,62,0.72) !important; border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 12px !important; box-shadow: 0 2px 10px rgba(0,0,0,0.3) !important; } .zf-style-glow .card:hover { border-color: rgba(255,255,255,0.18) !important; box-shadow: 0 6px 20px rgba(0,0,0,0.45) !important; } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color: #f5f5f7 !important; font-weight: 600; text-shadow: none; letter-spacing: -0.01em; } .zf-style-glow button, .zf-style-glow .btn { background: #0a84ff !important; color: #fff !important; border: none !important; border-radius: 8px !important; font-weight: 500; box-shadow: 0 1px 3px rgba(10,132,255,0.35) !important; transition: all .15s ease; } .zf-style-glow button:hover, .zf-style-glow .btn:hover { background: #409cff !important; box-shadow: 0 3px 12px rgba(10,132,255,0.45) !important; } .zf-style-glow button:active, .zf-style-glow .btn:active { transform: scale(0.97); } .zf-style-glow button.secondary, .zf-style-glow .btn-secondary, .zf-style-glow .theme-reset-btn { background: rgba(255,255,255,0.10) !important; color: #0a84ff !important; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background: rgba(30,30,32,0.85) !important; border: 1px solid rgba(255,255,255,0.14) !important; color: #f5f5f7 !important; border-radius: 8px !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #0a84ff !important; box-shadow: 0 0 0 3px rgba(10,132,255,0.25) !important; outline: none !important; } .zf-style-glow a { color: #409cff; text-decoration: none; } .zf-style-glow a:hover { text-decoration: underline; } .zf-style-glow * { text-shadow: none !important; } .zf-style-glow ::selection { background: rgba(10,132,255,0.35); } .zf-style-glow .status-dot.status-active { background: #30d158 !important; }'
        },
        { id: 'neoncyber', name: '霓虹赛博', mode: 'dark', bg: '#0a0618', fx: 'fireworks',
          vars: { bg: '#0a0618', card: 'rgba(22,12,44,0.88)', hover: 'rgba(255,60,180,0.12)', border: 'rgba(255,60,220,0.35)', text: '#f6e9ff', text2: '#9d7cc8', accent: '#ff3ccc' },
          extra: { '--radius': '10px', '--green': '#00ffd5', '--blue-rgb': '255, 60, 204' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: radial-gradient(1000px 600px at 80% -10%, rgba(255,60,204,0.22), transparent 55%), radial-gradient(900px 500px at 0% 100%, rgba(0,255,213,0.14), transparent 55%), linear-gradient(180deg, #0d0722 0%, #0a0618 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(160deg, rgba(30,14,60,0.92), rgba(10,6,24,0.94)) !important; border: 1px solid rgba(255,60,204,0.35) !important; box-shadow: 0 0 24px rgba(255,60,204,0.15), inset 0 0 30px rgba(0,255,213,0.05) !important;  } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(100deg, rgba(255,60,204,0.85), rgba(120,60,255,0.85)) !important; color: #fff !important; border: none !important; box-shadow: 0 0 16px rgba(255,60,204,0.45); } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(90deg, #ff3ccc, #b96bff, #00ffd5); -webkit-background-clip: text; background-clip: text; color: transparent; } .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { border-color: rgba(255,60,204,0.35) !important; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #ff3ccc !important; box-shadow: 0 0 12px rgba(255,60,204,0.35) !important; } .zf-style-glow a { color: #00ffd5 !important; }' },
        { id: 'holowolo', name: '全息光谱', mode: 'dark', bg: '#060d1a', fx: 'orbit',
          vars: { bg: '#060d1a', card: 'rgba(10,22,40,0.88)', hover: 'rgba(0,220,255,0.10)', border: 'rgba(0,220,255,0.30)', text: '#e8f6ff', text2: '#6fa0c8', accent: '#00e0ff' },
          extra: { '--radius': '14px', '--green': '#7cffb2', '--blue-rgb': '0, 224, 255' },
          extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: radial-gradient(1100px 650px at 20% -10%, rgba(0,224,255,0.16), transparent 55%), radial-gradient(900px 550px at 95% 110%, rgba(124,255,178,0.10), transparent 55%), radial-gradient(700px 400px at 60% 50%, rgba(150,80,255,0.10), transparent 60%), linear-gradient(180deg, #081226 0%, #060d1a 100%) !important; } .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(165deg, rgba(14,30,54,0.92), rgba(6,13,26,0.94)) !important; border: 1px solid rgba(0,224,255,0.30) !important; box-shadow: 0 0 26px rgba(0,224,255,0.12), inset 0 1px 0 rgba(0,224,255,0.15) !important;  } .zf-style-glow .card:hover { border-color: rgba(0,224,255,0.6) !important; box-shadow: 0 0 22px rgba(0,224,255,0.28) !important; transform: translateY(-2px); } .zf-style-glow button, .zf-style-glow .btn { background: linear-gradient(100deg, rgba(0,224,255,0.9), rgba(124,120,255,0.9)) !important; color: #04121e !important; font-weight: 600 !important; border: none !important; box-shadow: 0 0 16px rgba(0,224,255,0.4); } .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { background: linear-gradient(90deg, #00e0ff, #7cffb2, #b08cff); -webkit-background-clip: text; background-clip: text; color: transparent; } .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color: #00e0ff !important; box-shadow: 0 0 12px rgba(0,224,255,0.3) !important; } .zf-style-glow .status-dot.status-active { background: #7cffb2 !important; }' },


    ];
    function hexToRgbStr(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return '74, 158, 255';
        return parseInt(m[1].slice(0,2),16) + ', ' + parseInt(m[1].slice(2,4),16) + ', ' + parseInt(m[1].slice(4,6),16);
    }
    function isDark(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return true;
        var r = parseInt(m[1].slice(0,2),16), g = parseInt(m[1].slice(2,4),16), b = parseInt(m[1].slice(4,6),16);
        return (r*299 + g*587 + b*114) / 1000 < 128;
    }

    var Theme = {
        styles: STYLES,
        current: 'midnight',  // 当前风格 id（默认：极简暗夜）
        chatBinding: 'global', // 对话框归属：global=全局统一 | perchat=每个对话框独立
        darkAccent: '#4a9eff', // 兼容旧代码读取
        lightAccent: '#4a9eff',
        grayAccent: '#4a9eff',
        followStrength: 50,

        init: function () {
            try {
                var params = new URLSearchParams(window.location.search);
                if (params.get('reset_theme') === '1') {
                    UserSettings.remove('zf_theme');
                    try { localStorage.removeItem('zf_theme'); } catch (e) {}
                    this.current = 'midnight';
                    this.save();
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
            } catch (e) {}

            var saved = this._load();
            if (saved && saved.styleId && this._byId(saved.styleId)) {
                this.current = saved.styleId;
                if (saved.chatBinding) this.chatBinding = saved.chatBinding;
            } else if (saved && saved.current) {
                // 旧配置兼容：dark→极简暗夜，light→晴空
                this.current = saved.current === 'light' ? 'sky' : 'midnight';
            }
            this.apply();
            this._setupUI();
        },

        _byId: function (id) {
            for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
            return null;
        },

        // ===== 应用风格：一次性写入全部 CSS 变量 =====
        apply: function () {
            var style = this._byId(this.current) || STYLES[0];
            var v = style.vars;
            var root = document.documentElement;
            var accentRgb = hexToRgbStr(v.accent);
            var dark = isDark(v.bg);

            var map = {
                '--bg': v.bg,
                '--bg-card': v.card,
                '--bg-hover': v.hover,
                '--border': v.border,
                '--text': v.text,
                '--text2': v.text2,
                '--blue': v.accent,
                '--blue-rgb': accentRgb,
                '--green': dark ? '#4ade80' : '#1a8a3a',

                // 衍生别名（保持全站面板/对话框联动，与旧版映射一致）
                '--panel': v.card,
                '--panel-bg': v.card,
                '--bg2': v.hover,
                '--text-sub': v.text2,
                '--text-sub2': v.text2,
                '--text-primary': v.text,
                '--text-secondary': v.text2,
                '--text-dim': v.text2,
                '--text1': v.text,
                '--accent': v.accent,
                '--accent-color': v.accent,
                '--accent-weak': 'rgba(' + accentRgb + ', 0.15)',
                '--blue-soft': 'rgba(' + accentRgb + ', 0.12)',
                '--blue-dark': v.accent,
                '--theme-accent': v.accent,

                // 风筝统计面板变量（三种模式统一用当前风格）
                '--kite-panel-bg': v.card,
                '--kite-panel-border': v.border,
                '--kite-panel-text': v.text,
                '--kite-panel-soft': v.hover,
                '--kite-panel-bg-gray': v.card,
                '--kite-panel-border-gray': v.border,
                '--kite-panel-text-gray': v.text,
                '--kite-panel-soft-gray': v.hover,
                '--kite-panel-bg-light': v.card,
                '--kite-panel-border-light': v.border,
                '--kite-panel-text-light': v.text,
                '--kite-panel-soft-light': v.hover
            };
            Object.keys(map).forEach(function (k) { root.style.setProperty(k, map[k]); });
            // 风格扩展变量：允许每个风格彻底改写圆角/字体/渐变等，实现形态级差异
            if (style.extra && typeof style.extra === 'object') {
                Object.keys(style.extra).forEach(function (k) {
                    try { root.style.setProperty(k, style.extra[k]); } catch (e) {}
                });
            }

            // 风格专属 CSS（如辉光特效），切换时整体替换
            var extraEl = document.getElementById('zf-style-extra');
            if (!extraEl) {
                extraEl = document.createElement('style');
                extraEl.id = 'zf-style-extra';
                document.head.appendChild(extraEl);
            }
            extraEl.textContent = (style.extraCss || '');
            if (style.extraCss) { root.classList.add('zf-style-glow'); } else { root.classList.remove('zf-style-glow'); }

            root.setAttribute('data-theme', dark ? 'dark' : 'light');
            root.setAttribute('data-mode', dark ? 'dark' : 'light');

            // 按钮图标
            var btn = document.getElementById('themeBtn');
            if (btn) {
                btn.title = '当前风格: ' + style.name;
            }

            // 高亮面板中的当前风格卡片
            document.querySelectorAll('.zf-style-card').forEach(function (el) {
                el.classList.toggle('active', el.getAttribute('data-style') === Theme.current);
            });

            try {
                document.dispatchEvent(new CustomEvent('themechange', { detail: { mode: dark ? 'dark' : 'light', style: style.id } }));
            } catch (e) {}

            /* 全局风格切换后，重新贴上所有角色框的独立皮肤（防止衍生变量被全局值串味） */
            try { if (typeof Theme._restoreRoleSkins === 'function') Theme._restoreRoleSkins(); } catch (e) {}
        },

        // ===== 切换风格 =====
        setStyle: function (id) {
            var s = this._byId(id);
            if (!s) return;
            this.current = id;
            this.apply();
            this.save();
        },

        // 兼容旧接口
        setMode: function () { this.apply(); },
        toggle: function () {
            var el = document.getElementById('themePanel');
            if (el) el.classList.toggle('open');
        },

        save: function () {
            try {
                var data = JSON.stringify({ styleId: this.current, chatBinding: this.chatBinding });
                localStorage.setItem('zf_theme', data);
                try { UserSettings.set('zf_theme', data); } catch (e) {}
            } catch (e) {}
        },

        _load: function () {
            try {
                var s = null;
                try { s = UserSettings.get('zf_theme'); } catch (e) {}
                if (!s) s = localStorage.getItem('zf_theme');
                return s ? JSON.parse(s) : null;
            } catch (e) { return null; }
        },

        _setupUI: function () {
            var self = this;
            var btn = document.getElementById('themeBtn');
            var panel = document.getElementById('themePanel');
            if (btn && panel) {
                // 防止面板被拖拽残留的内联样式移出可视区
                try {
                    var r = panel.getBoundingClientRect();
                    if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth) {
                        panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.transform = '';
                    }
                } catch (e) {}
                // 事件委托：无论按钮被重建多少次都能响应（防重复）
                if (!document._zfThemeDelegated) {
                    document._zfThemeDelegated = true;
                    document.addEventListener('click', function (e) {
                        var b = e.target.closest ? e.target.closest('#themeBtn') : null;
                        if (b) {
                            e.stopPropagation();
                            e.preventDefault();
                            var p = document.getElementById('themePanel');
                            if (p) p.classList.toggle('open');
                        }
                    }, true);
                }
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    var el = document.getElementById('themePanel');
                    if (el) el.classList.toggle('open');
                }, true);
                // 捕获阶段监听，避免被其他脚本的 stopPropagation 拦截
                document.addEventListener('click', function (e) {
                    if (!panel.contains(e.target) && !btn.contains(e.target)) {
                        panel.classList.remove('open');
                    }
                }, true);
            }

            // 20 风格宫格
            var grid = document.getElementById('zfStyleGrid');
            if (grid && !grid.dataset.done) {
                grid.dataset.done = '1';
                STYLES.forEach(function (s) {
                    var card = document.createElement('div');
                    card.className = 'zf-style-card';
                    card.setAttribute('data-style', s.id);
                    var dark = isDark(s.vars.bg);
                    card.innerHTML =
                        '<div class="zs-preview" style="background:' + s.vars.bg + '">' +
                            '<div class="zs-bar" style="background:' + s.vars.card + ';border:1px solid ' + s.vars.border + '"></div>' +
                            '<div class="zs-dot" style="background:' + s.vars.accent + '"></div>' +
                        '</div>' +
                        '<div class="zs-name">' + s.name + '</div>';
                    card.addEventListener('click', function (e) {
                        e.stopPropagation();
                        self.setStyle(s.id);
                    });
                    grid.appendChild(card);
                });
            }

            // 对话框归属下拉已移除（功能下线），元素不存在时直接跳过
            var sel = document.getElementById('zfChatBinding');
            if (sel && !sel.dataset.done) {
                sel.dataset.done = '1';
                sel.value = this.chatBinding;
                sel.addEventListener('change', function () {
                    self.chatBinding = this.value;
                    self.save();
                });
            }
        }
    };

    /* ===== 对话框归属（ChatTheme）：保留原有能力 =====
       chatBinding=global 时所有对话框跟随全局风格；
       chatBinding=perchat 时允许每个对话框绑定独立风格 */
    var ChatTheme = {
        KEY: 'zf_chat_themes',
        _all: function () {
            try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch (e) { return {}; }
        },
        _put: function (o) {
            try { localStorage.setItem(this.KEY, JSON.stringify(o)); } catch (e) {}
        },
        get: function (id) { return this._all()[id] || null; },
        set: function (id, conf) {
            var o = this._all();
            if (conf) o[id] = conf; else delete o[id];
            this._put(o);
        },
        boxId: function (box) {
            if (!box) return null;
            var id = box.dataset.boxId || box.dataset.cbDockKey || box.id || box.dataset.zfThemeId;
            if (!id) {
                id = 'ct_' + Math.random().toString(36).slice(2, 9);
                box.dataset.zfThemeId = id;
            }
            return id;
        },
        restoreFor: function (box) {
            // 仅在 perchat 模式下恢复对话框绑定风格
            if (Theme.chatBinding !== 'perchat') { Theme.apply(); return; }
            var id = this.boxId(box); if (!id) return;
            var c = this.get(id);
            if (c && c.styleId && Theme._byId(c.styleId)) {
                var saved = Theme.current;
                Theme.current = c.styleId;
                Theme.apply();
                Theme.current = saved; // 不改全局选择
            } else {
                Theme.apply();
            }
        },
        bindCurrent: function (id) {
            this.set(id, { styleId: Theme.current });
        },
        openMenu: function (box) {
            if (Theme.chatBinding !== 'perchat') {
                if (window.showToast) showToast('当前为全局统一风格，如需每对话框独立请在主题面板中切换');
                return;
            }
            var id = this.boxId(box); if (!id) return;
            var self = this;
            var bound = this.get(id);
            var old = document.getElementById('chatThemeMenu');
            if (old) old.remove();
            var menu = document.createElement('div');
            menu.id = 'chatThemeMenu';
            menu.style.cssText = 'position:fixed;z-index:99999;background:var(--bg-card,#161a24);border:1px solid var(--border,#2a3040);' +
                'border-radius:8px;padding:10px;min-width:200px;max-height:60vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.45);font-size:13px;color:var(--text,#eee);';
            var html = '<div style="font-weight:600;margin-bottom:8px;">此对话框风格</div>';
            Theme.styles.forEach(function (s) {
                var isCur = bound && bound.styleId === s.id;
                html += '<div class="ctm-item" data-id="' + s.id + '" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;">' +
                    '<span style="width:14px;height:14px;border-radius:3px;background:' + s.vars.bg + ';border:1px solid ' + s.vars.border + ';flex:none;"></span>' +
                    '<span style="flex:1;">' + s.name + '</span>' +
                    (isCur ? '<span style="color:var(--blue,#4a9eff);">✓</span>' : '') + '</div>';
            });
            html += '<div style="border-top:1px solid var(--border,#2a3040);margin:8px 0 4px;"></div>' +
                '<div class="ctm-clear" style="padding:6px 8px;border-radius:6px;cursor:pointer;opacity:.8;">跟随全局</div>';
            menu.innerHTML = html;
            document.body.appendChild(menu);
            var btn2 = box.querySelector('.chat-theme-btn');
            if (btn2) {
                var r = btn2.getBoundingClientRect();
                menu.style.left = Math.min(r.left, window.innerWidth - 230) + 'px';
                menu.style.top = Math.min(r.bottom + 6, window.innerHeight - 300) + 'px';
            }
            function close(ev) {
                if (menu.contains(ev.target)) return;
                menu.remove(); document.removeEventListener('mousedown', close);
            }
            setTimeout(function () { document.addEventListener('mousedown', close); }, 0);
            menu.querySelectorAll('.ctm-item').forEach(function (el) {
                el.addEventListener('click', function () {
                    self.set(id, { styleId: el.dataset.id });
                    var saved = Theme.current;
                    Theme.current = el.dataset.id;
                    Theme.apply();
                    Theme.current = saved;
                    menu.remove();
                });
                el.addEventListener('mouseenter', function () { el.style.background = 'var(--bg-hover,#222836)'; });
                el.addEventListener('mouseleave', function () { el.style.background = 'none'; });
            });
            menu.querySelector('.ctm-clear').addEventListener('click', function () {
                self.set(id, null);
                Theme.apply();
                menu.remove();
            });
        }
    };

    // 面板样式（宫格卡片）
    function injectStyle() {
        if (document.getElementById('zfStyleGridStyle')) return;
        var st = document.createElement('style');
        st.id = 'zfStyleGridStyle';
        st.textContent =
            '#zfStyleGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}' +
            '.zf-style-card{cursor:pointer;border:2px solid transparent;border-radius:8px;padding:4px;text-align:center;transition:all .15s ease;}' +
            '.zf-style-card:hover{transform:translateY(-2px);box-shadow:0 3px 10px rgba(0,0,0,.3);}' +
            '.zf-style-card.active{border-color:var(--blue,#4a9eff);background:var(--accent-weak,rgba(74,158,255,.1));}' +
            '.zs-preview{position:relative;height:34px;border-radius:6px;overflow:hidden;margin-bottom:4px;}' +
            '.zs-bar{position:absolute;left:6px;right:6px;top:14px;height:12px;border-radius:3px;}' +
            '.zs-dot{position:absolute;right:7px;top:5px;width:7px;height:7px;border-radius:50%;}' +
            '.zs-name{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text,#eee);}';
        document.head.appendChild(st);
    }


    window.Theme = Theme;
    window.ThemePresets = { list: function(){return [];}, apply: function(){} }; // 兼容残留引用
    window.ChatTheme = ChatTheme;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { Theme.init(); injectStyle(); setupFxGrid(); setupCursorGrid(); });
    else { Theme.init(); injectStyle(); setupFxGrid(); setupCursorGrid(); }

    // ===== 背景特效按钮网格（修复：面板特效按钮丢失）=====
    var FXS = [
        { id: 'none',      name: '无特效', ico: '○' },
        { id: 'firefly',   name: '萤火虫', ico: '✦' },
        { id: 'meteor',    name: '流星', ico: '☆' },
        { id: 'snow',      name: '雪花', ico: '❅' },
        { id: 'rain',      name: '下雨', ico: '☂' },
        { id: 'bubbles',   name: '气泡', ico: '○·' },
        { id: 'clouds',    name: '云朵', ico: '☁' },
        { id: 'aurora',    name: '极光', ico: '≈' },
        { id: 'sun',       name: '阳光', ico: '☀' },
        { id: 'particles', name: '粒子', ico: '··' },
        { id: 'star',      name: '星空', ico: '✿' },
        { id: 'netmouse',  name: '鼠标网络', ico: '⌗' },
        { id: 'orbit',     name: '环绕粒子', ico: '⊛' },
        { id: 'fireworks', name: '烟火', ico: '✺' },
        { id: 'techwave',  name: '科技波', ico: '⚡' },
        { id: 'magic',     name: '魔法阵', ico: '✦' },
        { id: 'wisps',     name: '灵光精灵', ico: '✧' },
        { id: 'vortex',    name: '星漩', ico: '◉' },
        { id: 'comets',    name: '秘法彗星', ico: '☄' }
    ]
    function hexToRgbStr(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        var m2 = m;
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return '74, 158, 255';
        return parseInt(m[1].slice(0,2),16) + ', ' + parseInt(m[1].slice(2,4),16) + ', ' + parseInt(m[1].slice(4,6),16);
    }
    function isDark(hex) {
        var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
        if (!m) return true;
        var r = parseInt(m[1].slice(0,2),16), g = parseInt(m[1].slice(2,4),16), b = parseInt(m[1].slice(4,6),16);
        return (r*299 + g*587 + b*114) / 1000 < 128;
    }

    var Theme = {
        styles: STYLES,
        current: 'midnight',  // 当前风格 id（默认：极简暗夜）
        chatBinding: 'global', // 对话框归属：global=全局统一 | perchat=每个对话框独立
        darkAccent: '#4a9eff', // 兼容旧代码读取
        lightAccent: '#4a9eff',
        grayAccent: '#4a9eff',
        followStrength: 50,

        init: function () {
            try {
                var params = new URLSearchParams(window.location.search);
                if (params.get('reset_theme') === '1') {
                    UserSettings.remove('zf_theme');
                    try { localStorage.removeItem('zf_theme'); } catch (e) {}
                    this.current = 'midnight';
                    this.save();
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
            } catch (e) {}

            var saved = this._load();
            if (saved && saved.styleId && this._byId(saved.styleId)) {
                this.current = saved.styleId;
                if (saved.chatBinding) this.chatBinding = saved.chatBinding;
            } else if (saved && saved.current) {
                // 旧配置兼容：dark→极简暗夜，light→晴空
                this.current = saved.current === 'light' ? 'sky' : 'midnight';
            }
            this.apply();
            this._setupUI();
        },

        _byId: function (id) {
            for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
            return null;
        },

        // ===== 应用风格：一次性写入全部 CSS 变量 =====
        apply: function () {
            var style = this._byId(this.current) || STYLES[0];
            var v = style.vars;
            var root = document.documentElement;
            var accentRgb = hexToRgbStr(v.accent);
            var dark = isDark(v.bg);

            var map = {
                '--bg': v.bg,
                '--bg-card': v.card,
                '--bg-hover': v.hover,
                '--border': v.border,
                '--text': v.text,
                '--text2': v.text2,
                '--blue': v.accent,
                '--blue-rgb': accentRgb,
                '--green': dark ? '#4ade80' : '#1a8a3a',

                // 衍生别名（保持全站面板/对话框联动，与旧版映射一致）
                '--panel': v.card,
                '--panel-bg': v.card,
                '--bg2': v.hover,
                '--text-sub': v.text2,
                '--text-sub2': v.text2,
                '--text-primary': v.text,
                '--text-secondary': v.text2,
                '--text-dim': v.text2,
                '--text1': v.text,
                '--accent': v.accent,
                '--accent-color': v.accent,
                '--accent-weak': 'rgba(' + accentRgb + ', 0.15)',
                '--blue-soft': 'rgba(' + accentRgb + ', 0.12)',
                '--blue-dark': v.accent,
                '--theme-accent': v.accent,

                // 风筝统计面板变量（三种模式统一用当前风格）
                '--kite-panel-bg': v.card,
                '--kite-panel-border': v.border,
                '--kite-panel-text': v.text,
                '--kite-panel-soft': v.hover,
                '--kite-panel-bg-gray': v.card,
                '--kite-panel-border-gray': v.border,
                '--kite-panel-text-gray': v.text,
                '--kite-panel-soft-gray': v.hover,
                '--kite-panel-bg-light': v.card,
                '--kite-panel-border-light': v.border,
                '--kite-panel-text-light': v.text,
                '--kite-panel-soft-light': v.hover
            };
            /* ===== 阶段1：背景隔离护盾 =====
             * 背景层与背景相关变量归 Background 管，主题切换禁止触碰。
             * 写变量前快照，写完后恢复，物理杜绝切主题把背景带偏。 */
            var _bgGuard = null;
            try {
                var _bgLayer = document.getElementById('bgCustomLayer');
                _bgGuard = {
                    layerBg: _bgLayer ? _bgLayer.style.background : null,
                    zfBg: document.body.style.getPropertyValue('--zf-custom-bg'),
                    zfText: document.body.style.getPropertyValue('--zf-custom-text'),
                    zfHas: document.body.classList.contains('zf-has-custom-bg'),
                    kiteBg: document.body.style.getPropertyValue('--kite-panel-bg'),
                    kiteBorder: document.body.style.getPropertyValue('--kite-panel-border'),
                    kiteText: document.body.style.getPropertyValue('--kite-panel-text')
                };
            } catch (e) {}
            Object.keys(map).forEach(function (k) {
                /* 禁写名单：背景专属变量不写 html（--bg-own-* 是 background.js 专属） */
                if (/^--(zf-custom|kite-panel|bg-own)/.test(k)) return;
                root.style.setProperty(k, map[k]);
            });
            try {
                var _bl = document.getElementById('bgCustomLayer');
                if (_bl && _bgGuard && _bgGuard.layerBg) _bl.style.background = _bgGuard.layerBg;
                var _b = document.body;
                var _ks = { '--zf-custom-bg': _bgGuard && _bgGuard.zfBg, '--zf-custom-text': _bgGuard && _bgGuard.zfText,
                            '--kite-panel-bg': _bgGuard && _bgGuard.kiteBg, '--kite-panel-border': _bgGuard && _bgGuard.kiteBorder,
                            '--kite-panel-text': _bgGuard && _bgGuard.kiteText };
                Object.keys(_ks).forEach(function (k) {
                    if (_ks[k]) { _b.style.setProperty(k, _ks[k]); } else { _b.style.removeProperty(k); }
                });
                if (_bgGuard && !_bgGuard.zfHas) _b.classList.remove('zf-has-custom-bg');
            } catch (e) {}
            // 风格扩展变量：允许每个风格彻底改写圆角/字体/渐变等，实现形态级差异
            if (style.extra && typeof style.extra === 'object') {
                Object.keys(style.extra).forEach(function (k) {
                    try { root.style.setProperty(k, style.extra[k]); } catch (e) {}
                });
            }

            // 风格专属 CSS（如辉光特效），切换时整体替换
            var extraEl = document.getElementById('zf-style-extra');
            if (!extraEl) {
                extraEl = document.createElement('style');
                extraEl.id = 'zf-style-extra';
                document.head.appendChild(extraEl);
            }
            extraEl.textContent = (style.extraCss || '');
            if (style.extraCss) { root.classList.add('zf-style-glow'); } else { root.classList.remove('zf-style-glow'); }

            root.setAttribute('data-theme', dark ? 'dark' : 'light');
            root.setAttribute('data-mode', dark ? 'dark' : 'light');

            // 按钮图标
            var btn = document.getElementById('themeBtn');
            if (btn) {
                btn.title = '当前风格: ' + style.name;
            }

            // 高亮面板中的当前风格卡片
            document.querySelectorAll('.zf-style-card').forEach(function (el) {
                el.classList.toggle('active', el.getAttribute('data-style') === Theme.current);
            });

            try {
                document.dispatchEvent(new CustomEvent('themechange', { detail: { mode: dark ? 'dark' : 'light', style: style.id } }));
            } catch (e) {}

            /* 全局风格切换后，重新贴上所有角色框的独立皮肤（防止衍生变量被全局值串味） */
            try { if (typeof Theme._restoreRoleSkins === 'function') Theme._restoreRoleSkins(); } catch (e) {}
        },

        // ===== 切换风格 =====
        setStyle: function (id) {
            var s = this._byId(id);
            if (!s) return;
            this.current = id;
            this.apply();
            this.save();
        },

        // 兼容旧接口
        setMode: function () { this.apply(); },
        toggle: function () {
            var el = document.getElementById('themePanel');
            if (el) el.classList.toggle('open');
        },

        save: function () {
            try {
                var data = JSON.stringify({ styleId: this.current, chatBinding: this.chatBinding });
                localStorage.setItem('zf_theme', data);
                try { UserSettings.set('zf_theme', data); } catch (e) {}
            } catch (e) {}
        },

        _load: function () {
            try {
                var s = null;
                try { s = UserSettings.get('zf_theme'); } catch (e) {}
                if (!s) s = localStorage.getItem('zf_theme');
                return s ? JSON.parse(s) : null;
            } catch (e) { return null; }
        },

        _setupUI: function () {
            var self = this;
            var btn = document.getElementById('themeBtn');
            var panel = document.getElementById('themePanel');
            if (btn && panel) {
                // 防止面板被拖拽残留的内联样式移出可视区
                try {
                    var r = panel.getBoundingClientRect();
                    if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth) {
                        panel.style.left = ''; panel.style.top = ''; panel.style.right = ''; panel.style.transform = '';
                    }
                } catch (e) {}
                // 事件委托：无论按钮被重建多少次都能响应（防重复）
                if (!document._zfThemeDelegated) {
                    document._zfThemeDelegated = true;
                    document.addEventListener('click', function (e) {
                        var b = e.target.closest ? e.target.closest('#themeBtn') : null;
                        if (b) {
                            e.stopPropagation();
                            e.preventDefault();
                            var p = document.getElementById('themePanel');
                            if (p) p.classList.toggle('open');
                        }
                    }, true);
                }
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    e.preventDefault();
                    var el = document.getElementById('themePanel');
                    if (el) el.classList.toggle('open');
                }, true);
                // 捕获阶段监听，避免被其他脚本的 stopPropagation 拦截
                document.addEventListener('click', function (e) {
                    if (!panel.contains(e.target) && !btn.contains(e.target)) {
                        panel.classList.remove('open');
                    }
                }, true);
            }

            // 20 风格宫格
            var grid = document.getElementById('zfStyleGrid');
            if (grid && !grid.dataset.done) {
                grid.dataset.done = '1';
                STYLES.forEach(function (s) {
                    var card = document.createElement('div');
                    card.className = 'zf-style-card';
                    card.setAttribute('data-style', s.id);
                    var dark = isDark(s.vars.bg);
                    card.innerHTML =
                        '<div class="zs-preview" style="background:' + s.vars.bg + '">' +
                            '<div class="zs-bar" style="background:' + s.vars.card + ';border:1px solid ' + s.vars.border + '"></div>' +
                            '<div class="zs-dot" style="background:' + s.vars.accent + '"></div>' +
                        '</div>' +
                        '<div class="zs-name">' + s.name + '</div>';
                    card.addEventListener('click', function (e) {
                        e.stopPropagation();
                        self.setStyle(s.id);
                    });
                    grid.appendChild(card);
                });
            }

            // 对话框归属下拉已移除（功能下线），元素不存在时直接跳过
            var sel = document.getElementById('zfChatBinding');
            if (sel && !sel.dataset.done) {
                sel.dataset.done = '1';
                sel.value = this.chatBinding;
                sel.addEventListener('change', function () {
                    self.chatBinding = this.value;
                    self.save();
                });
            }
        }
    };

    /* ===== 对话框归属（ChatTheme）：保留原有能力 =====
       chatBinding=global 时所有对话框跟随全局风格；
       chatBinding=perchat 时允许每个对话框绑定独立风格 */
    var ChatTheme = {
        KEY: 'zf_chat_themes',
        _all: function () {
            try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch (e) { return {}; }
        },
        _put: function (o) {
            try { localStorage.setItem(this.KEY, JSON.stringify(o)); } catch (e) {}
        },
        get: function (id) { return this._all()[id] || null; },
        set: function (id, conf) {
            var o = this._all();
            if (conf) o[id] = conf; else delete o[id];
            this._put(o);
        },
        boxId: function (box) {
            if (!box) return null;
            var id = box.dataset.boxId || box.dataset.cbDockKey || box.id || box.dataset.zfThemeId;
            if (!id) {
                id = 'ct_' + Math.random().toString(36).slice(2, 9);
                box.dataset.zfThemeId = id;
            }
            return id;
        },
        restoreFor: function (box) {
            // 仅在 perchat 模式下恢复对话框绑定风格
            if (Theme.chatBinding !== 'perchat') { Theme.apply(); return; }
            var id = this.boxId(box); if (!id) return;
            var c = this.get(id);
            if (c && c.styleId && Theme._byId(c.styleId)) {
                var saved = Theme.current;
                Theme.current = c.styleId;
                Theme.apply();
                Theme.current = saved; // 不改全局选择
            } else {
                Theme.apply();
            }
        },
        bindCurrent: function (id) {
            this.set(id, { styleId: Theme.current });
        },
        openMenu: function (box) {
            if (Theme.chatBinding !== 'perchat') {
                if (window.showToast) showToast('当前为全局统一风格，如需每对话框独立请在主题面板中切换');
                return;
            }
            var id = this.boxId(box); if (!id) return;
            var self = this;
            var bound = this.get(id);
            var old = document.getElementById('chatThemeMenu');
            if (old) old.remove();
            var menu = document.createElement('div');
            menu.id = 'chatThemeMenu';
            menu.style.cssText = 'position:fixed;z-index:99999;background:var(--bg-card,#161a24);border:1px solid var(--border,#2a3040);' +
                'border-radius:8px;padding:10px;min-width:200px;max-height:60vh;overflow:auto;box-shadow:0 8px 30px rgba(0,0,0,.45);font-size:13px;color:var(--text,#eee);';
            var html = '<div style="font-weight:600;margin-bottom:8px;">此对话框风格</div>';
            Theme.styles.forEach(function (s) {
                var isCur = bound && bound.styleId === s.id;
                html += '<div class="ctm-item" data-id="' + s.id + '" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;">' +
                    '<span style="width:14px;height:14px;border-radius:3px;background:' + s.vars.bg + ';border:1px solid ' + s.vars.border + ';flex:none;"></span>' +
                    '<span style="flex:1;">' + s.name + '</span>' +
                    (isCur ? '<span style="color:var(--blue,#4a9eff);">✓</span>' : '') + '</div>';
            });
            html += '<div style="border-top:1px solid var(--border,#2a3040);margin:8px 0 4px;"></div>' +
                '<div class="ctm-clear" style="padding:6px 8px;border-radius:6px;cursor:pointer;opacity:.8;">跟随全局</div>';
            menu.innerHTML = html;
            document.body.appendChild(menu);
            var btn2 = box.querySelector('.chat-theme-btn');
            if (btn2) {
                var r = btn2.getBoundingClientRect();
                menu.style.left = Math.min(r.left, window.innerWidth - 230) + 'px';
                menu.style.top = Math.min(r.bottom + 6, window.innerHeight - 300) + 'px';
            }
            function close(ev) {
                if (menu.contains(ev.target)) return;
                menu.remove(); document.removeEventListener('mousedown', close);
            }
            setTimeout(function () { document.addEventListener('mousedown', close); }, 0);
            menu.querySelectorAll('.ctm-item').forEach(function (el) {
                el.addEventListener('click', function () {
                    self.set(id, { styleId: el.dataset.id });
                    var saved = Theme.current;
                    Theme.current = el.dataset.id;
                    Theme.apply();
                    Theme.current = saved;
                    menu.remove();
                });
                el.addEventListener('mouseenter', function () { el.style.background = 'var(--bg-hover,#222836)'; });
                el.addEventListener('mouseleave', function () { el.style.background = 'none'; });
            });
            menu.querySelector('.ctm-clear').addEventListener('click', function () {
                self.set(id, null);
                Theme.apply();
                menu.remove();
            });
        }
    };

    // 面板样式（宫格卡片）
    function injectStyle() {
        if (document.getElementById('zfStyleGridStyle')) return;
        var st = document.createElement('style');
        st.id = 'zfStyleGridStyle';
        st.textContent =
            '#zfStyleGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}' +
            '.zf-style-card{cursor:pointer;border:2px solid transparent;border-radius:8px;padding:4px;text-align:center;transition:all .15s ease;}' +
            '.zf-style-card:hover{transform:translateY(-2px);box-shadow:0 3px 10px rgba(0,0,0,.3);}' +
            '.zf-style-card.active{border-color:var(--blue,#4a9eff);background:var(--accent-weak,rgba(74,158,255,.1));}' +
            '.zs-preview{position:relative;height:34px;border-radius:6px;overflow:hidden;margin-bottom:4px;}' +
            '.zs-bar{position:absolute;left:6px;right:6px;top:14px;height:12px;border-radius:3px;}' +
            '.zs-dot{position:absolute;right:7px;top:5px;width:7px;height:7px;border-radius:50%;}' +
            '.zs-name{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text,#eee);}';
        document.head.appendChild(st);
    }

    // ===== 风格设置面板：标题栏拖拽移动 + 左右边缘拖拽调宽 =====
    function initPanelDragResize() {
        var panel = document.getElementById('themePanel');
        var dragBar = document.getElementById('themePanelDrag');
        var rzL = document.getElementById('themePanelResizeL');
        var rzR = document.getElementById('themePanelResize');
        if (!panel) return;

        var GEO_KEY = 'zf_themePanelGeo';
        function saveGeo() {
            try {
                var r = panel.getBoundingClientRect();
                var free = panel.style.left !== '' && panel.style.left !== 'auto';
                localStorage.setItem(GEO_KEY, JSON.stringify({
                    w: Math.round(r.width), h: Math.round(r.height),
                    x: Math.round(r.left), y: Math.round(r.top), free: free
                }));
            } catch (e) {}
        }
        function restoreGeo() {
            try {
                var g = JSON.parse(localStorage.getItem(GEO_KEY) || 'null');
                if (!g) return;
                if (g.w) panel.style.width = Math.max(260, Math.min(window.innerWidth * 0.94, g.w)) + 'px';
                if (g.h) panel.style.height = Math.max(240, Math.min(window.innerHeight - 40, g.h)) + 'px';
                if (g.free && g.x != null) {
                    panel.style.right = 'auto';
                    panel.style.transform = 'none';
                    panel.style.left = Math.max(0, Math.min(window.innerWidth - 60, g.x)) + 'px';
                    panel.style.top = Math.max(0, Math.min(window.innerHeight - 40, g.y)) + 'px';
                }
            } catch (e) {}
        }
        restoreGeo();

        var MIN_W = 260;
        function clampW(w) {
            return Math.max(MIN_W, Math.min(Math.floor(window.innerWidth * 0.94), w));
        }
        // 拖拽高度时解除 CSS max-height 限制，避免无法往下拖
        // 高度自适应：面板最高不超过视口（顶部 42px 定位时留出边距），内容超出在面板内滚动
        function fitPanelHeight() {
            panel.style.maxHeight = (window.innerHeight - 60) + 'px';
            panel.style.height = 'auto';
            var r = panel.getBoundingClientRect();
            // 顶部被顶出或底部超出屏幕时，把面板整体下移/上收保证完整可见
            if (r.bottom > window.innerHeight - 8) {
                var t = Math.max(0, window.innerHeight - r.height - 8);
                panel.style.top = t + 'px';
                panel.style.bottom = 'auto';
            }
        }
        fitPanelHeight();
        window.addEventListener('resize', fitPanelHeight);

        // —— 标题栏拖拽移动 ——
        if (dragBar && !dragBar.dataset.bound) {
            dragBar.dataset.bound = '1';
            var moving = false, sx = 0, sy = 0, sl = 0, st = 0;
            dragBar.addEventListener('pointerdown', function (e) {
                if (e.target.closest('.theme-panel-close')) return; // 点关闭按钮不拖
                moving = true;
                dragBar.setPointerCapture(e.pointerId);
                var r = panel.getBoundingClientRect();
                sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
                // 切为自由定位
                panel.style.right = 'auto';
                panel.style.transform = 'none';
                panel.style.left = sl + 'px';
                panel.style.top = st + 'px';
                e.preventDefault();
            });
            dragBar.addEventListener('pointermove', function (e) {
                if (!moving) return;
                var nl = sl + (e.clientX - sx);
                var nt = st + (e.clientY - sy);
                nl = Math.max(0, Math.min(window.innerWidth - 60, nl));
                nt = Math.max(0, Math.min(window.innerHeight - 40, nt));
                panel.style.left = nl + 'px';
                panel.style.top = nt + 'px';
            });
            function endMove(e) {
                if (!moving) return;
                moving = false;
                if (dragBar.hasPointerCapture && dragBar.hasPointerCapture(e.pointerId)) dragBar.releasePointerCapture(e.pointerId);
                saveGeo();
            }
            dragBar.addEventListener('pointerup', endMove);
            dragBar.addEventListener('pointercancel', endMove);
        }

        // —— 拖拽调宽（左缘 / 右缘通用）——
        function bindResize(handle, dir, includeH) {
            if (!handle || handle.dataset.bound) return;
            handle.dataset.bound = '1';
            var resizing = false, sx = 0, sw = 0, sy = 0, sh = 0;
            handle.addEventListener('pointerdown', function (e) {
                resizing = true;
                handle.setPointerCapture(e.pointerId);
                sx = e.clientX; sy = e.clientY;
                sw = panel.getBoundingClientRect().width;
                sh = panel.getBoundingClientRect().height;
                // 锚点切换：拖哪个缘，锚点固定到对侧，保证拉宽朝正确方向伸展
                var r0 = panel.getBoundingClientRect();
                if (dir === 1) {
                    panel.style.left = r0.left + 'px';
                    panel.style.right = 'auto';
                } else {
                    panel.style.right = Math.max(0, window.innerWidth - r0.right) + 'px';
                    panel.style.left = 'auto';
                }
                panel.style.transform = 'none';
                e.preventDefault();
                e.stopPropagation();
            });
            handle.addEventListener('pointermove', function (e) {
                if (!resizing) return;
                var dw = (e.clientX - sx) * dir; // dir=1 右缘拉宽，dir=-1 左缘拉宽
                panel.style.width = clampW(sw + dw) + 'px';
                if (includeH) {
                    var nh = Math.max(240, Math.min(window.innerHeight - 40, sh + (e.clientY - sy)));
                    panel.style.height = nh + 'px';
                }
            });
            function endRz(e) {
                if (!resizing) return;
                resizing = false;
                if (handle.hasPointerCapture && handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
                saveGeo();
            }
            handle.addEventListener('pointerup', endRz);
            handle.addEventListener('pointercancel', endRz);
        }
        bindResize(rzL, -1, false);
        bindResize(rzR, 1, true);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initPanelDragResize);
    else initPanelDragResize();

    window.Theme = Theme;
    window.ThemePresets = { list: function(){return [];}, apply: function(){} }; // 兼容残留引用
    window.ChatTheme = ChatTheme;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { Theme.init(); injectStyle(); setupFxGrid(); setupCursorGrid(); });
    else { Theme.init(); injectStyle(); setupFxGrid(); setupCursorGrid(); }

    // ===== 背景特效按钮网格（修复：面板特效按钮丢失）=====
    var FXS = [
        { id: 'none',      ico: '🚫', name: '无' },
        { id: 'particles', ico: '✨', name: '粒子' },
        { id: 'clouds',    ico: '☁️', name: '漂浮' },
        { id: 'bubbles',   ico: '🫧', name: '气泡' },
        { id: 'meteor',    ico: '☄️', name: '流星' },
        { id: 'firefly',   ico: '🪰', name: '萤火虫' },
        { id: 'snow',      ico: '❄️', name: '飘雪' },
        { id: 'star',      ico: '🌟', name: '星光' },
        { id: 'netmouse',  ico: '🕸️', name: '网格' },
        { id: 'orbit',     ico: '🪐', name: '星环' },
        { id: 'fireworks', ico: '✺', name: '烟火' },
        { id: 'techwave',  ico: '⚡', name: '科技波' },
        { id: 'magic',     ico: '✦', name: '魔法阵' },
        { id: 'wisps',     ico: '✧', name: '灵光精灵' },
        { id: 'vortex',    ico: '◉', name: '星漩' },
        { id: 'comets',    ico: '☄', name: '秘法彗星' }
    ];
    // ===== 鼠标样式选择网格（v5.2.6：原始 + 4 种美化光标）=====
    function setupCursorGrid() {
        var tries = 0;
        (function wait(){
            if (window.ZFCursor) ZFCursor.render('cursorGrid');
            else if (tries++ < 40) setTimeout(wait, 100);
        })();
    }

    function setupFxGrid() {
        var grid = document.getElementById('fxGrid');
        if (!grid || grid.dataset.done) return;
        grid.dataset.done = '1';
        FXS.forEach(function (f) {
            var b = document.createElement('button');
            b.className = 'bg-fx-btn';
            b.setAttribute('data-fx', f.id);
            b.textContent = f.ico + ' ' + f.name;
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                var fxId = f.fx || f.id;
                if (window.Background && Background.toggleFx) {
                    Background.toggleFx(fxId); // v5.4.6 多选 toggle
                } else {
                    try {
                        var raw = localStorage.getItem('zf_background');
                        var o = raw ? JSON.parse(raw) : {};
                        var arr = Array.isArray(o.fxs) ? o.fxs.slice() : (o.fx ? [o.fx] : []);
                        var ix = arr.indexOf(fxId);
                        if (fxId === 'none') arr = [];
                        else if (ix >= 0) arr.splice(ix, 1);
                        else { if (arr.length >= 3) arr.shift(); arr.push(fxId); }
                        o.fxs = arr;
                        o.fx = arr[0] || '';
                        localStorage.setItem('zf_background', JSON.stringify(o));
                    } catch (err) {}
                }
            });
            grid.appendChild(b);
        });
        // 同步当前激活特效（多选，兼容 Background 晚加载）
        var pit = setInterval(function () {
            if (!window.Background) return;
            var fxs = Array.isArray(Background.fxs) ? Background.fxs : [];
            grid.querySelectorAll('.bg-fx-btn').forEach(function (el) {
                var id = el.getAttribute('data-fx');
                if (id === 'none') el.classList.toggle('active', fxs.length === 0);
                else el.classList.toggle('active', fxs.indexOf(id) >= 0);
            });
            clearInterval(pit);
        }, 300);
        setTimeout(function () { clearInterval(pit); }, 8000);
    }

    /* ===== 角色对话框皮肤（恢复自 2026-09-21 13:20 提交 f3c355e7）===== */
    function zfStyleVarMap(style) {
        var v = style.vars;
        var accentRgb = hexToRgbStr(v.accent);
        var dark = isDark(v.bg);
        return {
            '--bg': v.bg,
            '--bg-card': v.card,
            '--bg-hover': v.hover,
            '--border': v.border,
            '--text': v.text,
            '--text2': v.text2,
            '--blue': v.accent,
            '--blue-rgb': accentRgb,
            '--green': dark ? '#4ade80' : '#1a8a3a',
            '--panel': v.card,
            '--panel-bg': v.card,
            '--bg2': v.hover,
            '--text-sub': v.text2,
            '--text-sub2': v.text2,
            '--text-primary': v.text,
            '--text-secondary': v.text2,
            '--text-dim': v.text2,
            '--text1': v.text,
            '--accent': v.accent,
            '--accent-color': v.accent,
            '--accent-weak': 'rgba(' + accentRgb + ', 0.15)',
            '--blue-soft': 'rgba(' + accentRgb + ', 0.12)',
            '--blue-dark': v.accent,
            '--theme-accent': v.accent
        };
    }

    if (!document.getElementById('zf-box-skin-style')) {
        var _bs = document.createElement('style');
        _bs.id = 'zf-box-skin-style';
        /* 需要护盾的对话框内部节点（全局皮肤/明暗补丁会命名的那些） */
        var _shieldSel = [
            '.chatbox', '.chatbox-header', '.chatbox.collapsed .chatbox-header',
            '.chatbox-header .title', '.chatbox-header .hd-btn', '.chatbox-header button',
            '.chatbox-body', '.chat-messages', '.chatbox-input-area', '.input-area',
            '.chatbox-inputrow', '.chatbox-inputrow textarea', '.chatbox-inputrow input',
            '.chatbox-input textarea', '.chatbox-input input', '.chat-input input',
            '.chatbox-send', '.msg', '.msg-content', '.msg-user .msg-content',
            '.message.user', '.message.ai', '.message-content', '.message-meta',
            '.msg-content strong', '.msg-content code', '.message-content code',
            '.message-content blockquote', '.panel', '[class*="panel"]'
        ].map(function (s) { return 'html body .zf-box-skin[data-box-skin] ' + s; });
        _bs.textContent =
            /* 容器本体：颜色 / 圆角 / 边框完全跟随角色皮肤变量 */
            'html body .zf-box-skin[data-box-skin],html body .zf-box-skin[data-box-skin].chatbox{' +
            'background:var(--bg-card)!important;color:var(--text)!important;' +
            'border:1px solid var(--border)!important;border-radius:var(--radius,8px)!important;' +
            'background-image:none!important;box-shadow:0 8px 26px rgba(0,0,0,.26)!important;}' +
            /* 内部主要区块跟随角色皮肤变量 */
            'html body .zf-box-skin[data-box-skin] .chatbox-header,' +
            'html body .zf-box-skin[data-box-skin] .chatbox-body,' +
            'html body .zf-box-skin[data-box-skin] .chat-messages,' +
            'html body .zf-box-skin[data-box-skin] .chatbox-input-area,' +
            'html body .zf-box-skin[data-box-skin] .input-area,' +
            'html body .zf-box-skin[data-box-skin] .panel,' +
            'html body .zf-box-skin[data-box-skin] [class*="panel"]{' +
            'background:var(--bg-card)!important;color:var(--text)!important;border-color:var(--border)!important;}' +
            /* 护盾：全局 data-skin / data-theme 补丁不得渗入角色对话框 */
            _shieldSel.join(',') + '{color:var(--text)!important;border-color:var(--border)!important;' +
            'background-image:none!important;border-radius:var(--radius,8px)!important;}' +
            /* 链接用角色皮肤的强调色，避免被全局规则改掉 */
            'html body .zf-box-skin[data-box-skin] .msg-content a,' +
            'html body .zf-box-skin[data-box-skin] .message-content a{color:var(--blue)!important;}' +
            /* 通配护盾兜底：全局皮肤里大量规则使用的类名（.chat-box/.chat-message/.chat-header 等）
               不在上方白名单里，且发光/毛玻璃效果靠 box-shadow / backdrop-filter /
               text-shadow / filter 实现——白名单护盾没锁这些属性，导致切「霓虹/玻璃」
               等整体皮肤时角色对话框仍被串味。这里按属性维度全量锁死。
               用 [data-role-skin-id] 抬高特异性，压过 body[data-skin=x] .a .b 形态的规则。 */
            'html body .zf-box-skin[data-box-skin][data-role-skin-id],' +
            'html body .zf-box-skin[data-box-skin][data-role-skin-id] *:not(canvas):not(img):not(svg):not(video):not(iframe):not(path):not(circle):not(rect):not(line):not(polygon){' +
            'background-image:none!important;' +
            'box-shadow:none!important;text-shadow:none!important;filter:none!important;}';
        document.head.appendChild(_bs);
    }

    Theme._restoreRoleSkins = function () {
        /* 优先用 DOM 属性（刷新/新建后仍在），回落 JS 属性 / 角色本地存储 */
        var boxes = document.querySelectorAll('.chatbox, .zf-box-skin, [data-box-skin]');
        var seen = {};
        for (var i = 0; i < boxes.length; i++) {
            var box = boxes[i];
            var bid = (box.id || box.getAttribute('data-box-id') || '');
            var key = bid || ('idx_' + i);
            if (seen[key]) continue;
            seen[key] = true;
            var sid = box.getAttribute('data-box-skin') || box._zfRoleSkinId || '';
            /* 兜底：从角色本地存储读取（DOM 标记丢失 / 新建框未贴皮肤时） */
            if (!sid && bid) {
                try {
                    var lr = null;
                    var raw = localStorage.getItem('zf_role_chat_' + bid);
                    if (raw) lr = JSON.parse(raw);
                    if (!lr && window.App && typeof App.localRoleOf === 'function') lr = App.localRoleOf(bid);
                    if (lr && lr.chat_skin) sid = lr.chat_skin;
                } catch (e) {}
            }
            if (!sid) continue;
            /* 只在角色框上恢复，普通对话框不动 */
            if (!box.classList.contains('zf-box-skin') && !box.hasAttribute('data-box-skin')) {
                /* 存储里有皮肤但 DOM 完全没有标记：仍恢复（时序问题兜底） */
            }
            try { this.applyToBox(box, sid); } catch (e) {}
        }
    };

    /* 追加：把某风格渲染到指定对话框（恢复自 f3c355e7） */
    Theme.applyToBox = function (box, styleId) {
        if (!box || !box.style || !box.classList) return;
        var oldVars = box._zfSkinVars || [];
        oldVars.forEach(function (k) { try { box.style.removeProperty(k); } catch (e) {} });
        box._zfSkinVars = null;
        box.classList.remove('zf-box-skin');
        box.removeAttribute('data-box-skin');
        box.removeAttribute('data-role-skin');
        box.removeAttribute('data-role-skin-id');
        box._zfRoleSkinId = '';
        var style = styleId ? Theme._byId(styleId) : null;
        if (!style) {
            /* 无皮肤 / 跟随全局：恢复之前被顶掉的形状皮肤（若有） */
            try {
                if (box._zfShapeSkin) {
                    box.setAttribute('data-skin', box._zfShapeSkin);
                    box._zfShapeSkin = '';
                }
            } catch (e) {}
            return;
        }
        var map = zfStyleVarMap(style);
        var keys = Object.keys(map);
        keys.forEach(function (k) { try { box.style.setProperty(k, map[k]); } catch (e) {} });
        if (style.extra && typeof style.extra === 'object') {
            Object.keys(style.extra).forEach(function (k) {
                try { box.style.setProperty(k, style.extra[k]); keys.push(k); } catch (e) {}
            });
        }
        box._zfSkinVars = keys;
        box.classList.add('zf-box-skin');
        box.setAttribute('data-box-skin', style.id);
        box._zfRoleSkinId = style.id;
        box.setAttribute('data-role-skin-id', style.id);
        /* 记录被角色皮肤顶掉的形状皮肤，便于清除角色皮肤后恢复 */
        try {
            var prevShape = box.getAttribute('data-skin');
            if (prevShape) { box._zfShapeSkin = prevShape; }
        } catch (e) {}
        try { box.removeAttribute('data-skin'); } catch (e) {}
        box.setAttribute('data-role-skin', '1');
    };
})();
