# -*- coding: utf-8 -*-
import io
cp = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2_发布版\public\css\style-kite.css'
css = io.open(cp, encoding='utf-8').read()
if '.kho-track__curb' in css:
    print('already inserted'); raise SystemExit
marker = '/* 旧版竖排车道样式已移除（v12 赛车场重设计） */'
assert marker in css
new_css = r"""
.kho-track { display: flex; align-items: center; gap: 5px; --lane: #9fb3c8; }
.kho-track__no {
    flex: none; width: 16px; height: 16px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 9px; font-weight: 700; color: #0b1220;
    background: linear-gradient(180deg, #ffe9a8, #d9a52e);
    box-shadow: 0 0 0 1px rgba(0,0,0,.4), 0 0 6px rgba(255,222,120,.35);
    font-family: var(--font-mono, Consolas, monospace);
}
.kho-track__road {
    flex: 1 1 auto; position: relative; height: 22px; border-radius: 5px; overflow: hidden;
    background:
        linear-gradient(180deg, rgba(255,255,255,.06) 0 2px, transparent 2px),
        linear-gradient(0deg, rgba(0,0,0,.5), rgba(0,0,0,.15)),
        linear-gradient(90deg, #232a33, #2c3540 55%, #232a33);
    box-shadow: inset 0 0 0 1px rgba(0,0,0,.55), 0 1px 3px rgba(0,0,0,.4);
}
/* 红白路缘石：赛道上下两侧 */
.kho-track__curb { position: absolute; left: 0; right: 0; height: 3px; font-style: normal; z-index: 1;
    background: repeating-linear-gradient(90deg, #d84b4b 0 7px, #f2f2f2 7px 14px); opacity: .85; }
.kho-track__curb--t { top: 0; } .kho-track__curb--b { bottom: 0; }
/* 中央虚线：随车速向右滚动 */
.kho-track__road::after {
    content: ''; position: absolute; left: 0; right: -40px; top: 50%; height: 2px; margin-top: -1px; z-index: 1;
    background: repeating-linear-gradient(90deg, rgba(255,255,255,.5) 0 12px, transparent 12px 26px);
    animation: khoRoad .9s linear infinite;
}
.kho-track--run .kho-track__road::after { opacity: .9; }
.kho-track--q .kho-track__road::after, .kho-track--tight .kho-track__road::after { animation-duration: 2.8s; opacity: .55; }
.kho-track--idle .kho-track__road::after { animation: none; opacity: .3; }
@keyframes khoRoad { from { transform: translateX(0); } to { transform: translateX(26px); } }
/* 状态光晕 */
.kho-track--run .kho-track__road { box-shadow: inset 0 0 0 1px rgba(62,207,142,.55), inset 0 0 12px rgba(62,207,142,.18); }
.kho-track--q .kho-track__road { box-shadow: inset 0 0 0 1px rgba(232,179,75,.55), inset 0 0 12px rgba(232,179,75,.18); }
.kho-track--tight .kho-track__road { box-shadow: inset 0 0 0 1px rgba(199,155,245,.55), inset 0 0 12px rgba(199,155,245,.18); }
.kho-track--idle .kho-track__road { opacity: .75; }
/* ===== F1 小车：横向向右开；--car=队伍色 ===== */
.kho-car {
    position: absolute; top: 50%; width: 16px; height: 9px; margin-top: -5px; z-index: 2;
    color: var(--car, #9fb3c8);
    animation: khoCarRun 0.9s linear infinite;
    transition: left 1.2s ease;
}
.kho-car::before {
    content: ''; position: absolute; inset: 2px 0 1px 0;
    background: linear-gradient(180deg, color-mix(in srgb, var(--car) 70%, #fff) 0 30%, var(--car) 30%);
    border-radius: 5px 7px 3px 3px / 4px 8px 2px 2px;
    box-shadow: 0 1px 2px rgba(0,0,0,.5);
}
.kho-car::after {
    content: ''; position: absolute; left: 5px; top: 0; width: 5px; height: 3px;
    background: rgba(230,245,255,.9); border-radius: 3px 3px 0 0;
    box-shadow: -4px 6px 0 -1px #16181c, 13px 6px 0 -1px #16181c;
}
/* 尾焰 */
.kho-car i { position: absolute; left: -5px; top: 3px; width: 4px; height: 3px; border-radius: 50%;
    background: linear-gradient(90deg, rgba(120,200,255,.9), rgba(60,140,255,.4));
    filter: blur(.4px); animation: khoExhaust .45s linear infinite; }
@keyframes khoExhaust { from { transform: translateX(0) scale(1); opacity: .9; } to { transform: translateX(-7px) scale(.4); opacity: 0; } }
.kho-track--q .kho-car, .kho-track--tight .kho-car, .kho-track--idle .kho-car { animation-play-state: paused; }
.kho-track--q .kho-car i, .kho-track--tight .kho-car i { animation: none; opacity: 0; }
@keyframes khoCarRun { from { transform: translateX(0); } to { transform: translateX(2px); } }
.kho-car--empty { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); font-size: 9px; font-weight: 400; color: #5a6b7d; letter-spacing: 2px; }
.kho-track__queue { position: absolute; right: 3px; top: 1px; z-index: 3; font-style: normal; font-size: 9px; color: #ffd866; text-shadow: 0 0 4px rgba(0,0,0,.8); }
.kho-track__spd { flex: none; min-width: 26px; text-align: center; font-size: 9px; font-weight: 700; color: #9fe0b8;
    background: rgba(10,16,24,.8); border: 1px solid rgba(159,213,255,.25); border-radius: 3px; padding: 1px 2px;
    font-family: var(--font-mono, Consolas, monospace); }
.kho-track--tight .kho-track__spd { color: #e08b8b; }
.kho-track--idle .kho-track__spd { color: #5a6b7d; }
"""
css = css.replace(marker, marker + '\n' + new_css, 1)
io.open(cp, 'w', encoding='utf-8').write(css)
print('inserted, chars =', len(css))
