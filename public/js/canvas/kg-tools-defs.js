/**
 * kg-tools-defs.js — 知识图谱工具分类定义（长任务 lp-20260902-051533 · 步骤 5）
 * ---------------------------------------------------------------
 * 独立注册「知识图谱 🔮」工具分类（方式同 canvas-tools-defs.js）：
 *   - query_knowledge：AI 查询知识库（XX 是什么 / 和 YY 什么关系）
 *   - open_knowledge_graph：打开可视化图谱
 *   - rebuild_knowledge：增量重建（文档 LLM 提取 + 代码静态提取）
 * 零耦合：不修改其他分类；依赖 kg-data/kg-extract/kg-code/app-knowledge-graph。
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';

  var CATEGORY = 'knowledge_graph';
  var DISPLAY = '知识图谱 🔮';

  function defs() {
    return {
      desc: '知识图谱工具：查询项目概念知识库（实体-关系网），回答「XX 是什么」「XX 和 YY 什么关系」等问题；可打开可视化图谱、增量重建知识库。',
      tools: [
        {
          name: 'query_knowledge',
          desc: '查询知识图谱。支持：概念搜索（entity）、两实体间关系（relation）、邻居概念（neighbors）。返回带来源的实体描述与关系列表。',
          params: {
            type: 'object',
            properties: {
              mode: { type: 'string', enum: ['entity', 'relation', 'neighbors', 'stats'], desc: 'entity=查实体（默认），relation=查两实体关系，neighbors=查邻居概念，stats=知识库统计' },
              name: { type: 'string', desc: '实体名（entity/neighbors 模式必填）' },
              name2: { type: 'string', desc: '第二个实体名（relation 模式必填）' },
              hops: { type: 'number', desc: '邻居跳数，默认 1（neighbors 模式）' }
            }
          }
        },
        {
          name: 'open_knowledge_graph',
          desc: '打开知识图谱可视化界面（力导向图，可搜索/过滤/缩放）。',
          params: { type: 'object', properties: {} }
        },
        {
          name: 'rebuild_knowledge',
          desc: '增量重建知识库：对变更的文档做 LLM 提取（KGExtract）、对变更代码做静态提取（KGCode）。force=true 强制全量。',
          params: {
            type: 'object',
            properties: { force: { type: 'boolean', desc: '是否强制全量重提（默认 false 增量）' } }
          }
        },
        // 元工具（任何分类必须能终止/切换）
        { name: 'task_complete', desc: '结束任务并给用户最终答复', params: { type: 'object', properties: { message: { type: 'string', desc: '最终答复' }, success: { type: 'boolean', desc: '是否成功' } }, required: ['message'] } },
        { name: 'switch_tool_category', desc: '切换工具分类', params: { type: 'object', properties: { category: { type: 'string', desc: '分类名' } } } },
        { name: 'ask_user', desc: '向用户提问', params: { type: 'object', properties: { question: { type: 'string', desc: '问题' } } } }
      ]
    };
  }

  // ---------- 执行 ----------
  function execQuery(args) {
    if (!window.KGData) return { ok: false, error: '知识库未安装（kg-data.js）' };
    var mode = args.mode || 'entity';
    var data = KGData.exportAll() || {};
    var ents = data.entities || {}, rels = data.relations || {};
    var relArr = Object.keys(rels).map(function (k) { return rels[k]; });
    var norm = function (s) { return String(s || '').toLowerCase().replace(/\s+/g, ''); };

    if (mode === 'stats') {
      var s = KGData.stats();
      var m = s.meta || {};
      return { ok: true, entities: s.entities, relations: s.relations,
        types: s.types, relTypes: s.relTypes, lastExtract: m.lastExtract, lastCodeExtract: m.lastCodeExtract,
        docLog: Object.keys(m.extractLog || {}).length + ' 文档', codeLog: Object.keys(m.codeLog || {}).length + ' 代码文件' };
    }
    if (mode === 'relation') {
      var a = norm(args.name), b = norm(args.name2);
      var out = [];
      relArr.forEach(function (r) {
        if ((r.from === a && r.to === b) || (r.from === b && r.to === a)) {
          out.push({ from: ents[r.from] ? ents[r.from].name : r.from, to: ents[r.to] ? ents[r.to].name : r.to, type: r.type, evidence: r.evidence, source: r.source });
        }
      });
      if (!out.length) return { ok: true, found: false, answer: '知识库中未找到「' + args.name + '」与「' + args.name2 + '」的直接关系。', hint: '可用 rebuild_knowledge 增量补充知识库。' };
      return { ok: true, found: true, relations: out, answer: out.map(function (r) { return r.from + ' --' + r.type + '-- ' + r.to + '（来源: ' + r.source + '）'; }).join('；') };
    }
    // entity / neighbors
    var key = norm(args.name);
    var e = ents[key];
    if (!e) {
      // 模糊搜索
      var hits = [];
      Object.keys(ents).forEach(function (k) { if (k.indexOf(key) >= 0) hits.push(ents[k].name); });
      return { ok: true, found: false, fuzzy: hits.slice(0, 10), answer: hits.length ? '未精确命中，相近概念：' + hits.slice(0, 10).join('、') : '知识库中无「' + args.name + '」。' };
    }
    var eRels = [];
    relArr.forEach(function (r) {
      if (r.from === key || r.to === key) {
        eRels.push({ from: ents[r.from] ? ents[r.from].name : r.from, to: ents[r.to] ? ents[r.to].name : r.to, type: r.type, evidence: r.evidence, source: r.source });
      }
    });
    if (mode === 'neighbors') {
      var hops = Math.max(1, Math.min(3, args.hops || 1));
      var nb = KGData.neighbors ? KGData.neighbors(e.name, hops) : null;
      return { ok: true, entity: { name: e.name, type: e.type, desc: e.desc, sources: e.sources }, neighbors: nb, relations: eRels.slice(0, 30) };
    }
    return {
      ok: true, found: true,
      entity: { name: e.name, type: e.type, desc: e.desc, sources: e.sources, confidence: Math.min(1, (e.hits || 1) * 0.1 + 0.5) },
      relations: eRels.slice(0, 30),
      answer: '【' + e.name + '】' + (e.type || '概念') + '：' + (e.desc || '（无描述）') + '。相关关系 ' + eRels.length + ' 条' + (e.sources && e.sources.length ? '，来源：' + e.sources.join(', ') : '') + '。'
    };
  }

  function execOpen() {
    if (!window.KGView) return { ok: false, error: '可视化模块未安装（app-knowledge-graph.js）' };
    KGView.open();
    return { ok: true, result: '知识图谱可视化已打开' };
  }

  function execRebuild(args) {
    if (!window.KGExtract) return { ok: false, error: '提取引擎未安装（kg-extract.js）' };
    // 异步执行，返回已启动状态
    var p1 = KGExtract.run({ force: !!args.force }).catch(function (e) { return { error: e.message }; });
    var p2 = (window.KGCode ? KGCode.run({ force: !!args.force }) : Promise.resolve({})).catch(function (e) { return { error: e.message }; });
    return { ok: true, result: '知识库增量重建已启动（文档 LLM 提取 + 代码静态提取），可用 query_knowledge(mode=stats) 查看进度' };
  }

  // ---------- 注册（含执行逻辑 + 兜底元工具） ----------
  function register() {
    if (!window.ToolStore || !window.App) return false;
    try {
      // 分类定义注册（同 canvas-tools-defs 的结构）
      if (typeof ToolStore.registerCategory === 'function') {
        ToolStore.registerCategory(CATEGORY, DISPLAY, defs());
      } else {
        ToolStore.categories = ToolStore.categories || {};
        ToolStore.categories[CATEGORY] = Object.assign({ id: CATEGORY, name: DISPLAY }, defs());
      }
      // 执行器注册
      var executors = {
        query_knowledge: execQuery,
        open_knowledge_graph: execOpen,
        rebuild_knowledge: execRebuild
      };
      var origExec = Tools.execute;
      Tools.execute = function (name, args, ctx) {
        if (executors[name]) {
          try { return executors[name](args || {}, ctx); }
          catch (e) { return { ok: false, error: 'kg-tools: ' + e.message }; }
        }
        return origExec.apply(Tools, arguments);
      };
      return true;
    } catch (e) {
      console.warn('[kg-tools-defs] 注册失败: ' + e.message);
      return false;
    }
  }

  // 等待 ToolStore 就绪
  function tryRegister(retries) {
    if (register()) { console.log('[kg-tools-defs] 分类「' + DISPLAY + '」已注册'); return; }
    if ((retries || 0) < 20) setTimeout(function () { tryRegister((retries || 0) + 1); }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { tryRegister(); });
  else tryRegister();

  window.KGTools = { register: register, execQuery: execQuery, defs: defs };
})();
