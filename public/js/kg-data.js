/**
 * kg-data.js — 知识图谱数据层（长任务 lp-20260902-051533 · 步骤 1）
 * ---------------------------------------------------------------
 * 独立知识库存储：实体（概念）+ 关系（三元组）。
 * 零耦合原则：
 *   - 不修改任何现有文件逻辑；本文件可独立删除/卸载。
 *   - 存储独立（KV key: kg_entities / kg_relations / kg_meta），与 canvas_agent_events 等无关。
 *   - 挂载点：window.KGData。若未在 index.html 引入则不加载，系统不受影响。
 *
 * 数据结构：
 *   实体 { id, name, type, desc, sources: [file], confidence, hits, created, updated }
 *     - id: 归一化名（小写去空格）作为唯一键
 *     - type: concept|module|file|tool|feature|person|term ...（自由扩展）
 *   关系 { id, from, to, type, evidence, source, ts }
 *     - type: 引用|依赖|同类|实现于|属于|配置于 ...（自由扩展）
 *   元信息 kg_meta { version, lastExtract, extractLog: {file: {ts, segs, ents, rels}} }
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';
  if (window.KGData) return; // 防重复加载

  var KV_ENTITIES = 'kg_entities';
  var KV_RELATIONS = 'kg_relations';
  var KV_META = 'kg_meta';

  var _entities = {};  // id -> entity
  var _relations = {}; // rid -> relation
  var _meta = { version: 1, lastExtract: 0, extractLog: {} };

  var MAX_RELATIONS = 20000; // 关系上限，超出丢弃置信度最低的

  // ---------- 底层存取 ----------
  function _kvGet(key) {
    try {
      var raw = (window.KVS && KVS.get) ? KVS.get(key) : localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function _kvSet(key, val) {
    try {
      var raw = JSON.stringify(val);
      if (window.KVS && KVS.set) KVS.set(key, raw); else localStorage.setItem(key, raw);
      return true;
    } catch (e) { return false; }
  }

  function load() {
    var e = _kvGet(KV_ENTITIES); if (e && typeof e === 'object') _entities = e;
    var r = _kvGet(KV_RELATIONS); if (r && typeof r === 'object') _relations = r;
    var m = _kvGet(KV_META); if (m && typeof m === 'object') _meta = m;
  }
  function save() {
    _kvSet(KV_ENTITIES, _entities);
    _kvSet(KV_RELATIONS, _relations);
    _kvSet(KV_META, _meta);
  }
  load();

  // ---------- 实体 ----------
  function normId(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function ridOf(from, to, type) {
    return normId(from) + '|' + normId(to) + '|' + String(type || '').trim();
  }

  /**
   * 添加/合并实体
   * @param {object} ent { name, type, desc, source, confidence }
   */
  function upsertEntity(ent) {
    if (!ent || !ent.name) return null;
    var id = normId(ent.name);
    if (!id) return null;
    var cur = _entities[id];
    var now = Date.now();
    if (cur) {
      if (ent.type && ent.type !== cur.type) cur.type = ent.type; // 后写的类型覆盖
      if (ent.desc && ent.desc.length > (cur.desc || '').length) cur.desc = ent.desc;
      if (ent.source && cur.sources.indexOf(ent.source) < 0) cur.sources.push(ent.source);
      cur.confidence = Math.min(1, (cur.confidence || 0.5) + 0.1); // 重复出现提升置信度
      cur.hits = (cur.hits || 0) + 1;
      cur.updated = now;
    } else {
      cur = {
        id: id,
        name: String(ent.name).trim(),
        type: ent.type || 'concept',
        desc: ent.desc || '',
        sources: ent.source ? [ent.source] : [],
        confidence: ent.confidence != null ? ent.confidence : 0.5,
        hits: 1,
        created: now,
        updated: now
      };
      _entities[id] = cur;
    }
    return cur;
  }

  /**
   * 添加关系（from/to 为实体名；实体不存在会自动补建）
   * @param {object} rel { from, to, type, evidence, source }
   */
  function upsertRelation(rel) {
    if (!rel || !rel.from || !rel.to || !rel.type) return null;
    var f = upsertEntity({ name: rel.from, source: rel.source });
    var t = upsertEntity({ name: rel.to, source: rel.source });
    if (!f || !t) return null;
    if (f.id === t.id) return null; // 自环无意义
    var rid = ridOf(f.id, t.id, rel.type);
    var cur = _relations[rid];
    if (cur) {
      cur.evidence = rel.evidence || cur.evidence;
      cur.weight = (cur.weight || 1) + 1;
      cur.ts = Date.now();
    } else {
      cur = {
        id: rid, from: f.id, to: t.id, type: String(rel.type).trim(),
        evidence: rel.evidence || '', source: rel.source || '',
        weight: 1, ts: Date.now()
      };
      _relations[rid] = cur;
    }
    _trimRelations();
    return cur;
  }

  function _trimRelations() {
    var keys = Object.keys(_relations);
    if (keys.length <= MAX_RELATIONS) return;
    keys.sort(function (a, b) {
      return (_relations[a].weight || 1) - (_relations[b].weight || 1);
    });
    var drop = keys.length - MAX_RELATIONS;
    for (var i = 0; i < drop; i++) delete _relations[keys[i]];
  }

  // ---------- 查询 ----------
  function getEntity(name) { return _entities[normId(name)] || null; }

  function searchEntities(q, type) {
    q = (q || '').trim().toLowerCase();
    var out = [];
    for (var id in _entities) {
      var e = _entities[id];
      if (type && e.type !== type) continue;
      if (!q || e.name.toLowerCase().indexOf(q) >= 0 || (e.desc || '').toLowerCase().indexOf(q) >= 0) {
        out.push(e);
      }
    }
    out.sort(function (a, b) { return (b.hits || 0) - (a.hits || 0); });
    return out;
  }

  function relationsOf(name, dir) {
    var id = normId(name);
    var out = [];
    for (var rid in _relations) {
      var r = _relations[rid];
      if (dir !== 'to' && r.from === id) out.push(r);
      else if (dir !== 'from' && r.to === id) out.push(r);
    }
    return out;
  }

  function neighbors(name, hops) {
    hops = hops || 1;
    var seen = {};
    var frontier = [normId(name)];
    for (var h = 0; h < hops; h++) {
      var next = [];
      for (var i = 0; i < frontier.length; i++) {
        var rs = relationsOf(frontier[i]);
        for (var j = 0; j < rs.length; j++) {
          [rs[j].from, rs[j].to].forEach(function (nid) {
            if (!seen[nid] && nid !== normId(name)) { seen[nid] = 1; next.push(nid); }
          });
        }
      }
      frontier = next;
    }
    return Object.keys(seen).map(function (id) { return _entities[id]; }).filter(Boolean);
  }

  function stats() {
    return {
      entities: Object.keys(_entities).length,
      relations: Object.keys(_relations).length,
      types: _countBy(_entities, 'type'),
      relTypes: _countBy(_relations, 'type'),
      meta: _meta
    };
  }
  function _countBy(obj, field) {
    var c = {};
    for (var k in obj) { var v = obj[k][field]; if (v) c[v] = (c[v] || 0) + 1; }
    return c;
  }

  // ---------- 导入导出 ----------
  function exportAll() { return { entities: _entities, relations: _relations, meta: _meta }; }
  function importAll(data) {
    if (!data || typeof data !== 'object') return false;
    if (data.entities) _entities = data.entities;
    if (data.relations) _relations = data.relations;
    if (data.meta) _meta = data.meta;
    save();
    return true;
  }
  function clear() {
    _entities = {}; _relations = {}; _meta = { version: 1, lastExtract: 0, extractLog: {} };
    save();
  }

  function setMeta(k, v) { _meta[k] = v; }
  function saveNow() { save(); }

  // ---------- 挂载 ----------
  window.KGData = {
    version: '1.0.0',
    // 实体
    upsertEntity: upsertEntity,
    getEntity: getEntity,
    searchEntities: searchEntities,
    relationsOf: relationsOf,
    neighbors: neighbors,
    // 关系
    upsertRelation: upsertRelation,
    // 元
    stats: stats,
    setMeta: setMeta,
    saveNow: saveNow,
    exportAll: exportAll,
    importAll: importAll,
    clear: clear
  };

  // 自检示例（首次加载无数据时写入 1 条自检实体，验证结构可解析；正式提取会自然覆盖）
  if (!Object.keys(_entities).length) {
    upsertEntity({ name: '知识图谱', type: 'feature', desc: '本项目的概念知识图谱系统（自检条目）', source: 'kg-data.js', confidence: 0.9 });
    save();
  }
})();
