# -*- coding: utf-8 -*-
import json, urllib.request, urllib.error

tasks = [
    {"goal": "审视 server/chat_pool.py 槽位回收与幂等逻辑，找出可优化点并给出补丁建议"},
    {"goal": "审查 server/agent_registry.py AgentCard TTL 与判活机制，提出改进"},
    {"goal": "分析 server/chat_gate.py 串行闸门 AIMD 策略，评估并发效率并给出调参建议"},
    {"goal": "审查 server/pool_resume.py 断点续跑恢复逻辑，找边界 case"},
    {"goal": "审查 server/conn_pool.py 连接池，评估 per_host/idle_sec 配置合理性"},
    {"goal": "扫描 server/routes/api_dispatch_post.py do_POST 巨型分发的可拆分性，提出重构路线"},
    {"goal": "审查 mixin_jobs 后台流水线与 schedule 定时任务的异常兜底"},
]

body = {
    "tasks": tasks,
    "model": "DeepSeek",
    "context": ("你们是 7 个无头进化智能体（补跑批次）。各自独立分析指定模块代码，产出：问题清单+补丁建议，"
                "每人写入 private/记忆/进化报告/ 下一个 md 文件（文件名含模块名）。完成后回复报告要点摘要。"),
}

req = urllib.request.Request(
    "http://127.0.0.1:8580/api/swarm/submit",
    data=json.dumps(body).encode("utf-8"),
    headers={"Content-Type": "application/json"},
)
try:
    r = urllib.request.urlopen(req, timeout=60)
    out = "OK %s\n%s" % (r.status, r.read().decode("utf-8", "replace")[:2000])
except urllib.error.HTTPError as e:
    out = "ERR %s\n%s" % (e.code, e.read().decode("utf-8", "replace")[:800])

with open(r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\scripts\_swarm_spawn3_out.txt", "w", encoding="utf-8") as f:
    f.write(out)
print("done")
