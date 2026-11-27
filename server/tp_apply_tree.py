# -*- coding: utf-8 -*-
import io

from util_log import get_logger

log = get_logger('tp_apply_tree')
ROOT = r''
P = ROOT + r'\public\js\app-taskpanel.js'

s = io.open(P, encoding='utf-8', errors='replace').read()

old_sig = """sig += sc.id + ',' + scTitle + ',' + (sc.isSending ? '1' : '0') + ',' + (sc._stopped ? '1' : '0') + ',' +
                   (sc.queue ? sc.queue.length : 0) + ',' + (sc.history ? sc.history.length : 0) + ',' + (Number(sc._sessionTotalTokens) || 0) + ',' + scToolTotal + '|';"""
new_sig = """var scScore = '-';
            try { if (window.ZFChildRel && window.ZFChildRel.scoreOf) { var sv = window.ZFChildRel.scoreOf(sc); scScore = (sv == null ? '-' : String(sv)); } } catch (eSg) {}
            sig += sc.id + ',' + scTitle + ',' + (sc.isSending ? '1' : '0') + ',' + (sc._stopped ? '1' : '0') + ',' +
                   (sc.queue ? sc.queue.length : 0) + ',' + (sc.history ? sc.history.length : 0) + ',' + (Number(sc._sessionTotalTokens) || 0) + ',' + scToolTotal + ',s:' + scScore + '|';"""
assert s.count(old_sig) == 1, 'sig anchor: %d' % s.count(old_sig)
s = s.replace(old_sig, new_sig)

old2 = """        // 渲染卡片
        for (var j = 0; j < sorted.length; j++) {
            var chat = sorted[j];
            var title = '';"""
new2 = """        // ===== 父子分组：父在上，子对话缩进挂在父下面；孤儿（父不在列表）也缩进展示 =====
        var relOK = !!(window.ZFChildRel && window.ZFChildRel.isSub && window.ZFChildRel.srcIdOf);
        var childMap = {}; // srcId -> [chat]
        var orphans = [];
        if (relOK) {
            for (var og = 0; og < sorted.length; og++) {
                var ogc = sorted[og];
                if (ogc.el && window.ZFChildRel.isSub(ogc.el)) {
                    var sid = window.ZFChildRel.srcIdOf(ogc.el);
                    var skey = (sid == null) ? '_orphan' : String(sid);
                    if (!childMap[skey]) childMap[skey] = [];
                    childMap[skey].push(ogc);
                } else {
                    orphans.push(ogc); // 父对话
                }
            }
            var orphanKids = (childMap['_orphan'] || []);
            for (var ok2 = 0; ok2 < orphanKids.length; ok2++) orphans.push(orphanKids[ok2]);
        } else {
            orphans = sorted; // ZFChildRel 未加载 → 降级平铺
        }

        // 渲染卡片
        var childScoreCls = function (s2) { return (s2 == null) ? '' : (s2 >= 80 ? ' cs-score--hi' : (s2 < 60 ? ' cs-score--lo' : '')); };
        function renderChatCard(chat, isChild) {
            var html = '';
            var title = '';"""
assert s.count(old2) == 1, 'card anchor: %d' % s.count(old2)
s = s.replace(old2, new2)

old4 = """            if (lpPlanIds.length) {
                html += '<span class="cs-pill cs-pill--lp" data-lp-plan="' + this._esc(lpPlanIds[0]) + '" title="该对话关联的超长计划，点击查看进度" style="cursor:pointer;">📜 长任务' + (lpPlanIds.length > 1 ? '+' + (lpPlanIds.length - 1) : '') + '</span>';
            }
            html += '</div>';
            html += '</div>';
        }"""
new4 = """            if (lpPlanIds.length) {
                html += '<span class="cs-pill cs-pill--lp" data-lp-plan="' + self._esc(lpPlanIds[0]) + '" title="该对话关联的超长计划，点击查看进度" style="cursor:pointer;">📜 长任务' + (lpPlanIds.length > 1 ? '+' + (lpPlanIds.length - 1) : '') + '</span>';
            }
            html += '</div>';

            // 子行追加：缩进信息条（职业名+积分，父行不显示）
            if (isChild) {
                var rel = null;
                try { if (chat.el && window.ZFChildRel && window.ZFChildRel.childKeyOf) rel = window.ZFChildRel.childKeyOf(chat.el); } catch (eRk) {}
                var roleName = (rel && rel.key) || (chat.el && chat.el._isSummarizerChat ? '总结师' : '');
                var score = null;
                try { if (window.ZFChildRel && window.ZFChildRel.scoreOf) score = window.ZFChildRel.scoreOf(chat); } catch (eSc) {}
                var scoreTxt = (score == null) ? '—' : String(score) + '分';
                html += '<div class="cs-card-childinfo"><span class="cs-child-role">🧩 ' + self._esc(roleName || '子对话') + '</span><span class="cs-child-score' + childScoreCls(score) + '" title="该子对话最近评分（≥80绿 / <60红）">⭐ ' + scoreTxt + '</span></div>';
            }
            html += '</div>';
            return html;
        }

        // ===== 树形驱动循环：父在上，子在其下缩进 =====
        var renderedIds = {};
        function renderGroup(parentChat) {
            var pk = parentChat ? String(parentChat.id) : null;
            if (pk) renderedIds[pk] = 1;
            html += '<div class="cs-group">';
            if (parentChat) html += renderChatCard(parentChat, false);
            var kids = pk ? (childMap[pk] || []) : [];
            if (kids.length) {
                html += '<div class="cs-children">';
                for (var cj = 0; cj < kids.length; cj++) {
                    renderedIds[String(kids[cj].id)] = 1;
                    html += renderChatCard(kids[cj], true);
                }
                html += '</div>';
            }
            html += '</div>';
        }
        for (var rg = 0; rg < orphans.length; rg++) {
            var rc = orphans[rg];
            if (rc.el && relOK && window.ZFChildRel.isSub(rc.el)) continue; // 孤儿子对话走孤儿区
            renderGroup(rc);
        }
        // 孤儿区：父不在列表的子对话
        var orphanKids2 = [];
        if (relOK) {
            for (var rk = 0; rk < sorted.length; rk++) {
                var rkc = sorted[rk];
                if (rkc.el && window.ZFChildRel.isSub(rkc.el) && !renderedIds[String(rkc.id)]) orphanKids2.push(rkc);
            }
        }
        if (orphanKids2.length) {
            html += '<div class="cs-orphan-zone"><div class="cs-orphan-title">⚠ 父对话不在列表（可能已关闭）</div>';
            for (var rj = 0; rj < orphanKids2.length; rj++) html += renderChatCard(orphanKids2[rj], true);
            html += '</div>';
        }"""
assert s.count(old4) == 1, 'tail anchor: %d' % s.count(old4)
s = s.replace(old4, new4)

start = s.index('function renderChatCard')
end = s.index('return html;', start)
seg = s[start:end]
seg2 = seg.replace('this._esc(', 'self._esc(').replace('this._getChatNote(', 'self._getChatNote(').replace('this._getChatProjectName(', 'self._getChatProjectName(')
s = s[:start] + seg2 + s[end:]

io.open(P, 'w', encoding='utf-8', newline='').write(s)
log.info('%s %s', 'OK js rewritten, len=', len(s))
