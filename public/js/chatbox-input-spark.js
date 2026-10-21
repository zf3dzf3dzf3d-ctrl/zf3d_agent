/* ============================================================
 * chatbox-input-spark.js —— 输入框「灵感召唤」伪 placeholder 浮层
 * 去掉冷冰冰的「输入消息，Enter 发送，Shift+Enter 换行」说明书，
 * 换成会打字、会流光、会轮播的灵感文案，光标一落进输入框即被点燃。
 *
 * 设计要点（对齐本次蜂群收口裁定的技术可行性结论）：
 *  1. 原生 textarea placeholder 已被移除（模板置空），避免 i18n 注入器
 *     (i18n.js translateAttrs 命中 [placeholder]) 把旧句盖回来。
 *  2. 文案用本文件内全局常量数组写入浮层 span，不在任何 i18n 词条表 → 天然豁免。
 *  3. 浮层运行时镜像 textarea 的 font/padding/color 基线，保证与真实光标对齐。
 *  4. 五态：空闲慢轮播 / 聚焦加速 / value 非空立即隐藏退场 / 失焦恢复 / 后台暂停。
 *  5. 按对话实例幂等（_zfSpark 守卫），销毁/重渲染不泄漏定时器。
 * ============================================================ */
(function () {
    'use strict';

    /* ---------- 30 条灵感文案（6 族 × 5，策划定稿版） ---------- */
    var SPARK_LINES = [
        // A 梦想召唤
        '在这里，写下你的第一个梦想吧',
        '你的脑洞，值得被世界看见',
        '把梦里那个画面，说出来',
        '所有伟大的作品，都从一句话开始',
        '别想了，先把它变成现实',
        // B 疯狂创造
        '开始疯狂创造吧！',
        '尽管提，AI 负责把不可能变可能',
        '越离谱越好，这里没有标准答案',
        '给我一句话，我还你一个奇迹',
        '想象力不设限，输入框也不设限',
        // C 悬念挑逗
        '试试输入「我想做个____」',
        '听说点进来的人，都创作出了爆款',
        '你下一个灵感，可能就在这句里',
        '敲点什么？我有点期待',
        '嘘——这里能诞生别人想不到的东西',
        // D 伙伴陪伴
        '我在听，你想聊点什么',
        '别客气，把我当你的创作搭子',
        '今天想一起搞点什么大事情',
        '你不是一个人在创作',
        '说吧，我随时都在状态',
        // E 文艺诗意
        '一字落纸，万象生辉',
        '让灵感像风一样，吹进这里',
        '此刻的空白，是无限的开始',
        '把心跳写成一段提示词',
        '星星落进框里，就成了作品',
        // F 极客行动
        '一句话，召唤一支 AI 工作团',
        '把你的想法，丢进无限画布',
        '别客气，让 AI 替你动手',
        '下一个爆款任务，从这里发出',
        '输入即启动，回车即起飞'
    ];
    // 聚焦态优先池（更有冲劲、更像在对你招手）
    var SPARK_FOCUS_POOL = [1, 5, 6, 8, 9, 13, 17, 25, 28, 29];

    var TYPE_MS = 70;       // 打字机每字间隔
    var HOLD_GAP_MS = 10000; // 整句完成后到下一句的间隔（10秒，避免切换太快）

    /* ---------- 样式（一次性注入，内联于此以免双副本 CSS 同步） ---------- */
    function ensureStyle() {
        if (document.getElementById('zf-spark-style')) return;
        var css = '' +
            '.chatbox .chatbox-inputrow { position: relative; }' +
            '.zf-input-spark {' +
            '  position:absolute; z-index:2; pointer-events:none;' +
            '  white-space:pre-wrap; overflow:hidden;' +
            '  background:linear-gradient(90deg,#ff6b6b,#ffb347,#ffd93d,#6bcB77,#4d96ff,#9b5de5,#ff6b6b);' +
            '  background-size:300% 100%;' +
            '  -webkit-background-clip:text; background-clip:text;' +
            '  color:transparent; -webkit-text-fill-color:transparent;' +
            '  animation:zfSparkFlow 7s linear infinite;' +
            '  opacity:.92;' +
            '}' +
            '.zf-input-spark .zf-spark-caret {' +
            '  display:inline-block; width:1px; margin-left:1px;' +
            '  transform:translateY(1px);' +
            '  background:currentColor; -webkit-text-fill-color:rgba(160,170,200,.7);' +
            '  animation:zfSparkBlink 1s steps(1) infinite;' +
            '}' +
            '@keyframes zfSparkFlow { to { background-position:300% 0; } }' +
            '@keyframes zfSparkBlink { 50% { -webkit-text-fill-color:transparent; } }' +
            '.qc-sendrow { position: relative; }' +
            '.cs-qs-inputrow { position: relative; }' +
            '[data-theme="light"] .zf-input-spark { opacity:.85; }' +
            /* 硬兜底：强制三处输入框原生 ::placeholder 透明。
               即便 i18n 注入器回填旧"说明书"句，底层灰字也永不可见，
               浮层完全独占显示，杜绝与浮层重叠的体验层风险。 */
            '.chatbox .chatbox-inputrow textarea::placeholder,' +
            '.qc-sendrow textarea::placeholder,' +
            '.cs-qs-inputrow textarea::placeholder' +
            '{ color:transparent !important; opacity:1 !important; }' +
            '.chatbox .chatbox-inputrow textarea::-webkit-input-placeholder,' +
            '.qc-sendrow textarea::-webkit-input-placeholder,' +
            '.cs-qs-inputrow textarea::-webkit-input-placeholder' +
            '{ color:transparent !important; opacity:1 !important; }';
        var s = document.createElement('style');
        s.id = 'zf-spark-style';
        s.textContent = css;
        document.head.appendChild(s);
    }

    /* ---------- 单实例控制器 ---------- */
    function SparkCtl(row, ta) {
        this.row = row;
        this.ta = ta;
        this.bubble = null;
        this.timer = null;
        this.lineIdx = -1;
        this.paused = false;
        this._mkBubble();
        this._bind();
        this._start();
    }

    SparkCtl.prototype._mkBubble = function () {
        if (this.bubble) this.bubble.remove();
        var b = document.createElement('div');
        b.className = 'zf-input-spark';
        b.innerHTML = '<span class="zf-spark-text"></span><span class="zf-spark-caret">&nbsp;</span>';
        this.row.appendChild(b);
        this.bubble = b;
        this.txtEl = b.querySelector('.zf-spark-text');
    };

    // 运行时把浮层几何/字体对齐到 textarea，保证与真实光标同位
    SparkCtl.prototype._sync = function () {
        var ta = this.ta, b = this.bubble;
        if (!ta || !b) return;
        var cs = getComputedStyle(ta);
        b.style.font = cs.font;
        b.style.lineHeight = cs.lineHeight;
        b.style.left = (ta.offsetLeft + parseFloat(cs.paddingLeft)) + 'px';
        b.style.top = (ta.offsetTop + parseFloat(cs.paddingTop)) + 'px';
        b.style.width = (ta.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) + 'px';
        b.style.maxHeight = ta.clientHeight + 'px';
    };

    SparkCtl.prototype._nextIdx = function (focus) {
        var pool = focus ? SPARK_FOCUS_POOL : null;
        var n;
        if (pool) {
            do { n = pool[(Math.random() * pool.length) | 0]; } while (n === this.lineIdx && pool.length > 1);
        } else {
            do { n = (Math.random() * SPARK_LINES.length) | 0; } while (n === this.lineIdx);
        }
        this.lineIdx = n;
        return n;
    };

    SparkCtl.prototype._start = function () {
        var self = this;
        this._clear();
        // 仅在未输入文字时显示灵感文字（未聚焦也显示，充当 placeholder），聚焦则切冲劲文案
        var focused = (document.activeElement === this.ta);
        if (this.ta.value || this.paused || !this.bubble.isConnected) {
            if (this.bubble) this.bubble.style.display = 'none';
            return;
        }
        this._sync();
        this.bubble.style.display = '';
        var focus = focused;
        var full = SPARK_LINES[self._nextIdx(focus)];
        var i = 0;
        this.txtEl.textContent = '';
        function step() {
            if (self.paused || !self.bubble.isConnected) return;
            // 有输入内容立即让位停止（未聚焦也继续显示，充当 placeholder）
            if (self.ta.value) {
                self.bubble.style.display = 'none';
                self._clear();
                return;
            }
            self.bubble.style.display = '';
            self._sync();
            if (i <= full.length) {
                self.txtEl.textContent = full.slice(0, i);
                i++;
                self.timer = setTimeout(step, TYPE_MS);
            } else {
                // 整句完成后停留 10 秒再切换下一句
                self.timer = setTimeout(function () { self._start(); }, HOLD_GAP_MS);
            }
        }
        step();
    };

    SparkCtl.prototype._clear = function () {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    };

    SparkCtl.prototype._bind = function () {
        var self = this;
        // focus 立即切冲劲子集 + 加速
        this.ta.addEventListener('focus', function () { if (!self.ta.value) self._start(); });
        // 输入即让位：value 非空隐藏，清空恢复
        this.ta.addEventListener('input', function () {
            if (self.ta.value) { self._clear(); self.bubble.style.display = 'none'; }
            else { self._start(); }
        });
        this.ta.addEventListener('blur', function () {
            if (!self.ta.value && !self.paused) self._start();
        });
        window.addEventListener('resize', function () { self._sync(); });
    };

    SparkCtl.prototype.destroy = function () {
        this._clear();
        this.paused = true;
        if (this.bubble) this.bubble.remove();
        if (this.ta) this.ta._zfSpark = null;
    };

    /* ---------- 扫描所有对话输入框，逐实例幂等挂载 ---------- */
    /* 三处灵感输入框：主对话框 / 快捷创建条 / 任务面板快发条 */
    var SPARK_TARGETS = [
        ['.chatbox .chatbox-inputrow textarea', '.chatbox-inputrow'],
        ['.qc-sendrow textarea', '.qc-sendrow'],
        ['.cs-qs-inputrow textarea', '.cs-qs-inputrow']
    ];
    var SPARK_TA_SELECTOR = SPARK_TARGETS.map(function (t) { return t[0]; }).join(', ');

    function scan(root) {
        ensureStyle();
        var doc = root || document;
        SPARK_TARGETS.forEach(function (t) {
            doc.querySelectorAll(t[0]).forEach(function (ta) {
                var row = ta.closest(t[1]);
                if (!row) return;
                if (ta._zfSpark) {
                    // 重渲染保护：若原实例脱离文档，则重建
                    if (!ta._zfSpark.bubble || !ta._zfSpark.bubble.isConnected) {
                        ta._zfSpark._mkBubble(); ta._zfSpark._start();
                    }
                    return;
                }
                ta._zfSpark = new SparkCtl(row, ta);
            });
        });
    }

    /* ---------- 后台隐藏暂停（省电），回前台恢复 ---------- */
    document.addEventListener('visibilitychange', function () {
        var hidden = document.hidden;
        document.querySelectorAll(SPARK_TA_SELECTOR).forEach(function (ta) {
            var c = ta._zfSpark;
            if (!c) return;
            if (hidden) { c.paused = true; c._clear(); }
            else {
                c.paused = false;
                if (document.contains(ta) && !ta.value) c._start();
            }
        });
    });

    /* ---------- 启动：DOM ready + MutationObserver 监听新建对话 ---------- */
    function boot() {
        scan(document);
        var t = null;
        var mo = new MutationObserver(function () {
            if (t) clearTimeout(t);
            t = setTimeout(function () { scan(document); }, 200); // 节流，防重渲染风暴
        });
        mo.observe(document.body, { childList: true, subtree: true });
        // 对外暴露：对话销毁时可调用 _zfSpark.destroy() 清理
        window.ZfSpark = { scan: scan, lines: SPARK_LINES };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
