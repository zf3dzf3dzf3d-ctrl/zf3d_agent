/* ============================================================
 * app-canvas-role-drop.js v2 —— 角色拖拽到无限画布 = 创建角色专属对话
 * 修复 v1 问题：
 *  - 角色面板 dragstart 设的是 effectAllowed='move'，v1 在 dragover 里
 *    设了 dropEffect='copy'，Chrome 视为不匹配 → drop 事件不触发 → 创建失败。
 *    现统一 dropEffect='move'。
 *  - v1 只监听 canvasArea，落点命中网格层/中间层时链路不稳。
 *    现改为 document 捕获阶段统一处理，只要落点在画布内且不在角色面板上即生效。
 * ============================================================ */
(function () {
    'use strict';

    var ROLE_TYPE = 'text/zf-role';

    function _inCanvas(t) {
        var area = document.getElementById('canvasArea');
        if (!area) return false;
        return t === area || (area.contains && area.contains(t));
    }
    function _isBlank(t) {
        if (window.App && typeof App._isCanvasBlankTarget === 'function')
            return App._isCanvasBlankTarget(t);
        return !t.closest('.chatbox');
    }
    function _isRoleDrag(e) {
        try { return (e.dataTransfer.types || []).indexOf(ROLE_TYPE) >= 0; }
        catch (err) { return false; }
    }
    function _inRolesPanel(t) {
        return !!(t.closest && t.closest('#roles-panel'));
    }

    /* document 捕获阶段：保证在任何落点都能放行/接收 */
    document.addEventListener('dragover', function (e) {
        if (!_isRoleDrag(e)) return;
        var t = e.target;
        if (_inRolesPanel(t)) return;                 // 面板内部交给面板自身逻辑
        if (!_inCanvas(t)) return;                    // 只认画布区域
        if (!_isBlank(t)) return;                     // 落在对话框/节点上不响应
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';           // 与 effectAllowed='move' 匹配
        var area = document.getElementById('canvasArea');
        if (area) area.classList.add('role-drop-ok');
    }, true);

    document.addEventListener('dragleave', function (e) {
        if (e.target && e.target.id === 'canvasArea')
            document.getElementById('canvasArea').classList.remove('role-drop-ok');
    }, true);

    document.addEventListener('drop', function (e) {
        var area = document.getElementById('canvasArea');
        if (area) area.classList.remove('role-drop-ok');
        if (!_isRoleDrag(e)) return;
        var t = e.target;
        if (_inRolesPanel(t)) return;
        if (!_inCanvas(t) || !_isBlank(t)) return;
        var rid = '';
        try { rid = e.dataTransfer.getData(ROLE_TYPE) || ''; } catch (err) {}
        if (!rid) return;
        e.preventDefault();
        e.stopPropagation();

        var role = _findRoleById(rid);
        if (!role) { alert('未找到该角色，请重新打开角色面板后再试'); return; }
        if (typeof App.openRoleChat !== 'function') { alert('对话组件未就绪，请刷新页面后重试'); return; }
        App.openRoleChat(role, { x: e.clientX, y: e.clientY });
    }, true);

    /* 从角色缓存/接口里找角色 */
    function _findRoleById(rid) {
        function find(data) {
            if (!data || !data.ok) return null;
            var list = data.roles || [];
            for (var i = 0; i < list.length; i++) {
                if (String(list[i].id) === String(rid)) return list[i];
            }
            return null;
        }
        try {
            var saved = JSON.parse(localStorage.getItem('zf_roles_cache') || 'null');
            var hit = find(saved && saved.data);
            if (hit) return hit;
        } catch (e) {}
        var done = null;
        try {
            var r = new XMLHttpRequest();
            r.open('GET', '/api/roles', false);
            r.send(null);
            if (r.status === 200) done = find(JSON.parse(r.responseText));
        } catch (e) {}
        return done;
    }
})();
