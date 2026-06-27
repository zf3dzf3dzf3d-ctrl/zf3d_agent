"""
操作基类 v2.1 — 兼容性导入层
所有操作类已拆分到 操作/ 包下，本文件仅保留导入转发，确保旧代码兼容
"""
from 操作.基类 import 操作结果, 操作基类
from 操作.文件 import (
    创建文件, 读取文件, 写入文件, 追加文件, 删除文件, 替换文本, 批量编辑, 列出目录,
    列出回收站, 恢复文件, 清空回收站
)
from 操作.代码 import (搜索代码, Glob搜索, 符号搜索, 验证代码, 自动测试, 构建验证)
from 操作.Git import (Git状态, Git提交, Git回滚, Git差异, Git日志, Git分支)
from 操作.系统 import (打开程序, 运行命令, 截图, 获取时间, 系统信息, 等待, 数学计算, JSON操作)
from 操作.网络 import (网页抓取, 网络搜索, 网页分析, 图片分析)
from 操作.Job import (Job创建, Job更新, Job列表, Job详情)
from 操作.高级 import (
    子代理, 并行执行, Pipeline, Barrier, LoopUntilDry,
    _后台任务管理器, 后台执行, 获取后台结果,
    查Bug, 编程循环
)
from 操作.诊断 import (
    查询运行错误, 解决运行错误, 清除已解决错误,
    添加监控规则, 查询监控规则, 删除监控规则, 搜索操作结果
)
from 操作.Word import (
    读取Word, 替换Word文本, 追加Word段落, 插入Word段落, 删除Word段落, 新建Word文档
)
from 操作.Excel import (
    替换Excel文本,
)
from 操作.图片下载 import (
    下载网页图片,
)
from 操作.多线程下载 import (
    多线程下载,
)
from 操作.ComfyUI操作 import (
    ComfyUI提交工作流, ComfyUI查询进度, ComfyUI获取图片, ComfyUI列出模型,
    ComfyUI队列控制, ComfyUI一键生图, ComfyUI上传图片, ComfyUI列出工作流,
)

__all__ = [
    "操作结果", "操作基类",
    "创建文件", "读取文件", "写入文件", "追加文件", "删除文件", "替换文本", "批量编辑", "列出目录",
    "列出回收站", "恢复文件", "清空回收站",
    "搜索代码", "Glob搜索", "符号搜索", "验证代码", "自动测试", "构建验证",
    "Git状态", "Git提交", "Git回滚", "Git差异", "Git日志", "Git分支",
    "打开程序", "运行命令", "截图", "获取时间", "系统信息", "等待", "数学计算", "JSON操作",
    "网页抓取", "网络搜索", "网页分析", "图片分析",
    "子代理", "并行执行", "Pipeline", "Barrier", "LoopUntilDry",
    "_后台任务管理器", "后台执行", "获取后台结果",
    "Job创建", "Job更新", "Job列表", "Job详情",
    "查询运行错误", "解决运行错误", "清除已解决错误",
    "添加监控规则", "查询监控规则", "删除监控规则",
    "读取Word", "替换Word文本", "追加Word段落", "插入Word段落", "删除Word段落", "新建Word文档",
    "替换Excel文本",
    "下载网页图片",
    "多线程下载",
    "ComfyUI提交工作流", "ComfyUI查询进度", "ComfyUI获取图片",
    "ComfyUI列出模型", "ComfyUI队列控制", "ComfyUI一键生图", "ComfyUI上传图片",
    "ComfyUI列出工作流",
]
