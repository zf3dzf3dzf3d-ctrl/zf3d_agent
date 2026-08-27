const fs = require('fs');
const path = String.raw`F:\朱峰社区智能体无限_新版本\新版本生产\朱峰社区智能体无限_5.0.0\public\js\app-project.js`;
let c = fs.readFileSync(path, 'utf8');

// 备份
fs.writeFileSync(path + '.bak', c, 'utf8');
console.log('备份完成:', path + '.bak');

const startIdx = c.indexOf('panel.dataset.resizeBound');
const stopIdx = c.indexOf('stopResize = function(event)');
if (startIdx < 0 || stopIdx < 0) {
    console.log('FAIL: 关键标记未找到');
    process.exit(1);
}

// 找到 stopResize 块结束的位置（pointerup listener 之后）
const afterStop = c.indexOf("panel.addEventListener('pointerup'", stopIdx);
const endIdx = c.indexOf(';', afterStop) + 1;
// 再找到下一行 beforeunload 结束
const unloadIdx = c.indexOf("localStorage.setItem('project_panel_width'", afterStop);
const unloadEnd = c.indexOf(';', unloadIdx) + 1;
const beforeUnloadEnd = c.indexOf('});', unloadEnd) + 3;
const oldBlock = c.substring(startIdx, beforeUnloadEnd);
console.log('oldBlock length:', oldBlock.length);
console.log('oldBlock first 200 chars:', oldBlock.substring(0, 200));

// 构建新的代码块（用 \r\n 保持 CRLF 一致）
const CRLF = '\r\n';
const newBlock = [
    "        panel.dataset.resizeBound = 'true';",
    "        // ✅ 关键修复：拖拽热区必须与 CSS 中 .proj-panel::before 的 width:8px 完全对齐",
    "        // 之前用 12px，多出来的 4px 会被判定为 resizing → setPointerCapture + preventDefault",
    "        // → 关闭按钮的 click 事件被吞掉 → \"项目管理关闭不上\"",
    "        var RESIZE_ZONE = 8;",
    "        panel.addEventListener('pointerdown', function(event) {",
    "            if (event.button !== 0) return;",
    "            if (event.clientX > panel.getBoundingClientRect().left + RESIZE_ZONE) return;",
    "            // 进入\"准备拖拽\"状态，但先不调 setPointerCapture / preventDefault",
    "            // 等用户在 pointermove 中真正移动后才升级为正式拖拽，避免吞掉相邻元素的 click",
    "            self._projPanelResizing = 'pending';",
    "            self._projPanelResizeStartX = event.clientX;",
    "            self._projPanelResizeStartWidth = panel.getBoundingClientRect().width;",
    "            self._projPanelResizePointerId = event.pointerId;",
    "        });",
    "        panel.addEventListener('pointermove', function(event) {",
    "            // pending 状态：如果用户开始移动，升级为正式 resizing",
    "            if (self._projPanelResizing === 'pending') {",
    "                var dx = Math.abs(event.clientX - self._projPanelResizeStartX);",
    "                if (dx < 3) return; // 移动不到 3px 视为点击，不升级",
    "                // 升级为正式拖拽",
    "                self._projPanelResizing = true;",
    "                panel.classList.add('resizing');",
    "                try {",
    "                    panel.setPointerCapture(self._projPanelResizePointerId);",
    "                    event.preventDefault();",
    "                } catch (e) {}",
    "            }",
    "            if (self._projPanelResizing !== true) return;",
    "            var minWidth = 280;",
    "            var maxWidth = Math.max(minWidth, window.innerWidth - 40);",
    "            var width = self._projPanelResizeStartWidth + self._projPanelResizeStartX - event.clientX;",
    "            applyWidth(width);",
    "        });",
    "        var stopResize = function(event) {",
    "            if (self._projPanelResizing === 'pending') {",
    "                // 从未升级为正式拖拽 → 是普通点击，不做任何事（让 click 正常触发）",
    "                self._projPanelResizing = false;",
    "                self._projPanelResizeStartX = undefined;",
    "                self._projPanelResizeStartWidth = undefined;",
    "                self._projPanelResizePointerId = undefined;",
    "                return;",
    "            }",
    "            if (self._projPanelResizing !== true) return;",
    "            self._projPanelResizing = false;",
    "            panel.classList.remove('resizing');",
    "            try { panel.releasePointerCapture(event.pointerId); } catch (e) {}",
    "            try { localStorage.setItem('project_panel_width', String(Math.round(panel.getBoundingClientRect().width))); } catch (e) {}",
    "        };",
    "        panel.addEventListener('pointerup', stopResize);",
    "        panel.addEventListener('pointercancel', stopResize);",
    "        // ✅ 兜底：pointerleave 时也强制清理 resizing 状态，防止卡住",
    "        panel.addEventListener('pointerleave', function(event) {",
    "            if (self._projPanelResizing === 'pending') {",
    "                self._projPanelResizing = false;",
    "            }",
    "        });",
    "        window.addEventListener('beforeunload', function() {",
    "            try { localStorage.setItem('project_panel_width', String(Math.round(panel.getBoundingClientRect().width))); } catch (e) {}",
    "        });"
].join(CRLF);

if (c.includes(oldBlock)) {
    c = c.replace(oldBlock, newBlock);
    fs.writeFileSync(path, c, 'utf8');
    console.log('✅ 替换成功，新文件大小:', fs.statSync(path).size);
} else {
    console.log('FAIL: oldBlock 未在文件中匹配');
    process.exit(1);
}
