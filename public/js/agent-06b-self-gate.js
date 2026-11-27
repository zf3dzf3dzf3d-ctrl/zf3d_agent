// ========== agent-06b-self-gate.js —— 自审闭环门禁校验器 v3.1 ==========
// 职责：AI 调用 task_complete 时，校验其最终消息是否包含「审核报告」五部分结构：
//   ①逐条核验清单 ②自我反驳(≥2条) ③自我审视 ④具体问题定位 ⑤默认不通过结论
// 硬性规则：五部分缺一即拒绝；模糊表述黑名单直接判失败；分数≥90 仅作辅助。
// v3.1 变更：① lite 分级废除——所有 task_complete 恒走 full 五部分严格门禁（原 lite 判定
//   引用从未定义的 _roundToolCalls，本就是死代码，实际一直恒 full；勿按"本轮工具"维度恢复
//   分级，多轮工程任务收尾轮常只剩只读工具，会被错误降级）；② 章节定位锚定「审核报告」
//   分隔线，防答案正文中的标题词把章节边界提前；③ 模糊表述黑名单升级全文扫描。
// 校验结果供 agent-02-loop-core.js 终止块拦截使用：
//   未通过 → 清空 _terminalResult + 注入自纠指令（role=tool），循环继续；
//   通过   → 正常放行终止。逃生阀：仅用户发送 selfGate:off 可关（selfGate:on 恢复）；
//   模型参数不可关（task_complete 执行器不透传 selfGate 字段，防模型自拆门禁）。
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

    // ===== 写/执行类工具白名单（共享常量防两处漂移）=====
    // 消费方：循环核心的写/执行工具触达标记（纯文本收尾拦截判定）。lite 分级已废除（v3.1），
    // 但常量保留——未来若恢复分级，必须按"全任务维度"（chat._taskTouchedWriteTools）判定而非本轮工具。
    // 新增写类工具时只改这里。
    var WRITE_TOOLS_RE = /^(write_file|replace_text|move_file|run_code|git_save|schedule|browser_control|image_gen|video_gen|send_email)$/i;

    // ===== P2-1 报告段锚定：「—— 审核报告 ——」分隔线 =====
    // 五部分章节只在报告段内定位，防答案正文中的标题词（如用户问题含"自我反驳"）把章节边界
    // 提前、正文被当报告正文。无分隔线时回退：以「核验清单标题首次出现且其后至少还有 2 个
    // 其他章节标题」处为报告起点（模板恒以核验清单开头，正文孤立提及不满足簇条件）。
    var RE_REPORT_SEP = /[-—─=＿_]{2,}\s*审[核官]\s*报\s*告\s*[-—─=_]{2,}/;

    function splitAnswerReport(t) {
        var m = RE_REPORT_SEP.exec(t);
        if (m && m.index >= 0) {
            var nl = t.indexOf('\n', m.index);
            var start = (nl >= 0) ? nl + 1 : t.length;
            return { base: t.slice(start), baseStart: start };
        }
        var cl = null;
        for (var ci = 0; ci < SECTIONS.length; ci++) { if (SECTIONS[ci].key === 'checklist') { cl = SECTIONS[ci]; break; } }
        if (cl) {
            var idx = 0;
            while (idx <= t.length) {
                var rel = t.slice(idx).search(cl.re);
                if (rel < 0) break;
                var start2 = idx + rel;
                var rest = t.slice(start2);
                var others = 0;
                for (var i2 = 0; i2 < SECTIONS.length; i2++) {
                    if (SECTIONS[i2].key === 'checklist') continue;
                    if (rest.search(SECTIONS[i2].re) >= 0) others++;
                }
                if (others >= 2) return { base: rest, baseStart: start2 };
                idx = start2 + 1;
            }
        }
        return { base: t, baseStart: -1 };
    }

    // ===== 分数解析（辅助校验）=====
    var RE_SCORE = /(?:审核评分|审官评分|自审评分|评分)\s*[:：]?\s*(\d{1,3})\s*(?:分|\/\s*100)?/;

    /**
     * 解析审核报告。返回 { sections: {key: 正文}, score: n|null }。
     * 切分方式：P2-1 起先切出报告段（分隔线或核验清单簇锚定），章节只在报告段内定位；
     * 取两标题之间的文本作为该部分正文；评分同样只在报告段内解析。
     */
    function parseReport(text) {
        var t = splitAnswerReport(String(text || '')).base;
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

        // ===== 硬校验0（公共，full/lite 通用）：报告之前必须有答案正文（防空卷放行）=====
        // 用户看到的是完整 message；若答案只藏在报告「实测证据」引号里，用户视角=没有答案。
        function getAnswerBodyLen(t) {
            var ts = String(t);
            // P2-1：与 parseReport 同源切分——正文=报告段之前；完全无章节时回退全文（旧行为）
            var _sr = splitAnswerReport(ts);
            var firstIdx = -1;
            if (_sr.baseStart < 0) {
                for (var fi = 0; fi < SECTIONS.length; fi++) {
                    var m0 = ts.search(SECTIONS[fi].re);
                    if (m0 >= 0 && (firstIdx < 0 || m0 < firstIdx)) firstIdx = m0;
                }
            }
            var cut = (_sr.baseStart >= 0) ? _sr.baseStart : firstIdx;
            var preText = (cut >= 0 ? ts.slice(0, cut) : ts);
            // 【20261123 bug修复】原此处有 preText.split('——')[0]，本意去掉「—— 审核报告 ——」引导行，
            // 但会误伤正文里含破折号的答案（如「**调度内核**：……——……」被截到不足 30 字而误拒）。
            // cut 已是报告段起点（splitAnswerReport 已回退到引导行行首），无需再切，直接删掉该行。
            return preText.replace(/[#>*`\-\s【】（）()《》\[\]:：、,，。.!？?；;'"\"“”…—]/g, '').length;
        }
        var NO_BODY_MSG = '审核报告之前缺少答案正文（有效内容<30字）。用户阅读的是报告之前的正文区域；答案绝不能只作为「实测证据」引文出现在核验清单里。必须先写完整答案正文，再附审核报告';

        // 【v3.1】lite 分支已废除：所有 task_complete 恒走下方 full 五部分校验（详见头注释）。
        // 历史：原 lite 判定引用从未定义的 _roundToolCalls，调用方恒传 full，本分支从未生效过。

        // 报告过短直接拒（敷衍拦截第一道）
        if (!text || String(text).trim().length < 200) {
            return { pass: false, reasons: ['审核报告过短（<200字），疑似敷衍，拒绝放行'], missing: SECTIONS.map(function (s) { return s.title; }), score: null };
        }

        var parsed = parseReport(text);

        // ===== 硬校验0：报告之前必须有答案正文（公共函数，与 lite 共用）=====
        if (getAnswerBodyLen(text) < 30) {
            reasons.push(NO_BODY_MSG);
        }

        // ===== 硬校验1：五部分缺一不可 =====
        for (var i = 0; i < SECTIONS.length; i++) {
            var s = SECTIONS[i];
            var body = parsed.sections[s.key];
            // 【20261123 bug修复】原一律要求 ≥15 字，但门禁模板自己写着「通过时写"无"」——
            // 按模板写「无」反而被判缺失（模板与校验自相矛盾，致正常收尾被连拒）。
            // 修正：通过时的「无」是合法内容，明确放行；其余情况仍需 ≥15 字。
            if (!body) { missing.push(s.title); continue; }
            // body 形如「问题定位】无。\n【⑤ 」：含标题残片「】」与下一段标题「【⑤ 」，先清掉再判定。
            var _b = body.replace(s.title, '').replace(/^[#\s】]+/, '').replace(/【[^】]*$/, '').trim();
            var _isNone = /^(?:无|没有|暂无|不适用|N\/?A)[。\.\s]*$/.test(_b);
            if (!_isNone && _b.length < 15) {
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

        // ===== 硬校验3：模糊表述黑名单（P2-1 升级全文扫描：报告段+答案正文的模糊断言都拦；
        // S2 先剥引号内引用再扫描，防引用禁语原文误伤；引号密度阈值防塞禁语绕过）=====
        var strippedFull = stripQuotes(text);
        for (var b = 0; b < FUZZY_BLACKLIST.length; b++) {
            if (strippedFull.indexOf(FUZZY_BLACKLIST[b]) >= 0) {
                reasons.push('审核报告/答案正文出现模糊表述「' + FUZZY_BLACKLIST[b] + '」。默认不通过立场：放行必须实证，禁止模糊断言');
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
     * 【v3.1】lite 参数已废除（恒 full 模板）；保留前两个调用参数不变。
     * @param {object} v validate() 返回值
     * @param {number} round 当前自审轮次（从1起）
     * @param {boolean} stuckMode 同签名卡住≥3轮
     */
    function buildRetryInstruction(v, round, stuckMode) {
        var lines = [];
        lines.push('【自审门禁】你的 task_complete 已被自审闭环拒绝（第 ' + round + ' 轮自审未通过）。');
        if (stuckMode) {
            lines.push('⚠️ 防打转护栏：同一问题已连续 3 轮无实质进展，本轮必须更换实现路径/换思路，禁止沿用前几轮的相同修法。');
        }
        lines.push('拒绝原因：');
        for (var i = 0; i < v.reasons.length; i++) lines.push((i + 1) + '. ' + v.reasons[i]);
        lines.push('重要：最终消息的结构必须是「先答案正文 → 后审核报告」。先用正文完整回答用户的问题，再用 —— 审核报告 —— 分隔线附五部分报告；审核报告只是交付自证，不能替代答案。');
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
        WRITE_TOOLS_RE: WRITE_TOOLS_RE,
        RE_REPORT_SEP: RE_REPORT_SEP,
        version: '3.1'
    };
})();
