/**
 * kg-extract.js — 知识提取引擎（长任务 lp-20260902-051533 · 步骤 2）
 * ---------------------------------------------------------------
 * 扫描 docs/ 与 项目记录/ 下的 .md 文件，分段调用现有 LLM 通道
 * 提取「概念 → 关系 → 概念」三元组，写入 KGData 知识库。
 *
 * 零耦合原则：
 *   - 不修改任何现有文件逻辑；挂载 window.KGExtract，可独立删除。
 *   - 依赖 window.KGData（kg-data.js）与 Models（模型选择器）。
 *   - 提取日志缓存（文件级）：已提取且未变更的文件跳过，增量提取。
 *
 * 用法（浏览器控制台 / 后续步骤的按钮调用）：
 *   KGExtract.run()                        // 增量提取全部（用当前默认模型）
 *   KGExtract.run({ force: true })         // 强制全量重提
 *   KGExtract.run({ modelId: 'xx' })       // 指定模型
 *   KGExtract.listDocs()                   // 列出可扫描文件
 *   KGExtract.progress()                   // 查看进度
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';
  if (window.KGExtract) return;

  var API_READFILE = '/api/tools/read';       // 后端读文件接口（返回 {ok, path, content}）
  var API_FIND     = '/api/tools/find';       // 后端查找文件接口（返回 {ok, files}）
  var SEG_CHARS = 3000;      // 每段字符数
  var SEG_OVERLAP = 200;     // 段间重叠
  var CONCURRENCY = 1;       // 串行提取，避免限流
  var state = { running: false, total: 0, done: 0, currentFile: '', log: [] };

  // ---------- 工具 ----------
  function _log(msg) {
    state.log.push('[' + new Date().toLocaleTimeString() + '] ' + msg);
    if (state.log.length > 200) state.log.shift();
    try { console.log('[KGExtract] ' + msg); } catch (e) {}
  }

  function _fetchJson(url, body, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', url, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.timeout = timeoutMs || 60000;
      x.onload = function () {
        try { resolve(JSON.parse(x.responseText || '{}')); }
        catch (e) { reject(new Error('bad json: ' + (x.responseText || '').slice(0, 100))); }
      };
      x.onerror = function () { reject(new Error('network error')); };
      x.ontimeout = function () { reject(new Error('timeout')); };
      x.send(JSON.stringify(body || {}));
    });
  }

  // ---------- 文档清单 ----------
  // 优先走后端接口拿真实文件列表；接口不可用时用静态清单（重要文档手工列出，保底可跑）
  var FALLBACK_DOCS = [
    'docs/remote-control-帮助与介绍.md',
    'docs/remote-control-开发日志.md',
    'docs/remote-control-帮助文档.md',
    '项目记录/远程控制系统-开发日志.md'
  ];

  function listDocs() {
    // 走后端 find 工具列 docs/ 与 项目记录/ 下的 .md；接口不可用时用静态清单保底
    return _fetchJson(API_FIND, { pattern: '**/*.md', path: 'docs' }, 15000)
      .then(function (r1) {
        var files = (r1 && r1.ok && Array.isArray(r1.files)) ? r1.files.slice() : [];
        return _fetchJson(API_FIND, { pattern: '**/*.md', path: '项目记录' }, 15000)
          .then(function (r2) {
            if (r2 && r2.ok && Array.isArray(r2.files)) files = files.concat(r2.files);
            return files.length ? files : FALLBACK_DOCS;
          });
      })
      .catch(function () { return FALLBACK_DOCS; });
  }

  // ---------- 读文件 ----------
  function readDoc(path) {
    return _fetchJson(API_READFILE, { path: path, max_chars: 60000 }, 30000)
      .then(function (r) {
        if (r && r.ok && typeof r.content === 'string') return r.content;
        return '';
      })
      .catch(function () { return ''; });
  }

  // ---------- 分段 ----------
  function segment(text) {
    var segs = [];
    var i = 0;
    while (i < text.length) {
      segs.push(text.slice(i, i + SEG_CHARS));
      if (i + SEG_CHARS >= text.length) break;
      i += SEG_CHARS - SEG_OVERLAP;
    }
    return segs;
  }

  // ---------- LLM 提取单段 ----------
  var REL_TYPES = ['依赖', '引用', '同类', '实现于', '属于', '配置于', '用于', '相关'];

  function buildPrompt(seg, fname) {
    return '你在为软件项目构建知识图谱。请从下面这段项目文档中提取「实体-关系」三元组。\n' +
      '输出严格的 JSON（不要 markdown 代码块、不要多余文字）：\n' +
      '{"entities":[{"name":"概念名","type":"concept|module|file|tool|feature|term","desc":"一句话描述"}],\n' +
      ' "relations":[{"from":"实体A","to":"实体B","type":"关系类型","evidence":"原文依据（短语）"}]}\n' +
      '关系类型从这些里选：' + REL_TYPES.join('、') + '。\n' +
      '要求：只提取文档明确提到的；实体名用简短规范名（如「远程控制系统」而非「我们的那个系统」）；没有可提取内容就输出 {"entities":[],"relations":[]}。\n' +
      '文档来源：' + fname + '\n\n文档内容：\n' + seg;
  }

  function callLLM(prompt, modelId) {
    return new Promise(function (resolve, reject) {
      var model = null;
      try { model = (window.Models && Models.get) ? Models.get(modelId || _defaultModelId()) : null; } catch (e) {}
      if (!model || !model.endpoint || !(model.key || model.apiKey)) {
        return reject(new Error('无可用模型（请先在界面配置并选择模型）'));
      }
      var payload = {
        model: model.modelId || model.model || model.id || '',
        messages: [{ role: 'user', content: prompt }],
        stream: false, temperature: 0.2, max_tokens: 1500
      };
      var headers = { 'Content-Type': 'application/json' };
      try { var k = model.apiKey || model.key; if (k) headers['Authorization'] = 'Bearer ' + k; } catch (e) {}
      var useProxy = false;
      try { useProxy = /^https?:/.test(model.endpoint || '') && model.endpoint.indexOf(location.origin) !== 0; } catch (e) { useProxy = true; }
      var url = useProxy ? '/api/proxy' : model.endpoint;
      if (useProxy) payload = { _target_url: model.endpoint, _method: 'POST', _headers: headers, _body: payload };
      var x = new XMLHttpRequest();
      x.open('POST', url, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.timeout = 90000;
      x.onload = function () {
        try {
          var r = JSON.parse(x.responseText || '{}');
          var content = (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content) || r.content || '';
          content = String(content).replace(/```json|```/g, '').trim();
          var m = content.match(/\{[\s\S]*\}/);
          resolve(m ? JSON.parse(m[0]) : { entities: [], relations: [] });
        } catch (e) { resolve({ entities: [], relations: [] }); } // 解析失败按空处理，不中断
      };
      x.onerror = function () { reject(new Error('LLM 网络错误')); };
      x.ontimeout = function () { reject(new Error('LLM 超时')); };
      x.send(JSON.stringify(payload));
    });
  }

  function _defaultModelId() {
    try {
      if (window.Models && Models.current) return Models.current();
      if (window.App && App.getCurrentModelId) return App.getCurrentModelId();
    } catch (e) {}
    return null;
  }

  // ---------- 主流程 ----------
  /**
   * @param {object} opt { force, modelId, files }
   * @returns Promise<{extracted, files, segs, ents, rels, skipped}>
   */
  function run(opt) {
    opt = opt || {};
    if (state.running) return Promise.reject(new Error('提取已在进行中'));
    if (!window.KGData) return Promise.reject(new Error('缺少 KGData（kg-data.js 未加载）'));

    state.running = true; state.done = 0; state.log = [];
    var stats = { extracted: 0, files: 0, segs: 0, ents: 0, rels: 0, skipped: 0 };

    return listDocs().then(function (docs) {
      var todo = [];
      var kgMeta = KGData.stats().meta || {};
      var extLog = kgMeta.extractLog || {};
      docs.forEach(function (f) {
        var was = extLog[f];
        // 缓存命中：提取过且未开 force → 跳过（增量）
        if (!opt.force && was && was.ts) { stats.skipped++; return; }
        todo.push(f);
      });
      state.total = todo.length;
      _log('待提取 ' + todo.length + ' 个文件（跳过已缓存 ' + stats.skipped + '）');

      var chain = Promise.resolve();
      todo.forEach(function (f) {
        chain = chain.then(function () {
          state.currentFile = f;
          return readDoc(f).then(function (text) {
            if (!text) { _log('读取失败/为空，跳过: ' + f); return; }
            var segs = segment(text);
            var fileEnts = 0, fileRels = 0;
            var segChain = Promise.resolve();
            segs.forEach(function (seg, si) {
              segChain = segChain.then(function () {
                return callLLM(buildPrompt(seg, f), opt.modelId).then(function (out) {
                  stats.segs++;
                  (out.entities || []).forEach(function (e) {
                    if (KGData.upsertEntity({ name: e.name, type: e.type, desc: e.desc, source: f, confidence: 0.6 })) { stats.ents++; fileEnts++; }
                  });
                  (out.relations || []).forEach(function (r) {
                    if (KGData.upsertRelation({ from: r.from, to: r.to, type: r.type, evidence: r.evidence, source: f })) { stats.rels++; fileRels++; }
                  });
                }).catch(function (e) {
                  _log('段提取失败 ' + f + ' #' + (si + 1) + ': ' + e.message);
                });
              });
            });
            return segChain.then(function () {
              try {
                var m = KGData.exportAll().meta || {};
                m.extractLog = m.extractLog || {};
                m.extractLog[f] = { ts: Date.now(), segs: segs.length, ents: fileEnts, rels: fileRels };
                m.lastExtract = Date.now();
                KGData.importAll({ meta: m }); // importAll 会 save
              } catch (e) { _log('元信息写入失败: ' + e.message); }
              stats.files++;
              _log('完成 ' + f + '：' + segs.length + ' 段 / ' + fileEnts + ' 实体 / ' + fileRels + ' 关系');
            });
          }).then(function () {
            state.done++;
          });
        });
      });

      return chain.then(function () {
        state.running = false; state.currentFile = '';
        _log('提取结束：' + JSON.stringify(stats));
        return stats;
      });
    }).catch(function (e) {
      state.running = false;
      throw e;
    });
  }

  function progress() {
    return {
      running: state.running,
      total: state.total,
      done: state.done,
      currentFile: state.currentFile,
      log: state.log.slice(-20)
    };
  }

  window.KGExtract = {
    version: '1.0.0',
    run: run,
    listDocs: listDocs,
    progress: progress
  };
})();
