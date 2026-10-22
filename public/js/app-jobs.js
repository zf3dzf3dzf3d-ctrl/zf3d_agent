/* 后台 Jobs 无人值守监控面板（方案A 自包含）
 * 零改后端：对接 /api/jobs 五接口。轮询守三铁律：≥3s + hidden暂停 + 单发去重 + 失败退避8s。
 */
(function () {
  'use strict';

  // ---- 后端契约：状态着色（与 mixin_jobs 状态机对齐）----
  var STATUS_UI = {
    queued:   { t: '排队中', c: '#5a6b8c' },
    running:  { t: '运行中', c: '#3a7d5c' },
    done:     { t: '已完成', c: '#4a7a4a' },
    await_review: { t: '待审核', c: '#8a6d2b' },
    failed:   { t: '失败',   c: '#8a3a3a' }
  };

  function esc(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function stInfo(st) { return STATUS_UI[st] || { t: st || '未知', c: '#666' }; }

  // [P2] 流水线阶段序列（与 swarm_pipeline note_stage 名对齐；planning 不单独记录故不计）
  var STAGE_SEQ = [
    { key: 'converge', t: '收口' },
    { key: 'decision_gate', t: '决策门' },
    { key: 'build', t: '施工' },
    { key: 'review', t: '审核' },
    { key: 'summary', t: '总结' }
  ];
  // 依 cfg 推算本次「预期会跑的阶段」（关策划→无 gate/summary 视 cfg 而定）
  function expectedStages(cfg) {
    cfg = cfg || {};
    return STAGE_SEQ.filter(function (s) {
      if (s.key === 'decision_gate') return !!cfg.decision_gate;
      if (s.key === 'summary') return !!cfg.summarize;
      return true;
    });
  }
  function renderStageBar(cfg, doneArr, status) {
    var doneSet = {}; (doneArr || []).forEach(function (k) { doneSet[k] = 1; });
    var exp = expectedStages(cfg);
    var total = exp.length, hit = exp.filter(function (s) { return doneSet[s.key]; }).length;
    var pct = total ? Math.round(hit / total * 100) : 0;
    var live = (status === 'running' || status === 'queued');
    var cells = exp.map(function (s) {
      var on = doneSet[s.key] ? ' on' : '';
      return '<span class="sg' + on + '" title="' + esc(s.t) + '">' + esc(s.t) + '</span>';
    }).join('');
    return '<div class="zf-jobs-stage">' +
      '<div class="sg-track"><div class="sg-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="sg-cells">' + cells + '</div>' +
      '<div class="sg-note">' + (live ? '进行中 · 阶段明细将在结束时产生' : ('完成 ' + hit + '/' + total + ' 阶段（' + pct + '%）')) + '</div>' +
      '</div>';
  }
  function fmtTime(ts) {
    if (!ts) return '-';
    try { return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false }); }
    catch (e) { return String(ts); }
  }

  // ---- API 封装 ----
  var API = {
    base: '',
    _get: function (url) {
      return fetch(url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    },
    list: function () { return API._get('/api/jobs'); },
    detail: function (id) { return API._get('/api/jobs/' + id); },
    transcript: function (id) { return API._get('/api/jobs/' + id + '/transcript'); },
    submit: function (payload) {
      return fetch('/api/jobs/submit', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); });
    },
    resume: function (id, verdict) {
      return fetch('/api/jobs/' + id + '/resume', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verdict: verdict })
      }).then(function (r) { return r.json(); });
    }
  };

  // ---- 轮询引擎（三铁律）----
  var Poll = {
    timer: null, interval: 3000, backoff: 8000,
    inFlight: false, failCount: 0, enabled: true, _tick: function () {
      if (!Jobs.visible || !Poll.enabled) return;          // 铁律1：面板隐藏即停
      if (document.hidden) return;                          // 铁律2：后台标签页即停
      if (Poll.inFlight) return;                            // 铁律3：单发去重
      Poll.inFlight = true;
      API.list().then(function (d) {
        Poll.failCount = 0;
        Jobs.renderList((d && d.jobs) || []);
        // [P1] 选中任务且停在对话流 Tab 时，随轮询增量刷新 transcript（复用列表节奏，三铁律已兜底并发/退避）
        if (Jobs.tab === 'transcript' && Jobs.selId) Jobs.loadTranscript(Jobs.selId);
      }).catch(function () {
        Poll.failCount++;                                   // 失败退避：连错拉长到8s
      }).then(function () {
        Poll.inFlight = false;
        clearTimeout(Poll.timer);
        var wait = Poll.failCount >= 2 ? Poll.backoff : Poll.interval;
        Poll.timer = setTimeout(Poll._tick, wait);
      });
    },
    start: function () { clearTimeout(Poll.timer); Poll._tick(); },
    stop: function () { clearTimeout(Poll.timer); }
  };

  // ---- 主控制器 ----
  var Jobs = {
    visible: false, list: [], selId: null, tab: 'overview',
    _trCache: {}, _openTr: {},
    filterStatus: 'all', keyword: '',   // [P2] 列表筛选 + 搜索

    init: function () {
      // 【2026 调整】监控入口从右下角悬浮 FAB 收进左上角文件菜单（高级功能不再占常驻入口），
      // 对外暴露 window.JobsPanel 供 app-undo.js 文件菜单调用。
      this._injectDrawer();
      this._injectModal();
      window.JobsPanel = this;
      var self = this;
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && self.visible) Poll.start();
      });
    },

    _injectDrawer: function () {
      var d = document.createElement('div');
      d.id = 'zfJobsDrawer';
      d.innerHTML =
        '<div class="zf-jobs-bar">' +
          '<h3>后台任务</h3>' +
          '<label class="zf-jobs-toggle"><input type="checkbox" id="zfJobsAuto" checked> 自动刷新</label>' +
          '<button class="zf-jobs-btn" id="zfJobsRefresh">刷新</button>' +
          '<button class="zf-jobs-btn primary" id="zfJobsNew">+ 新建</button>' +
          '<button class="zf-jobs-btn" id="zfJobsClose">✕</button>' +
        '</div>' +
        '<div class="zf-jobs-filter">' +
          '<select id="zfJobsFilter" class="zf-jobs-select">' +
            '<option value="all">全部状态</option>' +
            '<option value="queued">排队中</option>' +
            '<option value="running">运行中</option>' +
            '<option value="await_review">待审核</option>' +
            '<option value="done">已完成</option>' +
            '<option value="failed">失败</option>' +
          '</select>' +
          '<input type="text" id="zfJobsSearch" class="zf-jobs-search" placeholder="搜索目标/ID…">' +
        '</div>' +
        '<div class="zf-jobs-list" id="zfJobsList"><div class="zf-jobs-empty">加载中…</div></div>' +
        '<div class="zf-jobs-detail" id="zfJobsDetail"></div>';
      document.body.appendChild(d);
      var self = this;
      document.getElementById('zfJobsClose').addEventListener('click', function () { self.toggle(false); });
      document.getElementById('zfJobsRefresh').addEventListener('click', function () { Poll._tick(); });
      document.getElementById('zfJobsNew').addEventListener('click', function () { self.openModal(); });
      document.getElementById('zfJobsAuto').addEventListener('change', function (e) {
        Poll.enabled = e.target.checked; if (Poll.enabled) Poll.start();
      });
      // [P2] 筛选 + 搜索：改条件即本地重渲染当前列表（不额外打后端）
      document.getElementById('zfJobsFilter').addEventListener('change', function (e) {
        Jobs.filterStatus = e.target.value; Jobs.renderList(Jobs.list);
      });
      document.getElementById('zfJobsSearch').addEventListener('input', function (e) {
        Jobs.keyword = (e.target.value || '').trim().toLowerCase(); Jobs.renderList(Jobs.list);
      });
    },

    _injectModal: function () {
      var m = document.createElement('div');
      m.id = 'zfJobsModal';
      m.innerHTML =
        '<div class="zf-jobs-form">' +
          '<h4>新建后台任务</h4>' +
          '<label>目标 goal*<br><textarea id="jGoal" rows="3" placeholder="要后台自动完成的任务描述"></textarea></label>' +
          '<div class="row3">' +
            '<div><label>策划者<br><input type="text" id="jPlanners" value="2"></label></div>' +
            '<div><label>施工者<br><input type="text" id="jBuilders" value="1"></label></div>' +
            '<div><label>审核者<br><input type="text" id="jReviewers" value="2"></label></div>' +
          '</div>' +
          '<div class="adv">' +
            '<div class="sw"><input type="checkbox" id="jSummarize" checked> 生成总结</div>' +
            '<div class="sw"><input type="checkbox" id="jGate"> 决策门（跑完停下等审核）</div>' +
            '<div class="row3">' +
              '<div><label>最大审核轮<br><input type="text" id="jMaxRounds" value="2"></label></div>' +
              '<div><label>通过分<br><input type="text" id="jPassScore" value="80"></label></div>' +
            '</div>' +
            '<label>上下文 context（可选）<br><textarea id="jContext" rows="2"></textarea></label>' +
          '</div>' +
          '<div class="acts"><button class="zf-jobs-btn" id="jCancel">取消</button>' +
          '<button class="zf-jobs-btn primary" id="jSubmit">提交</button></div>' +
        '</div>';
      document.body.appendChild(m);
      var self = this;
      document.getElementById('jCancel').addEventListener('click', function () { m.classList.remove('open'); });
      document.getElementById('jSubmit').addEventListener('click', function () { self.doSubmit(); });
      m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('open'); });
    },

    toggle: function (force) {
      this.visible = (force === undefined) ? !this.visible : force;
      document.getElementById('zfJobsDrawer').classList.toggle('open', this.visible);
      if (this.visible) { Poll.start(); } else { Poll.stop(); }
    },

    renderList: function (jobs) {
      this.list = jobs || [];
      var box = document.getElementById('zfJobsList');
      var badge = null; // FAB 已移除，badge 逻辑保留空操作兼容
      var active = this.list.filter(function (j) { return j.status === 'queued' || j.status === 'running' || j.status === 'await_review'; }).length;
      // 角标改为反映在文件菜单入口提示（无常驻按钮则跳过）
      if (badge) { badge.style.display = active ? 'block' : 'none'; badge.textContent = active; }
      var self = this;
      // [P2] 应用状态筛选 + 关键词搜索（仅影响视图；badge 计数仍基于完整 list）
      var view = this.list.filter(function (j) {
        if (self.filterStatus && self.filterStatus !== 'all' && j.status !== self.filterStatus) return false;
        if (self.keyword) {
          var g = (j.goal || '').toLowerCase(), id = String(j.id || '').toLowerCase();
          if (g.indexOf(self.keyword) < 0 && id.indexOf(self.keyword) < 0) return false;
        }
        return true;
      });
      if (!view.length) { box.innerHTML = '<div class="zf-jobs-empty">' + (this.list.length ? '无匹配任务，调整筛选/搜索试试' : '暂无任务，点「+ 新建」发一个') + '</div>'; return; }
      var html = '';
      view.forEach(function (j) {
        var si = stInfo(j.status);
        var goal = j.goal || '(无目标)';
        html += '<div class="zf-jobs-card' + (j.id === self.selId ? ' sel' : '') + '" data-id="' + esc(j.id) + '">' +
          '<div class="zf-jobs-goal">' + esc(goal.length > 60 ? goal.slice(0, 60) + '…' : goal) + '</div>' +
          '<div class="zf-jobs-meta">' +
            '<span class="zf-jobs-st" style="background:' + si.c + '">' + si.t + '</span>' +
            '<span>#' + esc(j.id) + '</span>' +
            '<span>' + fmtTime(j.created_at) + '</span>' +
            (j.error ? '<span style="color:#8a3a3a">⚠</span>' : '') +
          '</div></div>';
      });
      box.innerHTML = html;
      Array.prototype.forEach.call(box.querySelectorAll('.zf-jobs-card'), function (c) {
        c.addEventListener('click', function () { self.select(c.getAttribute('data-id')); });
      });
    },

    // [P2] transcript 角色配色映射（按关键词归类，未知角色回退灰）
    roleClass: function (role) {
      var r = (role || '').toLowerCase();
      if (/(user|用户|human)/.test(r)) return 'r-user';
      if (/(agent|builder|施工|planner|策划|assistant)/.test(r)) return 'r-build';
      if (/(review|审核|critic|audit)/.test(r)) return 'r-review';
      if (/(system|系统|tool|工具)/.test(r)) return 'r-system';
      return 'r-unknown';
    },

    select: function (id) {
      this.selId = id; this.tab = 'overview';
      this.renderList(this.list);
      var box = document.getElementById('zfJobsDetail');
      box.classList.add('show'); box.innerHTML = '<div class="zf-jobs-empty">加载中…</div>';
      var self = this;
      API.detail(id).then(function (d) { self.renderDetail((d && d.job) || {}, box); })
        .catch(function () { box.innerHTML = '<div class="zf-jobs-empty">详情加载失败</div>'; });
    },

    renderDetail: function (job, box) {
      var self = this, si = stInfo(job.status);
      var rep = '';
      try { rep = job.report_json ? (typeof job.report_json === 'string' ? JSON.parse(job.report_json) : job.report_json) : null; } catch (e) { rep = null; }
      var head =
        '<div class="zf-jobs-tabs">' +
          '<span class="zf-jobs-tab' + (this.tab === 'overview' ? ' sel' : '') + '" data-tab="overview">概要</span>' +
          '<span class="zf-jobs-tab' + (this.tab === 'transcript' ? ' sel' : '') + '" data-tab="transcript">对话流</span>' +
        '</div>';
      var body = '';
      if (this.tab === 'overview') {
        body =
          '<div class="zf-jobs-kv">' +
            '<span class="k">状态</span><span style="color:' + si.c + '">' + si.t + '</span>' +
            '<span class="k">目标</span><span>' + esc(job.goal) + '</span>' +
            '<span class="k">会话</span><span>' + esc(job.session_id || '-') + '</span>' +
            '<span class="k">创建</span><span>' + fmtTime(job.created_at) + '</span>' +
            '<span class="k">更新</span><span>' + fmtTime(job.updated_at) + '</span>' +
          '</div>' +
          (typeof renderStageBar === 'function' ? renderStageBar(job.cfg, (rep && rep.stages_done) || [], job.status) : '') +
          (job.error ? '<div style="color:#8a3a3a;margin-bottom:8px">错误：' + esc(job.error) + '</div>' : '') +
          (rep ? '<pre style="white-space:pre-wrap;font-size:12px;background:#111;border:1px solid #1a1a1f;border-radius:6px;padding:8px">' + esc(JSON.stringify(rep, null, 2)) + '</pre>' : '<div class="zf-jobs-empty">无总结产出</div>');
      } else {
        body = '<div class="zf-jobs-transcript" id="zfTrBox">加载中…</div>';
      }
      // [P1 审核续跑回路] await_review 状态：在概要先追加裁决续跑区
      if (this.tab === 'overview' && job.status === 'await_review') {
        body +=
          '<div class="zf-jobs-resume">' +
            '<div class="rz-title">⏸ 任务停在审核门，填写你的裁决后点「续跑」，后台将跳过策划/收口直接施工→审核→总结。</div>' +
            '<textarea id="jVerdict" rows="3" placeholder="例如：方向可以，但请补充错误处理；或：按 A 方案继续"></textarea>' +
            '<div class="rz-acts"><button class="zf-jobs-btn primary" id="jResumeBtn">▶ 提交裁决并续跑</button>' +
            '<span class="rz-hint" id="jResumeHint"></span></div>' +
          '</div>';
      }
      // [P2 失败重跑] failed 状态：复用原 cfg 一键重跑（新 job_id + 新 session，避免污染旧对话流）
      if (this.tab === 'overview' && job.status === 'failed') {
        body += '<div class="zf-jobs-retry">' +
          '<button class="zf-jobs-btn primary" id="jRetryBtn">↻ 按原配置重跑</button>' +
          '<span class="rz-hint" id="jRetryHint"></span></div>';
      }
      box.innerHTML = head + body;
      // 续跑按钮绑定
      var rb = box.querySelector('#jResumeBtn');
      if (rb) {
        rb.addEventListener('click', function () {
          var v = (document.getElementById('jVerdict') || {}).value || '';
          v = v.trim();
          var hint = document.getElementById('jResumeHint');
          if (!v) { if (hint) hint.textContent = '请先填写裁决'; return; }
          rb.disabled = true; if (hint) hint.textContent = '提交中…';
          API.resume(job.id, v).then(function (r) {
            if (r && r.ok) {
              if (hint) hint.textContent = '✓ 已续跑，状态转 queued';
              Poll.start(); self.renderList(self.list); self.select(job.id);
            } else {
              rb.disabled = false;
              if (hint) hint.textContent = '✕ ' + (r && r.error || '续跑失败');
            }
          }).catch(function (e) {
            rb.disabled = false; if (hint) hint.textContent = '✕ 异常：' + e.message;
          });
        });
      }
      // 失败重跑按钮绑定：复用 job.cfg（后端 detail 已透出）提交新任务
      var rbtn = box.querySelector('#jRetryBtn');
      if (rbtn) {
        rbtn.addEventListener('click', function () {
          var cfg = job.cfg || {};
          var hint = document.getElementById('jRetryHint');
          var payload = {
            goal: cfg.goal || job.goal || '',
            planners: cfg.planners || 0, builders: cfg.builders || 0, reviewers: cfg.reviewers || 0,
            summarize: !!cfg.summarize, decision_gate: !!cfg.decision_gate,
            max_review_rounds: cfg.max_review_rounds || 2, review_pass_score: cfg.review_pass_score || 80
          };
          if (cfg.context) payload.context = cfg.context;
          if (!payload.goal) { if (hint) hint.textContent = '✕ 缺目标无法重跑'; return; }
          rbtn.disabled = true; if (hint) hint.textContent = '重跑提交中…';
          API.submit(payload).then(function (r) {
            if (r && r.ok) { if (hint) hint.textContent = '✓ 已重跑（新任务 #' + (r.job_id || '') + '）'; Poll.start(); if (r.job_id) self.select(r.job_id); }
            else { rbtn.disabled = false; if (hint) hint.textContent = '✕ ' + (r && r.error || '重跑失败'); }
          }).catch(function (e) { rbtn.disabled = false; if (hint) hint.textContent = '✕ 异常：' + e.message; });
        });
      }
      Array.prototype.forEach.call(box.querySelectorAll('.zf-jobs-tab'), function (t) {
        t.addEventListener('click', function () { self.tab = t.getAttribute('data-tab'); self.renderDetail(job, box); if (self.tab === 'transcript') self.loadTranscript(job.id); });
      });
      if (this.tab === 'transcript') this.loadTranscript(job.id);
    },

    loadTranscript: function (id) {
      var box = document.getElementById('zfTrBox'); if (!box) return;
      var self = this;
      API.transcript(id).then(function (d) {
        var turns = (d && d.turns) || [];
        if (!turns.length) { box.innerHTML = '<div class="zf-jobs-empty">暂无对话记录</div>'; return; }
        var LIM = 600, html = '';
        turns.forEach(function (t, i) {
          var c = t.content || '';
          var key = id + ':' + i;
          var open = self._openTr[key];
          var shown = (!open && c.length > LIM) ? c.slice(0, LIM) + '…' : c;
          html += '<div class="tr-row ' + self.roleClass(t.role) + '"><div class="tr-role">' + esc(t.role || '?') + (t.turn_no ? ' · #' + t.turn_no : '') + '</div>' +
            '<div class="tr-body">' + esc(shown) +
            (c.length > LIM ? ' <span class="tr-fold" data-key="' + key + '">' + (open ? '收起' : '展开全文') + '</span>' : '') +
            '</div></div>';
        });
        box.innerHTML = html;
        Array.prototype.forEach.call(box.querySelectorAll('.tr-fold'), function (f) {
          f.addEventListener('click', function () { var k = f.getAttribute('data-key'); self._openTr[k] = !self._openTr[k]; self.loadTranscript(id); });
        });
      }).catch(function () { box.innerHTML = '<div class="zf-jobs-empty">对话流加载失败</div>'; });
    },

    openModal: function () { document.getElementById('zfJobsModal').classList.add('open'); },

    doSubmit: function () {
      var g = document.getElementById('jGoal').value.trim();
      if (!g) { alert('请填写任务目标 goal'); return; }
      var payload = {
        goal: g,
        planners: parseInt(document.getElementById('jPlanners').value, 10) || 0,
        builders: parseInt(document.getElementById('jBuilders').value, 10) || 0,
        reviewers: parseInt(document.getElementById('jReviewers').value, 10) || 0,
        summarize: document.getElementById('jSummarize').checked,
        decision_gate: document.getElementById('jGate').checked,
        max_review_rounds: parseInt(document.getElementById('jMaxRounds').value, 10) || 2,
        review_pass_score: parseInt(document.getElementById('jPassScore').value, 10) || 80
      };
      var ctx = document.getElementById('jContext').value.trim();
      if (ctx) payload.context = ctx;
      var self = this;
      API.submit(payload).then(function (r) {
        document.getElementById('zfJobsModal').classList.remove('open');
        if (r && r.ok) { document.getElementById('jGoal').value = ''; Poll.start(); if (r.job_id) self.select(r.job_id); }
        else alert('提交失败：' + (r && r.error || JSON.stringify(r)));
      }).catch(function (e) { alert('提交异常：' + e.message); });
    }
  };

  function boot() { try { Jobs.init(); } catch (e) { console.error('[app-jobs]', e); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
