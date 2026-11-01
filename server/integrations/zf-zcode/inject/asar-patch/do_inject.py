# -*- coding: utf-8 -*-
import io, subprocess
b64 = io.open(r'F:\zf-asar-tmp\zf-logo-b64.txt').read().strip()
snip = u"""<!-- zf-inject-start -->
<style id="zf-switch-style">
#zf-fab{position:fixed;right:14px;bottom:14px;z-index:2147483000;width:48px;height:48px;border-radius:50%;background:#fff;cursor:pointer;user-select:none;box-shadow:0 4px 14px rgba(0,0,0,.45);opacity:.9;display:flex;align-items:center;justify-content:center}
#zf-fab:hover{opacity:1}
#zf-fab img{width:40px;height:40px;pointer-events:none}
#zf-dock{position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147482000;display:none;background:#0d1117;border:0}
body.zf-mode{overflow:hidden!important}
body.zf-mode #zf-dock{display:block}
body.zf-mode #zf-fab{background:#18b6ff}
body.zf-mode>#root,body.zf-mode>#app,body.zf-mode>.zcode-app{display:none!important}
</style>
<div id="zf-fab" title="switch"><img src="data:image/png;base64,__B64__"></div>
<iframe id="zf-dock" src="http://127.0.0.1:8793"></iframe>
<script>
(function(){document.getElementById("zf-fab").addEventListener("click",function(){document.body.classList.toggle("zf-mode");});})();
</script>
<!-- zf-inject-end -->""".replace("__B64__", b64)
io.open(r"F:\zf-asar-tmp\zf-inject-snippet.html", "w", encoding="utf-8").write(snip)
h = r"F:\zf-asar-tmp\app\out\renderer\index.html"
s = io.open(h, encoding="utf-8").read()
if "zf-inject-start" in s:
    a = s.index("<!-- zf-inject-start -->")
    b = s.index("<!-- zf-inject-end -->") + len("<!-- zf-inject-end -->")
    s = s[:a] + s[b:]
elif "zf-fab" in s:
    a = s.index("<!-- 朱峰智能体无限 悬浮切换按钮 注入开始 -->")
    b = s.index("朱峰智能体无限 悬浮切换按钮 注入结束 -->") + len("朱峰智能体无限 悬浮切换按钮 注入结束 -->")
    s = s[:a] + s[b:]
assert s.count("</body>") == 1
io.open(h, "w", encoding="utf-8").write(s.replace("</body>", snip + "\n  </body>"))
chk = io.open(h, encoding="utf-8").read()
print("INJECTED_OK", ("base64," + b64[:10]) in chk and "100vw" in chk)
r = subprocess.run('npx --yes @electron/asar pack app "C:\\Program Files\\ZCode\\resources\\app.asar"', cwd=r"F:\zf-asar-tmp", shell=True, capture_output=True, text=True)
print("PACK rc", r.returncode, (r.stderr or "")[-200:])
d = io.open(r"C:\Program Files\ZCode\resources\app.asar", "rb").read()
print("NEW_FAB_IN_ASAR:", d.find(b64[:40].encode()) != -1)
