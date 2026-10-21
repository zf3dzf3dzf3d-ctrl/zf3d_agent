// ========== app-minimap-organize.js v20 - 整理模式（2026 从零重写版） ==========
// 架构原则（根治死机）：
//  1. 纯 DOM 卡片渲染：只在「打开 / 节点集合变化 / 操作结束」时重建一次，绝无每帧重绘
//  2. 零 requestAnimationFrame / 零 setInterval / 零 setTimeout 循环 —— 完全事件驱动
//  3. 拖拽/框选/缩放/平移全部直接改 CSS transform，不触发任何重排级联
//  4. 无 MutationObserver、无递归渲染、无主画布侦听 —— 打开时快照一次，关闭时写回
// 对外接口（保持兼容 app-minimap.js）：window.MinimapOrganize.{open,close,toggle,isActive,getGroups}
// 操作：单击=点选 | 拖卡片=移动 | 空白拖=框选 | Shift+框=加选 | Ctrl+框=减选 |
//       滚轮=缩放 | 中键/空白右键拖=平移 | Delete=关闭所选 | 1~4排=自动排列 | 建组/重命名/解散
(function () {
    'use strict';

    var GROUP_KEY = 'zf_minimap_groups';
    var groups = [];
    try { groups = JSON.parse(localStorage.getItem(GROUP_KEY) || '[]') || []; } catch (e) { groups = []; }
    function saveGroups() { try { localStorage.setItem(GROUP_KEY, JSON.stringify(groups)); } catch (e) {} }
    var GROUP_COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e91e63'];

    // ===== 状态 =====
    var active = false;
    var overlay = null, world = null, rubber = null, hintEl = null;
    var cards = [];            // { el, chat, x, y, w, h, title, color }
    var byEl = new Map();      // 真实节点 el -> card
    var selected = new Set();  // card -> true
    var view = { x: 0, y: 0, s: 1 };   // 平移 + 缩放（一次性，拖完才应用）
    var namePop = null, nameInput = null;

    function $(id) { return document.getElementById(id); }

    // ===== DOM：只创建一次 =====
    function ensureDom() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.className = 'minimap-organize-overlay';
        overlay.innerHTML =
            '<div class="mo-panel">' +
                '<div class="mo-toolbar">' +
                    '<span class="mo-title">整理模式</span>' +
                    '<button class="mo-btn" id="moGroupBtn">建组</button>' +
                    '<button class="mo-btn" id="moRenameBtn">重命名</button>' +
                    '<button class="mo-btn" id="moDissolveBtn">解散</button>' +
                    '<span class="mo-sep"></span>' +
                    '<button class="mo-btn mo-arr" data-rows="1">1排</button>' +
                    '<button class="mo-btn mo-arr" data-rows="2">2排</button>' +
                    '<button class="mo-btn mo-arr" data-rows="3">3排</button>' +
                    '<button class="mo-btn mo-arr" data-rows="4">4排</button>' +
                    '<span class="mo-flex"></span>' +
                    '<button class="mo-btn" id="moCloseBtn">退出</button>' +
                    '<button class="mo-close-x" id="moCloseXBtn" title="退出整理模式">&times;</button>' +
                '</div>' +
                '<div class="mo-viewport"><div class="mo-world"></div>' +
                    '<div class="mo-rubber" style="display:none"></div></div>' +
                '<div class="mo-hintbar"><span class="mo-hint">单击=点选 | 拖卡片=移动 | 空白拖=框选 | Shift加选 | Ctrl减选 | 滚轮=缩放 | 中键拖=平移 | Delete=关闭 | 1~4排=排列</span></div>' +
            '</div>';
        document.body.appendChild(overlay);
        world = overlay.querySelector('.mo-world');
        rubber = overlay.querySelector('.mo-rubber');
        hintEl = overlay.querySelector('.mo-hint');

        overlay.querySelector('#moCloseBtn').addEventListener('click', close);
        overlay.querySelector('#moCloseXBtn').addEventListener('click', close);
        overlay.querySelector('#moGroupBtn').addEventListener('click', createGroupFromSelection);
        overlay.querySelector('#moRenameBtn').addEventListener('click', renameSelectedGroup);
        overlay.querySelector('#moDissolveBtn').addEventListener('click', dissolveSelectedGroup);
        var arrs = overlay.querySelectorAll('.mo-arr');
        for (var i = 0; i < arrs.length; i++) {
            (function (b) {
                b.addEventListener('click', function () { arrangeRows(parseInt(b.getAttribute('data-rows'), 10) || 1); });
            })(arrs[i]);
        }

        namePop = document.createElement('div');
        namePop.className = 'mo-name-pop';
        namePop.innerHTML = '<input type="text" maxlength="20" placeholder="输入组名"><button>确定</button>';
        namePop.style.display = 'none';
        overlay.querySelector('.mo-panel').appendChild(namePop);
        nameInput = namePop.querySelector('input');
        namePop.querySelector('button').addEventListener('click', confirmName);
        nameInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') confirmName();
            if (e.key === 'Escape') hideNamePop();
        });

        bindViewportEvents();
    }
