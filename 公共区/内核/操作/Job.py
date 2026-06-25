"""
Job操作模块 - Job创建/更新/列表/详情
"""
import json
import time
from .基类 import 操作结果, 操作基类


class _Job管理器:
    """Job状态管理（内存级，session生命周期）"""
    _实例 = None

    def __new__(cls):
        if cls._实例 is None:
            cls._实例 = super().__new__(cls)
            cls._实例._jobs = {}
            cls._实例._next_id = 1
        return cls._实例

    def 创建(self, subject, description=""):
        job_id = str(self._next_id)
        self._next_id += 1
        self._jobs[job_id] = {
            "id": job_id, "subject": subject, "description": description,
            "status": "pending", "owner": "",
            "blocks": [], "blockedBy": [],
            "metadata": {},
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "updated_at": ""
        }
        return job_id

    def 更新(self, job_id, status=None, owner=None, addBlocks=None, addBlockedBy=None, removeBlocks=None, removeBlockedBy=None, metadata=None):
        job = self._jobs.get(job_id)
        if not job:
            return None
        if status:
            job["status"] = status
        if owner is not None:
            job["owner"] = owner
        if addBlocks:
            job["blocks"].extend(addBlocks)
        if addBlockedBy:
            job["blockedBy"].extend(addBlockedBy)
        if removeBlocks:
            job["blocks"] = [b for b in job["blocks"] if b not in removeBlocks]
        if removeBlockedBy:
            job["blockedBy"] = [b for b in job["blockedBy"] if b not in removeBlockedBy]
        if metadata:
            job["metadata"].update(metadata)
        job["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        return job

    def 获取(self, job_id):
        return self._jobs.get(job_id)

    def 列表(self):
        return list(self._jobs.values())

    def 可用任务(self):
        return [j for j in self._jobs.values()
                if j["status"] == "pending" and not j["blockedBy"]]


class Job创建(操作基类):
    名称 = "Job创建"
    描述 = "创建一个新的工作任务，用于跟踪多步骤实现的进度"
    参数结构 = {
        "标题": {"类型": "字符串", "必填": True, "说明": "任务标题"},
        "描述": {"类型": "字符串", "必填": False, "说明": "任务详细描述"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        管理器 = _Job管理器()
        job_id = 管理器.创建(参数.get("标题", ""), 参数.get("描述", ""))
        return 操作结果.成功(f"已创建Job #{job_id}: {参数.get('标题', '')}")


class Job更新(操作基类):
    名称 = "Job更新"
    描述 = "更新任务状态、设置依赖关系(blocks/blockedBy)"
    参数结构 = {
        "job_id": {"类型": "字符串", "必填": True, "说明": "任务ID"},
        "状态": {"类型": "字符串", "必填": False, "说明": "pending/in_progress/completed/failed"},
        "addBlocks": {"类型": "字符串", "必填": False, "说明": "添加阻塞的Job ID列表(JSON数组)"},
        "addBlockedBy": {"类型": "字符串", "必填": False, "说明": "添加被阻塞的Job ID列表(JSON数组)"},
        "removeBlocks": {"类型": "字符串", "必填": False, "说明": "移除阻塞的Job ID列表(JSON数组)"},
        "removeBlockedBy": {"类型": "字符串", "必填": False, "说明": "移除被阻塞的Job ID列表(JSON数组)"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        管理器 = _Job管理器()
        job_id = 参数.get("job_id", "")
        def parse_list(s):
            if not s:
                return None
            try:
                return json.loads(s) if isinstance(s, str) else s
            except:
                return None
        job = 管理器.更新(
            job_id,
            status=参数.get("状态"),
            addBlocks=parse_list(参数.get("addBlocks")),
            addBlockedBy=parse_list(参数.get("addBlockedBy")),
            removeBlocks=parse_list(参数.get("removeBlocks")),
            removeBlockedBy=parse_list(参数.get("removeBlockedBy"))
        )
        if not job:
            return 操作结果.失败(f"Job #{job_id} 不存在")
        return 操作结果.成功(f"已更新Job #{job_id}: 状态={job['status']}, blocks={job['blocks']}, blockedBy={job['blockedBy']}")


class Job列表(操作基类):
    名称 = "Job列表"
    描述 = "列出所有工作任务及其状态"
    参数结构 = {}

    def 执行(self, 参数: dict) -> 操作结果:
        管理器 = _Job管理器()
        jobs = 管理器.列表()
        if not jobs:
            return 操作结果.成功("无任务")
        格式化 = []
        for j in jobs:
            状态图标 = {"pending": "⏳", "in_progress": "🔄", "completed": "✅", "failed": "❌"}.get(j["status"], "❓")
            行 = f"{状态图标} #{j['id']} [{j['status']}] {j['subject']}"
            if j["blocks"]:
                行 += f" → 阻塞: {j['blocks']}"
            if j["blockedBy"]:
                行 += f" ← 被阻塞: {j['blockedBy']}"
            格式化.append(行)
        return 操作结果.成功(f"共{len(jobs)}个任务:\n" + "\n".join(格式化))


class Job详情(操作基类):
    名称 = "Job详情"
    描述 = "获取单个任务的完整信息（含依赖关系）"
    参数结构 = {
        "job_id": {"类型": "字符串", "必填": True, "说明": "任务ID"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        管理器 = _Job管理器()
        job = 管理器.获取(参数.get("job_id", ""))
        if not job:
            return 操作结果.失败(f"Job #{参数.get('job_id', '')} 不存在")
        return 操作结果.成功(json.dumps(job, ensure_ascii=False, indent=2))
