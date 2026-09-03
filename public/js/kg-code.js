/**
 * kg-code.js — 代码结构知识提取（长任务 lp-20260902-051533 · 步骤 3）
 * ---------------------------------------------------------------
 * 静态分析（不依赖 LLM）：
 *   - JS 文件：类名/函数声明/window 挂载为实体，import/requires 为关系
 *   - PY 文件：class/def 声明为实体
 * 实体 type：module / class / function
 * 关系 type：定义于 / 引用
 *
 * 零耦合：只依赖 window.KGData（kg-data.js），挂 window.KGCode。
 * 用法：KGCode.run() 全量扫描 public/js + server 目录
 *       KGCode.run({ force: true }) 忽略缓存
 * 增量：文件 mtime+size 未变则跳过（缓存于 kg_meta.codeLog）。
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';
  if (window.KGCode) return;

  var SCAN_DIRS = ['public/js', 'server/routes', 'server', 'tools'];
  var EXTS = ['.js', '.py'];
  var SKIP_RE = /[\/\\](node_modules|\.git|\.bak|__pycache__)/;
  var state = { running: false, log: [], done: 0, total: 0 };

  function _log(m) {
    state.log.push(m);
    if (state.log.length > 200) state.log.shift();
    try { /* console.log 已移除：内部日志保留在 state.log，KGCode.progress() 可查 */ } catch (e) {}
  }

  function _post(url, body, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', url, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.timeout = timeoutMs || 30000;
      x.onload = function () {
        try { resolve(JSON.parse(x.responseText || '{}')); }
        catch (e) { reject(new Error('bad json')); }
      };
      x.onerror = function () { reject(new Error('network error')); };
      x.ontimeout = function () { reject(new Error('timeout')); };
      x.send(JSON.stringify(body || {}));
    });
  }

  // ---------- 文件枚举（走 /api/tools/find） ----------
  function listFiles() {
    return _post('/api/tools/find', { pattern: '**/*.js', max_results: 500 })
      .then(function (r1) {
        var files = (r1 && r1.files) || [];
        return _post('/api/tools/find', { pattern: '**/*.py', max_results: 500 })
          .then(function (r2) { return files.concat((r2 && r2.files) || []); });
      })
      .then(function (all) {
        return all.filter(function (f) {
          return SCAN_DIRS.some(function (d) { return f.indexOf(d) === 0 || f.indexOf('/' + d) >= 0; })
            && EXTS.some(function (e) { return f.slice(-e.length) === e; })
            && !SKIP_RE.test(f);
        });
      });
  }

  // ---------- JS 静态解析 ----------
  function parseJS(path, src) {
    var ents = [], rels = [];
    var rel = { source: path, type: 'module' };
    ents.push({ name: path.replace(/^.*[\/\\]/, ''), type: 'module', desc: '文件 ' + path, source: path });
    // window.X = / window.X = window.X 防重复
    var re;
    re = /(?:window\.)([A-Za-z_$][\w$]*)\s*=/g;
    var m;
    while ((m = re.exec(src))) {
      ents.push({ name: m[1], type: 'class', desc: '全局挂载 window.' + m[1] + '（' + path + '）', source: path });
      rels.push({ from: m[1], to: path.replace(/^.*[\/\\]/, ''), type: '定义于', evidence: 'window.' + m[1], source: path });
    }
    // function foo( / var foo = function
    re = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g;
    while ((m = re.exec(src))) {
      ents.push({ name: m[1], type: 'function', desc: '函数 ' + m[1] + '（' + path + '）', source: path });
      rels.push({ from: m[1], to: path.replace(/^.*[\/\\]/, ''), type: '定义于', evidence: 'function ' + m[1], source: path });
    }
    // class Foo
    re = /(?:^|\n)\s*class\s+([A-Za-z_$][\w$]*)/g;
    while ((m = re.exec(src))) {
      ents.push({ name: m[1], type: 'class', desc: '类 ' + m[1] + '（' + path + '）', source: path });
      rels.push({ from: m[1], to: path.replace(/^.*[\/\\]/, ''), type: '定义于', evidence: 'class ' + m[1], source: path });
    }
    // require / 引用其他全局（KGData / KVS / Models / App / CA 等）
    re = /(?:window\.)?(KGData|KGExtract|KGCode|KVS|Models|App|Tools|CA|ToolStore)\b/g;
    var seen = {};
    while ((m = re.exec(src))) {
      if (seen[m[1]]) continue; seen[m[1]] = 1;
      var base = path.replace(/^.*[\/\\]/, '');
      if (m[1] !== base) {
        rels.push({ from: base, to: m[1], type: '引用', evidence: '代码中引用 ' + m[1], source: path });
      }
    }
    return { ents: ents, rels: rels };
  }

  // ---------- PY 静态解析 ----------
  function parsePY(path, src) {
    var ents = [], rels = [];
    var base = path.replace(/^.*[\/\\]/, '');
    ents.push({ name: base, type: 'module', desc: '文件 ' + path, source: path });
    var lines = src.split('\n');
    var re = /^(?:class|def)\s+([A-Za-z_]\w*)/;
    for (var i = 0; i < lines.length; i++) {
      var m = re.exec(lines[i]);
      if (m) {
        var isClass = lines[i].indexOf('class ') === 0;
        ents.push({ name: m[1], type: isClass ? 'class' : 'function', desc: (isClass ? '类 ' : '函数 ') + m[1] + '（' + path + '）', source: path });
        rels.push({ from: m[1], to: base, type: '定义于', evidence: lines[i].trim().slice(0, 60), source: path });
      }
    }
    // import 引用
    var seen = {};
    var im = /^import\s+(\w+)|^from\s+(\w+)/;
    for (var j = 0; j < lines.length; j++) {
      var mm = im.exec(lines[j]);
      if (mm) {
        var dep = mm[1] || mm[2];
        if (!seen[dep]) { seen[dep] = 1; rels.push({ from: base, to: dep, type: '引用', evidence: lines[j].trim().slice(0, 60), source: path }); }
      }
    }
    return { ents: ents, rels: rels };
  }

  // ---------- 主流程 ----------
  function run(opts) {
    opts = opts || {};
    if (state.running) return Promise.reject(new Error('已在运行中'));
    state.running = true; state.done = 0; state.log = [];
    var codeLog = (KGData.stats().meta || {}).codeLog || {};
    var changed = [];

    return listFiles().then(function (files) {
      state.total = files.length;
      _log('待扫描 ' + files.length + ' 个代码文件');
      var chain = Promise.resolve();
      files.forEach(function (f) {
        chain = chain.then(function () {
          return _post('/api/tools/read', { path: f }, 30000).then(function (r) {
            state.done++;
            var content = r && r.content;
            if (typeof content !== 'string') { _log('跳过（读失败）: ' + f); return; }
            var sig = content.length + ':' + simpleHash(content);
            if (!opts.force && codeLog[f] && codeLog[f].sig === sig) { _log('缓存命中: ' + f); return; }
            var res = (f.slice(-3) === '.js') ? parseJS(f, content) : parsePY(f, content);
            res.ents.forEach(function (e) { KGData.upsertEntity(e); });
            res.rels.forEach(function (r2) { KGData.upsertRelation(r2); });
            codeLog[f] = { sig: sig, ts: Date.now(), ents: res.ents.length, rels: res.rels.length };
            changed.push(f);
            _log('完成 ' + f + '：' + res.ents.length + ' 实体 / ' + res.rels.length + ' 关系');
          }).catch(function (e) { _log('错误 ' + f + '：' + e.message); });
        });
      });
      return chain.then(function () {
        KGData.setMeta('codeLog', codeLog);
        KGData.setMeta('lastCodeExtract', Date.now());
        KGData.saveNow();
        state.running = false;
        _log('全部完成：' + state.done + ' 文件，' + changed.length + ' 有变更');
        return { files: state.done, changed: changed };
      });
    }).catch(function (e) {
      state.running = false;
      _log('失败：' + e.message);
      throw e;
    });
  }

  function simpleHash(s) {
    var h = 0;
    for (var i = 0; i < s.length; i += 7) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return h;
  }

  window.KGCode = {
    run: run,
    listFiles: listFiles,
    progress: function () { return { running: state.running, done: state.done, total: state.total, log: state.log.slice(-30) }; },
    _parseJS: parseJS,
    _parsePY: parsePY
  };
})();
