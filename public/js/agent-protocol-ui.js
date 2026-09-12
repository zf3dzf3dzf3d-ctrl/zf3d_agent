/* agent-protocol-ui.js v2 —— 协议/挡位可视化增强：分段选择器+状态徽章+探测记录 */
(function () {
  'use strict';
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var MODE_NAME = { truncate: '✂️ 截断', minimal: '💡 极简保留', full: '📚 全保留' };
  var PROTO_NAME = { auto: '🎯 自动探测', responses: '⚡ Responses', chat: '🔌 Chat' };
  var TIP = {
    auto: '自动探测：endpoint 支持 Responses API 就优先用（推理链保留最完整），否则回退 Chat Completions。',
    responses: '强制 Responses API（/v1/responses）。',
    chat: '强制 Chat Completions（/v1/chat/completions），兼容性最好。',
    truncate: '每轮只带最近消息，最省 token。',
    minimal: '额外保留最近 2 轮 + 思考要点摘要，推理更连贯。',
    full: '完整保留推理链（仅 Responses API 生效，chat 协议自动退化为截断）。'
  };
  var state = { cfg: null, busy: false, probes: [], probeShown: false };

  function api(path, method, body) {
    return fetch(path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json(); });
  }

  function seg(cls, attr, opts, cur) {
    var h = '<div style="display:flex;margin-bottom:8px;">';
    opts.forEach(function (k, i) {
      var on = k === cur;
      var r = i === 0 ? '6px 0 0 6px' : (i === opts.length - 1 ? '0 6px 6px 0' : '0');
      var name = cls === 'proto' ? (PROTO_NAME[k] || k) : (MODE_NAME[k] || k);
      h += '<div ' + attr + '="' + k + '" style="flex:1;text-align:center;padding:7px 0;font-size:12px;'
        + 'cursor:pointer;border:1px solid ' + (on ? '#5b8cff' : '#3a3a4a')
        + ';border-left-width:' + (i ? '0' : '1px') + ';border-radius:' + r + ';'
        + 'background:' + (on ? 'linear-gradient(180deg,#33406b,#2a3352)' : '#24242f') + ';'
        + 'color:' + (on ? '#fff' : '#9a9ab0') + ';">' + name + (on ? ' ✓' : '') + '</div>';
    });
    return h + '</div>';
  }

  function badgeHtml() {
    if (!state.probes.length) return '<span style="font-size:11px;color:#8a8aa0;">暂无探测记录</span>';
    var p = state.probes[0];
    var ok = p.protocol === 'responses';
    var c = ok ? '#3dd68c' : '#e8b339';
    var age = p.age_s != null ? ' · ' + p.age_s + 's前' : '';
    return '<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;color:' + c + ';">'
      + '<span style="width:8px;height:8px;border-radius:50%;background:' + c + ';box-shadow:0 0 6px ' + c + ';"></span>'
      + esc(p.url) + ' → ' + (ok ? 'Responses ✓' : 'Chat') + esc(age) + '</span>';
  }

  function probeListHtml() {
    if (!state.probes.length)
      return '<div style="font-size:11px;color:#8a8aa0;">Agent 运行时会对所用 endpoint 自动探测；也可点「刷新探测」。</div>';
    return state.probes.slice(0, 6).map(function (p) {
      var ok = p.protocol === 'responses';
      var c = ok ? '#3dd68c' : '#e8b339';
      return '<div style="display:flex;gap:8px;align-items:center;padding:4px 0;border-bottom:1px dashed #2c2c3a;font-size:11px;">'
        + '<span style="width:7px;height:7px;border-radius:50%;background:' + c + ';flex:none;"></span>'
        + '<span style="flex:1;color:#c8c8d8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(p.url) + '</span>'
        + '<span style="color:' + c + ';flex:none;">' + (ok ? 'Responses' : 'Chat') + '</span>'
        + (p.age_s != null ? '<span style="color:#8a8aa0;flex:none;">' + p.age_s + 's前</span>' : '')
        + '</div>';
    }).join('');
  }
  function sectionHtml(cfg) {
    return '<div id="zf-ap-sec" style="margin-top:14px;padding:12px;border:1px solid #3a3a4a;border-radius:8px;background:#1b1b24;">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;">'
      + '<div style="font-size:13px;font-weight:600;color:#e8e8f0;white-space:nowrap;">⚙️ Agent 接口协议</div>'
      + '<div id="zf-ap-badge" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + badgeHtml() + '</div></div>'
      + '<div style="font-size:12px;color:#9a9ab0;margin-bottom:4px;">接口协议</div>'
      + '<div id="zf-ap-proto">' + seg('proto', 'data-zf-proto', cfg.protocol_options || ['auto', 'responses', 'chat'], cfg.protocol || 'auto') + '</div>'
      + '<div id="zf-ap-prototip" style="font-size:11px;color:#7d8db0;min-height:15px;margin-bottom:6px;">' + esc(TIP[cfg.protocol || 'auto']) + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '<button id="zf-ap-save" style="padding:6px 16px;background:#5b8cff;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;">保存</button>'
      + '<button id="zf-ap-probe" style="padding:6px 14px;background:#2a2a38;color:#c8c8d8;border:1px solid #3a3a4a;border-radius:6px;font-size:12px;cursor:pointer;">' + (state.probeShown ? '隐藏记录' : '刷新探测') + '</button>'
      + '<span id="zf-ap-status" style="font-size:11px;color:#8a8aa0;"></span></div>'
      + '<div id="zf-ap-probes" style="margin-top:10px;' + (state.probeShown ? '' : 'display:none;') + 'padding-top:8px;border-top:1px solid #2c2c3a;">'
      + '<div style="font-size:11px;color:#8a8aa0;margin-bottom:4px;">endpoint 探测记录（Responses ✓ = 支持推理链保留）</div>'
      + '<div id="zf-ap-probe-list">' + probeListHtml() + '</div></div>'
      + '</div>';
  }

  function bind() {
    var sec = document.getElementById('zf-ap-sec');
    if (!sec) return;
    sec.addEventListener('click', function (ev) {
      var seg = ev.target.closest('[data-zf-mode],[data-zf-proto]');
      if (seg && state.cfg) {
        if (seg.hasAttribute('data-zf-proto')) state.cfg.protocol = seg.getAttribute('data-zf-proto');
        rerender();
        return;
      }
      if (ev.target.id === 'zf-ap-save') doSave();
      if (ev.target.id === 'zf-ap-probe') doProbe();
    });
  }

  function rerender() {
    var sec = document.getElementById('zf-ap-sec');
    if (!sec) return;
    var cfg = state.cfg || { protocol: 'auto' };
    sec.outerHTML = sectionHtml(cfg);
    bind();
  }

  function setStatus(txt, color) {
    var el = document.getElementById('zf-ap-status');
    if (el) { el.textContent = txt || ''; el.style.color = color || '#8a8aa0'; }
  }

  function refreshProbes() {
    api('/api/agent/protocol/probe', 'POST', {}).then(function (res) {
      if (res && res.ok) {
        state.probes = (res.results || []).slice(0, 6);
        state.probeShown = true;
        rerender();
      }
    }).catch(function () {});
  }

  function doSave() {
    if (state.busy || !state.cfg) return;
    state.busy = true;
    setStatus('保存中…', '#e8b339');
    api('/api/agent/protocol', 'POST', { protocol: state.cfg.protocol, ctx_mode: state.cfg.ctx_mode })
      .then(function (res) {
        state.busy = false;
        if (res && res.ok) {
          state.cfg = res.config;
          setStatus('✅ 已保存，下一轮立即生效', '#3dd68c');
          rerender();
          setTimeout(function () { setStatus('', ''); }, 2500);
        } else setStatus('❌ 保存失败：' + ((res && res.error) || ''), '#ff6b6b');
      })
      .catch(function () { state.busy = false; setStatus('❌ 网络错误', '#ff6b6b'); });
  }

  function doProbe() {
    if (state.busy) return;
    if (state.probeShown) { state.probeShown = false; rerender(); return; }
    state.busy = true;
    setStatus('探测中…（读缓存，不发上游请求）', '#e8b339');
    refreshProbes();
    setTimeout(function () { state.busy = false; setStatus('', ''); }, 1200);
  }

  function mountInto(mount) {
    if (!mount || document.getElementById('zf-ap-sec')) return;
    mount.insertAdjacentHTML('beforeend', sectionHtml(state.cfg || { protocol: 'auto' }));
    bind();
    refreshProbes();
  }

  function patch() {
    if (!window.App || typeof window.App.renderModelPanel !== 'function' || window.App.__protoPatched2) return false;
    var orig = window.App.renderModelPanel;
    window.App.renderModelPanel = function (rootEl) {
      try { orig.apply(this, arguments); } catch (e) {}
      try { mountInto(rootEl && rootEl.querySelector ? rootEl : null); } catch (e) {}
    };
    window.App.__protoPatched2 = true;
    return true;
  }
  (function poll() {
    if (patch()) return;
    var tries = 0;
    (function loop() { if (!patch() && ++tries < 40) setTimeout(loop, 250); })();
  })();

})();
