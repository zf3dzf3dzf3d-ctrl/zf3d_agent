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

  // [P2] 流水线阶段序列（与 swarm_pipeline note_stage 名对齐）
  // 策划(planning)/反驳(objectors) 阶段后端已补记录，纳入进度条
  var STAGE_SEQ = [
    { key: 'planning', t: '策划' },
    { key: 'converge', t: '收口' },
    { key: 'objectors', t: '反驳' },
    { key: 'decision_gate', t: '决策门' },
    { key: 'build', t: '施工' },
    { key: 'review', t: '审核' },
    { key: 'summary', t: '总结' }
  ];
  // 阶段是否启用：count/布尔/objectors 数字>0 视为开；0/false/缺省 视为关
  function _stageOn(v) {
    if (v == null || v === false) return false;
    if (typeof v === 'number') return v > 0;
    if (typeof v === 'object') return !!(v.count > 0 && v.enabled !== false);
    return !!v;  // true / 非空字符串
  }
  // 依 cfg 推算本次「预期会跑的阶段」（关策划→无 planning/gate/summary 视 cfg 而定）
  function expectedStages(cfg) {
    cfg = cfg || {};
    return STAGE_SEQ.filter(function (s) {
      if (s.key === 'planning') return _stageOn(cfg.planners);
      if (s.key === 'objectors') return _stageOn(cfg.objectors);
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

  // [指挥舱 2026-11-02] 实时耗时（running 时以当前时刻减 updated_at，每秒自刷新由轮询驱动）
  function fmtElapsed(job) {
    if (!job) return '';
    if (job.status !== 'running' && job.status !== 'queued') return '';
    var base = (job.updated_at || job.created_at) * 1000;
    var s = Math.max(0, Math.floor((Date.now() - base) / 1000));
    var m = Math.floor(s / 60), h = Math.floor(m / 60);
    return h > 0 ? (h + '小时' + (m % 60) + '分' + (s % 60) + '秒')
                 : (m > 0 ? (m + '分' + (s % 60) + '秒') : (s + '秒'));
  }
  // [指挥舱] 心跳判活：running 且心跳断 >120s → 黄灯警示（区分"慢"与"僵死"）
  function heartbeatLate(job) {
    if (job.status !== 'running' || !job.heartbeat_at) return false;
    return (Date.now() / 1000 - job.heartbeat_at) > 120;
  }
  var STAGE_CN = { planning: '策划', converge: '收口', objectors: '反驳', decision_gate: '决策门',
                   build: '施工', review: '审核', summary: '总结' };
  // 卡片右侧状态灯 + 当前阶段/实时耗时摘要行
  function cockpitMeta(job) {
    var dot = heartbeatLate(job) ? '<span class="zf-jobs-dot zf-jobs-dot--warn" title="心跳已断' +
      Math.floor(Date.now() / 1000 - (job.heartbeat_at || 0)) + '秒，可能卡死或进程重启"></span>'
      : (job.status === 'running' ? '<span class="zf-jobs-dot zf-jobs-dot--live"></span>' : '');
    var parts = [];
    if (job.status === 'running') {
      var stage = STAGE_CN[job.stage] || '准备中';
      parts.push('阶段:' + stage);
    }
    var el = fmtElapsed(job);
    if (el) parts.push('已运行 ' + el);
    return dot + (parts.length ? '<span class="zf-jobs-live">' + esc(parts.join(' · ')) + '</span>' : '');
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
    },
    upload: function (filename, dataUrl) {
      return fetch('/api/jobs/upload', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: filename, data_b64: dataUrl })
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
      this._bindDrag();
      window.JobsPanel = this;
      this._atts = [];
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
          '<button class="zf-jobs-btn" id="zfJobsClose">✕</button>' +
        '</div>' +
        '<div class="zf-jobs-list" id="zfJobsList"><div class="zf-jobs-empty">加载中…</div></div>';
      document.body.appendChild(d);
      var self = this;
      document.getElementById('zfJobsClose').addEventListener('click', function () { self.toggle(false); });
      // 【2026-11 整合·单栏化】移除独立详情区：点击任务卡片时在卡片下方内联展开详情（含续跑/重跑/对话流），面板只留一个列表
    },

    // 【2026-10-22】拖拽移动抽屉：抓标题栏 h3 拖动，限制不跑出视口；与 resize 缩放并存
    _bindDrag: function () {
      var d = document.getElementById('zfJobsDrawer');
      var h = d.querySelector('.zf-jobs-bar h3');
      var drag = null;
      h.addEventListener('pointerdown', function (e) {
        if (e.target !== h) return;
        var r = d.getBoundingClientRect();
        drag = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
        d.style.right = 'auto';            // 改用 left 定位
        d.classList.add('dragging');
        try { h.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      h.addEventListener('pointermove', function (e) {
        if (!drag) return;
        var nx = Math.max(0, Math.min(window.innerWidth - 120, drag.left + e.clientX - drag.x));
        var ny = Math.max(0, Math.min(window.innerHeight - 60, drag.top + e.clientY - drag.y));
        d.style.left = nx + 'px'; d.style.top = ny + 'px';
      });
      var end = function () { if (drag) { drag = null; d.classList.remove('dragging'); } };
      h.addEventListener('pointerup', end);
      h.addEventListener('pointercancel', end);
    },

    toggle: function (force) {
      this.visible = (force === undefined) ? !this.visible : force;
      document.getElementById('zfJobsDrawer').classList.toggle('open', this.visible);
      if (this.visible) { Poll.start(); }
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
      if (!view.length) { box.innerHTML = '<div class="zf-jobs-empty">' + (this.list.length ? '无匹配任务，调整筛选/搜索试试' : '暂无后台任务') + '</div>'; return; }
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
            cockpitMeta(j) +
            (j.error ? '<span style="color:#8a3a3a">⚠</span>' : '') +
          '</div></div>';
      });
      box.innerHTML = html;
      Array.prototype.forEach.call(box.querySelectorAll('.zf-jobs-card'), function (c) {
        c.addEventListener('click', function () { self.select(c.getAttribute('data-id')); });
      });
      // 【2026-11 单栏化】轮询重绘后，把内联详情容器重新挂回选中卡片之后（保住展开态）
      if (this.selId) {
        var det = document.getElementById('zfJobsDetail');
        var selCard = box.querySelector('.zf-jobs-card[data-id="' + this.selId + '"]');
        if (det && selCard) { selCard.classList.add('sel'); selCard.parentNode.insertBefore(det, selCard.nextSibling); }
        else if (det) { det.parentNode.removeChild(det); }  // 选中任务已从列表消失（被清理），收起详情
      }
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
      // 【2026-11 单栏化】选中=在该卡片下方插入内联详情容器，替换原独立详情区
      this.selId = id; this.tab = 'overview';
      var self = this;
      // 移除旧的内联详情容器
      var old = document.getElementById('zfJobsDetail');
      if (old) old.parentNode.removeChild(old);
      var card = document.querySelector('.zf-jobs-card[data-id="' + id + '"]');
      if (!card) return;
      var box = document.createElement('div');
      box.id = 'zfJobsDetail';
      box.className = 'zf-jobs-detail show';
      card.parentNode.insertBefore(box, card.nextSibling);
      box.innerHTML = '<div class="zf-jobs-empty">加载中…</div>';
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
            objectors: cfg.objectors || 0,
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

    // 【2026-10-22 新增】附件卡片：图片/文本，粘贴或选择文件，可关闭。随任务提交（文本→context，图片→context 引用路径）
    _bindAttEvents: function () {
      var self = this;
      var box = document.getElementById('jAtts');
      var hint = document.getElementById('jAttHint');
      var file = document.getElementById('jFile');
      document.getElementById('jAttPick').addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function (e) {
        Array.prototype.forEach.call(e.target.files || [], function (f) { self._addFileAtt(f); });
        file.value = '';
      });
      // 粘贴：图片→上传成卡片；纯文本→文本卡片
      hint.addEventListener('paste', function (e) {
        var cd = e.clipboardData; if (!cd) return;
        var imgs = Array.prototype.slice.call(cd.items || []).filter(function (it) {
          return it.kind === 'file' && it.type && it.type.indexOf('image/') === 0;
        });
        if (imgs.length) {
          e.preventDefault();
          imgs.forEach(function (it) {
            var f = it.getAsFile(); if (f) self._addFileAtt(f);
          });
          return;
        }
        var txt = cd.getData('text/plain');
        if (txt && txt.trim()) { e.preventDefault(); self._atts.push({ type: 'text', name: '粘贴文本', text: txt }); self._renderAtts(); }
      });
      box.addEventListener('click', function (e) {
        var x = e.target.closest ? e.target.closest('.att-x') : null;
        if (!x) return;
        var i = parseInt(x.getAttribute('data-i'), 10);
        self._atts.splice(i, 1); self._renderAtts();
      });
    },

    _addFileAtt: function (f) {
      var self = this;
      var isImg = (f.type || '').indexOf('image/') === 0;
      if (isImg) {
        var rd = new FileReader();
        rd.onload = function () {
          var att = { type: 'image', name: f.name || 'image.png', dataUrl: rd.result, status: '上传中…' };
          self._atts.push(att); self._renderAtts();
          API.upload(att.name, rd.result).then(function (r) {
            if (r && r.ok) { att.url = r.url; att.status = ''; }
            else { att.status = '上传失败'; }
            self._renderAtts();
          }).catch(function () { att.status = '上传失败'; self._renderAtts(); });
        };
        rd.readAsDataURL(f);
      } else {
        var rd2 = new FileReader();
        rd2.onload = function () {
          self._atts.push({ type: 'text', name: f.name || '文本附件', text: String(rd2.result || '').slice(0, 20000) });
          self._renderAtts();
        };
        rd2.readAsText(f);
      }
    },

    _renderAtts: function () {
      var box = document.getElementById('jAtts'); if (!box) return;
      this._atts = (this._atts || []).filter(Boolean);
      if (!this._atts.length) { box.innerHTML = ''; return; }
      box.innerHTML = this._atts.map(function (a, i) {
        var x = '<button class="att-x" data-i="' + i + '" title="移除">×</button>';
        var cap = '<div class="att-cap">' + esc(a.name || '') + (a.status ? ' · ' + esc(a.status) : '') + '</div>';
        if (a.type === 'image') {
          var src = a.url || a.dataUrl || '';
          return '<div class="zf-jobs-att img">' + x + '<img src="' + src + '">' + cap + '</div>';
        }
        return '<div class="zf-jobs-att txt">' + x + '<div class="att-text">' + esc((a.text || '').slice(0, 160)) + '</div>' + cap + '</div>';
      }).join('');
    },

    doSubmit: function () {
      var g = document.getElementById('jGoal').value.trim();
      // 目标可留空，但必须有附件
      if (!g && !(this._atts && this._atts.length)) { window.zfToast ? zfToast('请填写任务目标，或粘贴/选择附件') : alert('请填写任务目标，或粘贴/选择附件'); return; }
      // [R-2 健壮性] 图片异步上传未完成前禁止提交，避免 context 里 url 为空导致附件丢失
      if ((this._atts || []).some(function (a) { return a.status === '上传中…'; })) { window.zfToast ? zfToast('有附件正在上传，请稍候…') : alert('有附件正在上传，请稍候…'); return; }
      // 【2026-10-28 默认精简】策划/审核/反驳/决策门/总结 默认全 0/关——只跑「施工→审核」，除非用户明确要求
      var payload = {
        goal: g || '(见任务附件)',
        planners: 0,
        builders: 1,
        reviewers: 0,
        objectors: 0,
        summarize: false,
        decision_gate: false,
        review_pass_score: 80,
        max_review_rounds: 8
      };
      // 附件 → 拼进 context（文本原文；图片以落盘路径引用），后端已支持 goal 为空时用 context 兜底
      var atts = this._atts || [];
      if (atts.length) {
        payload.context = atts.map(function (a) {
          if (a.type === 'image') return '[图片附件 ' + (a.url || '(未上传)') + ']';
          return '[文本附件 ' + (a.name || '') + ']\n' + (a.text || '');
        }).join('\n\n');
        payload.attachments = atts.map(function (a) { return { type: a.type, name: a.name, url: a.url || '' }; });
      }
      var self = this;
      var btn = document.getElementById('jSubmit');
      if (btn) { btn.disabled = true; btn.textContent = '提交中…'; }
      var reset = function () { if (btn) { btn.disabled = false; btn.textContent = '提交'; } };
      API.submit(payload).then(function (r) {
        if (r && r.ok) {
          document.getElementById('jGoal').value = '';
          self._atts = []; self._renderAtts();
          Poll.start(); if (r.job_id) self.select(r.job_id);
        } else {
          window.zfToast ? zfToast('提交失败：' + (r && r.error || JSON.stringify(r))) : alert('提交失败：' + (r && r.error || JSON.stringify(r)));
        }
        reset();
      }).catch(function (e) { reset(); window.zfToast ? zfToast('提交异常：' + (e && e.message || e)) : alert('提交异常：' + (e && e.message || e)); });
    }
  };

  function boot() { try { Jobs.init(); } catch (e) { console.error('[app-jobs]', e); } }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
