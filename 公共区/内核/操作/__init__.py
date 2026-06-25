"""
操作包 - 所有内置操作的模块化拆分
v2.1: 从单一操作基类.py拆分为按功能分组的多个模块
"""
from .基类 import 操作结果, 操作基类
from .文件 import (
    创建文件, 读取文件, 写入文件, 追加文件, 删除文件, 替换文本, 批量编辑, 列出目录
)
from .代码 import (搜索代码, Glob搜索, 符号搜索, 验证代码, 自动测试, 构建验证)
from .Git import (Git状态, Git提交, Git回滚, Git差异, Git日志, Git分支)
from .系统 import (打开程序, 运行命令, 截图, 获取时间, 系统信息, 等待, 数学计算, JSON操作)
from .网络 import (网页抓取, 网络搜索, 网页分析, 图片分析)
from .高级 import (子代理, 并行执行, Pipeline, Barrier, LoopUntilDry, 后台执行, 获取后台结果)
from .Job import (Job创建, Job更新, Job列表, Job详情)
from .Word import (读取Word, 替换Word文本, 追加Word段落, 插入Word段落, 删除Word段落, 新建Word文档)
from .Excel import (替换Excel文本,)
from .图片下载 import (下载网页图片,)
from .多线程下载 import (多线程下载,)
from .压缩 import (解压文件, 压缩文件,)
from .知识库操作 import (导入文档, 搜索知识库, 列出知识库文档, 删除知识库文档,)
from .剧本操作 import (开始录制, 停止录制, 回放剧本, 列出剧本, 删除剧本,)
from .导出与配置操作 import (导出对话, 创建工具,)
from .ComfyUI操作 import (
    ComfyUI提交工作流, ComfyUI查询进度, ComfyUI获取图片, ComfyUI列出模型,
    ComfyUI队列控制, ComfyUI一键生图, ComfyUI上传图片, ComfyUI列出工作流,
    ComfyUI图片修改, ComfyUI视频生成, ComfyUI反推, ComfyUI启动,
)

__all__ = [
    "操作结果", "操作基类",
    "创建文件", "读取文件", "写入文件", "追加文件", "删除文件", "替换文本", "批量编辑", "列出目录",
    "搜索代码", "Glob搜索", "符号搜索", "验证代码", "自动测试", "构建验证",
    "Git状态", "Git提交", "Git回滚", "Git差异", "Git日志", "Git分支",
    "打开程序", "运行命令", "截图", "获取时间", "系统信息", "等待", "数学计算", "JSON操作",
    "网页抓取", "网络搜索", "网页分析", "图片分析",
    "子代理", "并行执行", "Pipeline", "Barrier", "LoopUntilDry", "后台执行", "获取后台结果",
    "Job创建", "Job更新", "Job列表", "Job详情",
    "读取Word", "替换Word文本", "追加Word段落", "插入Word段落", "删除Word段落", "新建Word文档",
    "替换Excel文本",
    "下载网页图片",
    "多线程下载",
    "解压文件", "压缩文件",
    "导入文档", "搜索知识库", "列出知识库文档", "删除知识库文档",
    "开始录制", "停止录制", "回放剧本", "列出剧本", "删除剧本",
    "导出对话", "创建工具",
    "ComfyUI提交工作流", "ComfyUI查询进度", "ComfyUI获取图片",
    "ComfyUI列出模型", "ComfyUI队列控制", "ComfyUI一键生图", "ComfyUI上传图片",
    "ComfyUI列出工作流", "ComfyUI图片修改", "ComfyUI视频生成", "ComfyUI反推",
    "ComfyUI启动",
]
