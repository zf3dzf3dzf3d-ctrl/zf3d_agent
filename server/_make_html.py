# -*- coding: utf-8 -*-
import os
base = os.path.dirname(os.path.abspath(__file__))
p = os.path.join(base, 'private', 'ai实验', '定时开关.html')
html = '''<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<title>定时开关</title>
<style>
  body{font-family:微软雅黑;background:#1e1e2e;color:#eee;display:flex;justify-content:center;padding-top:60px}
  .box{background:#2a2a3d;padding:30px 40px;border-radius:16px;text-align:center;min-width:320px}
  h1{font-size:20px}
  #state{font-size:40px;font-weight:bold;margin:20px 0}
  .on{color:#4caf50}.off{color:#f44336}
  input{width:80px;padding:8px;font-size:16px;border-radius:8px;border:none;text-align:center}
  button{padding:10px 20px;margin:8px;font-size:15px;border:none;border-radius:8px;cursor:pointer;background:#4a6cf7;color:#fff}
  button:hover{background:#3a5ce0}
</style>
</head>
<body>
<div class="box">
  <h1>定时开关（演示版）</h1>
  <div id="state" class="off">OFF</div>
  <p>运行秒数：<input id="sec" type="number" value="5" min="1"></p>
  <button onclick="openSw()">打开并定时关闭</button>
  <button onclick="closeSw()">立即关闭</button>
  <p id="tip" style="color:#aaa;font-size:13px"></p>
</div>
<script>
let timer = null, left = 0;
function setState(on){
  const s = document.getElementById('state');
  s.textContent = on ? 'ON' : 'OFF';
  s.className = on ? 'on' : 'off';
}
function openSw(){
  left = parseInt(document.getElementById('sec').value) || 5;
  setState(true);
  clearInterval(timer);
  timer = setInterval(function(){
    left--;
    document.getElementById('tip').textContent = '剩余 ' + left + ' 秒';
    if(left <= 0) closeSw();
  }, 1000);
  document.getElementById('tip').textContent = '剩余 ' + left + ' 秒';
}
function closeSw(){
  clearInterval(timer);
  setState(false);
  document.getElementById('tip').textContent = '已关闭';
}
</script>
</body>
</html>
'''
os.makedirs(os.path.dirname(p), exist_ok=True)
with open(p, 'w', encoding='utf-8') as f:
    f.write(html)
print('written:', p, os.path.getsize(p), 'bytes')
