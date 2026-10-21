/**
 * kg-watch.js — 知识图谱增量更新（长任务 lp-20260902-051533 · 步骤 6）
 * ---------------------------------------------------------------
 * 监听 git 提交（轮询 /api/git 接口，5 分钟一次）+ 对话结论事件：
 *   - 有新提交时，比对变更文件，仅对变更文件重新提取（KGExtract 文档 / KGCode 代码）
 *   - 知识库不重建、不膨胀（upsert 合并 + 置信度衰减淘汰）
 * 零耦合：只依赖 KGData/KGExtract/KGCode，挂 window.KGWatch。
 * 用法：自动启动；KGWatch.status() 查看；KGWatch.stop() 停止。
 * ---------------------------------------------------------------
 */
(function () {
  'use strict';
  if (window.KGWatch) return;

  var POLL_MS = 5 * 60 * 1000; // 5 分钟
  var DECAY_DAYS = 30;         // 30 天未被引用的实体置信度衰减
  var state = { timer: null, lastCommit: null, checking: false, log: [], lastRun: 0 };

  function _log(m) {
    state.log.unshift('[' + new Date().toLocaleTimeString() + '] ' + m);
    if (state.log.length > 100) state.log.pop();
    // console.log 已移除：控制台不再输出启动/基线提示（KGWatch 内部日志仍保留在 state.log，KGWatch.status() 可查）
  }

  function _post(url, body, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', url, true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.timeout = timeoutMs || 30000;
      x.onload = function () { try { resolve(JSON.parse(x.responseText || '{}')); } catch (e) { reject(new Error('bad json')); } };
      x.onerror = function () { reject(new Error('network error')); };
      x.ontimeout = function () { reject(new Error('timeout')); };
      x.send(JSON.stringify(body || {}));
    });
  }

  // ---------- git 提交监听 ----------
  // 注意：后端没有 /api/git 路由，统一走 /api/tools/run（shell 执行接口）
  function _git(args) {
    return _post('/api/tools/run', { code: 'git ' + args }, 20000)
      .then(function (r) {
        return (r && r.ok && r.stdout) ? String(r.stdout) : '';
      })
      .catch(function () { return ''; });
  }

  function getHeadCommit() {
    return _git('log -1 --format=%H').then(function (out) {
      var h = out.trim();
      return h || null;
    });
  }

  function changedFiles(oldHead, newHead) {
    return _git('diff --name-only ' + oldHead + ' ' + newHead).then(function (out) {
      return out.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l; });
    });
  }

  function check() {
    if (state.checking || !window.KGData) return Promise.resolve();
    state.checking = true;
    return getHeadCommit().then(function (head) {
      if (!head) { _log('无法获取 git HEAD，跳过本轮'); state.checking = false; return; }
      if (state.lastCommit === null) { state.lastCommit = head; _log('基线提交: ' + head.slice(0, 8)); state.checking = false; return; }
      if (head === state.lastCommit) { state.checking = false; return; }
      _log('检测到新提交: ' + head.slice(0, 8) + '，开始增量提取…');
      return changedFiles(state.lastCommit, head).then(function (files) {
        var docs = files.filter(function (f) { return /\.md$/.test(f) && (/^docs[\/\\]/.test(f) || /项目记录/.test(f)); });
        var codes = files.filter(function (f) { return /\.(js|py)$/.test(f); });
        var jobs = [];
        if (docs.length && window.KGExtract) {
          // KGExtract 内部按 extractLog sig 跳过未变更文件，这里只需触发（新文件必为未缓存）
          jobs.push(KGExtract.run({}).then(function (r) { _log('文档增量提取完成'); }).catch(function (e) { _log('文档提取失败: ' + e.message); }));
        }
        if (codes.length && window.KGCode) {
          jobs.push(KGCode.run({}).then(function (r) { _log('代码增量提取完成: ' + (r.changed || []).length + ' 文件变更'); }).catch(function (e) { _log('代码提取失败: ' + e.message); }));
        }
        return Promise.all(jobs).then(function () {
          state.lastCommit = head;
          state.lastRun = Date.now();
          if (window.KGView) KGView.refresh();
          // 置信度衰减
          decay();
          _log('增量更新完成（docs:' + docs.length + ' codes:' + codes.length + '）');
        });
      });
    }).catch(function (e) { _log('检查异常: ' + e.message); })
      .then(function () { state.checking = false; });
  }

  // ---------- 置信度衰减（防膨胀） ----------
  function decay() {
    try {
      var data = KGData.exportAll() || {};
      var ents = data.entities || {};
      var now = Date.now();
      var changed = 0;
      Object.keys(ents).forEach(function (k) {
        var e = ents[k];
        if (e.updated && now - e.updated > DECAY_DAYS * 86400000 && (e.confidence || 0) > 0.3) {
          e.confidence = (e.confidence || 0.5) * 0.9;
          changed++;
        }
      });
      if (changed) { KGData.importAll({ entities: ents }); _log('置信度衰减: ' + changed + ' 个长期未更新实体'); }
    } catch (e) {}
  }

  // ---------- 对话结论注入（可选钩子） ----------
  function addConclusion(text, source) {
    if (!window.KGData || !text) return false;
    return KGData.upsertEntity({ name: text.slice(0, 60), type: 'concept', desc: text, source: source || '对话结论' });
  }

  function start() {
    if (state.timer) return;
    state.timer = setInterval(check, POLL_MS);
    _log('监听已启动（每 ' + (POLL_MS / 60000) + ' 分钟检查 git 提交）');
    check(); // 启动即建立基线
  }
  function stop() { if (state.timer) { clearInterval(state.timer); state.timer = null; _log('监听已停止'); } }

  window.KGWatch = {
    start: start, stop: stop, check: check, addConclusion: addConclusion,
    status: function () { return { running: !!state.timer, lastCommit: state.lastCommit, lastRun: state.lastRun, log: state.log.slice(0, 20) }; }
  };

  // 自动启动（等 KGData 就绪）
  function boot(retries) {
    if (window.KGData) { start(); return; }
    if ((retries || 0) < 20) setTimeout(function () { boot((retries || 0) + 1); }, 500);
    else _log('KGData 未加载，监听未启动');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { boot(); });
  else boot();
})();
