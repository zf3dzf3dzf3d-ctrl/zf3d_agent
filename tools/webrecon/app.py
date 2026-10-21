"""Web 界面：python app.py 后访问 http://127.0.0.1:5015"""
import io
import json
import os
import sys
from datetime import datetime

from flask import Flask, jsonify, request as fq_request, send_file

sys.path.insert(0, os.path.dirname(__file__))
from recon import scan

app = Flask(__name__)

PAGE = """<!doctype html><html lang=zh><head><meta charset=utf-8>
<title>WebRecon · 网站体检</title>
<style>
body{font-family:system-ui,'Microsoft YaHei';background:#0f172a;color:#e2e8f0;margin:0;padding:40px}
.box{max-width:860px;margin:0 auto}
h1{font-size:22px}
input{width:70%;padding:12px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:15px}
button{padding:12px 22px;border-radius:8px;border:0;background:#3b82f6;color:#fff;font-size:15px;cursor:pointer}
button:disabled{background:#475569}
.card{background:#1e293b;border-radius:10px;padding:16px 20px;margin-top:14px;border:1px solid #334155}
.card h3{margin:0 0 8px;font-size:15px;color:#93c5fd}
.tag{display:inline-block;background:#334155;border-radius:6px;padding:3px 10px;margin:3px;font-size:13px}
.warn{color:#fbbf24}.ok{color:#4ade80}
table{width:100%;border-collapse:collapse;font-size:14px}
td{padding:4px 8px;border-bottom:1px solid #334155}
.small{color:#64748b;font-size:12px}
</style></head><body><div class=box>
<h1>🔍 WebRecon — 网址一键体检</h1>
<p class=small>仅限对自有或已授权目标使用 · 探测约 5~15 秒</p>
<div><input id=url placeholder="https://your-site.com" onkeydown="if(event.key=='Enter')go()">
<button id=btn onclick=go()>开始探测</button></div>
<div id=res></div>
<script>
function card(t,html){return `<div class=card><h3>${t}</h3>${html}</div>`}
async function go(){
 const u=document.getElementById('url').value.trim();if(!u)return;
 const b=document.getElementById('btn');b.disabled=true;b.textContent='探测中…';
 document.getElementById('res').innerHTML='<div class=card>⏳ 正在探测 '+u+' …</div>';
 try{
  const r=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:u})});
  const d=await r.json();
  if(d.error){document.getElementById('res').innerHTML=card('❌ 错误','<span class=warn>'+d.error+'</span>');}
  else{
   const b2=d.basic;
   let h=card('📡 基础信息',`<table>
     <tr><td>状态码</td><td class=${b2.status_code==200?'ok':'warn'}>${b2.status_code??'-'}</td></tr>
     <tr><td>IP</td><td>${b2.ip??'-'}</td></tr>
     <tr><td>Server</td><td>${b2.server??'-'}</td></tr>
     <tr><td>标题</td><td>${b2.title??'-'}</td></tr>
     <tr><td>最终地址</td><td>${b2.final_url}</td></tr>
     <tr><td>重定向链</td><td>${(b2.redirect_chain||[]).map(x=>x.status).join(' → ')||'无'}</td></tr></table>`);
   h+=card('🧩 技术栈指纹', d.fingerprints.length?d.fingerprints.map(f=>`<span class=tag>${f}</span>`).join(''):'<span class=small>未识别</span>');
   const t=d.tls;
   h+=card('🔒 TLS 证书', t.https?`<span class=${t.warning?'warn':'ok'}>${t.warning?'⚠ '+t.warning:'✓ 有效'}</span><br>颁发者: ${t.issuer??'-'}<br>到期: ${t.not_after??'-'}`:'<span class=warn>'+ (t.note||t.error||'未启用 HTTPS') +'</span>');
   h+=card('📁 敏感路径', d.sensitive_paths.length?`<table>${d.sensitive_paths.map(f=>`<tr><td class=warn>200</td><td>/${f.path}</td><td>${f.size} bytes</td></tr>`).join('')}</table>`:'<span class=ok>未发现常见敏感文件可访问</span>');
   h+=card('🌐 DNS', `A 记录: ${d.dns.A??'-'}${(d.dns.NS||[]).length?'<br>NS: '+d.dns.NS.slice(0,3).join('; '):''}`);
   h+=`<p class=small>耗时 ${d.duration_sec}s · ${d.scanned_at} · <a style="color:#60a5fa" href="/report/${encodeURIComponent(d.target)}" target=_blank>导出 HTML 报告</a></p>`;
   document.getElementById('res').innerHTML=h;
  }
 }catch(e){document.getElementById('res').innerHTML=card('❌ 错误',e)}
 b.disabled=false;b.textContent='开始探测';
}
</script></div></body></html>"""


@app.get("/")
def index():
    return PAGE  # PAGE 是静态 HTML，不能走 Jinja 模板渲染（JS 花括号会被解析坏）


@app.post("/api/scan")
def api_scan():
    url = (fq_request.get_json(silent=True) or {}).get("url", "")
    if not url:
        return jsonify({"error": "请输入网址"})
    try:
        return jsonify(scan(url))
    except ValueError as e:
        return jsonify({"error": str(e)})
    except Exception as e:
        return jsonify({"error": f"探测失败: {e}"})


@app.get("/report/<path:target>")
def report(target):
    try:
        r = scan(target)
    except ValueError as e:
        return f"<h3>拒绝: {e}</h3>"
    rows = "".join(f"<tr><td>{k}</td><td>{v}</td></tr>"
                   for k, v in r["basic"].items() if k != "headers")
    paths = "".join(f"<tr><td>/{f['path']}</td><td>{f['status']}</td><td>{f['size']}</td></tr>"
                    for f in r["sensitive_paths"]) or "<tr><td colspan=3>无</td></tr>"
    html = f"""<!doctype html><meta charset=utf-8><title>WebRecon 报告 - {target}</title>
<body style="font-family:system-ui;max-width:800px;margin:30px auto">
<h2>网站体检报告 · {target}</h2>
<p>时间: {r['scanned_at']} | 耗时: {r['duration_sec']}s | {r['disclaimer']}</p>
<h3>基础信息</h3><table border=1 cellpadding=6>{rows}</table>
<h3>技术栈</h3><p>{', '.join(r['fingerprints']) or '未识别'}</p>
<h3>TLS</h3><p>{r['tls']}</p>
<h3>敏感路径</h3><table border=1 cellpadding=6>{paths}</table>
<h3>DNS</h3><p>A: {r['dns'].get('A')}</p></body>"""
    buf = io.BytesIO(html.encode("utf-8"))
    buf.seek(0)
    return send_file(buf, as_attachment=False, download_name="webrecon_report.html", mimetype="text/html")


if __name__ == "__main__":
    print("打开 http://127.0.0.1:5015 即可使用")
    app.run(host="127.0.0.1", port=5015, debug=False)
