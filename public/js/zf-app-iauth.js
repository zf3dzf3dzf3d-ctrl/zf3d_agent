/* ============================================================
 * zf-app-iauth.js v1 —— i授权 Dock 内容模块（P3 前端面板）
 * 挂载点：#zfIauthBody（由 zf-app-dock.js openIauth 懒挂载）
 * 契约：window.ZFIauth = { onOpen(body), onClose() }
 * 功能：站点列表（/api/iauth/sites）+ 问答框（/api/iauth/ask）
 *       + 无 grant 时写操作 403 提示（P2 预留展示）
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFIauth) return;

  var body, ui = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function injectCss() {
    if (document.getElementById('zfiStyle')) return;
    var st = document.createElement('style');
    st.id = 'zfiStyle';
    st.textContent =
      '.zfi-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden;background:#141519;color:#d8d8e0;font-size:13px}' +
      '.zfi-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);flex:0 0 auto}' +
      '.zfi-logo{display:flex;align-items:center;gap:6px;font-weight:600;color:#fff;font-size:14px}' +
      '.zfi-sites{display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px}' +
      '.zfi-site{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);cursor:pointer}' +
      '.zfi-site.on{background:rgba(80,150,255,.25);border-color:rgba(80,150,255,.6)}' +
      '.zfi-site.dis{opacity:.45;cursor:not-allowed}' +
      '.zfi-dot{width:7px;height:7px;border-radius:50%;background:#7ee787}' +
      '.zfi-dot.off{background:#e5534b}' +
      '.zfi-q{display:flex;gap:8px;padding:10px 14px;flex:0 0 auto}' +
      '.zfi-q input{flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#e8e8f0;padding:8px 12px;font-size:13px;outline:none}' +
      '.zfi-q input:focus{border-color:rgba(80,150,255,.7)}' +
      '.zfi-q button{background:#316dca;border:none;color:#fff;border-radius:8px;padding:8px 16px;cursor:pointer;font-size:13px}' +
      '.zfi-q button:disabled{opacity:.5;cursor:wait}' +
      '.zfi-a{flex:1;overflow:auto;padding:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word}' +
      '.zfi-tip{padding:14px;color:#8a8a98;font-size:12px}' +
      '.zfi-err{color:#ff8a80;font-size:12px;padding:6px 14px}';
    document.head.appendChild(st);
  }

  function loadSites() {
    fetch('/api/iauth/sites').then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { ui.sites.innerHTML = '<div class="zfi-tip">站点配置加载失败</div>'; return; }
      ui.sites.innerHTML = d.sites.map(function (s) {
        var on = s.enabled !== false;
        return '<div class="zfi-site' + (s.id === cur ? ' on' : '') + (on ? '' : ' dis') + '" data-id="' + esc(s.id) + '" title="' + esc(s.name) + (on ? '' : '（未启用）') + '">' +
          '<span class="zfi-dot' + (on ? '' : ' off') + '"></span>' + esc(s.name) + '</div>';
      }).join('');
      ui.sites.querySelectorAll('.zfi-site').forEach(function (el) {
        el.addEventListener('click', function () {
          if (el.classList.contains('dis')) return;
          cur = el.dataset.id;
          ui.sites.querySelectorAll('.zfi-site').forEach(function (x) { x.classList.toggle('on', x === el); });
        });
      });
    }).catch(function () { ui.sites.innerHTML = '<div class="zfi-tip">接口不可达（服务未重启或路由未注册）</div>'; });
  }

  var cur = 'lingguang';

  function ask() {
    var q = (ui.input.value || '').trim();
    if (!q || ui.btn.disabled) return;
    ui.btn.disabled = true;
    ui.err.textContent = '';
    ui.ans.textContent = '⏳ 已发送到「' + cur + '」，等待回答（最长约 2 分钟）…';
    fetch('/api/iauth/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site: cur, question: q })
    }).then(function (r) { return r.json(); }).then(function (d) {
      ui.btn.disabled = false;
      if (d.ok) {
        ui.ans.textContent = d.answer || '（空回答）';
      } else {
        ui.ans.textContent = '';
        ui.err.textContent = '❌ ' + (d.err || 'unknown') + '（' + (d.hint || '') + '）耗时 ' + (d.elapsedSec || '?') + 's';
      }
    }).catch(function (e) {
      ui.btn.disabled = false;
      ui.err.textContent = '❌ 请求失败：' + e;
    });
  }

  window.ZFIauth = {
    onOpen: function (container) {
      body = container;
      injectCss();
      body.innerHTML =
        '<div class="zfi-wrap">' +
        '<div class="zfi-bar"><span class="zfi-logo">🔐 i授权</span><span style="color:#8a8a98;font-size:12px">授权后由 AI 代你在你自己的登录会话里提问（通用中性技术，用户自担合规责任）</span></div>' +
        '<div class="zfi-sites" id="zfiSites"></div>' +
        '<div class="zfi-q"><input id="zfiInput" placeholder="向选中的在线 AI 提问…" /><button id="zfiBtn">发送</button></div>' +
        '<div class="zfi-err" id="zfiErr"></div>' +
        '<div class="zfi-a" id="zfiAns"><div class="zfi-tip">选择站点 → 输入问题 → 发送。回答由网页版 AI 生成，与官方 API 结果一致。</div></div>' +
        '</div>';
      ui.sites = body.querySelector('#zfiSites');
      ui.input = body.querySelector('#zfiInput');
      ui.btn = body.querySelector('#zfiBtn');
      ui.ans = body.querySelector('#zfiAns');
      ui.err = body.querySelector('#zfiErr');
      ui.btn.addEventListener('click', ask);
      ui.input.addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(); });
      loadSites();
    },
    onClose: function () { }
  };
})();
