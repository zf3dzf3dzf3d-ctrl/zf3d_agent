/* 伺服真源=项目根 public/（见 server/config.py PUBLIC_DIR）；改动必须改根副本并同步 server/public/js/ 副本 */
/* =====================================================================
 * crew-protocol.js — 📜 团队协议加载器 v1.0（2026-11-03）
 * =====================================================================
 * 一个自定义团队 = 一个 MD 文件（规范见 docs/团队协议-自定义团队规范.md）。
 * 本加载器只做一件事：MD → _objectorExpand 的 cfg 配置对象。
 * 引擎零改动：协议角色派出 = App._objectorExpand(box, chat, ZFCrewProtocol.cfg(teamId, roleIdx))
 * 存储：localStorage zf_crew_protocols = [{id,name,md,ts}]，按团队.id 合并（导入天然支持多人合并）。
 * ===================================================================== */
(function () {
  'use strict';
  if (window.ZFCrewProtocol) return; // 幂等守卫
  var P = window.ZFCrewProtocol = { version: '1.0' };
  var STORE_KEY = 'zf_crew_protocols';

  /* ── 存储 ── */
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveAll(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) {}
  }
  /* 导入/合并：同 id 覆盖、异 id 新增；返回 {added, updated} */
  P.import = function (mdText, meta) {
    var teams = P.parse(mdText);
    if (!teams.length) throw new Error('未解析到任何团队（检查「## 团队」段与 id 字段）');
    var list = loadAll();
    var r = { added: 0, updated: 0 };
    teams.forEach(function (t) {
      var idx = -1;
      for (var i = 0; i < list.length; i++) { if (list[i].id === t.id) { idx = i; break; } }
      var item = { id: t.id, name: t.name, md: t._md, ts: Date.now() };
      if (idx >= 0) { list[idx] = item; r.updated++; } else { list.push(item); r.added++; }
    });
    saveAll(list);
    return r;
  };
  P.list = function () { return loadAll(); };
  P.remove = function (id) {
    saveAll(loadAll().filter(function (t) { return t.id !== id; }));
  };
  /* 导出：全部协议拼成一个可再导入的 MD */
  P.exportAll = function () {
    return loadAll().map(function (t) { return t.md; }).join('\n\n<!-- ===== ↓ 下一个团队 ===== -->\n\n');
  };

  /* ── 解析：MD → 团队数组 ── */
  function getVal(block, key) {
    var m = block.match(new RegExp('^\\s*-\\s*' + key + '\\s*:\\s*(.+)$', 'm'));
    return m ? m[1].trim() : '';
  }
  P.parse = function (mdText) {
    var out = [];
    /* 按顶层「# 团队协议」或导入分隔注释切段，兼容多团队拼一个文件 */
    var chunks = String(mdText || '').split(/<!--\s*=+\s*↓?\s*下一个团队\s*=+\s*-->/);
    chunks.forEach(function (chunk) {
      if (!chunk.trim()) return;
      var teamBlock = (chunk.match(/##\s*团队([\s\S]*?)(?=\n##\s|$)/) || [])[1] || '';
      var id = getVal(teamBlock, 'id');
      var name = getVal(teamBlock, '名称') || id;
      if (!id) return; // 无 id 的段直接跳过
      var rolesSrc = (chunk.match(/##\s*角色([\s\S]*)$/) || [])[1] || '';
      var roles = [];
      /* 按 ### 三级标题切角色块 */
      var parts = rolesSrc.split(/(?=\n###\s)/);
      parts.forEach(function (p) {
        var hm = p.match(/^\s*###\s+(.+)$/m);
        if (!hm) return;
        var rname = hm[1].trim();
        roles.push({
          name: rname,
          face: getVal(p, '图标') || '🎭',
          count: parseInt(getVal(p, '默认数量'), 10) || 0,
          note: true,
          brief: getVal(p, '叮嘱') || '',
          taskHead: getVal(p, '职责') || ('【' + rname + '任务】你是' + rname + '，请按一句话叮嘱完成任务。'),
          conclTag: getVal(p, '结论标签') || ('【' + rname + '结论】')
        });
      });
      if (!roles.length) return;
      out.push({ id: id, name: name, author: getVal(teamBlock, '作者'), version: getVal(teamBlock, '版本'), desc: getVal(teamBlock, '简介'), roles: roles, _md: chunk.trim() });
    });
    return out;
  };

  /* ── cfg 生成：协议角色 → _objectorExpand 第三参（引擎零改动的关键） ── */
  P.cfg = function (teamId, roleIdx) {
    var t = null, list = loadAll();
    for (var i = 0; i < list.length; i++) { if (list[i].id === teamId) { t = list[i]; break; } }
    if (!t) throw new Error('协议团队不存在：' + teamId);
    var parsed = P.parse(t.md);
    for (var j = 0; j < parsed.length; j++) { if (parsed[j].id === teamId) t = parsed[j]; }
    var r = t.roles[roleIdx] || t.roles[0];
    var briefKey = 'zf_crew_proto_' + teamId + '_' + roleIdx + '_brief';
    return {
      briefKey: briefKey,
      defBrief: r.brief || '请按你的专业职责完成本任务。',
      label: r.name,
      title: r.face + ' ' + r.name,
      titleKey: r.name,
      toastIcon: r.face,
      srcFlag: '_isProtoChat_' + teamId + '_' + roleIdx,
      taskHead: r.taskHead,
      dutyHead: '== ' + r.name + '职责（你的任务） ==',
      conclTag: r.conclTag,
      conclNote: '（这条会通过统一前缀回注原对话）'
    };
  };

  /* 【新建团队 v1.1】AI 命令式新建：传团队名 + 角色数组，自动生成 id/MD 并落存储、上墙。
     roles: [{name:'名称', face:'🧑‍🔧', count:1, brief:'一句话叮嘱', duty:'职责描述', tag:'结论标签'}]
     返回 {id, name} */
  P.create = function (name, roles, opts) {
    opts = opts || {};
    if (!name || !name.trim()) throw new Error('团队名称不能为空');
    if (!roles || !roles.length) throw new Error('至少要有一个角色');
    var id = opts.id || ('team_' + Date.now().toString(36));
    var md = '## 团队\n- id: ' + id + '\n- 名称: ' + name.trim() +
      (opts.author ? '\n- 作者: ' + opts.author : '') +
      (opts.desc ? '\n- 简介: ' + opts.desc : '') + '\n\n## 角色\n';
    roles.forEach(function (r) {
      md += '\n### ' + (r.name || '未命名角色') + '\n- 图标: ' + (r.face || '🎭') +
        '\n- 默认数量: ' + (parseInt(r.count, 10) || 1) +
        (r.brief ? '\n- 叮嘱: ' + r.brief : '') +
        (r.duty ? '\n- 职责: ' + r.duty : '') +
        (r.tag ? '\n- 结论标签: ' + r.tag : '') + '\n';
    });
    var r = P.import(md, { source: 'create' });
    try { P.injectPanel(); } catch (e) {}
    if (!opts.silent && window.App && App._stepToast) App._stepToast('📜 新建团队「' + name.trim() + '」成功（' + roles.length + ' 个角色已上墙，id=' + id + '）', true);
    return { id: id, name: name.trim(), added: r.added, updated: r.updated };
  };
  /* 【AI 命令接口 v1.1】统一入口：ZFCrewProtocol.exec(cmd, payload)
     cmd:
       'create'  → payload {name, roles:[{name,face,count,brief,duty,tag}], author?, desc?}
       'import'  → payload 为团队协议 MD 字符串
       'export'  → payload 忽略，返回全部团队 MD 字符串
       'list'    → 返回团队列表 [{id,name,角色数}]
       'remove'  → payload 为团队 id
     返回 {ok:true, data} 或 {ok:false, error}，永不抛异常，方便 AI 判断 */
  P.exec = function (cmd, payload) {
    try {
      switch (cmd) {
        case 'create': return { ok: true, data: P.create(payload.name, payload.roles, payload) };
        case 'import': {
          var r = P.import(String(payload || ''));
          try { P.injectPanel(); } catch (e) {}
          return { ok: true, data: r };
        }
        case 'export': return { ok: true, data: P.exportAll() };
        case 'list': return {
          ok: true,
          data: loadAll().map(function (t) {
            var n = 0; try { n = (P.parse(t.md).filter(function (x) { return x.id === t.id; })[0] || { roles: [] }).roles.length; } catch (e) {}
            return { id: t.id, name: t.name, roles: n };
          })
        };
        case 'remove':
          P.remove(String(payload || ''));
          _injected[payload] = true; /* 防止轮询又把删掉的角色挂回来 */
          return { ok: true, data: { removed: payload } };
        default: return { ok: false, error: '未知命令：' + cmd + '（可用 create/import/export/list/remove）' };
      }
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  };
  var _injected = {};
  /* 【面板注入：把所有协议团队的角色卡追加进 ZFCrewPanel.ROLES（面板零改动渲染） */
  P.injectPanel = function () {
    if (!window.ZFCrewPanel || !ZFCrewPanel.ROLES) return;
    loadAll().forEach(function (t, ti) {
      if (_injected[t.id]) return;
      _injected[t.id] = true;
      var parsed = P.parse(t.md);
      var tp = null; for (var i = 0; i < parsed.length; i++) { if (parsed[i].id === t.id) tp = parsed[i]; }
      if (!tp) return;
      tp.roles.forEach(function (r, ri) {
        var key = 'proto_' + t.id + '_' + ri;
        /* 防重复：面板 ROLES 里已有同名 key 就跳过 */
        for (var k = 0; k < ZFCrewPanel.ROLES.length; k++) { if (ZFCrewPanel.ROLES[k].key === key) return; }
        /* 【讲解师排序 2026-11-27】协议卡（含律师）不再无条件 push 尾部：找到讲解师卡时插到它前面
           （讲解师排协议卡之后=律师后面，用户定稿）；讲解师卡缺席（旧缓存/被移除）时回退尾部追加 */
        var _card = {
          key: key, face: r.face, name: r.name, count: r.count, note: true,
          fn: function (box, chat) {
            App._objectorExpand(box, chat, window.ZFCrewProtocol.cfg(t.id, ri));
          }
        };
        var _exIdx = -1;
        for (var k2 = 0; k2 < ZFCrewPanel.ROLES.length; k2++) { if (ZFCrewPanel.ROLES[k2].key === 'explainer') { _exIdx = k2; break; } }
        if (_exIdx >= 0) { ZFCrewPanel.ROLES.splice(_exIdx, 0, _card); } else { ZFCrewPanel.ROLES.push(_card); }
      });
    });
  };
  /* 轮询注入：面板/协议加载顺序无关，谁后到都能挂上 */
  setInterval(function () { try { P.injectPanel(); } catch (e) {} }, 3000);
  document.addEventListener('DOMContentLoaded', function () { try { P.injectPanel(); } catch (e) {} });
})();
