/* ===== 思考过程实时翻译（CoT 实时机翻）v1.0 =====
 * 命名空间：App.zfReasonTranslate（与 i18n 系统隔离）
 * 原理：接收流式累计思考文本（agent-02-loop-core onChunk 挂钩），
 *   句级缓冲（句末标点 / 500ms / 80字符）→ 批量调免费翻译接口（Google 免费端点，
 *   失败自动切换微软 edge 端点）→ 译文写入思考气泡，原文收「查看原文」折叠。
 * 降级：接口失败静默回退原文，连续失败 3 次本轮停止翻译。
 * 默认关闭：localStorage zf_reason_translate = '1' 开启；目标语言 zf_reason_lang（默认 zh-CN）。
 * 隐私提示：开启翻译即表示同意将思考内容发送至翻译服务。
 */
(function () {
    'use strict';
    if (window.App && App.zfReasonTranslate) return;
    App = window.App || {};

    var LS_ENABLE = 'zf_reason_translate';
    var LS_LANG = 'zf_reason_lang';
    var LS_ENDPOINT = 'zf_reason_endpoint';

    var state = {
        buf: '',              // 未成句缓冲
        timer: null,          // 500ms 节流计时器
        translating: false,
        failCount: 0,         // 本轮连续失败次数（>=3 停止）
        cache: {},            // 原文→译文 内存缓存
        seq: 0                // 请求序号，防乱序回写
    };

    var MODULE = {
        get enabled() { try { return localStorage.getItem(LS_ENABLE) === '1'; } catch (e) { return false; } },
        set enabled(v) { try { localStorage.setItem(LS_ENABLE, v ? '1' : '0'); } catch (e) {} },
        get targetLang() { try { return localStorage.getItem(LS_LANG) || 'zh-CN'; } catch (e) { return 'zh-CN'; } },
        set targetLang(v) { try { localStorage.setItem(LS_LANG, v || 'zh-CN'); } catch (e) {} },
        get customEndpoint() { try { return localStorage.getItem(LS_ENDPOINT) || ''; } catch (e) { return ''; } },
        set customEndpoint(v) { try { v ? localStorage.setItem(LS_ENDPOINT, v) : localStorage.removeItem(LS_ENDPOINT); } catch (e) {} },
        reset: function () { // 每轮新回复开始时调用
            state.buf = ''; state.translating = false; state.failCount = 0; state.seq = 0;
            if (state.timer) { clearTimeout(state.timer); state.timer = null; }
        }
    };
    App.zfReasonTranslate = MODULE;

    // ===== 切句：句末标点/换行处切出完整句 =====
    function _splitSentences(text) {
        var out = [], last = 0;
        for (var i = 0; i < text.length; i++) {
            var c = text[i];
            if (c === '.' || c === '!' || c === '?' || c === '\n' || c === '。' || c === '！' || c === '？' || c === '；' || c === ';') {
                // 英文句号后若是数字/字母缩写场景不严格切，简单场景足够
                var seg = text.slice(last, i + 1);
                if (seg.trim()) out.push(seg);
                last = i + 1;
            }
        }
        return { sentences: out, rest: text.slice(last) };
    }

    // ===== 翻译接口：自定义端点 > Google 免费 > 微软 edge，逐级回退 =====
    function _translate(text, lang) {
        var custom = MODULE.customEndpoint;
        var p;
        if (custom) {
            p = fetch(custom + encodeURIComponent(text))
                .then(function (r) { return r.text(); })
                .then(function (t) {
                    try { var j = JSON.parse(t); if (j && j[0]) return j[0].map(function (s) { return s[0]; }).join(''); } catch (e) {}
                    return t;
                });
        } else {
            p = fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
                    encodeURIComponent(lang) + '&dt=t&q=' + encodeURIComponent(text))
                .then(function (r) { return r.json(); })
                .then(function (j) {
                    if (!j || !j[0]) throw new Error('bad');
                    return j[0].map(function (s) { return s[0]; }).join('');
                })
                .catch(function () {
                    // 回退微软 edge 免费端点
                    return fetch('https://api.edge.microsoft.com/translate/trans', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify([{ text: text }])
                    }).then(function (r) { return r.json(); })
                      .then(function (j) {
                          if (!j || !j[0] || !j[0].translations) throw new Error('bad-edge');
                          return j[0].translations.map(function (t) { return t.text; }).join('');
                      });
                });
        }
        return p;
    }

    // ===== 思考气泡管理（每轮一个，译文主显 + 原文折叠）=====
    function _ensureBubble(box) {
        var el = box.querySelector('.zf-cot-translate');
        if (el && el.parentNode) return el;
        el = document.createElement('div');
        el.className = 'zf-cot-translate';
        el.style.cssText = 'margin:6px 0;padding:8px 12px;border-radius:10px;background:rgba(90,140,255,0.10);' +
            'border:1px solid rgba(90,140,255,0.25);font-size:13px;line-height:1.6;color:#9db9ff;white-space:pre-wrap;word-break:break-word;';
        el.innerHTML = '<div class="zf-cot-head" style="font-size:12px;opacity:.75;margin-bottom:4px">🤔 思考中…（实时翻译）</div>' +
            '<div class="zf-cot-text"></div>' +
            '<details class="zf-cot-orig" style="margin-top:4px"><summary style="cursor:pointer;font-size:12px;opacity:.6">查看原文</summary>' +
            '<div class="zf-cot-orig-text" style="font-size:12px;opacity:.65;white-space:pre-wrap;margin-top:4px"></div></details>';
        var body = box.querySelector('.chatbox-body');
        if (body) { body.appendChild(el); body.scrollTop = body.scrollHeight; }
        return el;
    }

    function _finishBubble(box) {
        var el = box && box.querySelector('.zf-cot-translate');
        if (el) {
            var head = el.querySelector('.zf-cot-head');
            if (head) head.textContent = '🤔 思考过程（已翻译）';
        }
    }

    // ===== 批量翻译并回写 =====
    function _flush(box) {
        state.timer = null;
        if (!state.buf || state.translating || state.failCount >= 3) return;
        var text = state.buf; state.buf = '';
        if (MODULE.cache[text]) { _apply(box, text, MODULE.cache[text]); return; }
        state.translating = true;
        var mySeq = ++state.seq;
        _translate(text, MODULE.targetLang).then(function (out) {
            if (mySeq !== state.seq) return;
            state.translating = false; state.failCount = 0;
            MODULE.cache[text] = out;
            _apply(box, text, out);
        }).catch(function () {
            if (mySeq !== state.seq) return;
            state.translating = false;
            state.failCount++;
            // 静默回退：译文区维持原文显示
        });
    }

    function _apply(box, orig, translated) {
        var el = _ensureBubble(box);
        var t = el.querySelector('.zf-cot-text');
        var o = el.querySelector('.zf-cot-orig-text');
        if (t) t.textContent += (t.textContent ? '' : '') + translated;
        if (o) o.textContent += orig;
        var body = box.querySelector('.chatbox-body');
        if (body) body.scrollTop = body.scrollHeight;
    }

    // ===== 对外入口：流式 onChunk 挂钩调用 =====
    MODULE.onReasoning = function (box, fullReasoning) {
        if (!MODULE.enabled) return;
        if (!box || !fullReasoning) return;
        var el = _ensureBubble(box);
        // 原文始终同步（折叠区）
        var o = el.querySelector('.zf-cot-orig-text');
        if (o) o.textContent = fullReasoning;
        // 增量进入句级缓冲
        var full = el._zfSeen || 0;
        var delta = fullReasoning.slice(full);
        el._zfSeen = fullReasoning.length;
        state.buf += delta;
        var sp = _splitSentences(state.buf);
        if (sp.sentences.length) {
            state.buf = sp.rest;
            // 顺序翻译：translating 时排队下一轮
            if (!state.translating) {
                var batch = sp.sentences.join('');
                state.buf = sp.rest + state.buf; // 还原，_flush 内部取 buf
                state.buf = sp.rest;
                var _savedBuf = state.buf;
                state.buf = batch;
                _flush(box);
                state.buf = _savedBuf;
            } else {
                // 翻译中：缓存成句文本，flush 后处理
                var pending = (el._zfPending || '') + sp.sentences.join('');
                el._zfPending = pending;
                if (!state.timer) {
                    state.timer = setTimeout(function () {
                        var p = el._zfPending || ''; el._zfPending = '';
                        state.buf = p + state.buf;
                        _flush(box);
                    }, 600);
                }
            }
        }
        if (!state.timer && !state.translating && state.buf) {
            state.timer = setTimeout(function () { _flush(box); }, 500);
        }
    };

    MODULE.onDone = function (box) {
        if (state.timer) { clearTimeout(state.timer); state.timer = null; }
        if (state.buf) { var b = state.buf; state.buf = ''; if (b.trim()) { var _s = b; state.buf = _s; _flush(box); } }
        setTimeout(function () { _finishBubble(box); }, 1200);
    };

    // ===== 设置面板注入：自动往设置弹窗加开关（重试直到面板出现）=====
    function _injectSettings(retries) {
        var root = document.querySelector('#settingsOverlay .settings-content');
        if (!root) { if (retries > 0) setTimeout(function () { _injectSettings(retries - 1); }, 1500); return; }
        if (root.querySelector('.zf-cot-setting')) return;
        var wrap = document.createElement('div');
        wrap.className = 'zf-cot-setting';
        wrap.style.cssText = 'padding:10px 14px;border-top:1px dashed rgba(128,128,128,0.3);font-size:13px;';
        wrap.innerHTML =
            '<label style="display:flex;align-items:center;gap:8px;cursor:pointer">' +
            '<input type="checkbox" id="zfCotToggle" ' + (MODULE.enabled ? 'checked' : '') + '> ' +
            '<b>思考过程实时翻译</b></label>' +
            '<div style="margin-top:6px;display:flex;align-items:center;gap:6px">' +
            '目标语言 <select id="zfCotLang" style="padding:2px 6px">' +
            '<option value="zh-CN">中文</option><option value="en">English</option>' +
            '<option value="ja">日本語</option><option value="ko">한국어</option></select>' +
            '<input id="zfCotEndpoint" placeholder="自定义翻译端点(可选)" style="flex:1;padding:2px 6px;min-width:120px">' +
            '</div>' +
            '<div style="font-size:11px;opacity:.6;margin-top:4px">⚠ 开启后思考内容将发送至翻译服务（默认关闭）</div>';
        root.appendChild(wrap);
        var tog = wrap.querySelector('#zfCotToggle');
        var lang = wrap.querySelector('#zfCotLang');
        var ep = wrap.querySelector('#zfCotEndpoint');
        lang.value = MODULE.targetLang;
        ep.value = MODULE.customEndpoint;
        tog.addEventListener('change', function () { MODULE.enabled = tog.checked; });
        lang.addEventListener('change', function () { MODULE.targetLang = lang.value; });
        ep.addEventListener('change', function () { MODULE.customEndpoint = ep.value.trim(); });
    }
    // 已停用：不在面板底部注入「思考过程实时翻译」开关（按需求去掉，保留 _injectSettings 函数便于将来恢复）
    // setTimeout(function () { _injectSettings(20); }, 3000);
})();
