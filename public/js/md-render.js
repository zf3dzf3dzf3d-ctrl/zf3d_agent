/* ===== ZFMD 统一 Markdown 渲染层 v1（全站唯一实现，桌面/工具卡/面板/手机版共用） =====
 * 背景：此前 md 渲染在各处重复实现（chatbox-03 一套 marked 配置、记忆面板/工作台/
 *       文档同步各自 marked.parse、手机版内联 renderMD、工具卡只 escapeHtml 导致
 *       ** / *** 星号原样显示）。本文件收拢为唯一入口，各处只调用不重写。
 *
 * 对外 API（挂 window.ZFMD，另同步挂 window.zfmdRender 便于内联脚本短名调用）：
 *   ZFMD.escapeHtml(s)          → HTML 转义（唯一转义实现，各处复用）
 *   ZFMD.inline(text, opts)     → 单行渲染（工具卡头部简述/表格单元格用，不产生块级标签）
 *   ZFMD.render(text, opts)     → 块级渲染（段落/标题/列表/表格/代码围栏）
 *   ZFMD.md(text, opts)         → render 别名
 *   ZFMD.hasMarked()            → marked 是否可用
 *
 * opts：
 *   fallback   默认 true：marked 不可用时走内置轻量解析器；传 false 则 marked 不可用
 *              时返回 null（聊天层要"等 marked 恢复再渲染"，不希望中途降级，用它保留原策略）
 *   breaks     默认 true：单换行即换行（AI 中文长文常见）
 *   atxFix     默认 true：修复 AI 写 `###标题`（# 后无空格）不识别的问题
 *   tags       允许原样渲染的 HTML 标签白名单；默认安全集（strong/em/code 等行内）
 *              传 'rich' 放行 img/video/audio/table 等（手机版富媒体用）
 *   media      默认 false：true 时 ![](url) 按扩展名渲染成 <video>/<audio>/<img>（手机版）
 *   codespan   可选回调 function(codeText) → 自定义 <code> HTML（聊天层自验收 +/- 染色用）
 *   htmlHook   可选回调 function(rawHtmlSeg) → 自定义 HTML 段处理（聊天层 think 剥离用）
 *   thinkStrip 默认 true：剥离泄漏的 <think> 类标签
 *
 * 原生 HTML 的净化（2026-11-23 重做）：
 *   - 标签白名单 + 属性白名单（没列出来的一律删）；style、表单控件、事件属性一律不放行
 *   - 主路径 DOMPurify（经 LazyLoader 下发，异步到达）：解析交给浏览器自己的 HTML 解析器
 *   - 兜底（DOMPurify 未到达 / 不受支持）：从零重建标签，只保留白名单属性，值全部转义
 *   - 两条路径都不"过滤"原标签——用正则过滤属性是旧实现被绕过的根源
 */
(function (global) {
    'use strict';

    // ===== 唯一 HTML 转义实现 =====
    function escapeHtml(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // ===== 标签白名单 =====
    // 行内标签安全集：不含 src/href，不加载外部资源，不触发脚本
    var SAFE_TAGS = 'strong|b|em|i|u|s|del|mark|sub|sup|br|code|pre|span|small|kbd';
    // 富媒体标签集（工具卡 / 富文本块用）。相比旧版去掉表单控件 form/input/button/select/option/label：
    // 模型输出里内嵌表单等于界面伪装（诱导用户向本机 API 提交请求），不属渲染职责。
    var RICH_TAGS = SAFE_TAGS + '|img|video|audio|source|a|hr|div|p|ul|ol|li|table|thead|tbody|tfoot|tr|th|td|blockquote|h[1-6]|figure|figcaption|details|summary|section|article|header|footer|main|nav|aside|center|iframe';
    // 白名单里出现的全部具体标签名（h[1-6] 展开），供按 pattern 取子集
    var ALL_TAGS = RICH_TAGS.replace('h[1-6]', 'h1|h2|h3|h4|h5|h6').split('|');

    function tagPattern(opts) {
        return (opts && opts.tags === 'rich') ? RICH_TAGS : (opts && opts.tags) || SAFE_TAGS;
    }
    function tagAllowed(name, pattern) {
        return new RegExp('^(' + pattern + ')$', 'i').test(name);
    }
    function isRich(opts) {
        return tagPattern(opts) === RICH_TAGS;
    }

    // ===== 属性白名单：没列出来的一律删 =====
    var BASE_ATTRS = ['class', 'title', 'id', 'dir', 'lang'];
    var RICH_ATTRS = BASE_ATTRS.concat(['href', 'src', 'alt', 'width', 'height', 'controls', 'playsinline',
        'preload', 'poster', 'type', 'colspan', 'rowspan', 'align', 'start', 'open', 'datetime',
        'target', 'rel', 'sandbox', 'loading']);
    // 明确不列：style（全屏覆盖层 / 界面伪装）、srcdoc、formaction、action、srcset、background、一切 on* 事件属性

    // ===== URL 协议白名单（严格兜底用；DOMPurify 路径用它自带的同类检查）=====
    // 先做实体解码并抹掉空白/控制字符——浏览器解析 URL 时会整个抹掉制表与换行，
    // "java&#x09;script:" 就是 "javascript:"。
    var _NAMED_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", tab: '\t', newline: '\n', colon: ':' };
    function decodeEntities(s) {
        return String(s).replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, function (m, e) {
            var v;
            if (e.charAt(0) === '#') {
                var n = (e.charAt(1) === 'x' || e.charAt(1) === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
                v = (isFinite(n) && n >= 0 && n <= 0x10FFFF) ? String.fromCodePoint(n) : undefined;
            } else {
                v = _NAMED_ENT[e.toLowerCase()];
            }
            return (v === undefined) ? m : v;
        });
    }
    function isSafeUrl(u) {
        var s = decodeEntities(u).replace(/[\u0000-\u0020\u007F]+/g, '');
        var m = s.match(/^([a-zA-Z][a-zA-Z0-9+.\-]*):/);
        if (!m) return true;                                             // 相对地址 / 片段 / 查询
        if (/^(https?|mailto|ftp)$/i.test(m[1])) return true;
        return /^data:image\/(png|jpe?g|gif|webp|bmp);/i.test(s);         // 仅位图；data:image/svg+xml 可带脚本，不放行
    }

    // ===== DOMPurify 路径（主路径）=====
    // 为什么用 DOMPurify：它把"解析 HTML"交给浏览器自己的解析器，与随后渲染用的是同一个解析器，
    // 不存在"净化用一套正则、浏览器用另一套规则"的差异——旧实现的全部绕过都来自这种差异。
    var _hooksReady = false;
    function purifier() {
        var dp = global.DOMPurify;
        if (!dp || !dp.isSupported) return null;
        if (!_hooksReady) {
            dp.addHook('uponSanitizeElement', function (node, data) {
                var tag = data.tagName;
                if (tag === 'a') {
                    if (!node.getAttribute('target')) node.setAttribute('target', '_blank');
                    var rel = node.getAttribute('rel') || '';
                    if (!/(^|\s)noopener(\s|$)/i.test(rel)) node.setAttribute('rel', (rel + ' noopener noreferrer').replace(/^\s+/, ''));
                } else if (tag === 'iframe') {
                    // 无 allow-same-origin：内嵌页跑在不透明源里，读不到本应用的 Cookie / 存储，也调不通本应用 API
                    node.setAttribute('sandbox', 'allow-scripts');
                    node.setAttribute('loading', 'lazy');
                    node.setAttribute('class', 'zfmd-iframe');
                } else if (tag === 'img' || tag === 'video') {
                    if (!node.getAttribute('loading')) node.setAttribute('loading', 'lazy');
                    if (tag === 'video') { node.setAttribute('controls', ''); node.setAttribute('playsinline', ''); }
                } else if (tag === 'audio') {
                    node.setAttribute('controls', '');
                }
            });
            _hooksReady = true;
        }
        return dp;
    }
    function purifyConfig(opts) {
        return {
            ALLOWED_TAGS: ALL_TAGS.filter(function (t) { return tagAllowed(t, tagPattern(opts)); }),
            ALLOWED_ATTR: isRich(opts) ? RICH_ATTRS : BASE_ATTRS,
            FORBID_ATTR: ['style', 'srcdoc', 'formaction', 'action', 'srcset', 'background'],
            ALLOW_DATA_ATTR: true,
            ALLOW_ARIA_ATTR: true,
            FORCE_BODY: true,
            KEEP_CONTENT: true,
            SANITIZE_DOM: true
        };
    }

    // ===== 严格兜底（DOMPurify 尚未到达 / 不受支持时）=====
    // 不"过滤"原标签，而是从零重建：只保留白名单标签名；属性只认"双引号值 / 单引号值 / 无引号值"
    // 三种规范写法且仅限白名单内的少数几个；值一律转义后重新加引号。输出里不可能出现重建之外的字符。
    var _ATTR_RE = /([a-zA-Z][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    function fallbackOpenTag(name, attrText, rich) {
        var allowed = rich ? RICH_ATTRS : BASE_ATTRS;
        var out = '<' + name, seen = {}, m;
        attrText = String(attrText || '');
        _ATTR_RE.lastIndex = 0;
        while ((m = _ATTR_RE.exec(attrText))) {
            var an = m[1].toLowerCase();
            // sandbox / rel 一律由下面强制写入；iframe 的 class 由下面统一给（供样式表定位）
            if (seen[an] || an === 'sandbox' || an === 'rel' || (name === 'iframe' && an === 'class')) continue;
            if (!(an.indexOf('data-') === 0 || an.indexOf('aria-') === 0 || allowed.indexOf(an) >= 0)) continue;
            var av = (m[2] !== undefined) ? m[2] : (m[3] !== undefined) ? m[3] : (m[4] !== undefined) ? m[4] : '';
            if ((an === 'href' || an === 'src') && !isSafeUrl(av)) continue;
            seen[an] = 1;
            out += ' ' + an + '="' + escapeHtml(av) + '"';
        }
        if (name === 'a') {
            if (!seen.target) out += ' target="_blank"';
            out += ' rel="noopener noreferrer"';
        } else if (name === 'iframe') {
            out += ' sandbox="allow-scripts" loading="lazy" class="zfmd-iframe"';
        } else if (name === 'img') {
            if (!seen.loading) out += ' loading="lazy"';
        } else if (name === 'video') {
            if (!seen.loading) out += ' loading="lazy"';
            out += ' controls playsinline';
        } else if (name === 'audio') {
            out += ' controls';
        }
        return out + '>';
    }

    var _CTX_WRAP = {
        td: ['<table><tr>', '</tr></table>'], th: ['<table><tr>', '</tr></table>'],
        tr: ['<table>', '</table>'], thead: ['<table>', '</table>'], tbody: ['<table>', '</table>'],
        tfoot: ['<table>', '</table>'], caption: ['<table>', '</table>'],
        col: ['<table><colgroup>', '</colgroup></table>'], colgroup: ['<table>', '</table>'],
        li: ['<ul>', '</ul>'], dt: ['<dl>', '</dl>'], dd: ['<dl>', '</dl>'], source: ['<video>', '</video>']
    };
    function stripClose(html, name) {
        var tail = '</' + name + '>';
        return html.slice(-tail.length).toLowerCase() === tail ? html.slice(0, html.length - tail.length) : html;
    }

    // 净化单个开/闭标签（内置行内解析器的逐标签路径用）
    function sanTag(t, opts) {
        var s = String(t === undefined || t === null ? '' : t);
        var m = s.match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/);
        if (!m) return escapeHtml(s);                                   // 注释 / 声明 / 非标签 → 当文本
        var name = m[2].toLowerCase();
        if (!tagAllowed(name, tagPattern(opts))) return escapeHtml(s);
        if (m[1]) return '</' + name + '>';                              // 闭标签不带属性
        var rest = s.slice(m[0].length);
        var dp = purifier();
        if (!dp) return fallbackOpenTag(name, rest, isRich(opts));
        var cfg = purifyConfig(opts), out;
        var wrap = _CTX_WRAP[name];
        if (wrap) {
            // 表格 / 列表等依赖上下文的标签：单独解析会被解析器丢弃，包一层再取回
            cfg.RETURN_DOM_FRAGMENT = true;
            var el = dp.sanitize(wrap[0] + s + wrap[1], cfg).querySelector(name);
            out = el ? stripClose(el.outerHTML, name) : '';
        } else {
            out = stripClose(String(dp.sanitize(s, cfg)), name);
        }
        return out || fallbackOpenTag(name, rest, isRich(opts));
    }

    // 净化一段"源文本里的原生 HTML"（marked 路径的 html 令牌走这里）
    // 逐标签处理，不做整段解析：markdown 里的原生 HTML 经常是不配对的（开标签在一个令牌里、
    // 闭标签在几段之后），整段解析会把它们各自"补全"，破坏原有嵌套；逐标签重建则保持配对关系。
    // 安全性不依赖整段解析：每个标签都被单独重建为良构标签，标签之间的文本整体转义。
    function sanitizeFragment(raw, opts) {
        return String(raw || '').split(/(<[^>]+>)/g).map(function (seg) {
            if (seg.charAt(0) !== '<') return escapeHtml(seg);
            return sanTag(seg, opts);
        }).join('');
    }

    // 富媒体：![](url) 按类型渲染图/视频/音频；非白名单协议降级为转义文本
    function mediaHtml(url, alt) {
        var u = String(url), lu = u.toLowerCase();
        if (/\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/.test(lu) || /^data:video\//.test(lu)) {
            return '<video src="' + escapeHtml(u) + '" controls playsinline preload="metadata" style="max-width:100%;width:100%;border-radius:8px;margin:6px 0"></video>';
        }
        if (/\.(mp3|wav|m4a|aac|flac|ogg|opus)(\?|#|$)/.test(lu) || /^data:audio\//.test(lu)) {
            return '<audio src="' + escapeHtml(u) + '" controls preload="metadata" style="width:100%;margin:6px 0"></audio>';
        }
        if (/^(https?:\/\/|data:image\/(png|jpeg|gif|webp);|\/|\.\.\/|\.\/)/i.test(u)) {
            return '<img src="' + escapeHtml(u) + '" alt="' + escapeHtml(alt || u) + '" loading="lazy" onerror="this.outerHTML=this.alt" style="max-width:100%;height:auto;border-radius:8px;margin:6px 0;display:block">';
        }
        return escapeHtml(alt || u);
    }

    global.ZFMD = {
        escapeHtml: escapeHtml,
        SAFE_TAGS: SAFE_TAGS,
        RICH_TAGS: RICH_TAGS,
        tagPattern: tagPattern,
        sanTag: sanTag,
        sanitizeFragment: sanitizeFragment,
        mediaHtml: mediaHtml,
        // 批量净化任意 HTML（富模式）。调用方传入的多为 marked 的输出。
        sanitizeHtml: function (html) {
            var s = String(html === undefined || html === null ? '' : html);
            var dp = purifier();
            if (dp) return String(dp.sanitize(s, purifyConfig({ tags: 'rich' })));
            // 严格兜底：文本片段是 marked 已转义的输出，原样保留；只重建标签。
            // 但"像标签开头"的裸 "<"（如未闭合的 <iframe srcdoc=…，没有 ">" 不构成标签令牌）
            // 必须转义——否则浏览器会把它和后续内容续成一个活标签。
            return s.split(/(<\/?[a-zA-Z][^>]*>)/g).map(function (seg) {
                if (seg.charAt(0) === '<') return sanTag(seg, { tags: 'rich' });
                return seg.replace(/<(?=[a-zA-Z\/])/g, '&lt;');
            }).join('');
        },
        purifierReady: function () { return !!purifier(); }
    };

    // ===== 依赖加载 =====
    // DOMPurify 经项目的懒加载通道下发（window.LAZY_SCRIPTS 注册表），不往 index.html 加静态标签。
    // 它是异步到达的：到达前上面两条路径都走严格兜底（同样安全，只是保留的属性更少）。
    (function ensurePurifier() {
        if (global.DOMPurify || typeof global.document === 'undefined') return;
        try {
            if (global.LazyLoader && global.LAZY_SCRIPTS && global.LAZY_SCRIPTS.DOMPurify) {
                global.LazyLoader.load('DOMPurify', function () {});
            } else if (!global.document.querySelector('script[data-zf-purify]')) {
                var s = global.document.createElement('script');
                s.src = 'js/purify.min.js';
                s.setAttribute('data-zf-purify', '1');
                (global.document.head || global.document.documentElement).appendChild(s);
            }
        } catch (e) {
            if (typeof console !== 'undefined') console.warn('[ZFMD] DOMPurify 加载触发失败，保持严格兜底:', e);
        }
    })();

    if (typeof module !== 'undefined' && module.exports) module.exports = global.ZFMD;
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== ZFMD part2：核心解析（挂在 part1 的 window.ZFMD 上） ===== */
(function (global) {
    'use strict';
    var Z = global.ZFMD;
    var esc = Z.escapeHtml;

    // ---- 占位符：行内码 / 代码围栏 / 整行粗体（防后续拆行、序号替换、标题修复破坏它们） ----
    var PH = '\u0000Z', PH_END = '\u0000';
    function stash(store, val) { store.push(val); return PH + (store.length - 1) + PH_END; }
    function unstash(s, store) {
        return s.replace(new RegExp(PH + '(\\d+)' + PH_END, 'g'), function (_, i) { return store[+i] !== undefined ? store[+i] : ''; });
    }
    // 保护代码区（围栏 + 行内码）：所有 md 修复只作用于散文，代码原样透传
    function protectCode(s, store) {
        return s.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~|```[^\n]*$|`[^`\n]+`)/g, function (m) {
            return stash(store, m);
        });
    }

    // ---- 通用预处理（marked 与内置解析共用，一处修复全站受益） ----
    function preprocess(text, opts) {
        opts = opts || {};
        var s = String(text === undefined || text === null ? '' : text).replace(/\r\n?/g, '\n');
        var store = [];

        // ⓪ 代码区优先保护（后续任何正则都不许碰代码内容）
        s = protectCode(s, store);

        // ① 表格修复：@粘贴N 回注的表格每行之间被插入空行，GFM 表格遇空行即断
        s = s.replace(/(^[ \t]*\|[^\n]*\n)\n+(?=^[ \t]*\|)/gm, '$1');

        // ② ATX 标题修复：AI 常写 `###标题`（# 后无空格）marked 不识别 → 补空格
        if (opts.atxFix !== false) {
            s = s.replace(/^(\s{0,3})(#{1,6})(?=[^\s#])/gm, '$1$2 ');
        }

        // ③ 跨行粗体合并：**…** 跨行时 marked 不再识别（星号原样显示，即用户截图问题）
        //    仅合并「整段就是这一个粗体」的情形（后面紧跟换行或文本结尾），避免误合普通段落
        s = s.replace(/\*\*([^*\n](?:[^*]|\*(?!\*))*?)\*\*(?=[ \t]*(?:\n|$))/g, function (m, inner) {
            if (inner.indexOf('\n') === -1) return m;         // 单行的交回 marked 正常处理
            return '**' + inner.replace(/\s*\n\s*/g, ' ') + '**';
        });

        // ④ 带圈序号拆行：AI 常把 ①②③ 连排同一段，渲染挤成一坨 → 序号前补换行
        if (opts.cnSplit !== false) {
            // 整段单行粗体先纳入保护：拆行不能把粗体从中间劈开（劈开后跨行星号 marked 不认）
            var protectBold = function (x) {
                return x.replace(/\*\*(?=[^\s*])[^\n]*?[^\s*]\*\*/g, function (m) { return stash(store, m); });
            };
            s = protectBold(s);
            s = s.replace(/([^\n])([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑⒒⒓⒔⒕⒖⒗⒘⒙⒚⒛])/g, '$1\n$2');
            s = protectBold(s); // 拆行后新形成的整行粗体同样保护
            // 被保护起来交付 marked 的独立粗体片段，html 块默认会被转义，故这里直接转成 <strong>
            s = s.replace(/\*\*(?=[^\s*])([^*\n]{1,300}?)(?<=[^\s*])\*\*/g, '<strong>$1</strong>');
        }

        // ⑤ 泄漏 think 标签（marked 只在 HTML 块渲染器里剥，内置路径与散文需先处理）
        if (opts.thinkStrip !== false) {
            s = s.replace(/<\s*(think|thinking|thought|reasoning)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
                 .replace(/<\s*\/?\s*(think|thinking|thought|reasoning)\b[^>]*>/gi, '');
        }

        return unstash(s, store);
    }

    // ---- 行内渲染（单行场景：工具卡头部简述/参数值/表格单元格，不产生块级标签） ----
    //   顺序：行内码 → 图片 → 链接 → 原生标签净化 → 转义 → *** → ** → * → ~~ → __ → _
    function inline(text, opts) {
        opts = opts || {};
        var store = [];
        var s = String(text === undefined || text === null ? '' : text);

        // 行内码：内部只转义，不做任何 md 解析（星号等保持字面量）
        s = s.replace(/`([^`\n]+)`/g, function (m, c) {
            return stash(store, opts.codespan ? safeHook(opts.codespan, c) : codeOpen(opts) + esc(c) + '</code>');
        });
        // 图片：media=true 时按类型渲染图/视频/音频，否则退化为转义 alt 文本
        s = s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g, function (m, alt, url) {
            return stash(store, opts.media ? Z.mediaHtml(url, alt) : esc(alt || url));
        });
        // 链接：拦 javascript: / data:text\/html，其余协议（含本地路径）放行
        s = s.replace(/\[([^\]]+)\]\(\s*((?:[^()\s]|\([^)\s]*\))+)(?:\s+"[^"]*")?\s*\)/g, function (m, txt, url) {
            if (/^\s*(javascript|data):/i.test(url)) return stash(store, esc(txt));
            return stash(store, '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(txt) + '</a>');
        });
        // 原生 HTML 标签：白名单净化后放行（默认只放行行内安全标签，其余转义显示）
        s = s.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?\/?>/g, function (m) {
            return stash(store, Z.sanTag(m, opts));
        });

        // 剩余纯文本转义后做强调语法（*** / ** / * / ~~ 全部支持）
        s = esc(s);
        s = s.replace(/\*\*\*(?=[^\s*])([\s\S]*?[^\s*])\*\*\*/g, '<strong><em>$1</em></strong>');
        s = s.replace(/\*\*(?=[^\s*])([\s\S]*?[^\s*])\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>');
        s = s.replace(/(^|[^~\w])~~(?=[^\s~])([^~\n]*?[^\s~])~~(?![~\w])/g, '$1<del>$2</del>');
        s = s.replace(/(^|[^_\w])__(?=[^\s_])([^_\n]*?[^\s_])__(?![_\w])/g, '$1<strong>$2</strong>');
        s = s.replace(/(^|[^_\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![_\w])/g, '$1<em>$2</em>');

        // 换行转 <br> 必须在 unstash 之前：占位符里存的是代码围栏/图片标签原文，
        // 先 unstash 会把代码块内部换行也变成 <br>（破坏 <pre> 排版）。
        // 与 marked 的 breaks 行为对齐：默认单换行即软换行。
        if (opts.breaks !== false) s = s.replace(/\n/g, '<br>');
        s = unstash(s, store);
        return s;
    }

    function safeHook(fn, arg) {
        try { return String(fn(arg)); } catch (e) { return '<code>' + esc(arg) + '</code>'; }
    }
    // 行内码开标签：opts.codeStyle 时带内联样式（工具卡等无外部 CSS 依赖的场景）
    function codeOpen(opts) {
        return (opts && opts.codeStyle) ? '<code style="' + opts.codeStyle + '">' : '<code>';
    }

    Z.preprocess = preprocess;
    Z.inline = inline;
})(typeof window !== 'undefined' ? window : globalThis);

/* ===== ZFMD part3：块级渲染（marked 优先 + 内置兜底解析器） ===== */
(function (global) {
    'use strict';
    var Z = global.ZFMD;
    var esc = Z.escapeHtml;

    function hasMarked() {
        return typeof global.marked !== 'undefined' && global.marked &&
               (typeof global.marked.parse === 'function' || typeof global.marked === 'function');
    }

    // ---------- marked 路径（桌面主链路，保留既有全部定制） ----------
    var _markedInited = false;
    function markedParse(src, opts) {
        var mk = global.marked;
        if (!_markedInited && typeof mk.setOptions === 'function') {
            mk.setOptions({
                gfm: true, breaks: true,
                // 【安全 2026-11-23】marked 的"原始文本块"状态：行内（段落中间）出现 <script>/<style>/
                // <pre>/<textarea> 开标签后，其后的文本按原文输出、不转义；而本渲染器又把这些开标签
                // 转义成了文字——marked 以为在脚本里，浏览器看到的是正文，中间的原文就成了活标签：
                //   任务进度如下。<script><img/src="x"/onerror="alert(1)">
                // 旧版会把后面的 img 原样输出（图片加载失败即触发脚本，默认聊天路径、无需交互）。
                // 普通文本在分词阶段已转义，含裸 "<" 的 text 令牌只可能来自这种状态，统一转义掉。
                // walkTokens 是 marked 的全局选项，对站点内全部 marked.parse 调用方一并生效。
                walkTokens: function (token) {
                    if (token && token.type === 'text' && typeof token.text === 'string' &&
                        token.text.indexOf('<') !== -1) {
                        token.text = token.text.replace(/</g, '&lt;');
                    }
                },
                highlight: function (code, lang) {
                    if (typeof global.hljs !== 'undefined' && lang && global.hljs.getLanguage(lang)) {
                        try { return global.hljs.highlight(code, { language: lang }).value; } catch (e) {}
                    }
                    return code;
                }
            });
            _markedInited = true;
        }
        var parse = (typeof mk.parse === 'function') ? mk.parse : mk;
        if (typeof mk.Renderer !== 'function') return String(parse(src));

        var renderer = new mk.Renderer();
        renderer.html = function (token) {
            var raw = typeof token === 'string' ? token : (token && (token.raw || token.text) || '');
            raw = String(raw || '');
            // think 类标签泄漏剥离（marked 只把 HTML 块送进本渲染器，代码块不会走到这里，
            // 因此在此删除字面标签既彻底又不会误伤正文里合法展示的字面标签）
            if (opts.thinkStrip !== false) {
                raw = raw.replace(/<\s*(think|thinking|thought|reasoning)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
                         .replace(/<\s*\/?\s*(think|thinking|thought|reasoning)\b[^>]*>/gi, '');
            }
            if (opts.htmlHook) { try { raw = opts.htmlHook(raw); } catch (e) {} }
            // 原生 HTML 令牌整段交给 ZFMD 净化（DOMPurify 主路径 / 严格兜底，规则见 part1）：
            // 标签白名单 + 属性白名单，不放行 style 与表单控件，iframe 强制无同源的沙箱。
            // 旧实现在这里逐标签跑正则 sanTag、属性靠黑名单过滤——实测可被 "/" 分隔的事件属性、
            // 属性内 ">" 等写法绕过，已整体替换。
            return Z.sanitizeFragment(raw || '', opts);
        };
        renderer.codespan = function (token) {
            var raw = typeof token === 'string' ? token : (token && (token.text || token.raw) || '');
            var t = String(raw);
            if (opts.codespan) { try { return opts.codespan(t); } catch (e) {} }
            return '<code>' + esc(t) + '</code>';
        };
        // 【安全】链接/图片 URL 净化：拦 javascript: / vbscript: / data:text 协议（XSS 注入点）
        // marked 默认直接把 [x](javascript:alert(1)) 渲染成可点链接，必须覆写。与 sanTag 同策略。
        function safeUrl(u) {
            var lu = String(u || '').trim().toLowerCase().replace(/[\s\u0000-\u001F]/g, '');
            if (/^(javascript|vbscript):/.test(lu)) return null;
            if (/^data:/i.test(lu) && !/^data:(image|video|audio)\//.test(lu)) return null; // 拦 data:text/html 等
            return String(u || '').trim();
        }
        renderer.link = function (token) {
            var href = typeof token === 'object' && token ? (token.href || '') : (arguments.length >= 2 ? arguments[0] : '');
            var title = (typeof token === 'object' && token && token.title) || (typeof arguments[1] === 'string' ? arguments[1] : null) || null;
            var body  = (typeof token === 'object' && token) ? this.parser.parseInline(token.tokens) : (typeof arguments[2] === 'string' ? arguments[2] : String(arguments[arguments.length-1] || ''));
            var u = safeUrl(href);
            if (!u) return body;   // 危险协议 → 只渲染文字不渲染链接
            return '<a href="' + esc(u) + '" target="_blank" rel="noopener"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + body + '</a>';
        };
        renderer.image = function (token) {
            var href = typeof token === 'object' && token ? (token.href || '') : (arguments.length >= 2 ? arguments[0] : '');
            var title = (typeof token === 'object' && token && token.title) || (typeof arguments[1] === 'string' ? arguments[1] : null) || null;
            var alt   = (typeof token === 'object' && token && token.text) || String(arguments[arguments.length-1] || '');
            var u = safeUrl(href);
            if (!u) return esc(alt || '');
            return '<img src="' + esc(u) + '" alt="' + esc(alt || '') + '"' + (title ? ' title="' + esc(title) + '"' : '') + ' loading="lazy" style="max-width:100%;height:auto">';
        };
        return String(parse(src, { renderer: renderer }));
    }

    // ---------- 内置轻量块级解析器（marked 未就绪/手机版场景） ----------
    function blockParse(text, opts) {
        var blocks = [];
        var PH = '\u0001F', END = '\u0001';
        // 代码围栏先抽出，避免内部内容被行解析误伤
        var src = String(text || '').replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, function (m, lang, code) {
            blocks.push(code.replace(/\n$/, ''));
            return PH + (blocks.length - 1) + END;
        });
        var lines = src.split('\n'), html = [], inUl = false, inOl = false;
        function closeLists() { if (inUl) { html.push('</ul>'); inUl = false; } if (inOl) { html.push('</ol>'); inOl = false; } }

        for (var i = 0; i < lines.length; i++) {
            var L = lines[i];
            var bm = L.trim().match(new RegExp('^' + PH + '(\\d+)' + END + '$'));
            if (bm) {
                closeLists();
                var code = blocks[parseInt(bm[1], 10)] || '';
                html.push('<pre><code>' + esc(code) + '</code></pre>');
                continue;
            }
            var h = L.match(/^(#{1,6})\s+(.*)$/);
            if (h) { closeLists(); var hn = Math.min(h[1].length, 4); html.push('<h' + hn + '>' + Z.inline(h[2], opts) + '</h' + hn + '>'); continue; }
            if (/^\s*(---+|\*\*\*+)\s*$/.test(L)) { closeLists(); html.push('<hr>'); continue; }
            var ul = L.match(/^\s*[-*+]\s+(.*)$/);
            if (ul) { if (inOl) { html.push('</ol>'); inOl = false; } if (!inUl) { html.push('<ul>'); inUl = true; } html.push('<li>' + Z.inline(ul[1], opts) + '</li>'); continue; }
            var ol = L.match(/^\s*\d+[.、)]\s+(.*)$/);
            if (ol) { if (inUl) { html.push('</ul>'); inUl = false; } if (!inOl) { html.push('<ol>'); inOl = true; } html.push('<li>' + Z.inline(ol[1], opts) + '</li>'); continue; }
            var qt = L.match(/^>\s?(.*)$/);
            if (qt) { closeLists(); html.push('<blockquote>' + Z.inline(qt[1], opts) + '</blockquote>'); continue; }
            if (!L.trim()) { closeLists(); continue; }
            // 表格：连续 '|' 行成块（表头 + 分隔行可选）
            if (/\|/.test(L)) {
                var tbl = [], j = i;
                while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim()) { tbl.push(lines[j].trim().replace(/^\||\|$/g, '')); j++; }
                if (tbl.length >= 2) {
                    var isSep = function (cs) { return cs.length > 0 && cs.every(function (c) { return /^:?-{2,}:?$/.test(c) || c === ''; }); };
                    var rows = tbl.map(function (r) { return r.split('|').map(function (c) { return c.trim(); }); });
                    var head = rows[0], k = 1;
                    if (rows.length > 1 && isSep(rows[1])) k = 2;
                    var th = '<table><thead><tr>' + head.map(function (c) { return '<th>' + Z.inline(c, opts) + '</th>'; }).join('') + '</tr></thead><tbody>';
                    for (var ti = k; ti < rows.length; ti++) {
                        if (isSep(rows[ti])) continue;
                        th += '<tr>' + rows[ti].map(function (c) { return '<td>' + Z.inline(c, opts) + '</td>'; }).join('') + '</tr>';
                    }
                    closeLists(); html.push(th + '</tbody></table>'); i = j - 1; continue;
                }
            }
            closeLists();
            html.push('<p>' + Z.inline(L, opts) + '</p>');
        }
        closeLists();
        return html.join('');
    }

    // ---------- 统一入口 ----------
    // opts.wrap: 传入类名（如 'zfmd'）时用 <div class="..."> 包裹输出，配合 css/md-render.css 排版。
    //            默认不包裹 —— 聊天正文已有 style-markdown.css 的子选择器，包一层会影响既有样式，
    //            故只由「无既有排版依赖」的场景（工具卡/面板/手机版）显式开启。
    function wrapHtml(html, opts) {
        if (!opts || !opts.wrap) return html;
        return '<div class="' + esc(opts.wrap) + '">' + html + '</div>';
    }

    function render(text, opts) {
        opts = opts || {};
        if (text === undefined || text === null || text === '') return '';
        try {
            if (hasMarked()) return wrapHtml(markedParse(Z.preprocess(text, opts), opts), opts);
            if (opts.fallback === false) return null;   // 聊天层要等 marked 恢复，不中途降级
            return wrapHtml(blockParse(Z.preprocess(text, opts), opts), opts);
        } catch (e) {
            if (typeof console !== 'undefined') console.warn('[ZFMD] render 异常，降级为转义文本:', e);
            return wrapHtml('<p>' + esc(String(text)).replace(/\n/g, '<br>') + '</p>', opts);
        }
    }

    Z.hasMarked = hasMarked;
    Z.tagPattern = Z.tagPattern || null;
    Z.blockParse = blockParse;
    Z.render = render;
    Z.md = render;
})(typeof window !== 'undefined' ? window : globalThis);
