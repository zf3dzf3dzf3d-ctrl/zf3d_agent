# -*- coding: utf-8 -*-
import json, urllib.request, urllib.error

tasks = [
    {"goal": "审视 server/chat_pool.py 槽位回收与幂等逻辑，找出可优化点并给出补丁建议。最终回复直接给出：问题清单+补丁建议全文。"},
    {"goal": "审查 server/agent_registry.py AgentCard TTL 与判活机制，提出改进。最终回复直接给出：问题清单+改进建议全文。"},
    {"goal": "分析 server/chat_gate.py 串行闸门 AIMD 策略，评估并发效率并给出调参建议。最终回复直接给出：分析+调参建议全文。"},
    {"goal": "审查 server/pool_resume.py 断点续跑恢复逻辑，找边界 case。最终回复直接给出：边界问题清单+建议全文。"},
    {"goal": "审视 server/routes/mixin_browser.py 浏览器会话管理，找资源泄漏风险。最终回复直接给出：风险清单+建议全文。"},
    {"goal": "审查 server/conn_pool.py 连接池，评估 per_host/idle_sec 配置合理性。最终回复直接给出：评估+建议全文。"},
    {"goal": "扫描 server/routes/api_dispatch_post.py do_POST 巨型分发的可拆分性，提出重构路线。最终回复直接给出：重构路线全文。"},
]

body = {
    "tasks": tasks,
    "model": "智谱 GLM",
    "context": ("你们是 7 个无头进化智能体。各自独立分析指定模块代码。"
                "重要：不要写文件，分析结论直接写在最终回复里（问题清单+补丁建议），主控会汇总落盘。"),
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

with open(r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\scripts\_spawn4_out.txt", "w", encoding="utf-8") as f:
    f.write(out)
print("done")
