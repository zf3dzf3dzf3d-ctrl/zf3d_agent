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
 */
(function (global) {
    'use strict';

    // ===== 唯一 HTML 转义实现 =====
    function escapeHtml(s) {
        return String(s === undefined || s === null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    // 行内标签安全集：不含 src/href，不加载外部资源，不触发脚本
    var SAFE_TAGS = 'strong|b|em|i|u|s|del|mark|sub|sup|br|code|pre|span|small|kbd';
    // 富媒体标签集（手机版/正文允许内嵌图片视频时用）
    var RICH_TAGS = SAFE_TAGS + '|img|video|audio|source|a|hr|div|p|ul|ol|li|table|thead|tbody|tfoot|tr|th|td|blockquote|h[1-6]|figure|figcaption|details|summary|section|article|header|footer|main|nav|aside|center|label|input|select|option|button|form|iframe';
    // 裸 < > 兜底净化用最小集（比全标签白名单更保守，避免正文里的 "< 100" 被误转义）

    function tagPattern(opts) {
        return (opts && opts.tags === 'rich') ? RICH_TAGS : (opts && opts.tags) || SAFE_TAGS;
    }

    // 净化单个 HTML 标签：白名单 + 去事件属性 + 禁 javascript: + iframe 强制 sandbox
    function sanTag(t, opts) {
        var m = t.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([\s\S]*?)\/?>$/);
        if (!m) return escapeHtml(t);
        var close = m[1], name = m[2].toLowerCase(), attrs = m[3];
        if (!new RegExp('^(' + tagPattern(opts) + ')$', 'i').test(name)) return escapeHtml(t);
        if (close) return '</' + name + '>';
        attrs = attrs.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        attrs = attrs.replace(/(href|src|formaction|action)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '$1="#"');
        attrs = attrs.replace(/(href|src)\s*=\s*javascript:[^\s>]*/gi, '$1="#"');
        if (name === 'iframe') {
            attrs = attrs.replace(/\ssandbox\s*=\s*("[^"]*"|'[^']*')/i, '');
            return '<' + name + attrs + ' sandbox="allow-scripts" loading="lazy" style="max-width:100%;min-height:240px;border:1px solid var(--bg3);border-radius:8px;margin:6px 0">';
        }
        if (name === 'a') {
            if (!/\starget\s*=/i.test(attrs)) attrs += ' target="_blank"';
            if (!/\srel\s*=/i.test(attrs)) attrs += ' rel="noopener"';
        }
        if (name === 'img' && !/\sloading\s*=/i.test(attrs)) attrs += ' loading="lazy"';
        if (name === 'video' && !/\scontrols\s*=/i.test(attrs)) attrs += ' controls playsinline';
        if (name === 'audio' && !/\scontrols\s*=/i.test(attrs)) attrs += ' controls';
        return '<' + name + attrs + '>';
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
        if (/^(https?:\/\/|data:image\/|\/sdcard\/|file:\/\/|content:\/\/|\/|\.\.\/|\.\/)/i.test(u)) {
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
        mediaHtml: mediaHtml
    };
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
            // 白名单 + 属性净化（去 on* 事件、拦 javascript:、iframe 强制 sandbox）
            // 之前只白名单标签名，带 onerror 的 <img> 会被放行 —— 现统一走 Z.sanTag，
            // 与内置兜底解析器同一套净化规则，桌面/手机版行为一致。
            return String(raw || '').split(/(<[^>]+>)/g).map(function (seg) {
                if (seg.charAt(0) === '<') {
                    var m = seg.match(/^<\s*\/?\s*([a-zA-Z][a-zA-Z0-9]*)/);
                    if (!m || !new RegExp('^(' + Z.tagPattern(opts) + ')$', 'i').test(m[1])) return esc(seg);
                    return Z.sanTag(seg, opts);
                }
                return esc(seg);
            }).join('');
        };
        renderer.codespan = function (token) {
            var raw = typeof token === 'string' ? token : (token && (token.text || token.raw) || '');
            var t = String(raw);
            if (opts.codespan) { try { return opts.codespan(t); } catch (e) {} }
            return '<code>' + esc(t) + '</code>';
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
