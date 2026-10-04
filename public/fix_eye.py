import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\model-config-rewrite.js'
s = io.open(p, encoding='utf-8').read()
hidden_svg = "'<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#999\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24\"/><line x1=\"1\" y1=\"1\" x2=\"23\" y2=\"23\"/></svg>'"
shown_svg = "'<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#1890ff\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/></svg>'"
c1 = s.count(hidden_svg); c2 = s.count(shown_svg)
print('c1', c1, 'c2', c2)
s = s.replace(hidden_svg, "'\U0001F6AB'").replace(shown_svg, "'\U0001F441'")
io.open(p, 'w', encoding='utf-8').write(s)
print('done')
