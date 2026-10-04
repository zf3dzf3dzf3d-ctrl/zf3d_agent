/* ============================================================
 * dog-guard-chat.js —— 小狗管家（复用普通角色对话框版）
 * 左键小狗按钮 → 用角色列表的「小狗管家」角色，走 App.openRoleChat
 * 创建普通对话框（鼠标位置），与主脑/风筝同款交互语言。
 * - 防重入：injecting 标志（主脑同款），注入期间重复点击直接忽略
 * - 首问数据三级降级：后端真账本 → 画布摘要 → 如实声明
 * - 本地指令拦截：「开始巡逻/停止巡逻/巡逻状态」直接执行，不走大模型
 * ============================================================ */
(function () {
    'use strict';

    var SHORT_RE = /^(继续|好|嗯|哦|ok|okay|行|是的|对|好的|嗯嗯|继续吧|go|yes|收到|明白|1|2|3)\s*[。.!！?？~～]*$/i;
    var FIRST_Q = '最近守护情况怎么样？没有记录就如实说。';
    var st = window.__dogGuardChatState = window.__dogGuardChatState || { injecting: false };

    /* ---------- 上下文收集·一级：后端真实守护账本 ---------- */
    function fetchBackendLogbook() {
        return fetch('/api/worklog?days=1', { cache: 'no-store' })
            .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
            .then(function (res) {
                var log = (res && res.ok && res.log) || null;
                if (!log) throw new Error('empty');
                var lines = [];
                Object.keys(log).sort().forEach(function (day) {
                    var arr = log[day];
                    if (!Array.isArray(arr)) return;
                    arr.forEach(function (it) {
                        if (!it || it.source !== 'dog-guard') return;
                        var t = it.time || it.ts || day;
                        var m = String(it.summary || it.message || it.text || '').slice(0, 200);
                        if (m) lines.push((t !== day ? '[' + t + '] ' : '[' + day + '] ') + m);
                    });
                });
                lines = lines.slice(-20);
                if (!lines.length) throw new Error('empty');
                return '【后端守护账本（真实巡逻记录·最近20条）】\n' + lines.join('\n');
            });
    }

    /* ---------- 上下文收集·二级：画布上各对话最近内容摘要 ---------- */
    function collectContext() {
        var boxes = document.querySelectorAll('.chatbox');
        var groups = [];
        boxes.forEach(function (box) {
            if (!box.offsetParent && box.getClientRects().length === 0) return;
            var titleEl = box.querySelector('.title');
            var title = titleEl ? titleEl.textContent.trim() : ('对话' + (groups.length + 1));
            var body = box.querySelector('.chatbox-body') || box;
            var msgs = body.querySelectorAll('.msg');
            var lines = [];
            msgs.forEach(function (m) {
                if (m.hasAttribute('data-welcome')) return;
                if (m.classList.contains('typing')) return;
                var cl = m.className || '';
                if (/tool|system|status/i.test(cl)) return;
                var text = (m.textContent || '').trim();
                if (!text) return;
                var isUser = m.classList.contains('user') || m.classList.contains('msg-user') ||
                             (m.dataset && m.dataset.who === 'user') || /\buser\b/i.test(cl);
                if (isUser) {
                    if (text.length <= 4 || SHORT_RE.test(text)) return;
                    lines.push('用户：' + text.slice(0, 300));
                } else {
                    lines.push('AI：' + text.slice(0, 300));
                }
            });
            if (lines.length) {
                groups.push('═══ 对话' + (groups.length + 1) + '：「' + title + '」═══\n' + lines.slice(-8).join('\n'));
            }
        });
        return groups.length ? ('【画布对话摘要（非后端账本，仅供参考）】\n\n' + groups.join('\n\n')) : '';
    }

    /* ---------- 三级降级取上下文 ---------- */
    function collectBriefing(cb) {
        fetchBackendLogbook()
            .catch(function () {
                var ctx = collectContext();
                return ctx ? Promise.resolve(ctx) : Promise.reject(new Error('no-ctx'));
            })
            .then(function (text) { cb(text + '\n\n═══ 汇报请求 ═══\n' + FIRST_Q); })
            .catch(function () {
                cb('（注：后端守护账本不可达，画布上也暂无可回顾的对话内容）\n\n' + FIRST_Q + '如果没有巡逻记录，请如实告诉我。');
            });
    }

    /* ---------- 找角色列表里的小狗管家（删了则内置兜底） ---------- */
    function findDogRole(cb) {
        fetch('/api/roles')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                var all = (res && (res.roles || res.data)) || [];
                var exact = all.find(function (r) { return (r.name || '').trim() === '小狗管家'; });
                var loose = all.find(function (r) { return (r.name || '').indexOf('小狗') > -1 || (r.name || '').indexOf('守卫') > -1; });
                cb(exact || loose || null);
            })
            .catch(function () { cb(null); });
    }

    /* ---------- 本地指令拦截：开始/停止巡逻、查状态（不走大模型，即时反馈） ---------- */
    function tryLocalCommand(raw) {
        var text = (raw || '').trim().replace(/[。.!！?？~～\s]+$/, '');
        var on = App && typeof App._dogGuardEnabled === 'boolean' ? App._dogGuardEnabled : false;
        if (/^(开始|开启|上岗)(巡逻|守护)?(吧|呀|汪)?$|^巡逻.{0,2}(开始|启动)/.test(text)) {
            if (!on && App && App._dogGuardToggle) App._dogGuardToggle();
            return '汪！巡逻已开启，我会盯着各个对话，发现问题就督促改进~ 🐕';
        }
        if (/^(停止|关闭|下岗)(巡逻|守护)?(吧|呀|汪)?$|^巡逻.{0,2}(停止|关闭)/.test(text)) {
            if (on && App && App._dogGuardToggle) App._dogGuardToggle();
            return '好嘞，巡逻已停止，我先趴着休息~ 🐕';
        }
        if (/巡逻.{0,4}(状态|怎么样|开了吗|关了吗)|^(状态|还在巡逻吗|在巡逻吗)/.test(text)) {
            return on ? '汪！巡逻进行中，一切正常~ 🟢' : '现在没在巡逻哦（红灯💤）。对我说「开始巡逻」就能上岗~';
        }
        return null;
    }

    function sendIntoBox(box, text) {
        var input = box.querySelector('textarea') ||
                    box.querySelector('.chatbox-input') ||
                    box.querySelector('input[type="text"]');
        var btn = box.querySelector('.send-btn');
        if (input && btn) {
            input.value = text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            setTimeout(function () { btn.click(); }, 100);
        }
    }

    /* ---------- 给小狗对话框装指令拦截（在发首问时一并绑定） ---------- */
    function bindCommandInterceptor(box) {
        if (!box || box.dataset.dgCmdWired) return;
        box.dataset.dgCmdWired = '1';
        function intercept() {
            var input = box.querySelector('textarea') ||
                        box.querySelector('.chatbox-input') ||
                        box.querySelector('input[type="text"]');
            if (!input || !input.value) return false;
            var reply = tryLocalCommand(input.value);
            if (reply) {
                input.value = '';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                setTimeout(function () {
                    var body = box.querySelector('.chatbox-body') || box;
                    var bubble = document.createElement('div');
                    bubble.className = 'msg ai msg-ai';
                    bubble.textContent = reply;
                    body.appendChild(bubble);
                    body.scrollTop = body.scrollHeight;
                }, 50);
                return true;
            }
            return false;
        }
        var btn = box.querySelector('.send-btn');
        if (btn) btn.addEventListener('click', function (e) { if (intercept()) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
        var input = box.querySelector('textarea') || box.querySelector('input[type="text"]');
        if (input) input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey && intercept()) { e.stopImmediatePropagation(); e.preventDefault(); }
        }, true);
    }

    /* ---------- 在新创建的对话框里自动发出首问（轮询锁定新 box，不盲取末位） ---------- */
    function autoFirstAsk(beforeCount) {
        var waited = 0;
        (function poll() {
            var boxes = document.querySelectorAll('.chatbox');
            /* 只认打开前不存在的新对话框，避免期间新建的其他对话框导致串窗 */
            var box = null;
            for (var i = boxes.length - 1; i >= 0; i--) {
                var b = boxes[i];
                var hasInput = b.querySelector('textarea') || b.querySelector('.chatbox-input') ||
                               b.querySelector('input[type="text"]');
                if (i >= beforeCount && hasInput) { box = b; break; }
            }
            if (!box) {
                /* 输入框可能稍后才渲染，轮询等待最多 5s，不丢首问 */
                if (waited < 5000) { waited += 200; setTimeout(poll, 200); }
                else st.injecting = false;
                return;
            }
            bindCommandInterceptor(box);
            collectBriefing(function (text) {
                sendIntoBox(box, text);
                st.injecting = false;
            });
        })();
    }

    /* ---------- 对外入口：左键小狗按钮调用（主脑同款防重入） ---------- */
    function open(x, y) {
        if (st.injecting) return; // 注入进行中防重入，避免向同一对话框重复注入
        if (!window.App || typeof App.openRoleChat !== 'function') {
            console.warn('[dog-guard-chat] 对话组件未就绪'); return;
        }
        st.injecting = true;
        var beforeCount = document.querySelectorAll('.chatbox').length; /* 打开前快照 */
        findDogRole(function (role) {
            App.openRoleChat(role || { id: '', name: '小狗管家', avatar: '🐶' }, { x: x, y: y });
            autoFirstAsk(beforeCount);
        });
    }

    window.DogGuardChat = { open: open };
})();
