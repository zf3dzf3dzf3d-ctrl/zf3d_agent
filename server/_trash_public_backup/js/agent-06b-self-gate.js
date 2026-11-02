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

    // ===== S2 引用剥离：剥离「被引号包裹的黑名单短语」后再查黑名单（防"引用禁语原文"误伤）=====
    // 防绕过：引号包裹的黑名单命中 ≥5 处视为塞禁语绕过，保留原文判定（密度阈值）
    function stripQuotes(text) {
        var t = String(text || '');
        var quotedHits = 0;
        var out = t;
        for (var i = 0; i < FUZZY_BLACKLIST.length; i++) {
            var p = FUZZY_BLACKLIST[i];
            var re = new RegExp('[「『"\'"]' + p + '[」』"\'"]', 'g');
            out = out.replace(re, '【引用略】'); // 整体删除「引号+短语」，防全文扫描误伤引用
        }
        // 统计：原文命中数 vs 剥离后命中数，差值即被引号包裹的命中数（剥离后 out 已删除短语，需按删除标记数计）
        var removedMarks = out.split('【引用略】').length - 1;
        quotedHits = removedMarks;
        if (quotedHits >= 5) return t; // 高密度塞禁语 → 不信任剥离，返回原文
        return out;
    }

    /**
     * 校验审核报告。
     * @param {string} text task_complete 的 message 全文
     * @param {object} opts 可选：{ scoreFloor: 90, lite: false }
     *   lite=true：分级门禁（纯对话/策划类任务），只查「核验清单+审核结论」两部分存在且正文≥60字，
     *   不强制五部分/200字/反驳条数，黑名单仍生效（stripQuotes 剥引号后判定）。
     * @returns {{pass:boolean, reasons:[], missing:[], score:n|null, lite:boolean}}
     */
    function validate(text, opts) {
        opts = opts || {};
        var floor = (typeof opts.scoreFloor === 'number') ? opts.scoreFloor : 90;
        var reasons = [];
        var missing = [];

        // ===== S1 lite 分支：轻量校验（纯对话/策划类任务）=====
        if (opts.lite) {
            var liteText = String(text || '').trim();
            if (liteText.length < 60) {
                return { pass: false, lite: true, reasons: ['审核报告过短（<60字，lite 模式），疑似敷衍，拒绝放行'], missing: ['逐条核验清单', '审核结论'], score: null };
            }
            var liteParsed = parseReport(liteText);
            var liteMissing = [];
            ['checklist', 'verdict'].forEach(function (key) {
                var s = SECTIONS.filter(function (x) { return x.key === key; })[0];
                var body = liteParsed.sections[key];
                if (!body || body.trim().replace(/^#+\s*/, '').replace(s.title, '').trim().length < 10) liteMissing.push(s.title);
            });
            if (liteMissing.length) {
                return { pass: false, lite: true, reasons: ['lite 模式仍须含「逐条核验清单」与「审核结论」两部分（各≥10字正文），当前缺少: ' + liteMissing.join('、')], missing: liteMissing, score: liteParsed.score };
            }
            // lite 也要过黑名单（剥引号后判定，防引用误伤同时防绕过）
            var liteStripped = stripQuotes(liteText);
            for (var lb = 0; lb < FUZZY_BLACKLIST.length; lb++) {
                if (liteStripped.indexOf(FUZZY_BLACKLIST[lb]) >= 0) {
                    return { pass: false, lite: true, reasons: ['审核报告出现模糊表述（黑名单命中，lite 模式同样拦截）'], missing: [], score: liteParsed.score };
                }
            }
            return { pass: true, lite: true, reasons: [], missing: [], score: liteParsed.score };
        }

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

        // ===== 硬校验3：模糊表述黑名单（S2：先剥引号内 1~20 字引用再扫描，防引用禁语原文误伤）=====
        var strippedFull = stripQuotes(text);
        var strippedParsed = parseReport(strippedFull);
        for (var k in parsed.sections) {
            var body2 = (strippedParsed.sections && strippedParsed.sections[k]) || parsed.sections[k];
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
     * 生成自纠指令（role=tool 注回循环）。S3：按拒绝类型附填空模板。
     * @param {object} v validate() 返回值
     * @param {number} round 当前自审轮次（从1起）
     * @param {boolean} stuckMode 同签名卡住≥3轮
     * @param {boolean} lite 当前任务是否 lite 分级
     */
    function buildRetryInstruction(v, round, stuckMode, lite) {
        var lines = [];
        lines.push('【自审门禁】你的 task_complete 已被自审闭环拒绝（第 ' + round + ' 轮自审未通过' + (lite ? '，lite 分级模式' : '') + '）。');
        if (stuckMode) {
            lines.push('⚠️ 防打转护栏：同一问题已连续 3 轮无实质进展，本轮必须更换实现路径/换思路，禁止沿用前几轮的相同修法。');
        }
        lines.push('拒绝原因：');
        for (var i = 0; i < v.reasons.length; i++) lines.push((i + 1) + '. ' + v.reasons[i]);
        if (lite) {
            lines.push('请按以下模板补全（lite 分级模式：仅核验清单+审核结论，各≥10字正文，总长≥60字）：');
            lines.push('【逐条核验清单】');
            lines.push('- 验收标准：… → 证据：…（命令输出/文件行号/diff）→ 通过/不通过');
            lines.push('【审核结论】');
            lines.push('…（明确判定+依据；模糊表述会直接拦截）');
        } else {
            lines.push('请针对上述原因完成自纠后，重新用 task_complete 交付，并按以下模板附完整审核报告（缺一不放行）：');
            lines.push('【① 逐条核验清单】');
            lines.push('- 验收标准1：… → 实测证据：…（命令输出/文件行号/diff）→ 通过');
            lines.push('【② 自我反驳】（至少 2 条）');
            lines.push('- 疑点1：… → 验证：…，排除');
            lines.push('- 疑点2：… → 验证：…，排除');
            lines.push('【③ 自我审视】未删测试/未改预期/未绕过门禁；无未验证假设（逐项说明）');
            lines.push('【④ 问题定位】不通过时写清哪个文件哪一行、为什么错、怎么改；通过时写"无"');
            lines.push('【⑤ 审核结论】明确判定通过/不通过 + 实证依据');
            lines.push('注意：不要把黑名单模糊短语原文写进报告——虽已做引号引用剥离，但剥离有密度上限，直接避免使用最稳妥。');
        }
        lines.push('注意：这是无限自循环，没有外部兜底，不通过就会一直循环，直到审核报告真实通过为止。');
        return lines.join('\n');
    }

    // ===== 导出 =====
    window.SelfGate = {
        parseReport: parseReport,
        validate: validate,
        stripQuotes: stripQuotes,
        buildRetryInstruction: buildRetryInstruction,
        SECTIONS: SECTIONS,
        FUZZY_BLACKLIST: FUZZY_BLACKLIST,
        version: '3.0'
    };
})();
