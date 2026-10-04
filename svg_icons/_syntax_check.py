import subprocess, sys
p = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
code = open(p, encoding='utf-8').read()
js = 'try{new Function(require("fs").readFileSync(0,"utf8"));process.stdout.write("PARSE_OK")}catch(e){process.stdout.write("PARSE_FAIL:"+String(e.message).slice(0,200))}'
r = subprocess.run(['node', '-e', js], input=code.encode('utf-8'), capture_output=True)
out = r.stdout.decode('utf-8', 'replace')
open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\svg_icons\_syntax_check.txt', 'w', encoding='utf-8').write('RESULT: ' + out)
