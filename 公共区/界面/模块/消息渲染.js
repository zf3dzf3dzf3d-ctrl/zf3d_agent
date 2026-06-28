/**
 * 消息渲染 — 消息显示+渲染+路径链接化+清空对话
 * 从 逻辑.js 拆分
 */

// ============ 消息显示 ============
function addMsg(role, text, time) {
    const list = document.getElementById("msgList");
    const el = document.createElement("div");
    el.className = `msg ${role === "user" ? "user" : role === "system" ? "system" : "assistant"}`;
    // 时间戳标签
    if (time) {
        const t = document.createElement("div");
        t.className = "msg-time";
        t.textContent = time;
        el.appendChild(t);
    }
    const body = document.createElement("div");
    body.className = "msg-body";
    body.innerHTML = renderMsg(text);
    bindFolderLinks(body);
    el.appendChild(body);
    list.appendChild(el);
    addCopyButtons(el);
    list.scrollTop = list.scrollHeight;
}

// 给代码块添加复制按钮（DOM插入后添加，避免innerHTML丢失事件）
function addCopyButtons(container) {
    container.querySelectorAll('pre code').forEach(block => {
        const pre = block.parentElement;
        if (pre.querySelector('.code-copy-btn')) return; // 已有按钮则跳过
        pre.style.position = 'relative';
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.textContent = '📋';
        btn.addEventListener('click', function() {
            const text = block.textContent;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => {
                    btn.textContent = '✅';
                    setTimeout(() => btn.textContent = '📋', 1000);
                }).catch(() => {
                    fallbackCopy(text, btn);
                });
            } else {
                fallbackCopy(text, btn);
            }
        });
        pre.appendChild(btn);
    });
}

// 兼容非HTTPS环境的复制降级方案
function fallbackCopy(text, btn) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        btn.textContent = '✅';
        setTimeout(() => btn.textContent = '📋', 1000);
    } catch(e) {
        btn.textContent = '❌';
        setTimeout(() => btn.textContent = '📋', 1000);
    }
    document.body.removeChild(ta);
}

// 消息文本预处理：自动插入换行，让堆砌的文字分段显示
function _preprocessText(text) {
    if (!text) return text;
    // 不处理代码块内的内容
    let 代码块 = [];
    text = text.replace(/```[\s\S]*?```/g, (m) => { 代码块.push(m); return `\x00CODEBLOCK${代码块.length - 1}\x00`; });

    // 在"！"后插入换行（后面跟非换行、非结尾内容时）
    text = text.replace(/(！)([^\n！])/g, '$1\n$2');
    // 在"。"后插入换行（后面跟非换行内容时，排除小数点）
    text = text.replace(/(。)([^\n。0-9])/g, '$1\n$2');
    // 在"继续"/"接下来"/"然后开始"/"现在开始"前插入换行
    text = text.replace(/([^\n])(继续|接下来|然后开始|现在开始第|开始第)/g, '$1\n$2');
    // 在"——"前插入换行（步骤分隔符）
    text = text.replace(/([^\n])(——)/g, '$1\n$2');
    // 多个连续换行合并为两个
    text = text.replace(/\n{3,}/g, '\n\n');

    // 恢复代码块
    代码块.forEach((block, i) => { text = text.replace(`\x00CODEBLOCK${i}\x00`, block); });
    return text;
}

// HTML后处理：为关键内容添加彩色callout样式
function _enhanceHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    // 遍历直接子节点（段落、列表等），为含特定关键词的段落添加样式类
    const 子节点 = tmp.querySelectorAll('p, li');
    子节点.forEach(p => {
        const txt = p.textContent.trim();
        if (!txt) return;
        // 成功消息
        if (/✅|成功|完成|创建成功|已生成|已保存/.test(txt) && txt.length < 100) {
            p.classList.add('msg-callout', 'msg-success');
        }
        // 错误消息
        else if (/❌|失败|错误|报错|异常/.test(txt) && txt.length < 100) {
            p.classList.add('msg-callout', 'msg-error');
        }
        // 步骤标记
        else if (/第\d+步|步骤\d+|开始第|继续创建|继续写|现在开始/.test(txt) && txt.length < 80) {
            p.classList.add('msg-callout', 'msg-step');
        }
        // 提示信息
        else if (/⚠️|注意|提示|建议/.test(txt) && txt.length < 100) {
            p.classList.add('msg-callout', 'msg-info');
        }
        // 测试结果
        else if (/测试|运行结果|数据获取/.test(txt) && txt.length < 100) {
            p.classList.add('msg-callout', 'msg-test');
        }
    });
    return tmp.innerHTML;
}

// 流式渲染：轻量版，逐行添加callout样式（不调marked，性能友好）
function _streamRender(text) {
    let html = escapeHtml(text);
    let lines = html.split('\n');
    let styledLines = lines.map(line => {
        if (!line) return '';
        // 成功
        if (/✅|成功|完成|创建成功|已生成|已保存/.test(line) && line.length < 120) {
            return '<div class="msg-callout msg-success">' + line + '</div>';
        }
        // 错误
        if (/❌|失败|错误|报错|异常/.test(line) && line.length < 120) {
            return '<div class="msg-callout msg-error">' + line + '</div>';
        }
        // 步骤标记
        if (/第\d+步|步骤\d+|开始第|继续创建|继续写|现在开始/.test(line) && line.length < 100) {
            return '<div class="msg-callout msg-step">' + line + '</div>';
        }
        // 提示
        if (/⚠️|注意|提示|建议/.test(line) && line.length < 120) {
            return '<div class="msg-callout msg-info">' + line + '</div>';
        }
        // 测试结果
        if (/测试|运行结果|数据获取/.test(line) && line.length < 120) {
            return '<div class="msg-callout msg-test">' + line + '</div>';
        }
        return line;
    });
    return styledLines.join('<br>');
}

// 快速流式输出（Claude Code风格：文字快速涌入）
function renderMsg(text) {
    // 预处理：自动插入换行
    text = _preprocessText(text);
    if (typeof marked !== 'undefined') {
        try {
            // 配置 marked
            marked.setOptions({
                breaks: true,
                gfm: true
            });
            let html = marked.parse(text);
            // 后处理：为关键内容添加彩色callout样式
            html = _enhanceHtml(html);
            // 代码高亮
            if (typeof hljs !== 'undefined') {
                // 给代码块添加复制按钮（用事件委托，避免innerHTML后onclick丢失）
                const tmp = document.createElement('div');
                tmp.innerHTML = html;
                tmp.querySelectorAll('pre code').forEach(block => {
                    try { hljs.highlightElement(block); } catch(e) {}
                });
                html = tmp.innerHTML;
            }
            // LaTeX公式渲染（在Markdown渲染之后，避免与代码块冲突）
            if (typeof renderMathInElement !== 'undefined') {
                const tmp2 = document.createElement('div');
                tmp2.innerHTML = html;
                renderMathInElement(tmp2, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false},
                        {left: '\\[', right: '\\]', display: true}
                    ],
                    throwOnError: false
                });
                html = tmp2.innerHTML;
            }
            // 文件夹路径链接化
            html = linkifyFolderPaths(html);
            return html;
        } catch(e) {
            // 降级到简单渲染
        }
    }
    // 降级：简单渲染
    let html = escapeHtml(text);
    html = html.replace(/```([\s\S]*?)```/g, '<pre style="background:var(--bg);padding:8px;border-radius:4px;margin:4px 0;overflow-x:auto;font-size:12px">$1</pre>');
    html = html.replace(/`([^`]+)`/g, '<code style="background:var(--bg);padding:1px 4px;border-radius:3px;font-size:12px">$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^&gt;\s?(.+)$/gm, '<div style="border-left:3px solid var(--blue);padding:2px 8px;margin:2px 0;color:var(--text2)">$1</div>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

// ============ 文件夹路径链接化 ============

// 将消息HTML中的文件夹路径转为可点击链接
function linkifyFolderPaths(html) {
    try {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        // 匹配 Windows绝对路径 (如 D:\folder\sub 或 C:\Users\admin) 和 ./ 开头的相对路径
        // 不处理 code/pre/a 标签内的文本
        const 路径正则 = /([A-Za-z]:[\/\\][^\s<>"'|*?\u4e00-\u9fff\)\]]+|\.\/[^\s<>"'|*?\u4e00-\u9fff\)\]]+)/g;
        const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT, null);
        const 待处理 = [];
        let node;
        while ((node = walker.nextNode())) {
            // 跳过 code/pre/a 标签内的文本
            let parent = node.parentNode;
            let skip = false;
            while (parent && parent !== tmp) {
                if (parent.tagName === 'CODE' || parent.tagName === 'PRE' || parent.tagName === 'A') {
                    skip = true;
                    break;
                }
                parent = parent.parentNode;
            }
            if (skip) continue;
            if (路径正则.test(node.textContent)) {
                待处理.push(node);
            }
        }
        for (const textNode of 待处理) {
            const text = textNode.textContent;
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            路径正则.lastIndex = 0;
            let match;
            while ((match = 路径正则.exec(text)) !== null) {
                // 添加匹配前的文本
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
                }
                const path = match[1].replace(/\/+$/, '').replace(/\\+$/, ''); // 去掉尾部斜杠
                // 创建链接元素
                const link = document.createElement('a');
                link.className = 'folder-link';
                link.setAttribute('data-path', path);
                link.textContent = '📂 ' + path;
                link.title = '点击在左侧打开: ' + path;
                link.href = '#';
                fragment.appendChild(link);
                lastIndex = match.index + match[1].length;
            }
            // 添加剩余文本
            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            }
            textNode.parentNode.replaceChild(fragment, textNode);
        }
        return tmp.innerHTML;
    } catch (e) {
        return html; // 出错时返回原始HTML
    }
}

// 为容器内的文件夹链接绑定点击事件
function bindFolderLinks(container) {
    const links = container.querySelectorAll('.folder-link:not([data-bound])');
    links.forEach(link => {
        link.setAttribute('data-bound', 'true');
        link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const path = link.getAttribute('data-path');
            if (path) {
                openFolder(path);
                showToast('info', '📂 已打开文件夹', path);
            }
        });
    });
}

function clearChat() { document.getElementById("msgList").innerHTML = ""; fetch("/api/clear-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }

