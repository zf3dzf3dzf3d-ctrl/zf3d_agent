// ========== agent-06b-self-gate.js —— 自审闭环门禁校验器 v2.2 ==========
// 职责：AI 调用 task_complete 时，校验其最终消息是否包含「审核报告」五部分结构：
//   ①逐条核验清单 ②自我反驳(≥2条) ③自我审视 ④具体问题定位 ⑤默认不通过结论
// 硬性规则：五部分缺一即拒绝；模糊表述黑名单直接判失败；分数≥90 仅作辅助。
// 校验结果供 agent-02-loop-core.js 终止块拦截使用：
//   未通过 → 清空 _terminalResult + 注入自纠指令（role=tool），循环继续；
//   通过   → 正常放行终止。逃生开关：task_complete 参数 selfGate:false。
// 本文件无 DOM 依赖，纯函数，可被循环核心同步调用。
(function () {
    'use strict';
    if (window.__selfGateInit) return;
    window.__selfGateInit = true;

    // ===== 五部分标题的正则（支持 markdown 标题/加粗/编号变体）=====
    var SECTIONS = [
        { key: 'checklist',  title: '逐条核验清单', re: /逐条核验|核验清单|逐条验收/i },
        { key: 'rebuttal',   title: '自我反驳',     re: /自我反驳/i },
        { key: 'introspect', title: '自我审视',     re: /自我审视/i },
        { key: 'locate',     title: '问题定位',     re: /问题定位|具体问题|定位说明/i },
        { key: 'verdict',    title: '审核结论',     re: /审核结论|审官结论|最终结论|审核判定|审官判定/i }
    ];

    // ===== 模糊表述黑名单（出现即在对应缺失语义上下文直接判失败）=====
    // 仅在报告"看起来有结构但内容敷衍"时启用：对每个 section 的正文块做黑名单扫描。
    var FUZZY_BLACKLIST = [
        '应该没问题', '大致可以', '应该可以', '基本没问题', '大致没问题',
        '看起来没问题', '应该没问题了', '大概可以', '差不多可以', '总体没问题'
    ];

    // ===== 分数解析（辅助校验）=====
    var RE_SCORE = /(?:审核评分|审官评分|自审评分|评分)\s*[:：]?\s*(\d{1,3})\s*(?:分|\/\s*100)?/;

    /**
     * 解析审核报告。返回 { sections: {key: 正文}, score: n|null }。
     * 切分方式：按五部分标题定位，取两标题之间的文本作为该部分正文。
     */
    function parseReport(text) {
        var t = String(text || '');
        var found = [];
        for (var i = 0; i < SECTIONS.length; i++) {
            var m = t.search(SECTIONS[i].re);
            if (m >= 0) found.push({ key: SECTIONS[i].key, title: SECTIONS[i].title, idx: m });
        }
        found.sort(function (a, b) { return a.idx - b.idx; });
        var sections = {};
        for (var j = 0; j < found.length; j++) {
            var start = found[j].idx;
            var end = (j + 1 < found.length) ? found[j + 1].idx : t.length;
            sections[found[j].key] = t.slice(start, end);
        }
        var score = null;
        var sm = t.match(RE_SCORE);
        if (sm) { var v = parseInt(sm[1], 10); if (v >= 0 && v <= 100) score = v; }
        return { sections: sections, score: score, sectionCount: found.length };
        }

    /**
     * 校验审核报告。
     * @param {string} text task_complete 的 message 全文
     * @param {object} opts 可选：{ scoreFloor: 90 }
     * @returns {{pass:boolean, reasons:[], missing:[], score:n|null}}
     */
    function validate(text, opts) {
        opts = opts || {};
        var floor = (typeof opts.scoreFloor === 'number') ? opts.scoreFloor : 90;
        var reasons = [];
        var missing = [];

        // 报告过短直接拒（敷衍拦截第一道）
        if (!text || String(text).trim().length < 200) {
            return { pass: false, reasons: ['审核报告过短（<200字），疑似敷衍，拒绝放行'], missing: SECTIONS.map(function (s) { return s.title; }), score: null };
        }

        var parsed = parseReport(text);

        // ===== 硬校验1：五部分缺一不可 =====
        for (var i = 0; i < SECTIONS.length; i++) {
            var s = SECTIONS[i];
            var body = parsed.sections[s.key];
            if (!body || body.trim().replace(/^#+\s*/, '').replace(s.title, '').trim().length < 15) {
                missing.push(s.title);
            }
        }
        if (missing.length) {
            reasons.push('审核报告缺少必备部分: ' + missing.join('、') + '。五部分（逐条核验清单/自我反驳/自我审视/问题定位/审核结论）缺一不可');
        }

        // ===== 硬校验2：自我反驳部分必须 ≥2 条（识别 1. 2. / - / ①② 等列表标记）=====
        var rebuttal = parsed.sections.rebuttal || '';
        var itemMarks = rebuttal.match(/(^|\n)\s*(?:\d+[\.、\)]|[-*•]|①|②|③)\s*\S/g) || [];
        if (rebuttal && itemMarks.length < 2) {
            reasons.push('「自我反驳」部分不足 2 条（找到 ' + itemMarks.length + ' 条）。必须主动列出至少 2 个可能有问题之处并逐一验证排除');
        }

        // ===== 硬校验3：模糊表述黑名单（扫描各 section 正文）=====
        for (var k in parsed.sections) {
            var body2 = parsed.sections[k];
            for (var b = 0; b < FUZZY_BLACKLIST.length; b++) {
                if (body2.indexOf(FUZZY_BLACKLIST[b]) >= 0) {
                    reasons.push('审核报告出现模糊表述「' + FUZZY_BLACKLIST[b] + '」（在「' + k + '」部分）。默认不通过立场：放行必须实证，禁止模糊断言');
                    break;
                }
            }
        }

        // ===== 辅助校验：分数 ≥ floor（缺失不因分数拒绝，结构不合格才是主判据）=====
        var score = parsed.score;
        if (score !== null && score < floor) {
            reasons.push('审核评分 ' + score + ' 分低于 ' + floor + ' 分辅助线');
        }

        return { pass: reasons.length === 0, reasons: reasons, missing: missing, score: score };
    }

    /**
     * 生成自纠指令（role=tool 注回循环）。
     * @param {object} v validate() 返回值
     * @param {number} round 当前自审轮次（从1起）
     */
    function buildRetryInstruction(v, round, stuckMode) {
        var lines = [];
        lines.push('【自审门禁】你的 task_complete 已被自审闭环拒绝（第 ' + round + ' 轮自审未通过）。');
        if (stuckMode) {
            lines.push('⚠️ 防打转护栏：同一问题已连续 3 轮无实质进展，本轮必须更换实现路径/换思路，禁止沿用前几轮的相同修法。');
        }
        lines.push('拒绝原因：');
        for (var i = 0; i < v.reasons.length; i++) lines.push((i + 1) + '. ' + v.reasons[i]);
        lines.push('请针对上述原因完成自纠后，重新用 task_complete 交付，并在 message 中附完整审核报告，必须包含以下五部分（缺一不放行）：');
        lines.push('① 逐条核验清单：每条验收标准 → 实测证据（命令输出/文件行号/diff）→ 通过/不通过');
        lines.push('② 自我反驳：以找茬者立场列 2-3 个"可能有问题之处"，逐一验证排除');
        lines.push('③ 自我审视：是否偷懒/绕过（删测试、改预期、口头声称）？有无未验证假设？');
        lines.push('④ 问题定位：不通过必须写清哪个文件哪一行、为什么错、怎么改');
        lines.push('⑤ 审核结论：默认不通过立场，放行必须实证；出现"应该没问题/大致可以"等模糊表述直接判自审失败');
        lines.push('注意：这是无限自循环，没有外部兜底，不通过就会一直循环，直到审核报告真实通过为止。');
        return lines.join('\n');
    }

    // ===== 导出 =====
    window.SelfGate = {
        parseReport: parseReport,
        validate: validate,
        buildRetryInstruction: buildRetryInstruction,
        SECTIONS: SECTIONS,
        FUZZY_BLACKLIST: FUZZY_BLACKLIST,
        version: '2.2'
    };
})();
