/* zf-app-notes.js —— i记事本（M-N1）
 * 挂载于 dock 的 #zfNotesBody；左侧历史列表 + 右侧编辑区；数据存 server/data/notes.json
 */
(function () {
  'use strict';
  var body = null, notes = [], curId = null, saveTimer = null, dirty = false;

  var ICO_NEW = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  var ICO_DEL = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>';

  function cssInit() {
    if (document.getElementById('zfNotesCss')) return;
    var st = document.createElement('style');
    st.id = 'zfNotesCss';
    st.textContent = [
      '#zfNotesBody{display:flex;overflow:hidden;font-family:inherit}',
      '.zfn-side{width:200px;flex:0 0 auto;border-right:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;background:rgba(255,255,255,.02)}',
      '.zfn-side-head{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;flex:0 0 auto}',
      '.zfn-side-head b{font-size:12px;color:#9a9aa8;font-weight:600}',
      '.zfn-new{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#e8e8ee;border-radius:6px;padding:4px 8px;cursor:pointer;display:flex;align-items:center;gap:4px;font-size:12px}',
      '.zfn-new:hover{background:rgba(255,255,255,.12)}',
      '.zfn-list{flex:1;overflow:auto;padding:4px}',
      '.zfn-item{padding:7px 9px;border-radius:6px;cursor:pointer;position:relative;margin-bottom:2px;transition:background .15s}',
      '.zfn-item:hover{background:rgba(255,255,255,.05)}',
      '.zfn-item.on{background:rgba(90,140,255,.18)}',
      '.zfn-item-t{font-size:12.5px;color:#e2e2ea;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-right:20px}',
      '.zfn-item-d{font-size:10.5px;color:#77777f;margin-top:2px}',
      '.zfn-del{position:absolute;right:6px;top:50%;transform:translateY(-50%);opacity:0;background:none;border:none;color:#999;cursor:pointer;padding:3px;border-radius:4px}',
      '.zfn-item:hover .zfn-del{opacity:1}.zfn-del:hover{color:#ff6a6a;background:rgba(255,255,255,.08)}',
      '.zfn-main{flex:1;display:flex;flex-direction:column;min-width:0}',
      '.zfn-title{background:transparent;border:none;outline:none;color:#e8e8ee;font-size:15px;font-weight:600;padding:10px 14px 6px;border-bottom:1px solid rgba(255,255,255,.06)}',
      '.zfn-editor{flex:1;background:transparent;border:none;outline:none;resize:none;color:#c9c9d4;font-size:13px;line-height:1.7;padding:12px 14px;font-family:inherit}',
      '.zfn-status{flex:0 0 auto;padding:4px 14px;font-size:10.5px;color:#6d6d78;border-top:1px solid rgba(255,255,255,.05)}',
      '.zfn-title:disabled,.zfn-editor:disabled{opacity:.45;cursor:not-allowed}',
      '.zfn-list::-webkit-scrollbar{width:6px}.zfn-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}'
    ].join('');
    document.head.appendChild(st);
  }

  function fmt(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (d.getFullYear()) + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderList() {
    var list = body.querySelector('.zfn-list');
    list.innerHTML = '';
    notes.forEach(function (n) {
      var it = document.createElement('div');
      it.className = 'zfn-item' + (n.id === curId ? ' on' : '');
      it.dataset.id = n.id;
      it.innerHTML = '<div class="zfn-item-t"></div><div class="zfn-item-d">' + fmt(n.updatedAt) + '</div>' +
        '<button class="zfn-del" title="删除">' + ICO_DEL + '</button>';
      it.querySelector('.zfn-item-t').textContent = n.title || '未命名';
      it.addEventListener('click', function (e) {
        if (e.target.closest('.zfn-del')) return;
        selectNote(n.id);
      });
      it.querySelector('.zfn-del').addEventListener('click', function () {
        if (!confirm('删除「' + (n.title || '未命名') + '」？')) return;
        apiSave({ id: n.id, deleted: true }).then(function () {
          notes = notes.filter(function (x) { return x.id !== n.id; });
          if (curId === n.id) curId = notes.length ? notes[0].id : null;
          renderAll();
        });
      });
      list.appendChild(it);
    });
    if (!notes.length) {
      var empty = document.createElement('div');
      empty.style.cssText = 'padding:14px;font-size:11.5px;color:#666;text-align:center';
      empty.textContent = '还没有笔记，点右上角 + 新建';
      list.appendChild(empty);
    }
  }

  function renderEditor() {
    var cur = null;
    for (var i = 0; i < notes.length; i++) if (notes[i].id === curId) cur = notes[i];
    var has = !!cur;
    body.querySelector('.zfn-title').value = has ? cur.title : '';
    body.querySelector('.zfn-editor').value = has ? cur.content : '';
    body.querySelector('.zfn-title').disabled = !has;
    body.querySelector('.zfn-editor').disabled = !has;
    body.querySelector('.zfn-editor').placeholder = has ? '记录实践、心得……（自动保存）' : '先在左侧新建或选择一条笔记';
    body.querySelector('.zfn-status').textContent = has ? ('上次保存：' + fmt(cur.updatedAt)) : '';
    dirty = false;
  }

  function renderAll() { renderList(); renderEditor(); }

  function selectNote(id) {
    flushSave();
    curId = id;
    renderAll();
  }

  function curNote() {
    for (var i = 0; i < notes.length; i++) if (notes[i].id === curId) return notes[i];
    return null;
  }

  function apiSave(payload) {
    return fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); });
  }

  /* 防抖自动保存：停止输入 800ms 落盘 */
  function scheduleSave() {
    dirty = true;
    body.querySelector('.zfn-status').textContent = '编辑中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 800);
  }

  function flushSave() {
    clearTimeout(saveTimer);
    if (!dirty || !curId) return;
    var n = curNote();
    if (!n) return;
    n.title = body.querySelector('.zfn-title').value.trim();
    n.content = body.querySelector('.zfn-editor').value;
    apiSave({ id: n.id, title: n.title, content: n.content }).then(function (res) {
      if (res && res.ok) {
        dirty = false;
        var st = body.querySelector('.zfn-status');
        st.textContent = '已保存 ' + fmt(Date.now());
        renderList();
      } else {
        body.querySelector('.zfn-status').textContent = '保存失败：' + ((res && res.err) || '未知错误');
      }
    }).catch(function (e) {
      body.querySelector('.zfn-status').textContent = '保存失败：' + e;
    });
  }

  function newNote() {
    flushSave();
    apiSave({ title: '', content: '' }).then(function (res) {
      if (!(res && res.ok)) return;
      notes.unshift({ id: res.id, title: '', content: '', createdAt: Date.now(), updatedAt: Date.now() });
      curId = res.id;
      renderAll();
      body.querySelector('.zfn-title').focus();
    });
  }

  function buildDom() {
    body.innerHTML =
      '<div class="zfn-side">' +
      '  <div class="zfn-side-head"><b>历史笔记</b><button class="zfn-new" title="新建笔记">' + ICO_NEW + '新建</button></div>' +
      '  <div class="zfn-list"></div>' +
      '</div>' +
      '<div class="zfn-main">' +
      '  <input class="zfn-title" placeholder="标题"/>' +
      '  <textarea class="zfn-editor" placeholder="记录实践、心得……（自动保存）"></textarea>' +
      '  <div class="zfn-status"></div>' +
      '</div>';
    body.querySelector('.zfn-new').addEventListener('click', newNote);
    body.querySelector('.zfn-title').addEventListener('input', scheduleSave);
    body.querySelector('.zfn-editor').addEventListener('input', scheduleSave);
  }

  function load() {
    return fetch('/api/notes').then(function (r) { return r.json(); }).then(function (res) {
      notes = (res && res.ok && res.notes) || [];
      curId = notes.length ? notes[0].id : null;
      renderAll();
    }).catch(function () {
      body.querySelector('.zfn-status').textContent = '加载失败，请检查服务器';
    });
  }

  window.ZFNotes = {
    onOpen: function (el) {
      body = el;
      cssInit();
      if (!body.querySelector('.zfn-side')) buildDom();
      load();
    },
    onClose: function () { flushSave(); }
  };
})();
