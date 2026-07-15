/**
 * 后台任务通知 — 轮询 /api/bg-tasks，任务完成时弹Toast通知
 * 空闲时30秒轮询一次，有运行中任务时5秒轮询一次
 */
let _bgPollTimer = null;
let _bgKnownTasks = {};  // task_id -> status，记录上次已知状态

function startBgTaskPoll() {
    if (_bgPollTimer) return;
    pollBgTasks();
}

function stopBgTaskPoll() {
    if (_bgPollTimer) { clearTimeout(_bgPollTimer); _bgPollTimer = null; }
}

async function pollBgTasks() {
    _bgPollTimer = null;
    try {
        const res = await fetch("/api/bg-tasks");
        const d = await res.json();
        const 任务列表 = d.任务列表 || [];
        let 有运行中 = false;

        for (const t of 任务列表) {
            const 旧状态 = _bgKnownTasks[t.task_id];
            const 新状态 = t.status;

            if (旧状态 === "running" && 新状态 !== "running") {
                const 操作名 = t.操作名 || "";
                if (新状态 === "completed") {
                    showToast("success", "后台任务完成", `${t.task_id} (${操作名}) 已完成`, 6000);
                } else if (新状态 === "failed") {
                    showToast("error", "后台任务失败", `${t.task_id} (${操作名}) 执行失败`, 6000);
                } else if (新状态 === "stopped") {
                    showToast("info", "后台任务已停止", `${t.task_id} (${操作名}) 已停止`, 6000);
                }
            }

            _bgKnownTasks[t.task_id] = 新状态;
            if (新状态 === "running") 有运行中 = true;
        }

        // 有运行中任务 → 5秒后再次轮询；无运行中 → 30秒后慢速轮询
        _bgPollTimer = setTimeout(pollBgTasks, 有运行中 ? 5000 : 30000);
    } catch (e) {
        _bgPollTimer = setTimeout(pollBgTasks, 10000);
    }
}
