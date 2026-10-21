// 管家团（Butler Team）v2 —— 底栏按钮，插在底部状态栏（.statusbar）末尾
// 单按钮「管家团」：点击弹出角色面板（健康师/工作日志师/游戏导师/长期导师/理财投资专家…来自 team.json），
// 选角色后打开普通对话框（App.openRoleChat），并自动注入该角色档案+近7天摘要。
(function () {
  'use strict';
  if (window.ButlerPanel) return;

  // team 缓存：首次成功后 5 分钟内点击秒开
  var _teamCache = { data: null, ts: 0 };

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

  // team 缓存：首次成功后 5 分钟内点击秒开，不再被慢接口卡住
  var _teamCache = { data: null, ts: 0 };

  function openPanel(anchorBtn) {
    if (st.panel) { closePanel(); return; }
    // 【2026-10-11 修复下拉慢】先立即建面板（加载态），数据回来再填充——点击秒开。
    // 旧版是等 /api/butler/team 返回才建面板，后端一卡面板就半天不出。
    // 并加 5 分钟缓存：首次成功后点击直接秒开，不再每次都等接口。
    var p = document.createElement('div');
    p.id = 'butlerTeamPanel';
    p.style.cssText = 'position:fixed;z-index:99999;background:rgba(20,24,32,.96);border:1px solid rgba(255,255,255,.12);' +
      'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.45);padding:10px;min-width:200px;color:#cfd8e3;';
    var title = document.createElement('div');
    title.textContent = '管家团 · 选择角色';
    title.style.cssText = 'font-size:12px;opacity:.6;margin-bottom:8px;';
    p.appendChild(title);
    document.body.appendChild(p);
    st.panel = p;
    st.lastAnchor = anchorBtn;
    positionPanel(p, anchorBtn);
    bindOutsideClose(anchorBtn);
    var cached = _teamCache.data && (Date.now() - _teamCache.ts < 5 * 60 * 1000);
    if (cached) { fillPanel(p, _teamCache.data, anchorBtn); return; }
    var loading = document.createElement('div');
    loading.textContent = '加载中…';
    loading.className = 'bt-loading';
    loading.style.cssText = 'font-size:12px;opacity:.5;padding:4px 2px;';
    p.appendChild(loading);
    fetchTeam(function (team) {
      if (!st.panel || st.panel !== p) return; // 面板已关/重开
      if (team && team.length) { _teamCache.data = team; _teamCache.ts = Date.now(); }
      fillPanel(p, team, anchorBtn);
    });
  }

  function fillPanel(p, team, anchorBtn) {
    var old = p.querySelector('.bt-loading'); if (old) old.remove();
    if (p.querySelector('.bt-item')) return;  // 防重复填充
    if (!team || !team.length) {
      var tip = document.createElement('div');
      tip.textContent = '\uff08角色列表加载失败，稍后再试\uff09';
      tip.style.cssText = 'font-size:12px;opacity:.5;';
      p.appendChild(tip);
    }
    team.forEach(function (m) {
      var b = document.createElement('button');
      b.className = 'bt-item';
      b.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:8px 10px;' +
        'margin:2px 0;border:none;border-radius:8px;background:transparent;cursor:pointer;font-size:13px;color:#cfd8e3;transition:background .15s;';
      b.onmouseenter = function () { b.style.background = 'rgba(52,152,219,.35)'; b.style.color = '#fff'; };
      b.onmouseleave = function () { b.style.background = 'transparent'; b.style.color = '#cfd8e3'; };
      var av = document.createElement('span');
      av.textContent = m.avatar || '\ud83d\udc64';
      av.style.fontSize = '18px';
      var nm = document.createElement('span');
      nm.textContent = m.name || m;
      b.appendChild(av); b.appendChild(nm);
      var roleName = m.name || m;
      b.onclick = function () { closePanel(); openRoleChat(roleName); };
      p.appendChild(b);
    });
    positionPanel(p, anchorBtn || st.lastAnchor);
  }

  function positionPanel(p, anchorBtn) {
    if (!anchorBtn) return;
    var r = anchorBtn.getBoundingClientRect();
    var pw = p.offsetWidth, ph = p.offsetHeight;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - pw - 8));
    var top = r.top - ph - 8;
    if (top < 8) top = r.bottom + 8;
    p.style.left = left + 'px';
    p.style.top = top + 'px';
  }

  function bindOutsideClose(anchorBtn) {
    setTimeout(function () {
      st.onDoc = function (e) {
        if (st.panel && !st.panel.contains(e.target) && e.target !== anchorBtn) closePanel();
      };
      document.addEventListener('click', st.onDoc);
    }, 0);
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
    }
    var group = document.querySelector('.statusbar');
    var turbo = group && group.querySelector('#turboDockBtn');
    var ver = group && group.querySelector('.statusbar-right');
    if (group) {
      // 【修复】插入到「急速」按钮之后（statusbar-right 版本号之前）。
      // 注意：即使按钮已存在（此前可能被兜底 append 到 body/右下角 fab 组），
      // 也要校验父容器并搬回 statusbar，否则永远留在错误位置。
      var wrongParent = btn.parentElement !== group;
      if (wrongParent) {
        if (turbo && turbo.parentNode === group) group.insertBefore(btn, turbo.nextSibling);
        else if (ver && ver.parentNode === group) group.insertBefore(btn, ver);
        else group.appendChild(btn);
      }
    }
    else {
      if (!retry) setTimeout(function () { injectBtn(true); }, 300);
      else document.body.appendChild(btn);
    }
    btn.className = 'zf-dock-btn';
    btn.title = '管家团：健康师/工作日志师/游戏导师/长期导师/理财专家，长期记忆随聊随记';
    btn.innerHTML = '<span class="tk-label">🤵</span><span class="tk-dot"></span>';
    // 2026-10 改版：管家团入口从左下角状态栏移出，收进右上角「更多」下拉菜单。
    //   按钮仍保留（供其它代码定位/复用），但隐藏不再显示在状态栏。
    btn.style.display = 'none';
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
