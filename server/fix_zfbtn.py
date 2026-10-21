import io
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.5\public\js\app-zfrich.js'
t = io.open(p, encoding='utf-8').read()
n0 = t
t = t.replace('style="zfbtn;opacity:', 'style="opacity:')
t = t.replace('class="zf-tab-h"', 'class="zf-tab-h zfbtn"')
t = t.replace('class="zp-prev"', 'class="zp-prev zfbtn"')
t = t.replace('class="zp-next"', 'class="zp-next zfbtn"')
t = t.replace('class="zp-auto"', 'class="zp-auto zfbtn"')
# 删除死代码块：从 "h += '<' + 'script>..." 到 bindTabs 注释行
i = t.find("h += '<' + 'script>(function(){document.querySelectorAll")
marker = '// 简化：直接事件委托已由全局 ZFRich.bindTabs 处理'
j = t.find(marker)
if i >= 0 and j >= 0:
    j2 = t.find('\n', j) + 1
    t = t[:i] + "      // 切换绑定由全局 ZFRich.bindGlobal 事件委托统一处理，无需逐实例脚本\n" + t[j2:]
io.open(p, 'w', encoding='utf-8', newline='\n').write(t)
print('changed:', t != n0)
print('style_zfbtn_left:', 'style="zfbtn' in t)
print('deadcode_left:', 'forEach?0:0' in t)
print('tab_zfbtn:', 'zf-tab-h zfbtn' in t)
