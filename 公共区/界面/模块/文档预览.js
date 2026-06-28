/**
 * 文档预览 — 文档预览器+修改高亮
 * 从 逻辑.js 拆分
 */

// ============ 文档预览器 ============
async function showDocument(fullPath, name) {
    stopSlideshow();
    hideAudioPlayer();
    hideVideoPlayer();
    // 已打开则切换
    const existIdx = openFiles.findIndex(f => f.path === fullPath && f.type === 'document');
    if (existIdx >= 0) { if (existIdx !== activeFileIdx) switchTab(existIdx); return; }
    // 确保编辑器面板可见
    const ep = document.getElementById("editorPanel");
    const eb = document.getElementById("toggleEditor");
    if (ep.classList.contains("hidden")) { ep.classList.remove("hidden"); eb.classList.add("active"); updateDividers(); }
    // 创建文档标签页
    openFiles.push({ path: fullPath, name, content: "", dirty: false, type: 'document', docNodes: null, selection: null });
    const newIdx = openFiles.length - 1;
    switchTab(newIdx);
    await renderDocumentContent(newIdx);
}

// 文档内容渲染（可复用于初次打开、刷新、AI修改后自动更新）
async function renderDocumentContent(idx) {
    const f = openFiles[idx];
    if (!f || f.type !== 'document') return;
    const isActive = (idx === activeFileIdx);
    const target = isActive ? document.getElementById("docContent") : document.createElement("div");
    if (isActive) target.innerHTML = '<div style="color:#888;text-align:center;padding:40px;">加载中...</div>';
    try {
        const ext = (f.name.split(".").pop() || "").toLowerCase();
        if (ext === "pdf") {
            if (!window.pdfjsLib) throw new Error("PDF.js 未加载");
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
            const res = await fetch(`/api/file-content?path=${encodeURIComponent(f.path)}`);
            if (!res.ok) throw new Error("无法读取PDF文件");
            const buf = await res.arrayBuffer();
            const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
            target.innerHTML = "";
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 1.5 });
                const canvas = document.createElement("canvas");
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                canvas.style.cssText = "display:block;margin:0 auto 12px;box-shadow:0 2px 8px rgba(0,0,0,0.15);";
                target.appendChild(canvas);
                await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            }
        } else {
            const res = await fetch(`/api/file-content?path=${encodeURIComponent(f.path)}`);
            if (!res.ok) throw new Error("无法读取文件");
            const buf = await res.arrayBuffer();
            if (ext === "doc") {
                const res2 = await fetch(`/api/doc-content?path=${encodeURIComponent(f.path)}`);
                const d = await res2.json();
                if (!d.成功) throw new Error(d.错误 || "无法读取");
                target.innerHTML = d.html;
            } else if (ext === "xlsx" || ext === "xls") {
                const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
                let html = "";
                for (const sheetName of wb.SheetNames) {
                    const ws = wb.Sheets[sheetName];
                    let tableHtml = XLSX.utils.sheet_to_html(ws, { editable: false });
                    // sheet_to_html可能返回空，回退到sheet_to_json
                    if (!tableHtml || tableHtml.trim() === "<table></table>") {
                        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
                        if (rows.length > 0) {
                            tableHtml = "<table>";
                            for (const row of rows) {
                                tableHtml += "<tr>" + row.map(c => `<td>${String(c ?? "").replace(/</g,"&lt;")}</td>`).join("") + "</tr>";
                            }
                            tableHtml += "</table>";
                        }
                    }
                    html += `<h3 style="margin:16px 0 8px;">工作表: ${sheetName}</h3>`;
                    html += tableHtml || "<p>（空工作表）</p>";
                }
                target.innerHTML = html || "<p>（空表格）</p>";
            } else if (ext === "csv") {
                const text = new TextDecoder("utf-8").decode(buf);
                const rows = text.split(/\r?\n/).filter(r => r.trim());
                let html = "<table>";
                for (const row of rows) {
                    const cells = row.split(",");
                    html += "<tr>" + cells.map(c => `<td>${c.replace(/</g,"&lt;")}</td>`).join("") + "</tr>";
                }
                html += "</table>";
                target.innerHTML = html;
            } else if (ext === "docx") {
                const res2 = await fetch(`/api/docx-content?path=${encodeURIComponent(f.path)}`);
                const d = await res2.json();
                if (!d.成功) throw new Error(d.错误 || "无法读取");
                target.innerHTML = d.html;
            } else {
                target.innerHTML = "<p>不支持的文档格式</p>";
            }
        }
        f.docNodes = Array.from(target.childNodes);
    } catch (e) {
        target.innerHTML = `<div style="color:#c00;text-align:center;padding:40px;">❌ 无法加载文档: ${e.message}</div>`;
        f.docNodes = Array.from(target.childNodes);
    }
}

// ============ 文档修改高亮（类似代码编辑器的diff动画） ============
function highlightDocChanges(changes) {
    // 仅对当前激活的文档标签页生效
    if (activeFileIdx < 0 || openFiles[activeFileIdx]?.type !== 'document') return;
    const content = document.getElementById("docContent");
    if (!content) return;

    for (const change of changes) {
        const isDelete = !change.新文本 || change.新文本.trim() === "";
        const opType = isDelete ? "delete" : "modify";
        const opLabel = isDelete ? "已删除" : "已替换";
        const opIcon = isDelete ? "🗑️" : "✏️";

        // 在渲染的HTML中查找新文本并高亮
        if (!isDelete) {
            highlightDocText(content, change.新文本);
        }

        // 显示Banner
        showDocModifiedBanner(content, change, opType);

        // Toast
        const fname = openFiles[activeFileIdx]?.name || "";
        const textPreview = (isDelete ? change.旧文本 : change.新文本).substring(0, 30);
        const ellipsis = (isDelete ? change.旧文本 : change.新文本).length > 30 ? "..." : "";
        showToast(opType, `${opIcon} ${opLabel}`, `${fname}: ${textPreview}${ellipsis}`);
    }
}

// 在文档HTML中查找并高亮文本
function highlightDocText(content, searchText) {
    if (!searchText || searchText.length === 0) return;

    // TreeWalker遍历所有文本节点
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null, false);
    const matches = [];
    while (walker.nextNode()) {
        if (walker.currentNode.textContent.includes(searchText)) {
            matches.push(walker.currentNode);
        }
    }

    // 未找到精确匹配时，尝试用前50字符（mammoth可能拆分了文本节点）
    if (matches.length === 0 && searchText.length > 50) {
        const short = searchText.substring(0, 50);
        while (walker.currentNode) walker.previousNode(); // 重置
        const walker2 = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null, false);
        while (walker2.nextNode()) {
            if (walker2.currentNode.textContent.includes(short)) {
                matches.push(walker2.currentNode);
            }
        }
        if (matches.length > 0) searchText = short;
    }

    let firstMatch = null;
    for (const node of matches) {
        const text = node.textContent;
        const idx = text.indexOf(searchText);
        if (idx === -1) continue;

        const before = document.createTextNode(text.substring(0, idx));
        const span = document.createElement('span');
        span.className = 'doc-flash-highlight';
        span.textContent = searchText;
        const after = document.createTextNode(text.substring(idx + searchText.length));

        const parent = node.parentNode;
        parent.insertBefore(before, node);
        parent.insertBefore(span, node);
        parent.insertBefore(after, node);
        parent.removeChild(node);

        if (!firstMatch) firstMatch = span;

        // 5秒后淡出并恢复
        setTimeout(() => {
            span.classList.add('fade-out');
            setTimeout(() => {
                if (span.parentNode) {
                    const txt = document.createTextNode(span.textContent);
                    span.parentNode.replaceChild(txt, span);
                    txt.parentNode.normalize();
                }
            }, 1000);
        }, 5000);
    }

    // 滚动到第一个匹配
    if (firstMatch) {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// 文档修改Banner
function showDocModifiedBanner(content, change, opType) {
    const docViewer = document.getElementById("docViewer");
    if (!docViewer) return;
    // 清除旧banner
    docViewer.querySelectorAll(".doc-modified-banner").forEach(b => b.remove());

    const isDelete = opType === "delete";
    const icon = isDelete ? "🗑️" : "✏️";
    const label = isDelete ? "已删除" : "已替换";
    const textPreview = (isDelete ? change.旧文本 : change.新文本).substring(0, 30);
    const ellipsis = (isDelete ? change.旧文本 : change.新文本).length > 30 ? "..." : "";

    const banner = document.createElement("div");
    banner.className = `doc-modified-banner ${opType}`;
    banner.innerHTML = `<span>${icon} ${label}: 「${textPreview}${ellipsis}」</span><span class="banner-close" onclick="this.parentElement.remove()">✕</span>`;
    docViewer.appendChild(banner);

    setTimeout(() => {
        if (banner.parentElement) {
            banner.style.opacity = "0";
            banner.style.transition = "opacity 0.5s";
            setTimeout(() => banner.remove(), 500);
        }
    }, 4000);
}

