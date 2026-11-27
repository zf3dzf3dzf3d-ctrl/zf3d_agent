/* ============================================================
 * chatbox-mile-balls.js — 对话顶部四球进化（策划案 v7 显著化升级）
 * 四球：策划 进度 审核 总结 —— 纯文字球（数字直接上球面，去 emoji 层）
 * 蜂群收口采纳：突破师③纯文字球/①②富卡杠杆；反驳师③评分取最新/
 *   ④title改aria防叠显/⑤三位数实测降字号/⑥仅lit呼吸/②seq优先getRound兜底。
 * 铁律：角色返回带真实产出才亮；解析不到不出球；禁止定时器/耗时猜进度。
 *   策划球：正文含「【策划师结论】」→ 球面 #seq（派出序号，data-role-seq 优先，
 *           getRound 兜底；反驳师②：账本 key 未实证，0 时不显示）
 *   进度球：/【工程进度】\s*(\d+)%/ → 球面百分数
 *   审核球：/【(审核|验证|重构|安全|优化)评分】\s*(\d+)/ 同轮取最新 → 球面分数
 *   总结球：正文含「【总结师沉淀】」→ 球面 ✓
 * 三态：hidden→lit→faded；仅 lit 呼吸光晕（反驳师⑥）；faded 保留数字可读。
 * 富弹卡（用户点名）：hover 0.25s 或点击弹自定义卡片；空球有职责说明卡；
 *   Esc/滚轮/点空白关闭，卡片互斥；el.title 移除改 aria-label 防叠显（反驳师④）。
 * ============================================================ */
(function () {
  'use strict';
  var BALLS = [
    { key: 'plan',    ch: '策', name: '策划球', color: '#4da3ff', tag: '【策划师结论】', desc: '策划师返回结论后点亮，球面显示派出轮次 #N' },
    { key: 'progress',ch: '%',  name: '进度球', color: '#4ade80', re: /【工程进度】\s*\**\s*(\d+)\s*\**\s*%/, desc: '推进师汇报工程进度后点亮，球面显示百分数' },
    { key: 'audit',   ch: '审', name: '审核球', color: '#f5c542', re: /【(?:审核|验证|重构|安全|优化)评分】[::]?\s*\**\s*(100|[1-9]?\d|[０-９]+)(?![0-9０-９])/g, desc: '审核/验证/安全/优化师评分后点亮，球面显示分数（≥60 绿 <60 红）' },
    { key: 'summary', ch: '总', name: '总结球', color: '#b18cff', tag: '【总结师沉淀】', desc: '派出总结师即点亮（等待产出），总结产出后球面 ✓' }
  ];

  function _summarize(text, m) {
    // 取锚点行后续 ≤200 字做富卡摘要
    var idx = m.index || 0;
    var seg = text.slice(idx, idx + 220).replace(/\s+/g, ' ').trim();
    return seg.length > 200 ? seg.slice(0, 200) + '…' : seg;
  }

  function _parse(text) {
    if (!text || typeof text !== 'string') return null;
    var found = null;
    BALLS.forEach(function (b) {
      var m = null;
      if (b.tag) { var i = text.lastIndexOf(b.tag); if (i !== -1) m = { index: i, val: null }; }
      else {
        // 反3根治：不再用 BALLS 上共享 /g 正则单例，每次局部创建（反驳师复审第3条）
        var re = new RegExp(b.re.source, 'g');
        var last = null, mm;
        while ((mm = re.exec(text)) !== null) { last = mm; if (mm.index === re.lastIndex) re.lastIndex++; }
        if (last) {
          // v8 真实语料喂测修复：全角数字转半角；进度越界(>100)丢弃防"120%"上球面
          var fv = String(last[1]).replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 65248); });
          var nv = Number(fv);
          if (b.key === 'progress' && (nv < 0 || nv > 100)) return;
          m = { index: last.index, val: fv };
        }
      }
      if (m) {
        if (!found) found = {};
        if (!found[b.key]) found[b.key] = { val: m.val, tip: _summarize(text, m), ts: Date.now() };
      }
    });
    return found;
  }

  function _chatMilestone(chat) {
    if (!chat._milestone) chat._milestone = {};
    return chat._milestone;
  }

  var _scanMiss = 0;

  function _collectChatText(chat) {
    // 增量扫描 chat.history（{role, content} 数组），只拼新增，成本不随轮次线性涨
    var out = '';
    try {
      var hist = chat.history;
      if (!Array.isArray(hist)) { _scanMiss++; return ''; }
      var from = chat._mileScanIdx || 0;
      if (from > hist.length) from = 0;
      for (var i = from; i < hist.length; i++) {
        out += '\n' + String(hist[i].content || hist[i].text || '');
      }
      chat._mileScanIdx = hist.length;
    } catch (e) { _scanMiss++; }
    return out;
  }

  function _roleInfo(box, chat) {
    // 角色名 · #seq · N轮（seq 优先 data-role-seq，getRound 兜底且 0 不显——反驳师②）
    try {
      var bid = box.id || (chat && chat.id) || '';
      var lr = bid ? JSON.parse(localStorage.getItem('zf_role_chat_' + bid) || 'null') : null;
      var seq = box.getAttribute('data-role-seq') || '';
      var rounds = 0;
      try { rounds = (window.ZFNextRound && ZFNextRound.getRound) ? (ZFNextRound.getRound(bid) || 0) : 0; } catch (e2) {}
      var parts = [];
      if (lr && lr.name) parts.push(lr.name);
      if (seq) parts.push('#' + seq);
      else if (rounds > 0) parts.push('第' + rounds + '轮');
      return { text: parts.join(' · '), seq: seq || (rounds > 0 ? String(rounds) : '') };
    } catch (e1) { return { text: '', seq: '' }; }
  }

  function _ensureTrack(header) {
    var row1 = header.querySelector('.chatbox-header-row1') || header;
    var track = row1.querySelector('.zf-mile-track');
    if (track) return track;
    track = document.createElement('div');
    track.className = 'zf-mile-track';
    BALLS.forEach(function (b) {
      var el = document.createElement('div');
      el.className = 'zf-mile-ball zf-mile-' + b.key;
      el.setAttribute('data-state', 'hidden');
      el.setAttribute('aria-label', b.name);
      track.appendChild(el);
    });
    row1.appendChild(track);
    return track;
  }

  // ---------- 富弹卡（M3） ----------
  var _card = null, _cardFor = null, _hoverTimer = null, _leaveTimer = null;

  function _closeCard() {
    if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
    if (_leaveTimer) { clearTimeout(_leaveTimer); _leaveTimer = null; }
    if (_card) { _card.remove(); _card = null; _cardFor = null; }
  }

  function _buildCard(b, d, role, state) {
    /* 【XSS 整改 2026-11-23】role.text 为角色名（用户可控，localStorage 读取），b.name 一并 esc；
       统一走全站唯一实现 ZFMD.escapeHtml，未加载时本地兜底 */
    var _escH = function (s) {
      if (window.ZFMD && ZFMD.escapeHtml) return ZFMD.escapeHtml(s);
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    };
    var rows = [];
    rows.push('<div class="zf-mile-card-t">' + _escH(b.name) + (role.text ? ' · ' + _escH(role.text) : '') + '</div>');
    if (!d) {
      var w = (b.key === 'summary' && state === 'lit') ? '已派出，等待总结产出…' : '尚未点亮 · ' + b.desc;
      rows.push('<div class="zf-mile-card-d">' + w + '</div>');
    } else if (b.key === 'progress') {
      rows.push('<div class="zf-mile-card-d">进度 <b>' + d.val + '%</b></div>');
    } else if (b.key === 'audit') {
      rows.push('<div class="zf-mile-card-d">评分 <b>' + d.val + '</b>（' + (Number(d.val) >= 60 ? '通过' : '未过') + '）</div>');
    } else if (b.key === 'summary') {
      rows.push('<div class="zf-mile-card-d">总结已沉淀 ✓</div>');
    } else {
      rows.push('<div class="zf-mile-card-d">策划结论已出' + (role.seq ? ' · #' + role.seq : '') + '</div>');
    }
    if (d && d.tip) rows.push('<div class="zf-mile-card-s">' + d.tip.replace(/</g, '&lt;') + '</div>');
    if (d && d.ts) rows.push('<div class="zf-mile-card-time">' + new Date(d.ts).toLocaleTimeString() + '</div>');
    return rows.join('');
  }

  // v9 P1兑现：开卡时就近匹配最近 assistant 消息（突破师方案，_parse 零改动）
  // 匹配键：d.tip 前 24 个非空白字符 与 消息文本同规格归一化后前缀比对（实验 9/9 命中）
  function _findSourceMsg(box, d) {
    try {
      if (!d || !d.tip) return null;
      var body = box.querySelector('.chatbox-body') || box;
      var msgs = body.querySelectorAll('.msg.ai');
      if (!msgs.length) return null;
      var norm = function (s) { return String(s || '').replace(/\s+/g, '').slice(0, 24); };
      var key = norm(d.tip);
      if (!key) return null;
      for (var i = msgs.length - 1; i >= 0; i--) {
        if (norm(msgs[i].textContent).indexOf(key) !== -1) return msgs[i];
      }
    } catch (e) {}
    return null;
  }

  function _jumpToSource(msgEl) {
    try {
      if (!msgEl) return;
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.remove('zf-mile-src-flash');
      void msgEl.offsetWidth; // 强制 reflow 重启动画
      msgEl.classList.add('zf-mile-src-flash');
      setTimeout(function () { msgEl.classList.remove('zf-mile-src-flash'); }, 2200);
    } catch (e) {}
  }

  function _openCard(el, b, d, role, state, box) {
    _closeCard();
    _card = document.createElement('div');
    _card.className = 'zf-mile-card zf-mile-card-' + b.key;
    _card.innerHTML = _buildCard(b, d, role, state);
    var src = _findSourceMsg(box, d);
    if (src) {
      var btn = document.createElement('button');
      btn.className = 'zf-mile-card-jump';
      btn.textContent = '查看原文 ↗';
      btn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        _closeCard();
        _jumpToSource(src);
      });
      _card.appendChild(btn);
    }
    // 反驳师复审第1条：卡片自身拦截 click 冒泡，防未来"查看原文"按钮点击冒泡到 document 误关卡（拆地雷）
    _card.addEventListener('click', function (ev) { ev.stopPropagation(); });
    // v10：鼠标在卡上时抵消 mouseleave 的延迟关闭（卡上 hover 保留）
    _card.addEventListener('mouseenter', function () {
      if (_leaveTimer) { clearTimeout(_leaveTimer); _leaveTimer = null; }
    });
    document.body.appendChild(_card);
    _cardFor = el;
    var r = el.getBoundingClientRect(), cw = _card.offsetWidth, ch = _card.offsetHeight;
    // v11 UI师中：窄视口钳制——卡片宽度不超过视口，纵向越界回弹到视口内
    cw = Math.min(cw, window.innerWidth - 16);
    _card.style.maxWidth = (window.innerWidth - 16) + 'px';
    var x = Math.min(Math.max(6, r.left + r.width / 2 - cw / 2), window.innerWidth - cw - 6);
    var y = r.bottom + 8 + ch > window.innerHeight ? Math.max(6, r.top - ch - 8) : r.bottom + 8;
    if (y + ch > window.innerHeight - 6) y = Math.max(6, window.innerHeight - ch - 6);
    _card.style.left = x + 'px';
    _card.style.top = y + 'px';
  }

  function _attachCard(el, getCtx, box) {
    el.addEventListener('mouseenter', function () {
      if (_hoverTimer) clearTimeout(_hoverTimer);
      _hoverTimer = setTimeout(function () { var c = getCtx(); if (c) _openCard(el, c.b, c.d, c.role, c.state, box); }, 250);
    });
    el.addEventListener('mouseleave', function () {
      if (_hoverTimer) { clearTimeout(_hoverTimer); _hoverTimer = null; }
      // v10 反驳师复审第2条：hover 开卡后延迟 300ms 关卡（移到卡上可抵消）
      if (_cardFor === el) {
        if (_leaveTimer) clearTimeout(_leaveTimer);
        _leaveTimer = setTimeout(function () { _leaveTimer = null; _closeCard(); }, 300);
      }
    });
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (_cardFor === el) { _closeCard(); return; }
      var c = getCtx();
      if (c) _openCard(el, c.b, c.d, c.role, c.state, box);
    });
  }

  document.addEventListener('click', function () { _closeCard(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') _closeCard(); });
  // v11 UI师中：滚轮关卡豁免卡内滚动区——用户在摘要区滚动不再误关卡
  document.addEventListener('wheel', function (e) {
    if (_card && e.target && e.target.closest && e.target.closest('.zf-mile-card')) return;
    _closeCard();
  }, { passive: true });

  // ---------- 渲染 ----------
  // 【子对话屏蔽】策划/审核/施工队/自定义/总结师等派生子对话不显示四球系统（用户要求）
  // 判定依据：派出时回填在 chat.el 上的源对话标记（agent-01-project-memory.js 等模块写入）
  function _isSubChat(box) {
    try {
      var el = box && box.el ? box.el : box;
      return !!(el && (el._isThinkerChat || el._isQcChat || el._raceSrcId ||
        el._customSrcId || el._summarizerSrcId || el._plainSrcId || el._objectorSrcId || el._evolutionSrcId)); // _objectorSrcId/_evolutionSrcId 为预留标记（v14 代码师审查：当前无写入点，防御未来新角色派单）
    } catch (e) { return false; }
  }

  function _render(chat) {
    try {
      var box = (typeof App !== 'undefined' && App.getChatBoxEl) ? App.getChatBoxEl(chat) : (chat.el || null);
      if (!box) return;
      var header = box.querySelector('.chatbox-header');
      if (!header) return;
      // 子对话：先移除已挂四球再跳过（v14：判定前移到 _ensureTrack 之前，消“建再删”DOM 抖动——代码师 R1 采纳项）
      if (_isSubChat(box)) { var t = header.querySelector('.zf-mile-track'); if (t) t.remove(); return; }
      var track = _ensureTrack(header);
      if (!track) return;
      var ms = _chatMilestone(chat);
      var role = _roleInfo(box, chat);
      BALLS.forEach(function (b, i) {
        var el = track.children[i];
        var d = ms[b.key];
        var state = d ? (d.prev ? 'faded' : 'lit') : 'hidden';
        if (d && d.prev) { d.prev = null; }
        if (b.key === 'summary' && !d && role.text && /总结/.test(role.text)) { state = 'lit'; }
        el.setAttribute('data-state', state);
        // 球面文字：有数据显示数字/✓，无数据显示底字（纯文字球，突破师③）
        var face = b.ch;
        if (b.key === 'plan' && d && role.seq) face = '#' + role.seq;
        else if (b.key === 'progress' && d) face = d.val;
        else if (b.key === 'audit' && d) face = d.val;
        else if (b.key === 'summary' && d) face = '✓';
        el.textContent = face;
        el.classList.toggle('zf-mile-sm', String(face).length > 2);
        el.setAttribute('aria-label', role.text ? role.text + ' · ' + b.name : b.name); // 反驳师④：不用 title，防与富卡叠显
        if (d && b.key === 'audit') el.classList.toggle('zf-mile-fail', Number(d.val) < 60);
        if (!el._mileCardBound) {
          el._mileCardBound = true;
          _attachCard(el, function () {
            var ms2 = _chatMilestone(chat);
            var dd = ms2[b.key];
            var st = dd ? 'lit' : (b.key === 'summary' && role.text && /总结/.test(role.text) ? 'lit' : 'hidden');
            return { b: b, d: dd, role: role, state: st, box: box };
          }, box);
        }
      });
    } catch (e) {}
  }

  function _merge(ms, found) {
    Object.keys(found).forEach(function (k) {
      if (!ms[k]) { ms[k] = found[k]; }
      else if (bVal(found[k]) !== bVal(ms[k])) { ms[k].prev = true; ms[k] = found[k]; }
    });
  }
  function bVal(d) { return d ? (String(d.val) + '|' + d.tip) : ''; }

  function _ingest(chat, text) {
    var found = _parse(text);
    if (!found || !chat) return;
    _merge(_chatMilestone(chat), found);
    _render(chat);
  }

  function scanAll() {
    try {
      var boxes = (typeof App !== 'undefined' && Array.isArray(App.chatBoxes)) ? App.chatBoxes
        : (window.Store && Store.getChatBoxes ? Store.getChatBoxes() : []);
      if (!Array.isArray(boxes)) return;
      boxes.forEach(function (chat) {
        var text = _collectChatText(chat);
        var found = _parse(text);
        if (found) _merge(_chatMilestone(chat), found);
        _render(chat);
      });
    } catch (e) {}
  }

  function injectStyle() {
    if (document.getElementById('zf-mile-style')) return;
    var st = document.createElement('style');
    st.id = 'zf-mile-style';
    st.textContent =
      '.chatbox-header-row1{position:relative}' +
      '.zf-mile-track{position:absolute;left:50%;transform:translateX(-50%);top:50%;margin-top:-11px;display:flex;gap:7px;align-items:center;pointer-events:none;z-index:5}' +
      /* v12 修复：row1 的 overflow:hidden 会裁剪 22px 球体上下沿，track 改挂 fixed 定位不可行，改为对球本体加 padding 缓冲并显式豁免裁剪 */
      '.chatbox-header-row1 > .zf-mile-track{overflow:visible !important}' +
      '.zf-mile-ball{pointer-events:auto;width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;' +
        'font-size:9.5px;font-weight:700;color:#fff;letter-spacing:-.5px;overflow:hidden;cursor:pointer;user-select:none;' +
        'opacity:.32;filter:grayscale(.75);transition:opacity .25s,filter .25s,box-shadow .25s,transform .15s;background:rgba(255,255,255,.10)}' +
      '.zf-mile-ball.zf-mile-sm{font-size:8px}' +
      '.zf-mile-ball:hover{transform:scale(1.18)}' +
      '.zf-mile-ball[data-state="lit"]{opacity:1;filter:none;animation:zfMileBreath 2s ease-in-out infinite}' +
      '.zf-mile-ball[data-state="faded"]{opacity:.55;filter:none}' +
      /* v11 UI师高：hidden 虚线描边与 faded 半透明形成三态可辨编码 */
      '.zf-mile-ball[data-state="hidden"]{border:1px dashed rgba(255,255,255,.5)}' +
      '@keyframes zfMileBreath{0%,100%{box-shadow:0 0 4px 1px rgba(255,255,255,.2)}50%{box-shadow:0 0 9px 3px rgba(255,255,255,.45)}}' +
      '@media (prefers-reduced-motion: reduce){.zf-mile-ball[data-state="lit"]{animation:none;box-shadow:0 0 6px 2px rgba(255,255,255,.35)}}' +
      '.zf-mile-plan[data-state="lit"]{background:rgba(77,163,255,.85)}' +
      '.zf-mile-progress[data-state="lit"]{background:rgba(74,222,128,.85)}' +
      '.zf-mile-audit[data-state="lit"]{background:rgba(245,197,66,.9)}' +
      '.zf-mile-audit.zf-mile-fail[data-state="lit"]{background:rgba(240,90,90,.9);color:#fff}' +
      /* v11 UI师中：fail 态数字加粗纯白，过 WCAG 对比度 */
      '.zf-mile-audit.zf-mile-fail{font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,.35)}' +
      '.zf-mile-summary[data-state="lit"]{background:rgba(177,140,255,.85)}' +
      '.zf-mile-card{position:fixed;z-index:9999;width:280px;max-width:92vw;max-height:220px;display:flex;flex-direction:column;overflow:hidden;background:#1e2430;color:#e8ecf3;border:1px solid rgba(255,255,255,.14);' +
        'border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.55;box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:auto}' +
        'border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.55;box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:auto}' +
      '.zf-mile-card-t{font-weight:700;font-size:13px;margin-bottom:4px;display:flex;align-items:center}' +
      /* v11 UI师低：卡标题前同色圆点，强化球↔卡颜色映射 */
      '.zf-mile-card-t::before{content:"";width:8px;height:8px;border-radius:50%;margin-right:6px;background:currentColor;flex:none;opacity:.9}' +
      '.zf-mile-card-d b{font-size:14px}' +
      '.zf-mile-card-s{margin-top:4px;color:#b9c2cf;min-height:0;flex:1 1 auto;overflow:auto;word-break:break-all}' +
      '.zf-mile-card-time{margin-top:4px;color:#8a93a0;font-size:11px;flex:none}' +
      'html[data-theme=light] .zf-mile-card{background:#fff;color:#26303e;border-color:rgba(0,0,0,.12)}' +
      'html[data-theme=light] .zf-mile-card-s{color:#5a6572}' +
      'html[data-theme=light] .zf-mile-card-time{color:#98a1ad}' +
      '@media (prefers-color-scheme: light){html:not([data-theme]) .zf-mile-card{background:#fff;color:#26303e;border-color:rgba(0,0,0,.12)}}' +
      /* v11 UI师低：圆点按球色映射 */
      '.zf-mile-card-plan.zf-mile-card-t::before,.zf-mile-card-plan .zf-mile-card-t::before{background:#4da3ff}' +
      '.zf-mile-card-progress .zf-mile-card-t::before{background:#4ade80}' +
      '.zf-mile-card-audit .zf-mile-card-t::before{background:#f5c542}' +
      '.zf-mile-card-summary .zf-mile-card-t::before{background:#b18cff}';
    document.head.appendChild(st);
  }

  injectStyle();
  setInterval(scanAll, 2000);
  document.addEventListener('DOMContentLoaded', scanAll);
  window.ZFMileBalls = { ingest: _ingest, scan: scanAll, parse: _parse, closeCard: _closeCard, get lastScanMiss() { return _scanMiss; } };
})();
