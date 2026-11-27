/* ============================================================
 * zf-sandtable-engine.js —— i进化·全自动沙盘编排引擎（P1）
 * 路线：沙盘协议-v1 + 策划案 v3/v4（M0 已收口，本文件为 P1 施工物）
 *
 * 职责：输入一个研究题目 → 自动按六站顺序派出沙盘师
 *   S1 认知师【认知底稿】 → S2 涌现师【涌现建议】 → S3 策划师【策划案】
 *   → S4 打磨师【打磨意见】 → S5 外力师【可行性评测】 → S6 预演师【预演报告】
 * 每站：设置一次性叮嘱（window._zfCustomNoteNext）→ 调 App._objectorExpand 派出
 *   （S3 策划师走 App._thinkerExpand）→ 轮询新窗 history 等待锚点标签出现
 *   → 切片存档 → 上一站产出注入下一站叮嘱 → 六站全齐后合成终稿 md
 *   → POST /api/fs/text-save 落盘 public/项目记录/策划案-<题目>.md
 *
 * 防线：五沙盘师派出时强制 toolsCategory='只读沙盘'（引擎级只读，见 agent-01 L2790-2793）。
 * 降级：单站轮询超时（默认 120s×5=600s 无产出）→ 暂停并提示用户半自动接管。
 * ============================================================ */
(function () {
  'use strict';
  if (window.ZFSandtable) return; // 防重复注入

  /* ── 六站配置（角色名 ↔ 派出函数 ↔ 锚点标签，契约同沙盘协议-v1） ── */
  var STAGES = [
    { no: 'S1', role: '认知师',     anchor: '【认知底稿】',   expand: '_objectorExpand', tag: '_isCognitiveChat',    cat: '只读沙盘' },
    { no: 'S2', role: '涌现师',     anchor: '【涌现建议】',   expand: '_objectorExpand', tag: '_isEmergenceChat',    cat: '只读沙盘' },
    { no: 'S3', role: '策划师',     anchor: '【策划案】',     expand: '_thinkerExpand',  tag: '_isThinkerChat',      cat: '只读沙盘' }, /* 收口裁决：S3 也纳入只读锁定（安全师【中】项），沙盘红线只出策划案不实际干活 */
    { no: 'S4', role: '打磨师',     anchor: '【打磨意见】',   expand: '_objectorExpand', tag: '_isPolishPlanChat',   cat: '只读沙盘' },
    { no: 'S5', role: '外力师', anchor: '【可行性评测】', expand: '_objectorExpand', tag: '_isExternalCapChat',  cat: '只读沙盘' },
    { no: 'S6', role: '预演师',     anchor: '【预演报告】',   expand: '_objectorExpand', tag: '_isPreplanChat',      cat: '只读沙盘' }
  ];

  var POLL_MS = 3000;          // 轮询间隔
  var POLL_MAX = 40;           // 单站最大轮询次数（40×3s=120s）
  var SECTION_TITLES = {
    'S1': '一、认知底稿（S1 认知师）',
    'S2': '二、涌现建议（S2 涌现师）',
    'S3': '三、策划案（S3 策划师）',
    'S4': '四、打磨意见（S4 打磨师）',
    'S5': '五、可行性评测（S5 外力师）',
    'S6': '六、预演报告（S6 预演师）'
  };

  /* ── 引擎状态（挂 window，刷新页面即丢；断点续跑靠 localStorage） ── */
  var _run = null; // { topic, stageIdx, sections:{S1:text,...}, chatIds:[...], startedAt }

  function _lsKey(topic) { return 'zf_sandtable_' + String(topic).slice(0, 40); }

  function _saveProgress() {
    try { if (_run) localStorage.setItem(_lsKey(_run.topic), JSON.stringify({ topic: _run.topic, stageIdx: _run.stageIdx, sections: _run.sections })); } catch (e) {}
  }
  function _loadProgress(topic) {
    try { return JSON.parse(localStorage.getItem(_lsKey(topic)) || 'null'); } catch (e) { return null; }
  }

  /* ── 日志与进度提示（复用主对话 toast/Store 日志；引擎面板自己也有状态栏） ── */
  function _log(msg, level) {
    try { if (window.Store && Store.addLog) Store.addLog(level || 'info', (_run && _run.hostId) || '', 'sandtable', '[i进化引擎] ' + msg); } catch (e) {}
    try { console.log('[ZFSandtable]', msg); } catch (e2) {}
    _emit(msg);
  }
  function _emit(msg) {
    try {
      var bar = document.querySelector('.zf-sandtable-status');
      if (bar) bar.textContent = msg;
    } catch (e) {}
  }
  function _toast(msg, ok) {
    try { if (window.App && App._stepToast) App._stepToast(msg, ok !== false); } catch (e) {}
  }

  /* ── 派出当前站：设置一次性叮嘱 → 调对应 expand（host=源对话） ── */
  function _dispatchStage(hostChat, st, brief) {
    window._zfCustomNoteNext = { note: brief, ts: Date.now(), imgs: [], pastes: [] };
    var fn = App[st.expand];
    if (typeof fn !== 'function') throw new Error('派出函数不存在：App.' + st.expand);
    // _objectorExpand 读取 cfg 由 crew-panel 传入；直接调用时走 App 上下文（内部读 _zfCustomNoteNext）
    // 注意：_objectorExpand(box, chat) 需要 box 参数——用 hostChat.el
    fn.call(App, hostChat.el, hostChat, st.cat ? { toolsCategory: st.cat } : undefined);
  }

  /* ── 等待某对话产出锚点：轮询 newChat.history 找 assistant 消息含 anchor ── */
  function _waitForAnchor(chatId, anchor, onDone, onTimeout) {
    var n = 0;
    var timer = setInterval(function () {
      n++;
      var txt = _chatText(chatId);
      if (txt && txt.indexOf(anchor) >= 0) {
        clearInterval(timer);
        onDone(txt);
        return;
      }
      if (n >= POLL_MAX) {
        clearInterval(timer);
        onTimeout();
      }
    }, POLL_MS);
    return timer;
  }

  function _chatText(chatId) {
    try {
      var boxes = Store.data.chatBoxes || [];
      for (var i = 0; i < boxes.length; i++) {
        if (String(boxes[i].id) === String(chatId)) {
          var h = boxes[i].history || [];
          var out = [];
          for (var j = 0; j < h.length; j++) {
            if (h[j] && h[j].role === 'assistant' && !h[j]._meta && h[j].content) out.push(String(h[j].content));
          }
          return out.join('\n');
        }
      }
    } catch (e) {}
    return '';
  }

  /* 从全文中切出 anchor 起到下一个锚点/文末的切片 */
  function _slice(txt, anchor) {
    var i = txt.indexOf(anchor);
    if (i < 0) return txt;
    var rest = txt.slice(i);
    // 到下一个【xxx】大标签或文末
    var m = rest.slice(anchor.length).match(/\n【[^】]{2,12}】/);
    return m ? rest.slice(0, anchor.length + m.index) : rest;
  }

  /* ── 站间叮嘱组装：题目 + 上一站产出 ── */
  function _buildBrief(topic, st, prevText) {
    var lines = [];
    lines.push('【i进化沙盘·' + st.no + ' ' + st.role + '】研究题目：' + topic);
    lines.push('输出要求：全文以「' + st.anchor + '」标签开头，围绕题目独立产出，不复述其他站内容。');
    lines.push('铁律：只读研究出报告，禁止写文件/改文件/执行安装；产出以锚点标签为唯一交付载体。');
    if (prevText) {
      lines.push('');
      lines.push('== 上游产出（供参考衔接，不要照抄） ==');
      lines.push(String(prevText).slice(0, 6000));
    }
    return lines.join('\n');
  }

  /* ── 终稿合成与落盘 ── */
  function _finalize(topic) {
    var now = new Date();
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    var ts = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate()) + ' ' + p2(now.getHours()) + ':' + p2(now.getMinutes());
    var md = [];
    md.push('# 策划案：' + topic);
    md.push('');
    md.push('> 由 i进化沙盘引擎（zf-sandtable-engine）全自动六站流水线产出：S1认知→S2涌现→S3策划→S4打磨→S5外部评测→S6预演。');
    md.push('> 产出时间：' + ts + '｜仅沙盘研究，不实际干活。');
    md.push('');
    STAGES.forEach(function (st) {
      md.push('## ' + SECTION_TITLES[st.no]);
      md.push('');
      md.push(_run.sections[st.no] || '（本站无产出）');
      md.push('');
    });
    md.push('---');
    md.push('*终稿由引擎自动合成；各站原文见「调查黑板/沙盘-」系列记录。*');
    var body = md.join('\n');
    var fname = '策划案-' + String(topic).replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 30) + '.md';
    var rel = 'public/项目记录/' + fname;
    fetch('/api/fs/text-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: rel, text: body })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) {
        _log('终稿已落盘：' + rel + '（' + body.length + ' 字节），可在项目记录中直接打开', 'info');
        _toast('🧬 i进化终稿已落盘：' + fname, true);
      } else {
        _log('终稿落盘失败：' + JSON.stringify(j).slice(0, 200), 'error');
        _toast('i进化终稿落盘失败，请查看日志', false);
      }
      try { localStorage.removeItem(_lsKey(topic)); } catch (e) {}
      _run = null;
    }).catch(function (e) {
      _log('终稿落盘异常：' + e.message, 'error');
    });
  }

  /* ── 主循环：跑当前站 → 成功进下一站；全部完成合成终稿 ── */
  function _runStage(topic) {
    if (!_run) return;
    var idx = _run.stageIdx;
    if (idx >= STAGES.length) { _finalize(topic); return; }
    var st = STAGES[idx];
    var hostChat = _run.hostChat;
    var prev = idx > 0 ? (_run.sections[STAGES[idx - 1].no] || '') : '';
    _log(st.no + ' 派出' + st.role + '…（' + (idx + 1) + '/' + STAGES.length + '）');
    _emit('🧬 i进化沙盘「' + topic + '」→ ' + st.no + ' ' + st.role + ' 进行中（' + (idx + 1) + '/' + STAGES.length + '）');
    try {
      _dispatchStage(hostChat, st, _buildBrief(topic, st, prev));
    } catch (e) {
      _log(st.no + ' 派出失败：' + e.message + '，引擎暂停，可半自动接管后从本站续跑', 'error');
      _toast('i进化引擎暂停：' + st.role + ' 派出失败（' + e.message + '）', false);
      return;
    }
    // 记录新窗 id：派出后 Store.data.chatBoxes 末尾新增且带 st.tag 的对话
    setTimeout(function () {
      var newId = _findChatByTag(st.tag, _run.chatIds);
      if (!newId) { _log(st.no + ' 未找到新窗（tag=' + st.tag + '），暂停', 'error'); _toast('i进化引擎暂停：找不到 ' + st.role + ' 新窗', false); return; }
      _run.chatIds.push(newId);
      _waitForAnchor(newId, st.anchor, function (full) {
        _run.sections[st.no] = _slice(full, st.anchor);
        _log(st.no + ' ' + st.role + ' 产出就绪（' + _run.sections[st.no].length + ' 字），已切片存档');
        _saveProgress();
        _run.stageIdx++;
        setTimeout(function () { _runStage(topic); }, 800);
      }, function () {
        _log(st.no + ' 轮询超时（' + (POLL_MAX * POLL_MS / 1000) + 's 无锚点），引擎暂停；产出若后到可续跑直接跳过本站等待', 'warn');
        _toast('i进化引擎暂停：' + st.role + ' 超时，可人工接管后点「继续沙盘」', false);
      });
    }, 1500);
  }

  function _findChatByTag(tag, excludeIds) {
    try {
      var boxes = Store.data.chatBoxes || [];
      for (var i = boxes.length - 1; i >= 0; i--) {
        var b = boxes[i];
        if (b && b.el && b.el[tag] && excludeIds.indexOf(b.id) < 0) return b.id;
      }
    } catch (e) {}
    return null;
  }

  /* ── 对外 API ── */
  window.ZFSandtable = {
    STAGES: STAGES,
    /** 启动沙盘：topic=题目，hostChat=源对话（crew 面板所在对话） */
    start: function (topic, hostChat) {
      topic = String(topic || '').trim();
      if (!topic) { _toast('请先填写研究题目', false); return false; }
      if (_run) { _toast('已有沙盘在跑：' + _run.topic, false); return false; }
      /* hostChat 缺省兜底：按钮单参调用时自选当前活动对话当源，找不到任何可用对话则拒绝启动（防 _dispatchStage 读 hostChat.el 抛 TypeError）
         【修复·未找到可用源对话】必须优先用 App.chatBoxes（页面内存中的"活"对话对象，带 .el DOM），
         Store.data.chatBoxes 是持久化副本（无 .el），判不出可用对话 → 永远报"未找到可用源对话"。同 app-batch-run.js 的已知坑。 */
      if (!hostChat) {
        try {
          var boxes = (window.App && App.chatBoxes && App.chatBoxes.length) ? App.chatBoxes : (Store.data.chatBoxes || []);
          var curId = Store.data.currentId;
          for (var i = 0; i < boxes.length; i++) {
            if (boxes[i] && boxes[i].el && curId != null && String(boxes[i].id) === String(curId)) { hostChat = boxes[i]; break; }
          }
          if (!hostChat) for (var j = 0; j < boxes.length; j++) { if (boxes[j] && boxes[j].el) { hostChat = boxes[j]; break; } }
        } catch (e) {}
      }
      if (!hostChat) { _toast('i进化启动失败：未找到可用源对话', false); return false; }
      if (typeof App === 'undefined' || typeof App._objectorExpand !== 'function') { _toast('引擎不可用：App 派出函数缺失', false); return false; }
      var saved = _loadProgress(topic);
      _run = {
        topic: topic,
        stageIdx: saved ? saved.stageIdx : 0,
        sections: saved ? (saved.sections || {}) : {},
        chatIds: [],
        hostChat: hostChat,
        hostId: hostChat ? hostChat.id : '',
        startedAt: Date.now()
      };
      _toast(saved ? ('🧬 续跑沙盘：从 ' + STAGES[_run.stageIdx].no + ' 继续') : '🧬 i进化沙盘启动：' + topic, true);
      _log(saved ? ('断点续跑：' + topic + ' 从 S' + (_run.stageIdx + 1)) : ('启动全新沙盘：' + topic));
      _mountPanel(hostChat);
      setTimeout(function () { _runStage(topic); }, 600);
      return true;
    },
    /** 超时/失败后续跑 */
    resume: function () {
      if (!_run) { _toast('没有可续跑的沙盘', false); return; }
      _run.stageIdx++; // 跳过卡住的站（产出若后到会被下一站参考语义覆盖，可接受降级）
      _runStage(_run.topic);
    },
    status: function () { return _run ? { topic: _run.topic, stage: STAGES[_run.stageIdx] && STAGES[_run.stageIdx].no, done: Object.keys(_run.sections).length } : null; },
    /* 断点续跑入口：页面刷新后恢复（面板按钮调） */
    resumeSaved: function (topic, hostChat) {
      var saved = _loadProgress(topic);
      if (!saved) { _toast('该题目无存档进度', false); return; }
      this.start(topic, hostChat);
    }
  };

  /* ── 极简状态面板（吸附在源对话窗 body 顶部；有进度条与继续/终止按钮） ── */
  function _mountPanel(hostChat) {
    try {
      if (!hostChat || !hostChat.el) return;
      var body = hostChat.el.querySelector('.chatbox-body');
      if (!body || body.querySelector('.zf-sandtable-panel')) return;
      var panel = document.createElement('div');
      panel.className = 'zf-sandtable-panel';
      panel.style.cssText = 'margin:6px 10px;padding:8px 10px;border:1px solid #7c6ee0;border-radius:8px;background:rgba(124,110,224,.08);font-size:12px;';
      panel.innerHTML =
        '<div style="font-weight:600;margin-bottom:4px;">🧬 i进化沙盘引擎 <span class="zf-sandtable-status" style="font-weight:400;color:#888;">准备中…</span></div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button class="zf-st-resume" style="flex:1;padding:2px 8px;border:1px solid #7c6ee0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;">继续沙盘（跳过卡站）</button>' +
        '<button class="zf-st-stop" style="flex:1;padding:2px 8px;border:1px solid #c66;border-radius:6px;background:transparent;color:inherit;cursor:pointer;">终止</button>' +
        '</div>';
      body.insertBefore(panel, body.firstChild);
      panel.querySelector('.zf-st-resume').addEventListener('click', function () { window.ZFSandtable.resume(); });
      panel.querySelector('.zf-st-stop').addEventListener('click', function () {
        try { localStorage.removeItem(_lsKey(_run.topic)); } catch (e) {}
        _run = null;
        _emit('已终止');
        _toast('i进化沙盘已终止', true);
      });
    } catch (e) {}
  }
})();
