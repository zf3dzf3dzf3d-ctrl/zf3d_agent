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
      /* 线性自绘 SVG 图标（stroke 风格 + currentColor）：🛠团队成员 💗伴侣 🧒孩子 🏡父母；其余 emoji 保持原样 */
      if (!window.ZF_REL_ICONS) {
        window.ZF_REL_ICONS = {
          '\ud83d\udee0': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M13 5l6 6-2 2-6-6 2-2z"/><path d="M11 7L4 14a2 2 0 0 0 0 3l3 3a2 2 0 0 0 3 0l7-7"/><path d="M9 13l2 2"/></svg>',
          '\ud83d\udc97': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M12 20.3l-6.7-6.6a4.4 4.4 0 0 1 6.2-6.2l.5.5.5-.5a4.4 4.4 0 0 1 6.2 6.2z"/></svg>',
          '\ud83d\udc92': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><circle cx="12" cy="12" r="8.5"/><path d="M9 5.5c.5-1.5 1.5-2 3-2s2.5.5 3 2"/><circle cx="9.2" cy="11" r=".4" fill="currentColor"/><circle cx="14.8" cy="11" r=".4" fill="currentColor"/><path d="M9.5 14.5a3.5 3.5 0 0 0 5 0"/></svg>',
          '\ud83c\udfe1': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/></svg>'
        };
      }
      var _icon = window.ZF_REL_ICONS[String(m.avatar || '').trim()];
      if (_icon) {
        av.innerHTML = _icon;
        av.style.cssText = 'display:inline-flex;width:18px;height:18px;align-items:center;justify-content:center;';
      } else {
        av.textContent = m.avatar || '\ud83d\udc64';
        av.style.fontSize = '18px';
      }
      var nm = document.createElement('span');
      nm.textContent = m.name || m;
      b.appendChild(av); b.appendChild(nm);
      var roleName = m.name || m;
      b.onclick = function () { closePanel(); openRoleChat(roleName); };
      p.appendChild(b);
    });
    appendTimersSection(p, function () { positionPanel(p, anchorBtn || st.lastAnchor); });
    positionPanel(p, anchorBtn || st.lastAnchor);
  }

  // ---------- 员工定时任务管理区（P4）：列表/启停/删/新增 ----------
  function fmtSched(sch) {
    if (!sch) return '';
    if (sch.type === 'daily') return '每日 ' + (sch.time || '');
    if (sch.type === 'interval') return '每 ' + (sch.seconds || 0) + ' 秒';
    return '';
  }
  function fetchTimers(cb) {
    fetch('/api/employee/timers').then(function (r) { return r.json(); })
      .then(function (res) { cb((res && res.timers) || []); })
      .catch(function () { cb([]); });
  }
  function timerOp(op, payload, cb) {
    fetch('/api/employee/timers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ op: op }, payload || {}))
    }).then(function (r) { return r.json(); }).then(function () { if (cb) cb(); }).catch(function () { if (cb) cb(); });
  }
  function appendTimersSection(p, done) {
    var sec = document.createElement('div');
    sec.className = 'bt-timers';
    sec.style.cssText = 'border-top:1px solid rgba(255,255,255,.12);margin-top:8px;padding-top:6px;min-width:260px;';
    var head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:12px;opacity:.6;margin-bottom:4px;';
    head.innerHTML = '<span>⏰ 员工定时任务</span>';
    var addBtn = document.createElement('button');
    addBtn.textContent = '+ 新建';
    addBtn.style.cssText = 'font-size:11px;padding:1px 8px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#cfd8e3;cursor:pointer;';
    head.appendChild(addBtn);
    sec.appendChild(head);
    var list = document.createElement('div');
    sec.appendChild(list);
    addBtn.onclick = function () {
      var name = prompt('员工名（需与团队成员名一致）：');
      if (!name) return;
      var promptTxt = prompt('到点要干的活（指令内容）：');
      if (!promptTxt) return;
      var schType = prompt('触发方式：输入 daily 或 interval', 'daily');
      if (schType !== 'daily' && schType !== 'interval') return;
      var sch;
      if (schType === 'daily') {
        var tm = prompt('每日几点触发（HH:MM）', '09:00');
        if (!tm) return;
        sch = { type: 'daily', time: tm };
      } else {
        var secN = parseInt(prompt('间隔秒数（最小 60）', '3600'), 10);
        if (!secN || secN < 60) return;
        sch = { type: 'interval', seconds: secN };
      }
      timerOp('add', { name: name, task_prompt: promptTxt, schedule: sch, box_id: '' }, function () { refresh(); });
    };
    function refresh() {
      fetchTimers(function (timers) {
        list.innerHTML = '';
        if (!timers.length) {
          var none = document.createElement('div');
          none.textContent = '（暂无定时任务）';
          none.style.cssText = 'font-size:11px;opacity:.45;padding:2px 0;';
          list.appendChild(none);
        }
        timers.forEach(function (t) {
          var row = document.createElement('div');
          row.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:12px;color:#cfd8e3;padding:2px 0;';
          var info = document.createElement('span');
          var lr = t.last_run ? new Date(t.last_run).toLocaleString() : '未运行';
          var st = t.last_status === 'ok' ? '✅' : (t.last_status ? '❌' : '');
          info.textContent = (t.enabled ? '🟢' : '⚪') + ' ' + t.name + ' · ' + fmtSched(t.schedule) + ' · ' + st + lr;
          info.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          var tg = document.createElement('button');
          tg.textContent = t.enabled ? '停' : '启';
          tg.style.cssText = btnCss();
          tg.onclick = function () { timerOp(t.enabled ? 'disable' : 'enable', { id: t.id }, refresh); };
          var del = document.createElement('button');
          del.textContent = '删';
          del.style.cssText = btnCss();
          del.onclick = function () { if (confirm('删除定时任务「' + t.name + '」？')) timerOp('remove', { id: t.id }, refresh); };
          row.appendChild(info); row.appendChild(tg); row.appendChild(del);
          list.appendChild(row);
        });
        if (done) done();
      });
    }
    function btnCss() {
      return 'font-size:11px;padding:1px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#cfd8e3;cursor:pointer;';
    }
    p.appendChild(sec);
    refresh();
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
