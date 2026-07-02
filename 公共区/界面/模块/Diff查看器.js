/**
 * Diff查看器 — 全屏行级代码对比页面
 * AI修改文件后弹出，展示新旧代码差异（红色删除+绿色新增）
 */

// ============ Diff页面 ============

function showDiffPage(文件名, 旧文本, 新文本, 操作类型) {
    const overlay = document.getElementById("diffOverlay");
    if (!overlay) return;

    // 计算行级diff
    const diff行 = _计算行级Diff(旧文本 || "", 新文本 || "");
    const del数 = diff行.filter(r => r.type === "del").length;
    const add数 = diff行.filter(r => r.type === "add").length;

    // 填充头部
    document.getElementById("diffFileName").textContent = 文件名 || "未知文件";
    const 操作标签 = {"替换": "✏️ 替换", "新建": "📄 新建", "追加": "➕ 追加", "删除": "🗑️ 删除"}[操作类型] || "修改";
    document.getElementById("diffStats").innerHTML =
        `<span class="diff-op-badge">${操作标签}</span>` +
        `<span class="diff-stat-del">−${del数}行</span>` +
        `<span class="diff-stat-add">+${add数}行</span>`;

    // 渲染diff内容
    const content = document.getElementById("diffContent");
    let html = '<table class="diff-table"><tbody>';
    let 旧行号 = 1, 新行号 = 1;

    for (const 行 of diff行) {
        const escaped = _转义HTML(行.text);
        if (行.type === "same") {
            html += `<tr class="diff-row-same">
                <td class="diff-ln-old">${旧行号}</td>
                <td class="diff-ln-new">${新行号}</td>
                <td class="diff-code">${escaped}</td>
            </tr>`;
            旧行号++; 新行号++;
        } else if (行.type === "del") {
            html += `<tr class="diff-row-del">
                <td class="diff-ln-old">${旧行号}</td>
                <td class="diff-ln-new"></td>
                <td class="diff-code">${escaped}</td>
            </tr>`;
            旧行号++;
        } else if (行.type === "add") {
            html += `<tr class="diff-row-add">
                <td class="diff-ln-old"></td>
                <td class="diff-ln-new">${新行号}</td>
                <td class="diff-code">${escaped}</td>
            </tr>`;
            新行号++;
        }
    }
    html += '</tbody></table>';
    content.innerHTML = html;

    // 显示
    overlay.style.display = "flex";
}

function closeDiffPage() {
    const overlay = document.getElementById("diffOverlay");
    if (overlay) overlay.style.display = "none";
}

// ============ 行级Diff算法（LCS） ============

function _计算行级Diff(旧文本, 新文本) {
    const 旧行 = 旧文本.split("\n");
    const 新行 = 新文本.split("\n");
    const m = 旧行.length, n = 新行.length;

    // 特殊情况：纯新建或纯删除
    if (m === 1 && 旧行[0] === "") {
        return 新行.map(text => ({type: "add", text}));
    }
    if (n === 1 && 新行[0] === "") {
        return 旧行.map(text => ({type: "del", text}));
    }

    // LCS动态规划表
    const dp = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (旧行[i - 1] === 新行[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // 回溯生成diff
    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && 旧行[i - 1] === 新行[j - 1]) {
            result.unshift({type: "same", text: 旧行[i - 1]});
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            result.unshift({type: "add", text: 新行[j - 1]});
            j--;
        } else {
            result.unshift({type: "del", text: 旧行[i - 1]});
            i--;
        }
    }
    return result;
}

function _转义HTML(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
