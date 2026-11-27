/* ============================================================
 * API Key 快捷输入对话框 v1.0 (2026-09-10)
 * 用户发送消息时如果当前模型没有配置 API Key，不再只是报错，
 * 而是弹出一个友好的对话框让用户直接输入 Key，并可直接跳转
 * 官网获取。输入确认后立即保存并恢复发送。
 * ============================================================ */
(function(global) {
  'use strict';

  // 各服务商官网地址（按 endpoint / key 前缀智能匹配）
  var PROVIDER_SITES = [
    { match: /ark|volces|doubao|火山/i, name: '火山方舟', url: 'https://console.volcengine.com/ark' },
    { match: /^sk-/ , name: 'OpenAI 兼容渠道', url: 'https://platform.openai.com/api-keys' },
    { match: /deepseek/i, name: 'DeepSeek', url: 'https://platform.deepseek.com/api_keys' },
    { match: /moonshot|kimi/i, name: 'Moonshot(Kimi)', url: 'https://platform.moonshot.cn/console/api-keys' },
    { match: /bigmodel|zhipu|glm/i, name: '智谱AI', url: 'https://open.bigmodel.cn/usercenter/apikeys' },
    { match: /dashscope|qwen|通义/i, name: '阿里云百炼', url: 'https://bailian.console.aliyun.com/?apiKey=1' },
    { match: /siliconflow|硅基/i, name: '硅基流动', url: 'https://cloud.siliconflow.cn/account/ak' },
    { match: /minimax/i, name: 'MiniMax', url: 'https://platform.minimaxi.com/user-center/basic-information/interface-key' },
    { match: /openrouter/i, name: 'OpenRouter', url: 'https://openrouter.ai/keys' }
  ];

  function detectProvider(model) {
    var text = ((model && ((model.name || '') + ' ' + (model.endpoint || '') + ' ' + (model.modelId || ''))) || '');
    for (var i = 0; i < PROVIDER_SITES.length; i++) {
      if (PROVIDER_SITES[i].match.test(text)) return PROVIDER_SITES[i];
    }
    return null;
  }

  // 【修复】模型名等拼接进 innerHTML 前统一转义（防注入）
  function escH(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 检测火山方舟 Ark Key（供保存后自动校正 endpoint）
  function isArkKey(key) { return /^ark-/.test(String(key || '').trim()); }

  function ensureStyles() {
    if (document.getElementById('apiKeyQuickStyle')) return;
    var st = document.createElement('style');
    st.id = 'apiKeyQuickStyle';
    st.textContent = [
      '#apiKeyQuickOverlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;display:flex;align-items:center;justify-content:center;}',
      '#apiKeyQuickOverlay .akq-box{width:440px;max-width:92vw;background:var(--bg2,#1e1f24);color:var(--text,#e8e8e8);border:1px solid var(--border,#3a3b40);border-radius:14px;padding:22px 24px;box-shadow:0 12px 40px rgba(0,0,0,.5);}',
      '#apiKeyQuickOverlay h3{margin:0 0 10px;font-size:16px;}',
      '#apiKeyQuickOverlay .akq-desc{font-size:13px;color:var(--text2,#9a9aa0);margin-bottom:14px;line-height:1.6;}',
      '#apiKeyQuickOverlay input{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid var(--border,#3a3b40);background:var(--bg,#141519);color:var(--text,#e8e8e8);font-size:13px;outline:none;}',
      '#apiKeyQuickOverlay input:focus{border-color:#4a8cff;}',
      '#apiKeyQuickOverlay .akq-err{color:#ff6b6b;font-size:12px;min-height:18px;margin-top:6px;}',
      '#apiKeyQuickOverlay .akq-btns{display:flex;gap:10px;margin-top:14px;justify-content:flex-end;flex-wrap:wrap;}',
      '#apiKeyQuickOverlay button{padding:8px 16px;border-radius:8px;border:1px solid var(--border,#3a3b40);background:var(--bg,#141519);color:var(--text,#e8e8e8);cursor:pointer;font-size:13px;}',
      '#apiKeyQuickOverlay .akq-ok{background:#2f6bff;border-color:#2f6bff;color:#fff;}',
      '#apiKeyQuickOverlay .akq-ok:hover{background:#4a8cff;}',
      '#apiKeyQuickOverlay .akq-site{color:#4a8cff;text-decoration:none;font-size:12px;align-self:center;margin-right:auto;}',
      '#apiKeyQuickOverlay .akq-site:hover{text-decoration:underline;}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // 【2026-11-22】调起官方登录遮罩（index.html 的 zf3dLoginOverlay，与签到登录一致），
  // 登录成功（遮罩关闭）后自动重取 ai-token 开通线路。reasonText 非空时说明为何要登录。
  // 遮罩关闭后若发现中转 Key 仍未下发（relay_key===false，多为用户点了取消），如实提示，
  // 绝不拿旧令牌假装开通线路——那是「需要登录→登录成功→仍401」死循环刷屏的根源。
  function _zfOpenLoginOverlay(onSave, reasonText) {
    var App = (typeof window.App !== 'undefined') ? window.App : null;
    if (!App || typeof App.zf3dTopbarShowLogin !== 'function') {
      _dlgAlert((reasonText ? reasonText + '。' : '') + '请先在右上角登录朱峰智能体账号，然后再发送消息。');
      return;
    }
    if (reasonText && typeof ToastStack !== 'undefined' && ToastStack.show) {
      try {
        var tip = document.createElement('div');
        tip.style.cssText = 'background:rgba(20,60,140,.94);color:#fff;padding:10px 16px;border-radius:8px;font-size:13px;max-width:360px;';
        tip.textContent = 'ℹ️ ' + reasonText;
        ToastStack.show(tip, 5000);
      } catch (eTip) {}
    }
    var origHide = App.zf3dTopbarHideLogin;
    App.zf3dTopbarHideLogin = function() {
      App.zf3dTopbarHideLogin = origHide;
      if (origHide) origHide.apply(this, arguments);
      fetch('/api/zf3d/ai-token', { credentials: 'include' })
        .then(function(r){ return r.json(); })
        .then(function(tj){
          if (tj && tj.token && tj.relay_key !== false) {
            return Promise.resolve(onSave && onSave(tj.token)).catch(function(e){ _dlgAlert('连接失败：' + (e && e.message || e)); });
          }
          if (tj && tj.token && tj.relay_key === false) {
            _dlgAlert('未完成登录，朱峰线路 Key 仍未下发：请重新打开登录窗口完成登录后再发送消息。');
            return;
          }
          if (tj && tj.error === 'not_login') return; // 用户取消登录，静默
          _dlgAlert('登录成功，但开通线路失败：' + ((tj && tj.error) || '未知错误'));
        })
        .catch(function(e){ _dlgAlert('网络错误：' + e); });
    };
    App.zf3dTopbarShowLogin();
  }

  /**
   * 打开快捷输入对话框
   * @param {Object} model 缺少 key 的模型对象
   * @param {Function} onSave(key) 保存成功后的回调（返回 Promise 或任意值）；保存成功后自动关闭弹窗
   */
  function open(model, onSave) {
    ensureStyles();
    // 【朱峰会员令牌线路】不走第三方 API Key，改用会员令牌文案 + aitoken 页直达
    var isZf = !!(model && ((typeof Models !== 'undefined' && Models.isZfOfficial) ? Models.isZfOfficial(model) : (model.zfLine || model.zfManaged || model.zfPinned || model.keyRef === 'zf_token' || model.keyRef === 'server' || /127\.0\.0\.1:(8527|8559|8554|8787|8788)/.test(String(model.endpoint||'') + String(model.baseUrl||'')))));
    var prov = detectProvider(model);
    var provName = (prov && prov.name) || '大模型服务商';
    if (isZf) {
      prov = { name: '朱峰社区会员', url: (model && model.officialUrl) || 'https://www.zf3d.com/airecharge.asp' };
      provName = prov.name;
    }

    var overlay = document.createElement('div');
    overlay.id = 'apiKeyQuickOverlay';

    // 【朱峰线路：登录即用，免令牌粘贴】直接调 aitoken_api.asp 自动取令牌
    if (isZf) {
      overlay.innerHTML =
        '<div class="akq-box"><h3>🔄 正在连接朱峰模型…</h3>' +
        '<div class="akq-desc">正在通过您的会员登录身份自动开通线路，无需任何密钥。<br>费用从会员积分余额中按量扣除。</div>' +
        '<div class="akq-err" id="akqKeyErr"></div>' +
        '<div class="akq-btns"><button id="akqCancel">取消</button></div></div>';
      document.body.appendChild(overlay);
      var errZf = overlay.querySelector('#akqKeyErr');
      overlay.querySelector('#akqCancel').addEventListener('click', function(){ overlay.remove(); });
      fetch('/api/zf3d/ai-token', { credentials: 'include' })
        .then(function(r){ return r.json(); })
        .then(function(j){
          if (j && j.token && j.relay_key === false) {
            // 【2026-11-22】令牌取到但本机缺中转线路 Key（heartbeat_api_key 为空）：
            // zf_models_relay 的鉴权 Key 只在"登录"时由官网下发，拿令牌假装开通必然被上游
            // 401 打回（曾致「需要登录→登录成功」无限刷屏）。此处直接引导真正重新登录。
            overlay.remove();
            _zfOpenLoginOverlay(onSave, '检测到本机缺少朱峰线路 Key，请重新登录朱峰账号以重新下发');
            return;
          }
          if (j && j.token) {
            overlay.remove();
            Promise.resolve(onSave && onSave(j.token)).catch(function(e){ _dlgAlert('连接失败：' + (e && e.message || e)); });
          } else if (j && j.error === 'not_login') {
            // 未登录：调起官方登录遮罩（index.html 的 zf3dLoginOverlay，与签到登录一致）
            overlay.remove();
            _zfOpenLoginOverlay(onSave, '');
          } else {
            errZf.textContent = '❌ 开通失败：' + ((j && j.error) || '服务暂不可用，请稍后再试');
          }
        })
        .catch(function(e){ errZf.textContent = '❌ 网络错误：' + e; });
      return;
    }

    overlay.innerHTML =
      '<div class="akq-box">' +
        '<h3>🔑 请输入您的 ' + provName + ' 的 API Key</h3>' +
        '<div class="akq-desc">模型「' + escH((model && model.name) || '未命名') + '」还没有配置 API 密钥，暂时无法对话。<br>' +
        '在下方粘贴您的 Key 即可立即开始使用；如果还没有，' +
        (prov ? '点击左下角按钮直达 ' + provName + ' 官网获取/充值。' : '请前往服务商官网获取。') +
        '</div>' +
        '<input type="password" id="akqKeyInput" placeholder="请粘贴 API Key（如 sk-… / ark-…）" autocomplete="off">' +
        '<div class="akq-err" id="akqKeyErr"></div>' +
        '<div class="akq-btns">' +
          (prov ? '<a class="akq-site" href="' + prov.url + '" target="_blank" rel="noopener">🚀 直达' + provName + '官网获取</a>' : '') +
          '<button id="akqCancel">取消</button>' +
          '<button id="akqSave" class="akq-ok">✓ 确定并连接</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var input = overlay.querySelector('#akqKeyInput');
    var errEl = overlay.querySelector('#akqKeyErr');
    var saveBtn = overlay.querySelector('#akqSave');
    setTimeout(function() { input.focus(); }, 50);

    function close() { overlay.remove(); }

    function doSave() {
      var key = String(input.value || '').trim();
      if (!key) { errEl.textContent = '⚠️ 请输入 API Key 后再确定'; input.focus(); return; }
      // 火山方舟 key 自动校正 endpoint
      if (!isZf && isArkKey(key) && model && model.endpoint && !/volces\.com/.test(model.endpoint)) {
        model.endpoint = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
      }
      saveBtn.disabled = true;
      saveBtn.textContent = '连接中…';
      Promise.resolve(onSave && onSave(key)).then(function() {
        close();
      }).catch(function(e) {
        saveBtn.disabled = false;
        saveBtn.textContent = '✓ 确定并连接';
        errEl.textContent = '❌ 保存失败：' + ((e && e.message) || e || '未知错误');
      });
    }

    overlay.querySelector('#akqCancel').addEventListener('click', close);
    overlay.addEventListener('click', function(ev) { if (ev.target === overlay) close(); });
    saveBtn.addEventListener('click', doSave);
    input.addEventListener('keydown', function(ev) { if (ev.key === 'Enter') doSave(); });
  }

  global.ApiKeyQuickDialog = {
    open: open,
    detectProvider: detectProvider,
    isArkKey: isArkKey
  };
})(window);
