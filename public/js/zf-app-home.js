/* zf-app-home.js —— i家电设备台账（T0，2026-11-11）
   左侧设备列表（房间/类型标签），右侧详情+编辑表单。
   API：GET/POST /api/home/devices（server/routes/mixin_ihome.py）
   注意：本窗口仅做台账登记与查询，不含任何设备控制指令。 */
(function () {
  'use strict';
  if (window.ZFHome) return;

  var devices = [];
  var selId = null;
  var root = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function apiGet() {
    return fetch('/api/home/devices').then(function (r) { return r.json(); });
  }
  function apiPost(body) {
    return fetch('/api/home/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function renderList() {
    var box = root.querySelector('#ihomeList');
    var kw = (root.querySelector('#ihomeKw').value || '').toLowerCase();
    var rows = devices.filter(function (d) {
      var s = (d.name + ' ' + d.room + ' ' + d.type + ' ' + d.brand + ' ' + d.model).toLowerCase();
      return !kw || s.indexOf(kw) >= 0;
    });
    if (!rows.length) {
      box.innerHTML = '<div style="padding:24px;text-align:center;color:#777;font-size:13px;">还没有登记设备<br>点右上「+ 新增」开始建台账</div>';
      return;
    }
    box.innerHTML = rows.map(function (d) {
      var on = d.id === selId ? 'background:rgba(255,255,255,.12);' : '';
      return '<div class="ihome-row" data-id="' + esc(d.id) + '" style="' + on +
        'padding:9px 12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.06);">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">' +
        '<span style="color:#e8e8ee;font-size:13px;font-weight:600;">' + esc(d.name) + '</span>' +
        (d.room ? '<span style="font-size:11px;color:#9aa;background:rgba(255,255,255,.08);border-radius:8px;padding:1px 8px;">' + esc(d.room) + '</span>' : '') +
        '</div>' +
        '<div style="color:#888;font-size:11px;margin-top:2px;">' +
        esc(d.type || '未分类') + (d.brand ? ' · ' + esc(d.brand) : '') + (d.model ? ' ' + esc(d.model) : '') +
        (d.protocol ? ' [' + esc(d.protocol) + ']' : '') + (d.ctrl ? ' 🎛' : '') +
        '</div></div>';
    }).join('');
    box.querySelectorAll('.ihome-row').forEach(function (el) {
      el.onclick = function () { selId = el.dataset.id; renderList(); renderDetail(); };
    });
  }

  function findSel() {
    for (var i = 0; i < devices.length; i++) if (devices[i].id === selId) return devices[i];
    return null;
  }

  function renderDetail() {
    var box = root.querySelector('#ihomeDetail');
    var d = findSel();
    if (!d) {
      box.innerHTML = '<div style="padding:30px;color:#777;font-size:13px;text-align:center;">← 从左侧选择设备，或新增一台</div>';
      return;
    }
    box.innerHTML =
      '<div style="padding:16px 18px;display:flex;flex-direction:column;gap:10px;height:100%;box-sizing:border-box;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<b style="color:#e8e8ee;font-size:15px;">' + esc(d.name) + '</b>' +
      '<button id="ihomeDel" style="background:rgba(220,60,60,.25);border:1px solid rgba(220,60,60,.5);color:#fbb;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;">删除</button></div>' +
      '<label style="font-size:12px;color:#99a;">名称<input id="ihName" value="' + esc(d.name) + '" style="width:100%;margin-top:3px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:7px 9px;color:#e8e8ee;font-size:13px;box-sizing:border-box;"></label>' +
      '<div style="display:flex;gap:8px;">' +
      '<label style="flex:1;font-size:12px;color:#99a;">房间<input id="ihRoom" value="' + esc(d.room) + '" placeholder="客厅/卧室…" style="width:100%;margin-top:3px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:7px 9px;color:#e8e8ee;font-size:13px;box-sizing:border-box;"></label>' +
      '<label style="flex:1;font-size:12px;color:#99a;">类型<input id="ihType" value="' + esc(d.type) + '" placeholder="灯/空调/电视…" style="width:100%;margin-top:3px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:7px 9px;color:#e8e8ee;font-size:13px;box-sizing:border-box;"></label>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
      '<label style="flex:1;font-size:12px;color:#99a;">品牌<input id="ihBrand" value="' + esc(d.brand) + '" style="width:100%;margin-top:3px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:7px 9px;color:#e8e8ee;font-size:13px;box-sizing:border-box;"></label>' +
      '<label style="flex:1;font-size:12px;color:#99a;">型号<input id="ihModel" value="' + esc(d.model) + '" style="width:100%;margin-top:3px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:7px 9px;color:#e8e8ee;font-size:13px;box-sizing:border-box;"></label>' +
      '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:12px;color:#99a;">' +
      '<label style="flex:1;">协议<input id="ihProtocol" value="' + esc(d.protocol) + '" placeholder="WiFi/蓝牙/Zigbee/红外…" style="width:100%;margin-top:3px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:7px 9px;color:#e8e8ee;font-size:13px;box-sizing:border-box;"></label>' +
      '<label style="display:flex;align-items:center;gap:4px;white-space:nowrap;">在线<input type="checkbox" id="ihOnline"' + (d.online ? ' checked' : '') + '></label>' +
      '<label style="display:flex;align-items:center;gap:4px;white-space:nowrap;">可控<input type="checkbox" id="ihCtrl"' + (d.ctrl ? ' checked' : '') + '></label>' +
      '</div>' +
      '<label style="font-size:12px;color:#99a;">备注/联动设想<textarea id="ihNote" rows="4" style="width:100%;margin-top:3px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:7px 9px;color:#e8e8ee;font-size:13px;resize:vertical;box-sizing:border-box;">' + esc(d.note) + '</textarea></label>' +
      '<div style="margin-top:auto;display:flex;gap:8px;align-items:center;">' +
      '<span id="ihomeMsg" style="flex:1;font-size:12px;color:#8a8;"></span>' +
      '<button id="ihomeSave" style="background:rgba(80,160,255,.3);border:1px solid rgba(80,160,255,.6);color:#cde;border-radius:7px;padding:7px 18px;cursor:pointer;font-size:13px;">保存</button></div>' +
      '</div>';
    box.querySelector('#ihomeSave').onclick = function () { save(); };
    box.querySelector('#ihomeDel').onclick = function () {
      if (!confirm('确定删除「' + d.name + '」？')) return;
      apiPost({ id: d.id, deleted: true }).then(function (res) {
        if (res.ok) { selId = null; load(); }
      });
    };
  }

  function save() {
    var d = findSel();
    if (!d) return;
    var g = function (id) { return root.querySelector('#' + id).value.trim(); };
    var cb = function (id) { return root.querySelector('#' + id).checked ? 1 : 0; };
    var msg = root.querySelector('#ihomeMsg');
    apiPost({
      id: d.id, name: g('ihName'), room: g('ihRoom'), type: g('ihType'),
      brand: g('ihBrand'), model: g('ihModel'), note: g('ihNote'),
      protocol: g('ihProtocol'), online: cb('ihOnline'), ctrl: cb('ihCtrl')
    }).then(function (res) {
      if (res.ok) { msg.textContent = '✓ 已保存'; load(); setTimeout(function () { msg.textContent = ''; }, 2000); }
      else msg.textContent = '保存失败: ' + (res.err || '');
    });
  }

  function load() {
    return apiGet().then(function (res) {
      devices = (res && res.ok && res.devices) || [];
      if (selId && !findSel()) selId = null;
      renderList();
      renderDetail();
    });
  }

  function render(container) {
    root = container;
    container.innerHTML =
      '<div style="flex:1;display:flex;overflow:hidden;">' +
      '<div style="width:230px;flex:0 0 230px;border-right:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;">' +
      '<div style="padding:10px 12px;display:flex;gap:6px;align-items:center;border-bottom:1px solid rgba(255,255,255,.08);">' +
      '<input id="ihomeKw" placeholder="搜索设备…" style="flex:1;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:7px;padding:6px 9px;color:#e8e8ee;font-size:12px;outline:none;">' +
      '<button id="ihomeAdd" title="新增设备" style="flex:0 0 auto;background:rgba(80,160,255,.3);border:1px solid rgba(80,160,255,.6);color:#cde;border-radius:7px;padding:5px 10px;cursor:pointer;font-size:13px;">＋</button>' +
      '</div>' +
      '<div id="ihomeList" style="flex:1;overflow:auto;"></div>' +
      '<div id="ihomeCount" style="padding:6px 12px;font-size:11px;color:#778;border-top:1px solid rgba(255,255,255,.08);"></div>' +
      '</div>' +
      '<div id="ihomeDetail" style="flex:1;overflow:auto;"></div>' +
      '</div>';
    root.querySelector('#ihomeKw').oninput = renderList;
    root.querySelector('#ihomeAdd').onclick = function () {
      apiPost({ name: '新设备', room: '', type: '', brand: '', model: '', note: '' }).then(function (res) {
        if (res.ok) { selId = res.id; load(); }
      });
    };
    load();
  }

  window.ZFHome = {
    onOpen: function (container) { render(container); },
    onClose: function () { root = null; }
  };
})();
