// ==== 对话产出一键打开工作台（v2.0 施工 S1+S2 → 2026-11-23 生成物卡片化）====
// 职责：AI 消息里的代码围栏（md/txt/html）注入「生成物卡片」（对齐外部编码智能体的 artifact 卡）：
//        卡片 = 图标 + 展示文件名(html取<title>/md取首个#标题) + 类型标签 + 「打开」主按钮 + ▾更多菜单；
//        代码块本体保留在卡片下方（透明可查），自验收审核报告卡仍为橙色小按钮。
// 点击「打开」：md/txt → 落盘 public/canvas/文档/对话导出/ 后 WBFileViewer.open 打开
//               （抽屉懒构建：没开过工作台时先 __KiteNS.workbench.open() 建抽屉再重试）；
//        html 完整页 → 落盘 public/canvas/演示/ 后沙箱预览弹窗渲染（allow-scripts 无 same-origin，
//                       opaque origin 下调本地 API 被 CORS 拦截——代码师①缺口封死，禁新标签回退）；
//        html 片段 → 沙箱 iframe srcdoc 预览（sandbox 无 same-origin，AI 生成 JS 无法调本地 API）。
// ▾ 菜单：html → 「📄 在工作台查看源码」（查看器源码视图只看不改，不执行）；全部 → 「📋 复制全部内容」「📎 复制文件路径」。
// 审核报告：无按钮无整卡点击，报告表格首列的【具体文件路径】自动 linkify（.tool-path-link 委托），点路径即在工作台打开该真实文件。
// 颜色区分：data-filetype CSS 钩子（md=蓝 txt=灰 html=绿 report=橙），双主题适配。
(function () {
    'use strict';

    var EXPORT_DIR = 'public/canvas/文档/对话导出/';
    var DEMO_DIR = 'public/canvas/演示/';

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 毫秒级时间戳 + 随机尾巴：防同秒撞名（反驳师⑤）
    function genName(ext) {
        var d = new Date();
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        var ts = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + d.getMilliseconds();
        var rid = Math.random().toString(36).slice(2, 6);
        return 'chat-' + ts + '-' + rid + '.' + ext;
    }

    function ensureStyles() {
        if (document.getElementById('zf-wb-open-style')) return;
        var st = document.createElement('style');
        st.id = 'zf-wb-open-style';
        st.textContent =
            '.zf-wb-open-btn{display:inline-flex;align-items:center;gap:4px;margin:4px 0 0 8px;padding:2px 10px;font-size:11px;border-radius:12px;cursor:pointer;border:1px solid transparent;background:rgba(255,255,255,.06);color:#cdd8e4;vertical-align:middle;transition:background .15s}' +
            '.zf-wb-open-btn:hover{background:rgba(255,255,255,.14)}' +
            /* 颜色区分（S2.3）：md=蓝 txt=灰 html=绿 report=橙，暗色主题 */
            '.zf-wb-open-btn[data-filetype="md"]{color:#7ab8ff;border-color:rgba(90,150,255,.35);background:rgba(70,130,255,.10)}' +
            '.zf-wb-open-btn[data-filetype="md"]:hover{background:rgba(70,130,255,.22)}' +
            '.zf-wb-open-btn[data-filetype="txt"]{color:#b8c2cc;border-color:rgba(180,190,200,.30);background:rgba(180,190,200,.08)}' +
            '.zf-wb-open-btn[data-filetype="txt"]:hover{background:rgba(180,190,200,.18)}' +
            '.zf-wb-open-btn[data-filetype="html"]{color:#6fe8a0;border-color:rgba(60,180,110,.35);background:rgba(60,180,110,.10)}' +
            '.zf-wb-open-btn[data-filetype="html"]:hover{background:rgba(60,180,110,.22)}' +
            '.zf-wb-open-btn[data-filetype="report"]{color:#f0a860;border-color:rgba(220,140,60,.35);background:rgba(220,140,60,.10)}' +
            '.zf-wb-open-btn[data-filetype="report"]:hover{background:rgba(220,140,60,.22)}' +
            /* 浅色主题·旧小按钮（自验收报告卡 report 橙仍走此样式） */
            '.light .zf-wb-open-btn{background:rgba(0,0,0,.05);color:#445}' +
            '.light .zf-wb-open-btn[data-filetype="md"]{color:#1d5fd0;border-color:rgba(29,95,208,.35);background:rgba(29,95,208,.07)}' +
            '.light .zf-wb-open-btn[data-filetype="txt"]{color:#556;border-color:rgba(90,100,110,.35);background:rgba(90,100,110,.06)}' +
            '.light .zf-wb-open-btn[data-filetype="html"]{color:#0a8a4a;border-color:rgba(10,138,74,.35);background:rgba(10,138,74,.07)}' +
            '.light .zf-wb-open-btn[data-filetype="report"]{color:#c07010;border-color:rgba(192,112,16,.35);background:rgba(192,112,16,.07)}' +
            /* 生成物卡片（artifact card，2026-11-23）：图标+文件名+类型+打开+▾菜单，颜色沿用 md=蓝 txt=灰 html=绿 */
            '.zf-artifact-card{display:flex;align-items:center;gap:10px;margin:0 0 2px;padding:8px 10px;border:1px solid rgba(255,255,255,.08);border-bottom:none;border-radius:10px 10px 0 0;background:rgba(255,255,255,.045);min-width:0}' +
            '.zf-artifact-card[data-filetype="md"]{border-color:rgba(90,150,255,.30);background:rgba(70,130,255,.06)}' +
            '.zf-artifact-card[data-filetype="html"]{border-color:rgba(60,180,110,.30);background:rgba(60,180,110,.06)}' +
            '.zf-artifact-card[data-filetype="txt"]{border-color:rgba(180,190,200,.25);background:rgba(180,190,200,.05)}' +
            '.zf-artifact-ico{flex:none;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.07);color:#cdd8e4}' +
            '.zf-artifact-ico svg{width:18px;height:18px}' +
            '.zf-artifact-card[data-filetype="md"] .zf-artifact-ico{color:#7ab8ff;background:rgba(70,130,255,.12)}' +
            '.zf-artifact-card[data-filetype="html"] .zf-artifact-ico{color:#6fe8a0;background:rgba(60,180,110,.12)}' +
            '.zf-artifact-card[data-filetype="txt"] .zf-artifact-ico{color:#b8c2cc;background:rgba(180,190,200,.10)}' +
            '.zf-artifact-meta{flex:1;min-width:0}' +
            '.zf-artifact-name{font-size:13px;font-weight:600;color:#e8eef5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.zf-artifact-sub{font-size:11px;color:#8fa3b8;margin-top:1px}' +
            '.zf-artifact-actions{flex:none;position:relative;display:flex;align-items:center;gap:0}' +
            /* 分段胶囊「打开 ▾」（2026-11-23 再设计）：主段渐变色按文件类型，副段▾带分隔缝 */
            '.zf-artifact-openbtn{cursor:pointer;border:none;color:#fff;font-size:12px;font-weight:600;line-height:1;padding:8px 14px;border-radius:8px 0 0 8px;background:linear-gradient(135deg,#6b7686,#4a5563);transition:filter .15s,box-shadow .15s}' +
            '.zf-artifact-more{cursor:pointer;border:none;border-left:1px solid rgba(255,255,255,.28);color:rgba(255,255,255,.92);font-size:10px;width:24px;height:29px;border-radius:0 8px 8px 0;display:inline-flex;align-items:center;justify-content:center;background:#4a5563;transition:filter .15s}' +
            '.zf-artifact-openbtn:hover,.zf-artifact-more:hover{filter:brightness(1.18)}' +
            '.zf-artifact-openbtn:active,.zf-artifact-more:active{filter:brightness(.9)}' +
            '.zf-artifact-card[data-filetype="md"] .zf-artifact-openbtn{background:linear-gradient(135deg,#3d7bff,#1e56c8)}' +
            '.zf-artifact-card[data-filetype="md"] .zf-artifact-more{background:#1e56c8}' +
            '.zf-artifact-card[data-filetype="html"] .zf-artifact-openbtn{background:linear-gradient(135deg,#2fbf6f,#0d8a4d)}' +
            '.zf-artifact-card[data-filetype="html"] .zf-artifact-more{background:#0d8a4d}' +
            '.zf-artifact-card[data-filetype="txt"] .zf-artifact-openbtn{background:linear-gradient(135deg,#77828f,#525d6b)}' +
            '.zf-artifact-card[data-filetype="txt"] .zf-artifact-more{background:#525d6b}' +
            '.zf-artifact-menu{display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:99998;min-width:170px;background:#1a2230;border:1px solid #2c3644;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);padding:4px;flex-direction:column}' +
            '.zf-artifact-menu.open{display:flex}' +
            '.zf-artifact-menu button{cursor:pointer;border:none;background:none;color:#cdd8e4;font-size:12px;text-align:left;padding:6px 10px;border-radius:6px;white-space:nowrap}' +
            '.zf-artifact-menu button:hover{background:rgba(255,255,255,.08)}' +
            /* 浅色主题（body.light / html.light 任一钩子命中即生效） */
            '.light .zf-artifact-card{border-color:rgba(0,0,0,.10);background:rgba(0,0,0,.03)}' +
            '.light .zf-artifact-card[data-filetype="md"]{border-color:rgba(29,95,208,.30);background:rgba(29,95,208,.05)}' +
            '.light .zf-artifact-card[data-filetype="html"]{border-color:rgba(10,138,74,.30);background:rgba(10,138,74,.05)}' +
            '.light .zf-artifact-card[data-filetype="txt"]{border-color:rgba(90,100,110,.25);background:rgba(90,100,110,.04)}' +
            '.light .zf-artifact-name{color:#2a3542}' +
            '.light .zf-artifact-sub{color:#6b7a8c}' +
            '.light .zf-artifact-ico{background:rgba(0,0,0,.06);color:#445}' +
            '.light .zf-artifact-card[data-filetype="md"] .zf-artifact-ico{color:#1d5fd0;background:rgba(29,95,208,.08)}' +
            '.light .zf-artifact-card[data-filetype="html"] .zf-artifact-ico{color:#0a8a4a;background:rgba(10,138,74,.08)}' +
            '.light .zf-artifact-card[data-filetype="txt"] .zf-artifact-ico{color:#556;background:rgba(90,100,110,.08)}' +
            '.light .zf-artifact-openbtn{border-color:rgba(0,0,0,.15);background:rgba(0,0,0,.04);color:#2a3542}' +
            '.light .zf-artifact-openbtn:hover{background:rgba(0,0,0,.08)}' +
            '.light .zf-artifact-menu{background:#fff;border-color:#d6dde5;box-shadow:0 8px 24px rgba(0,0,0,.18)}' +
            '.light .zf-artifact-menu button{color:#2a3542}' +
            '.light .zf-artifact-menu button:hover{background:rgba(0,0,0,.06)}' +
            /* 审核报告表格文件路径链接：吃 style-chatbox 的 .tool-path-link 主题样式，无需内联 */
            /* HTML 片段沙箱预览弹窗 */
            '.zf-wb-preview-mask{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}' +
            '.zf-wb-preview-box{width:min(860px,92vw);height:min(640px,86vh);background:#fff;border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.5)}' +
            '.zf-wb-preview-head{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:#1a2230;color:#cdd8e4;font-size:12px}' +
            '.zf-wb-preview-head button{cursor:pointer;background:none;border:none;color:#cdd8e4;font-size:14px}' +
            '.zf-wb-preview-box iframe{flex:1;border:none;width:100%}';
        document.head.appendChild(st);
    }

    // 【2026-11-23 丝滑打开】内容哈希稳定路径：同一内容永远同一落盘文件。
    // 输出完成 → 渲染即落盘（幂等，已存在不覆盖）→ 文件有稳定路径 → 点击只做"打开"这一件事。
    function hash8(str) {
        var s = String(str), h = 5381;
        for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
        return (h >>> 0).toString(16).slice(0, 8);
    }
    // 稳定相对路径（不含 public/ 前缀）：canvas/文档/对话导出/chat-<hash8>.md
    function stableRel(dir, ext, text) {
        return dir.slice('public/'.length) + 'chat-' + hash8(text) + '.' + ext;
    }
    // 幂等落盘：先 GET 探测，已存在则免写（幂等省一次 IO）；404 才创建
    function ensureSaved(rel, text) {
        var full = 'public/' + rel;
        return fetch('/api/fs/text?path=' + encodeURIComponent(full)).then(function (r) {
            if (r.ok) return rel;               // 已有真实文件：保留现状（尊重用户编辑）
            return fetch('/api/fs/text-save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: full, text: text })
            }).then(function (r2) { return r2.json().then(function (j) { return { ok: r2.ok, j: j }; }); }).then(function (res) {
                if (!res.ok || !res.j.ok) throw new Error((res.j && res.j.error) || ('HTTP 失败'));
                return rel;
            });
        });
    }
    // 一次性落盘（自验收报告卡等旧路径仍走这里）
    function persist(text, ext, dir) {
        var path = dir + genName(ext);
        return fetch('/api/fs/text-save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path, text: text })
        }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
            if (!res.ok || !res.j.ok) throw new Error((res.j && res.j.error) || ('HTTP 失败'));
            var saved = res.j.path || path;
            // 归一为相对项目根的 posix 路径供 viewer/静态服务使用
            // 【修复 2026-11-23】接口实测返回绝对路径（如 E:\...\public\canvas\...），
            // 旧逻辑只处理「public/ 开头」的相对路径，绝对路径会原样透传，
            // 下游拼出 public/E:/... 导致 404。这里统一截取最后一个 /public/ 段。
            var rel = saved.replace(/\\/g, '/');
            var pubIdx = rel.lastIndexOf('/public/');
            if (pubIdx >= 0) rel = rel.slice(pubIdx + '/public/'.length);
            if (rel.indexOf('public/') === 0) rel = rel.slice('public/'.length);
            return rel;
        });
    }

    // 打开工作台「文本」页签（抽屉懒构建重试）；返回 false = 组件不可用
    // 【2026-11-23 对齐】box=卡片所在聊天框：与工作台按钮同款定位（workbenchActiveNode+显式 box），
    // 抽屉从此挂进同一聊天框，不再落到 DOM 第一个聊天框导致「打开位置不一致」。
    function openInWorkbench(rel, box) {
        /* 【对齐】首次尝试前就设置激活聊天框——查看器 drawerEl 按 workbenchActiveNode
           解析抽屉归属，多聊天框时文件必然渲染进卡片所在聊天框的工作台。 */
        try { if (box && window.__KiteNS) window.__KiteNS.workbenchActiveNode = box; } catch (e) {}
        var viewerReady = window.WBFileViewer && typeof WBFileViewer.open === 'function';
        /* 【修复 2026-11-23 多对话】目标聊天框还没有自己的抽屉时，viewer.open 会误回退到
           全局首个抽屉并返回 true——懒构建被跳过、文件渲染进别人的抽屉（乙对话打不开）。
           此时必须先走 __KiteNS.workbench.open(box) 懒构建，再延迟重试打开。 */
        var needBuild = !!box && !(box.querySelector && box.querySelector('.wb-drawer'));
        if (!needBuild && viewerReady) {
            if (WBFileViewer.open('public/' + rel, null, box)) return true;
        }
        var _wb = (window.__KiteNS && window.__KiteNS.workbench) || null;
        if (_wb && typeof _wb.open === 'function') {
            try { _wb.open(box); } catch (e) {}
            if (viewerReady) {
                /* 刚构建的抽屉页签委托可能尚未就绪，同步 activateFilesTab 点不进去——
                   对齐 openBrowserAt 的 120ms 延迟模式，稍后再调一次打开（查看器幂等，
                   loadingPaths 防同路径并发 fetch），保证「打开后界面直接定位到这个文件」。 */
                setTimeout(function () {
                    try { if (window.WBFileViewer && WBFileViewer.open) WBFileViewer.open('public/' + rel, null, box); } catch (e) {}
                }, 120);
            }
            return true;
        }
        return false;
    }

    function wbErrToast(msg) {
        if (window.ToastStack && ToastStack.show) ToastStack.show(msg, 'error');
        else alert(msg);
    }

    // 落盘 + 打开（md/txt/html 完整页共用）：html 走沙箱预览弹窗，md/txt 进工作台文本页签。
    // 【2026-11-23 多次打开】savedRef 同卡片复用首次落盘路径：重复点击=重新调起同一文件
    // （查看器聚焦同一标签 / html 重开预览弹窗），不再另存副本、不再显示「✓ 已打开」死态。
    function saveAndOpen(text, ext, filetype, btn, box, savedRef) {
        var dir = (filetype === 'html') ? DEMO_DIR : EXPORT_DIR;
        var setOk = function () {
            if (!btn) return;
            var old = btn.innerHTML;
            btn.innerHTML = '✓';
            setTimeout(function () { btn.innerHTML = old; }, 900);
        };
        var doOpen = function (rel) {
            if (filetype === 'html') {
                // 完整页：落盘后走沙箱预览弹窗（iframe.src + allow-scripts 无 same-origin，
                // opaque origin 下同源 API 调用被 CORS 拦截——代码师①缺口封死）。
                // 【整改 2026-11-23】html 禁走 window.open 新标签回退（同源直开会让 AI 生成的脚本
                // 以同源身份访问本地 API，绕过沙箱），无论组件是否就绪都不回退。
                openPreview('/' + rel, true, '网页预览（沙箱运行，无法访问本地 API）', true);
            } else if (!openInWorkbench(rel, box)) {
                // 兜底：无工作台 API 时才退新标签（静态服务直开，md 无样式但内容可见）
                window.open('/' + rel, '_blank');
            }
        };
        if (savedRef && savedRef.rel) {
            /* 【2026-11-23 丝滑打开】渲染期已按稳定路径落盘：文件在 → 直接打开零等待；
               未确认（渲染期落盘失败/未完成）→ 点击时补一次幂等落盘再开 */
            if (savedRef.saved) { doOpen(savedRef.rel); return; }
            ensureSaved(savedRef.rel, text).then(function () {
                savedRef.saved = true;
                doOpen(savedRef.rel);
                setOk();
            }).catch(function (err) {
                wbErrToast('打开工作台失败: ' + err.message);
            });
            return;
        }
        persist(text, ext, dir).then(function (rel) {
            if (savedRef) savedRef.rel = rel;
            doOpen(rel);
            setOk();
        }).catch(function (err) {
            wbErrToast('打开工作台失败: ' + err.message);
        });
    }

    // 卡片菜单「在工作台编辑源码」：落盘后仅打开查看器（html 也是源码视图不执行），不弹沙箱预览
    function workbenchEdit(text, ext, filetype, btn, box, savedRef) {
        var dir = (filetype === 'html') ? DEMO_DIR : EXPORT_DIR;
        var setOk = function () {
            if (!btn) return;
            var old = btn.innerHTML;
            btn.innerHTML = '✓';
            setTimeout(function () { btn.innerHTML = old; }, 900);
        };
        var doOpen = function (rel) {
            if (!openInWorkbench(rel, box)) {
                wbErrToast('工作台组件未就绪，无法打开');
                return;
            }
            setOk();
        };
        if (savedRef && savedRef.rel) {
            if (savedRef.saved) { doOpen(savedRef.rel); return; }
            ensureSaved(savedRef.rel, text).then(function () {
                savedRef.saved = true;
                doOpen(savedRef.rel);
            }).catch(function (err) {
                wbErrToast('打开工作台失败: ' + err.message);
            });
            return;
        }
        persist(text, ext, dir).then(function (rel) {
            if (savedRef) savedRef.rel = rel;
            doOpen(rel);
        }).catch(function (err) {
            wbErrToast('打开工作台失败: ' + err.message);
        });
    }

    // 复制全部内容（按钮 ✓ 反馈）
    function copyText(text, feedbackBtn) {
        var done = function () {
            if (!feedbackBtn) return;
            var old = feedbackBtn.textContent;
            feedbackBtn.textContent = '✓ 已复制';
            setTimeout(function () { feedbackBtn.textContent = old; }, 1200);
        };
        var fallback = function () {
            try {
                var ta = document.createElement('textarea');
                ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            } catch (e) {}
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(); done(); });
        else { fallback(); done(); }
    }

    // 收起全部展开中的卡片菜单
    function closeAllMenus() {
        Array.prototype.forEach.call(document.querySelectorAll('.zf-artifact-menu.open'), function (m) { m.classList.remove('open'); });
    }
    // 文档级一次性委托：点击卡片操作区之外任意处收起菜单（capture 先行，菜单内点击由自身 stopPropagation 保留）
    document.addEventListener('click', function (e) {
        if (e.target && e.target.closest && e.target.closest('.zf-artifact-actions')) return;
        closeAllMenus();
    }, true);

    var TXT_MIN_LEN = 500; // 纯文本触发阈值（策划案口径 500 字）

    // 沙箱预览弹窗：srcOrHtml 为 URL 时 iframe.src 加载（完整页），否则 srcdoc（片段）
    // sandbox 策略：allow-scripts 保留 JS 运行效果，但**无 allow-same-origin** →
    // 文档处于 opaque origin，对本地 API 的 JSON POST 会因 CORS 预检被浏览器拦截，
    // AI 生成脚本无法读写项目文件（反驳师②/代码师① 同源执行缺口封死）。
    function openPreview(srcOrHtml, isUrl, title, allowScripts) {
        var mask = document.createElement('div');
        mask.className = 'zf-wb-preview-mask';
        mask.innerHTML =
            '<div class="zf-wb-preview-box">' +
            '<div class="zf-wb-preview-head"><span>' + esc(title) + '</span><button title="关闭">✕</button></div>' +
            '<iframe sandbox="' + (allowScripts ? 'allow-scripts' : '') + '" referrerpolicy="no-referrer"></iframe></div>';
        var frame = mask.querySelector('iframe');
        if (isUrl) frame.src = srcOrHtml; else frame.srcdoc = srcOrHtml;
        var close = function () { mask.remove(); };
        mask.querySelector('button').addEventListener('click', close);
        mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
        document.body.appendChild(mask);
    }

    // HTML 片段：沙箱 srcdoc 预览（无 same-origin、无脚本）
    function previewFragment(html, btn) {
        openPreview(html, false, 'HTML 片段预览（沙箱，不执行脚本）', false);
    }

    function isCompleteHtml(t) {
        return /^\s*(<!doctype\s+html|<html[\s>])/i.test(t);
    }

    // ---- 【2026-11-23 生成物卡片】图标 + 展示名 + 类型标签 + 打开 + ▾更多（对齐外部编码智能体 artifact 卡）----
    var ARTIFACT_ICONS = {
        html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 2.6 4.2 5.6 4.2 9S14.8 18.4 12 21c-2.8-2.6-4.2-5.6-4.2-9S9.2 5.6 12 3z"/></svg>',
        md: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7 14.5v-5l2.5 3 2.5-3v5M17.5 9.5v5M15.5 12.5l2 2 2-2"/></svg>',
        txt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 15.5h6"/></svg>'
    };

    // 展示名：html 取 <title>，md 取首个 # 标题，统一去危险字符并截断防超长；取不到用默认名
    function artifactName(filetype, code) {
        var t = '';
        if (filetype === 'html') {
            var m = /<title[^>]*>([^<]*)<\/title>/i.exec(code);
            t = m ? m[1].replace(/[<>"]/g, '').trim() : '';
            if (!t) t = '网页';
            return t.slice(0, 24) + '.html';
        }
        if (filetype === 'md') {
            var h = /^\s*#\s+(.+?)\s*$/m.exec(code);
            t = h ? h[1].replace(/[<>`*\[\]#]/g, '').trim() : '';
            if (!t) t = '文档';
            return t.slice(0, 24) + '.md';
        }
        return '文本.txt';
    }

    function artifactSub(filetype, code) {
        if (filetype === 'html') return isCompleteHtml(code) ? '网站 · HTML' : '网页片段 · HTML';
        if (filetype === 'md') return '文档 · Markdown';
        return '文本 · 纯文本';
    }

    function buildArtifactCard(filetype, code, box) {
        var card = document.createElement('div');
        card.className = 'zf-artifact-card';
        card.setAttribute('data-filetype', filetype);
        var htmlComplete = filetype === 'html' && isCompleteHtml(code);
        card.innerHTML =
            '<div class="zf-artifact-ico">' + (ARTIFACT_ICONS[filetype] || ARTIFACT_ICONS.txt) + '</div>' +
            '<div class="zf-artifact-meta">' +
                '<div class="zf-artifact-name">' + esc(artifactName(filetype, code)) + '</div>' +
                '<div class="zf-artifact-sub">' + esc(artifactSub(filetype, code)) + '</div>' +
            '</div>' +
            '<div class="zf-artifact-actions">' +
                '<button type="button" class="zf-artifact-openbtn">打开</button>' +
                '<button type="button" class="zf-artifact-more" title="更多操作">▾</button>' +
                '<div class="zf-artifact-menu">' +
                    (filetype === 'html' ? '<button type="button" data-act="edit">📄 在工作台查看源码</button>' : '') +
                    '<button type="button" data-act="copy">📋 复制全部内容</button>' +
                    '<button type="button" data-act="copypath">📎 复制文件路径</button>' +
                '</div>' +
            '</div>';
        /* 【2026-11-23 丝滑打开】渲染即定路径+落盘：输出完成 → 真实文件即刻存在（幂等，
           已存在免写）→ 点击零落盘直达。工作台只看（用户口径），不做手动编辑。
           html 片段不落盘（无独立文件语义），点击时临时沙箱预览。 */
        var savedRef = { rel: null, saved: false };
        if (!(filetype === 'html' && !htmlComplete)) {
            var dir = (filetype === 'html') ? DEMO_DIR : EXPORT_DIR;
            savedRef.rel = stableRel(dir, filetype, code);
            card.setAttribute('title', 'public/' + savedRef.rel);
            ensureSaved(savedRef.rel, code).then(function () {
                savedRef.saved = true;
            }).catch(function () { /* 点击时兜底重存（saveAndOpen 内 ensureSaved） */ });
        }
        var openBtn = card.querySelector('.zf-artifact-openbtn');
        openBtn.addEventListener('click', function (e) {
            e.stopPropagation(); e.preventDefault();
            if (filetype === 'html' && !isCompleteHtml(code)) { previewFragment(code, openBtn); return; }
            saveAndOpen(code, filetype, filetype, openBtn, box, savedRef);
        });
        var moreBtn = card.querySelector('.zf-artifact-more');
        var menu = card.querySelector('.zf-artifact-menu');
        moreBtn.addEventListener('click', function (e) {
            e.stopPropagation(); e.preventDefault();
            var willOpen = !menu.classList.contains('open');
            closeAllMenus();
            if (willOpen) menu.classList.add('open');
        });
        menu.addEventListener('click', function (e) {
            var item = e.target && e.target.closest && e.target.closest('button[data-act]');
            if (!item) return;
            e.stopPropagation();
            var act = item.getAttribute('data-act');
            closeAllMenus();
            if (act === 'copy') { copyText(code, moreBtn); return; }
            if (act === 'copypath') { copyText(savedRef.rel ? 'public/' + savedRef.rel : '', moreBtn); return; }
            if (act === 'edit') { workbenchEdit(code, filetype, filetype, openBtn, box, savedRef); return; }
        });
        return card;
    }


    // 给单个代码围栏挂按钮；rawCode = 从 message 原始文本切片出的围栏原文（优先用，
    // 因高亮后 DOM textContent 与原文可能不一致——策划案最大坑；取不到时回退 DOM）
    function attachToCode(block, rawCode) {
        var pre = block.parentElement;
        if (!pre || (pre.parentElement && (pre.parentElement.querySelector('.zf-artifact-card') || pre.parentElement.querySelector('.zf-wb-open-btn')))) return; // 显式括号（代码师⑤）
        /* 【修复 2026-11-23】hljs 对 html 围栏会同时挂 language-html 与 language-xml（html 按 xml 语法高亮），
           原写法单变量「后写覆盖」最终取到 'xml' → html 围栏永远判不上、不注入按钮（用户反馈：生成的 html 点不了工作台）。
           改为收集全部 language-* 别名，命中任一即判定。 */
        var langs = [];
        (block.classList || []).forEach(function (c) { if (c.indexOf('language-') === 0) langs.push(c.slice(9).toLowerCase()); });
        var code = (typeof rawCode === 'string' && rawCode.trim()) ? rawCode : (block.textContent || '');
        if (!code.trim()) return;
        var filetype = null;
        if (langs.indexOf('html') >= 0 || langs.indexOf('htm') >= 0) {
            filetype = 'html';
        } else if (langs.indexOf('md') >= 0 || langs.indexOf('markdown') >= 0) {
            filetype = 'md';
        } else if (!langs.length && code.length > TXT_MIN_LEN && !/[{};=]/.test(code.slice(0, 80)) ) {
            // 无语言围栏且不像代码 → 视为纯文本（反驳师④：不按长度误触发代码块）
            filetype = 'txt';
        } else { return; }
        var wrap = pre.parentElement;
        if (!wrap || !wrap.classList.contains('code-wrap')) {
            wrap = document.createElement('div');
            wrap.className = 'code-wrap';
            pre.parentNode.insertBefore(wrap, pre);
            wrap.appendChild(pre);
        }
        // 【2026-11-23 卡片化】小按钮升级为生成物卡片（图标+文件名+类型+打开+▾菜单），置于代码块上方；
        // .zf-wb-open-btn 旧类查重保留（防旧消息残留双入口）。
        // box=宿主聊天框：传给工作台做同位挂载（与工作台按钮打开位置一致）
        if (wrap.querySelector('.zf-artifact-card') || wrap.querySelector('.zf-wb-open-btn')) return;
        var box = null;
        try { box = pre.closest('.chatbox, .chat-box, .chat-node'); } catch (e) {}
        wrap.insertBefore(buildArtifactCard(filetype, code, box), wrap.firstChild);
    }

    // 从消息原始文本按出现顺序提取 ```lang 代码围栏原文（S2：不依赖高亮后 DOM）
    function extractFences(rawText) {
        var out = [];
        if (typeof rawText !== 'string' || !rawText) return out;
        var re = /```([^\n`]*)\n([\s\S]*?)```/g, m;
        while ((m = re.exec(rawText)) !== null) out.push(m[2]);
        return out;
    }

    // 对外入口：增强一条 AI 消息（div=已渲染 DOM，rawText=消息原始文本）
    function enhance(div, rawText) {
        try {
            ensureStyles();
            if (!div) return;
            // 常规代码围栏：原始文本切片序号与 DOM 围栏序号一一对齐，优先用原文
            var fences = extractFences(rawText);
            var idx = 0;
            div.querySelectorAll('pre code').forEach(function (b) {
                attachToCode(b, fences[idx++] || null);
            });
        } catch (e) { /* 静默兜底，不影响消息渲染 */ }
    }

    // 【2026-11-23 按用户口径二次修正】工作台的入口是自验收表格里的【具体文件路径】，
    // 不是审核报告本身：报告渲染后把表格首列的文件路径 linkify 成 .tool-path-link
    // （复用 tools-06 的文档级委托：点击 → FileTree._openTextPreview / WBFileViewer
    // 打开真实文件，失败回退文件树定位）。报告摘要本身只做原生展开/收起，无任何按钮。
    function enhanceReport(reportTxt, card) {
        try {
            if (!card) return;
            var bodies = card.querySelectorAll('.zf-sg-body');
            Array.prototype.forEach.call(bodies, function (body) {
                if (body.classList.contains('zf-paths-linked')) return;
                body.classList.add('zf-paths-linked');
                Array.prototype.forEach.call(body.querySelectorAll('table tbody tr'), function (tr) {
                    var td = tr.querySelector('td');
                    if (!td || td.querySelector('.tool-path-link')) return;
                    var raw = (td.textContent || '').replace(/\s+/g, '');
                    if (!raw || raw.length > 160) return;
                    // 像路径/文件名：含路径分隔符，或带扩展名（纯文字如“合计”不命中）
                    if (!(/[\/]/.test(raw) || /\.[A-Za-z0-9]{1,8}$/.test(raw))) return;
                    var span = document.createElement('span');
                    span.className = 'tool-path-link';
                    span.setAttribute('data-ftpath', raw);
                    span.setAttribute('title', '点击在工作台查看该文件');
                    span.textContent = raw;
                    td.textContent = '';
                    td.appendChild(span);
                });
            });
        } catch (e) { /* 静默兜底 */ }
    }

    window.ZFWbOpen = { enhance: enhance, enhanceReport: enhanceReport, saveAndOpen: saveAndOpen };
})();
