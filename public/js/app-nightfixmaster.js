// ========== app-nightfixmaster.js - 🌙 夜间修复大师 ==========
// 功能：点一下打包「夜间修复任务」发送到新对话（无头跑），让 AI 复盘每个对话课题、
//       排查 bug、生成只读巡检报告与工单。挂在大师集群下拉菜单内（app-mastercluster.js 注册）。
// 实现参照 app-filemaster.js：提示词 → _logMasterSendToNewChat 公共链路 → 新对话自动发送。
// v2（蜂群收口整改）：①只报告不修改（安全师/反驳师共识）；②cwd 写死项目根路径（反驳师③）；
//                    ③写档回读验证条款（进化师③）；④文案标明需手动触发（反驳师②）。
(function () {
    'use strict';

    function buildPrompt() {
        var lines = [];
        lines.push('===== 🌙 夜间修复大师 · 对话课题复盘与 bug 排查任务 =====');
        lines.push('生成时间: ' + new Date().toLocaleString());
        lines.push('项目根目录: F:\\朱峰社区智能体无限_新版本\\朱峰社区智能体无限_5.7.0（所有读写/巡检一律以此路径为准）');
        lines.push('');
        lines.push('【你的角色】你是「夜间修复大师」，夜间值守的巡检专家：复盘本系统所有对话课题，');
        lines.push('排查遗留 bug、未完成任务、报错线索，输出巡检报告和待办工单，等用户醒来裁决。');
        lines.push('');
        lines.push('【本次任务】依次完成以下四步：');
        lines.push('1. 课题盘点：读取项目记录（private/记忆/、public/项目记录/）与长期计划（lp-* 未完成项），');
        lines.push('   列出每个对话课题的现状（进行中/已完成/卡住/遗留问题）；');
        lines.push('2. bug 排查：扫描 server/logs/ 的错误日志（fallback_events.jsonl 等）、git 近期提交、');
        lines.push('   运行 `git status --short` 看工作区是否有遗留未提交改动，找出可疑 bug 与半成品改动；');
        lines.push('3. 修复分级：把发现的问题按 P0(阻塞)/P1(影响功能)/P2(优化) 分级，');
        lines.push('   每条写清：文件位置、现象、根因猜测、修复方案、风险；');
        lines.push('4a. 写档纪律：凡用 project_record append/write 落档，必须写后回读验证非空，');
        lines.push('   防止「假 ok」——返回 ok 不等于写入成功，必须回读。');
        lines.push('');
        lines.push('【安全红线 · 必须严格遵守】');
        lines.push('① 白名单永不动：.git/、python/、node_modules/、private/记忆/ 只读不改；');
        lines.push('② 本轮【只报告不修改】：写入/替换/删除代码文件的操作一律禁止，');
        lines.push('   所有修复方案只写进工单，绝不擅动代码，等用户裁决后再执行；');
        lines.push('③ 唯一允许的写操作：用 project_record 落档报告（写后必须回读验证非空）；');
        lines.push('④ 结尾落档「🌙 夜间修复报告」：发现了什么/分级工单清单（文件位置+方案+风险），');
        lines.push('   供用户晨起审阅裁决。');
        lines.push('');
        lines.push('现在开始夜间巡检：本轮只巡检、只报告、只落工单，不修改任何代码，全程如实汇报。');
        return lines.join('\n');
    }

    App.nightFixMaster = function (srcBox) {
        var self = App;
        try {
            var chat = self._logMasterFindChat ? self._logMasterFindChat(srcBox) : null;
            var prompt = buildPrompt();
            if (typeof self._logMasterSendToNewChat !== 'function') {
                self._logMasterToast('夜间修复大师依赖日志大师公共链路，加载失败');
                return;
            }
            self._logMasterSendToNewChat(srcBox, chat, prompt, '🌙 夜间修复', 'nightfixmaster');
            if (self._logMasterToast) self._logMasterToast('🌙 夜间修复任务已发送到新对话（无头跑，需手动触发）：AI 将只读巡检课题/排查 bug 并落档修复报告与工单…');
        } catch (e) {
            console.error('[NightFixMaster]', e);
            if (self._logMasterToast) self._logMasterToast('夜间修复大师执行出错: ' + e.message);
        }
    };
})();
