// ========== app-filemaster.js - 🧹 文件资源管理师 ==========
// 功能：点一下打包「文件体检任务」发送到新对话，让 AI 扫描项目垃圾文件：
//   ① 垃圾文件扫描（_tmp_*/临时文件/空文件，只报告）② bak 收容（移到 private/垃圾场/bak收容/）
//   ③ 陈旧 bak 清理（>30天，必须二次确认）④ git 卫生检查 ⑤ 可疑文件查询
// 安全红线（写死在提示词里）：白名单源码目录永不动；bak 只移不删；删除必须用户二次确认。
(function () {
    'use strict';

    function buildPrompt() {
        var lines = [];
        lines.push('===== 🧹 文件资源管理师 · 项目文件体检任务 =====');
        lines.push('生成时间: ' + new Date().toLocaleString());
        lines.push('项目根目录: 以你当前工作目录(cwd)为准,不要假设固定路径');
        lines.push('');
        lines.push('【你的角色】你是「文件资源管理师」，负责项目文件卫生：垃圾文件扫描、bak 收容、陈旧 bak 清理、git 卫生检查、可疑文件查询。');
        lines.push('');
        lines.push('【本次任务】对项目根目录做一次全面文件体检，输出以下四份报告：');
        lines.push('1. 垃圾文件清单：扫描 _tmp_*、_scan*、临时文件、空文件、无主文件（只报告，先不要动）');
        lines.push('2. bak 收容清单：散落各处的 .bak / .bak.* 文件，建议移入收容目录 private/垃圾场/bak收容/（移动前先列出「来源路径 → 收容路径」映射表）');
        lines.push('3. 陈旧 bak 待删清单：收容目录中修改时间超过 30 天的 bak，列出后等待我确认，确认前绝不能删');
        lines.push('4. git 卫生报告：检查 .gitignore 是否覆盖该忽略的目录（缓存/日志/数据），列出未跟踪的可疑文件');
        lines.push('');
        lines.push('【安全红线 · 必须严格遵守】');
        lines.push('① 白名单永不动：server/、public/ 的源码文件、.git、python/、private/记忆/ 一律禁止修改/移动/删除（其中的 .bak 例外，只允许移动到收容目录）');
        lines.push('② 修改时间在 2 小时内的文件标记为「疑似活跃勿动」，只报告不处理');
        lines.push('③ 本轮只允许执行「移动到收容目录」类操作，且必须在消息里给出完整映射表；任何删除操作必须先出清单、等我明确回复确认后才执行');
        lines.push('④ 执行收容/删除前，先对项目做一次 git 提交兜底（如果工作区不干净）；扫描要排除 python/、node_modules/、.git/ 目录，避免卡死');
        lines.push('⑤ 收容目录不存在时先创建；移动后要在报告里保留来源信息，保证可回溯');
        lines.push('');
        lines.push('现在开始体检，先输出四份报告再等我裁决，不要擅自动手删除任何文件。');
        return lines.join('\n');
    }

    App.fileMaster = function (srcBox) {
        var self = App;
        try {
            var chat = self._logMasterFindChat ? self._logMasterFindChat(srcBox) : null;
            var prompt = buildPrompt();
            if (typeof self._logMasterSendToNewChat !== 'function') {
                self._logMasterToast('文件资源管理师依赖日志大师公共链路，加载失败');
                return;
            }
            self._logMasterSendToNewChat(srcBox, chat, prompt, '🧹 文件体检', 'filemaster');
            if (self._logMasterToast) self._logMasterToast('🧹 文件体检任务已发送到新对话，AI 将先出报告再等你确认…');
        } catch (e) {
            console.error('[FileMaster]', e);
            if (self._logMasterToast) self._logMasterToast('文件资源管理师执行出错: ' + e.message);
        }
    };
})();
