// 管家团（Butler Team）v2 —— 底栏按钮，插在小狗守卫（dogGuardBtn）右侧
// 单按钮「管家团」：点击弹出角色面板（健康师/工作日志师/游戏导师/长期导师/理财投资专家…来自 team.json），
// 选角色后打开普通对话框（App.openRoleChat），并自动注入该角色档案+近7天摘要。
(function () {
  'use strict';
  if (window.ButlerPanel) return;

  function fetchTeam(cb) {
    fetch('/api/butler/team')
      .then(function (r) { return r.json(); })
      .then(function (res) { cb((res && res.team) || []); })
      .catch(function () { cb([]); });
  }

  function findRole(name, cb) {
    fetch('/api/roles')
      .then(function (r) { return r.json(); })
      .then(function (res) {
        var all = (res && (res.roles || res.data)) || [];
        var exact = all.find(function (r) { return (r.name || '').trim() === name; });
        var loose = all.find(function (r) { return (r.name || '').indexOf(name) > -1; });
        cb(exact || loose || null);
      })
      .catch(function () { cb(null); });
  }

  function fetchSummary(role, cb) {
    fetch('/api/butler/state?role=' + encodeURIComponent(role))
      .then(function (r) { return r.json(); })
      .then(function (res) { cb((res && res.summary) || ''); })
      .catch(function () { cb(''); });
  }

  // ---------- 角色选择面板 ----------
  var st = { panel: null, injecting: false, onDoc: null };

  function closePanel() {
    if (st.onDoc) { document.removeEventListener('click', st.onDoc); st.onDoc = null; }
    if (st.panel) { st.panel.remove(); st.panel = null; }
  }

  function openPanel(anchorBtn) {
    if (st.panel) { closePanel(); return; }
    fetchTeam(function (team) {
      closePanel();
      var p = document.createElement('div');
      p.id = 'butlerTeamPanel';
      p.style.cssText = 'position:fixed;z-index:99999;background:rgba(20,24,32,.96);border:1px solid rgba(255,255,255,.12);' +
        'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.45);padding:10px;min-width:200px;color:#cfd8e3;';
      var title = document.createElement('div');
      title.textContent = '管家团 · 选择角色';
      title.style.cssText = 'font-size:12px;opacity:.6;margin-bottom:8px;';
      p.appendChild(title);
      if (!team.length) {
        var tip = document.createElement('div');
        tip.textContent = '（角色列表加载失败，稍后再试）';
        tip.style.cssText = 'font-size:12px;opacity:.5;';
        p.appendChild(tip);
      }
      team.forEach(function (m) {
        var b = document.createElement('button');
        b.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;' +
          'margin:2px 0;border:none;border-radius:8px;background:transparent;cursor:pointer;font-size:13px;color:#cfd8e3;transition:background .15s;';
        b.onmouseenter = function () { b.style.background = 'rgba(52,152,219,.35)'; b.style.color = '#fff'; };
        b.onmouseleave = function () { b.style.background = 'transparent'; b.style.color = '#cfd8e3'; };
        var av = document.createElement('span');
        av.textContent = m.avatar || '👤';
        av.style.fontSize = '18px';
        var nm = document.createElement('span');
        nm.textContent = m.name || m;
        b.appendChild(av); b.appendChild(nm);
        var roleName = m.name || m;
        b.onclick = function () { closePanel(); openRoleChat(roleName); };
        p.appendChild(b);
      });
      document.body.appendChild(p);
      st.panel = p;
      // 定位在按钮上方
      if (anchorBtn) {
        var r = anchorBtn.getBoundingClientRect();
        p.style.visibility = 'hidden';
        setTimeout(function () {
          var pw = p.offsetWidth, ph = p.offsetHeight;
          var left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
          var top = r.top - ph - 8;
          if (top < 8) top = r.bottom + 8;
          p.style.left = left + 'px';
          p.style.top = top + 'px';
          p.style.visibility = 'visible';
        }, 0);
      }
      // 点外部关闭（监听器由 closePanel 统一移除，避免残留累积）
      setTimeout(function () {
        st.onDoc = function (e) {
          if (st.panel && !st.panel.contains(e.target) && e.target !== anchorBtn) closePanel();
        };
        document.addEventListener('click', st.onDoc);
      }, 0);
    });
  }

  // ---------- 打开角色对话并注入档案摘要 ----------
  function openRoleChat(roleName) {
    if (st.injecting) return;
    st.injecting = true;
    findRole(roleName, function (role) {
      fetchSummary(roleName, function (summary) {
        try {
          if (role && window.App && App.openRoleChat) {
            App.openRoleChat(role, {});
            if (summary) {
              setTimeout(function () {
                var box = document.querySelector('.chat-box.active .chat-input, .chat-input');
                if (box) {
                  box.value = summary;
                  box.dispatchEvent(new Event('input', { bubbles: true }));
                }
              }, 300);
            }
          } else if (window.ZFChatFallback && ZFChatFallback.open) {
            ZFChatFallback.open(roleName, summary);
          }
        } finally {
          setTimeout(function () { st.injecting = false; }, 800);
        }
      });
    });
  }

  function injectBtn(retry) {
    var btn = document.getElementById('butlerDockBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'butlerDockBtn';
      // 锚点：小狗守卫按钮（管家团插在小狗右侧）
      var anchor = document.getElementById('dogGuardBtn');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
      else {
        if (!retry) setTimeout(function () { injectBtn(true); }, 300);
        else document.body.appendChild(btn);
      }
    }
    btn.className = 'dog-guard-btn zf-dock-btn';
    btn.title = '管家团：健康师/工作日志师/游戏导师/长期导师/理财专家，长期记忆随聊随记';
    btn.innerHTML = '<span class="tk-label">管家团</span><span class="tk-dot"></span>';
    btn.onclick = function (e) { e.stopPropagation(); openPanel(btn); };
  }

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { injectBtn(false); });
    } else {
      injectBtn(false);
    }
  }
  init();

  window.ButlerPanel = { open: openPanel, openRoleChat: openRoleChat, injectBtn: injectBtn };
})();
