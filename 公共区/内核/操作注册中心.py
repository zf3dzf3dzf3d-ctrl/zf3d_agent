"""
操作注册中心 - 注册、调度、执行操作
所有操作通过名称调用，解耦模块与具体操作
"""
import json
import threading
from 操作基类 import (
    操作基类, 操作结果,
    打开程序, 运行命令, 创建文件, 读取文件, 写入文件, 追加文件,
    删除文件, 替换文本, 列出目录, 网页抓取, 网络搜索, 截图, 获取时间,
    系统信息, 等待, 数学计算, JSON操作, 搜索代码, 批量编辑, 验证代码,
    Git状态, Git提交, Git回滚,
    Glob搜索, 符号搜索,
    Git差异, Git日志, Git分支,
    自动测试, 构建验证,
    网页分析, 图片分析,
    Job创建, Job更新, Job列表, Job详情,
    后台执行, 获取后台结果,
    子代理, 并行执行,
    Pipeline, Barrier, LoopUntilDry,
    查Bug, 编程循环,
    查询运行错误, 解决运行错误, 清除已解决错误,
    添加监控规则, 查询监控规则, 删除监控规则, 搜索操作结果,
    读取Word, 替换Word文本, 追加Word段落, 插入Word段落, 删除Word段落, 新建Word文档,
    替换Excel文本,
    下载网页图片,
    多线程下载,
    列出回收站, 恢复文件, 清空回收站,
    ComfyUI提交工作流, ComfyUI查询进度, ComfyUI获取图片, ComfyUI列出模型,
    ComfyUI队列控制, ComfyUI一键生图, ComfyUI上传图片, ComfyUI列出工作流,
)
from 操作.ComfyUI操作 import (
    ComfyUI图片修改, ComfyUI视频生成, ComfyUI反推, ComfyUI启动,
    ComfyUI诊断, ComfyUI修复自定义节点,
)
from 操作.压缩 import (
    解压文件, 压缩文件,
)
from 操作.知识库操作 import (
    导入文档, 搜索知识库, 列出知识库文档, 删除知识库文档,
)
from 操作.剧本操作 import (
    开始录制, 停止录制, 回放剧本, 列出剧本, 删除剧本,
)
from 操作.导出与配置操作 import (
    导出对话, 创建工具,
)
from 操作.询问用户 import (
    询问用户,
)
from 操作.记忆操作 import (
    保存记忆, 搜索记忆, 遗忘记忆,
)
from 操作.账本操作 import (
    查看任务账本, 添加任务 as 账本添加任务, 完成任务 as 账本完成任务,
)
from 操作.浏览器操作 import (
    打开网页操作, 读取页面内容操作, 读取页面结构操作,
    读取页面元素操作, 浏览器截图操作, 搜索页面内容操作,
    点击网页元素操作, 填写网页表单操作, 滚动网页操作,
    返回上一页操作, 切换标签页操作,
    保存浏览器会话操作, 加载浏览器会话操作,
    分析网页操作,
)


class 操作注册中心类:
    """操作注册与调度中心"""
    _实例引用 = None  # 类级自引用，供操作类内部访问

    def __init__(self):
        self._操作表 = {}  # 名称 -> 操作实例
        self._别名表 = {}  # 别名 -> 正式名称
        self._文件管理器 = None
        self._模型直连器 = None
        self._配置加载器 = None
        操作注册中心类._实例引用 = self
        # v2.1: 操作调用统计
        self._操作统计 = {}  # 操作名 -> {"调用次数": N, "成功次数": N, "失败次数": N, "总耗时毫秒": N}
        self._调用历史 = []  # 最近100条调用记录
        self._统计锁 = threading.Lock()  # 统计数据线程安全锁
        # 中文名→英文名映射（API function name必须为[a-zA-Z0-9_-]）
        self._英文名映射 = {
            "打开程序": "open_program", "运行命令": "run_command",
            "创建文件": "create_file", "读取文件": "read_file",
            "写入文件": "write_file", "追加文件": "append_file",
            "删除文件": "delete_file", "替换文本": "replace_text",
            "批量编辑": "batch_edit", "列出目录": "list_dir",
            "网页抓取": "web_fetch", "网络搜索": "web_search",
            "截图": "screenshot", "获取时间": "get_time",
            "系统信息": "system_info", "等待": "wait",
            "数学计算": "math_calc", "JSON操作": "json_op",
            "搜索代码": "search_code", "验证代码": "verify_code",
            "Git状态": "git_status", "Git提交": "git_commit", "Git回滚": "git_rollback",
            "Glob搜索": "glob_search", "符号搜索": "symbol_search",
            "Git差异": "git_diff", "Git日志": "git_log", "Git分支": "git_branch",
            "自动测试": "auto_test", "构建验证": "build_check",
            "网页分析": "web_analyze", "图片分析": "image_analyze",
            "Job创建": "job_create", "Job更新": "job_update",
            "Job列表": "job_list", "Job详情": "job_get",
            "后台执行": "bg_run", "获取后台结果": "bg_result",
            "子代理": "sub_agent", "并行执行": "parallel_run",
            "Pipeline": "pipeline", "Barrier": "barrier", "LoopUntilDry": "loop_until_dry",
            "查Bug": "bug_check", "编程循环": "code_loop",
            "查询运行错误": "query_errors", "解决运行错误": "resolve_error",
            "清除已解决错误": "clear_resolved", "添加监控规则": "add_monitor_rule",
            "查询监控规则": "list_monitor_rules",             "删除监控规则": "remove_monitor_rule",
            "搜索操作结果": "search_op_results",
            "读取Word": "read_word", "替换Word文本": "replace_word_text",
            "追加Word段落": "append_word_para", "插入Word段落": "insert_word_para",
            "删除Word段落": "delete_word_para", "新建Word文档": "create_word_doc",
            "替换Excel文本": "replace_excel_text",
            "下载网页图片": "download_web_images",
                "多线程下载": "multi_thread_download",
                "ComfyUI提交工作流": "comfyui_submit_workflow",
                "ComfyUI查询进度": "comfyui_query_progress",
                "ComfyUI获取图片": "comfyui_get_image",
                "ComfyUI列出模型": "comfyui_list_models",
                "ComfyUI队列控制": "comfyui_queue_control",
                "ComfyUI一键生图": "comfyui_generate_image",
                    "ComfyUI上传图片": "comfyui_upload_image",
                    "ComfyUI列出工作流": "comfyui_list_workflows",
                    "ComfyUI图片修改": "comfyui_image_modify",
                    "ComfyUI视频生成": "comfyui_video_generate",
                    "ComfyUI反推": "comfyui_interrogate",
                    "ComfyUI启动": "comfyui_start",
                    "ComfyUI诊断": "comfyui_diagnose",
                    "ComfyUI修复自定义节点": "comfyui_fix_custom_nodes",
                    "解压文件": "extract_file",
                    "压缩文件": "compress_file",
                    "导入文档": "import_doc",
                    "搜索知识库": "search_kb",
                    "列出知识库文档": "list_kb_docs",
                    "删除知识库文档": "delete_kb_doc",
            "开始录制": "start_record",
            "停止录制": "stop_record",
            "回放剧本": "play_script",
            "列出剧本": "list_scripts",
            "删除剧本": "delete_script",
            "导出对话": "export_chat",
            "创建工具": "create_tool",
            "询问用户": "ask_user",
                    # 浏览器操作
                    "打开网页": "open_webpage",
                    "读取页面内容": "read_page_content",
                    "读取页面结构": "read_page_structure",
                    "读取页面元素": "read_page_elements",
                    "浏览器截图": "browser_screenshot",
                    "搜索页面内容": "search_page_content",
                    "点击网页元素": "click_web_element",
                    "填写网页表单": "fill_web_form",
                    "滚动网页": "scroll_webpage",
                    "返回上一页": "go_back",
                    "切换标签页": "switch_tab",
                    "保存浏览器会话": "save_browser_session",
                    "加载浏览器会话": "load_browser_session",
                    "分析网页": "analyze_webpage",
                    "列出回收站": "list_trash",
                    "恢复文件": "restore_file",
                    "清空回收站": "empty_trash",
                }
        self._英文反查 = {v: k for k, v in self._英文名映射.items()}
        # 参数名中文→英文映射
        self._参数名映射 = {
            "路径": "path", "内容": "content", "命令": "command",
            "超时秒数": "timeout", "工作目录": "cwd", "程序名或路径": "program",
            "旧文本": "old_text", "新文本": "new_text", "新名称": "new_name",
            "编辑列表": "edits", "关键词": "keyword", "后缀过滤": "ext_filter",
            "消息": "message", "表达式": "expression", "网址": "url",
            "保存路径": "save_path", "秒数": "seconds",
            "字段路径": "field_path", "新值": "new_value",
            "全部替换": "replace_all", "匹配计数": "match_count",
            "offset": "offset", "limit": "limit",
            "正则模式": "regex_mode", "忽略大小写": "ignore_case",
            "上下文行数": "context_lines", "输出模式": "output_mode",
            "maxResults": "max_results",
            "pattern": "pattern", "递归": "recursive",
            "符号类型": "symbol_type",
            "模式": "mode", "文件路径": "file_path", "提交": "commit",
            "数量": "count", "格式": "format", "操作类型": "action_type",
            "分支名": "branch_name",
            "页码": "page", "图片路径": "image_path", "问题": "question",
            "最大长度": "max_length",
            "标题": "subject", "描述": "description",
            "job_id": "job_id", "状态": "status",
            "addBlocks": "add_blocks", "addBlockedBy": "add_blocked_by",
            "removeBlocks": "remove_blocks", "removeBlockedBy": "remove_blocked_by",
            "操作名": "action_name", "参数": "params",
            "task_id": "task_id", "任务描述": "task_desc",
            "类型": "agent_type", "任务列表": "task_list",
            "最大并发数": "max_workers",
            "未解决Only": "unresolved_only", "最近数": "limit",
            "错误ID": "error_id", "解决说明": "resolution",
            "规则ID": "rule_id", "名称": "rule_name",
            "目标模块": "target_module", "目标函数": "target_func",
            "异常类型": "exception_type", "关键字": "match_keyword",
            "动作": "action",
            "序号": "index", "样式": "style",
            "保存目录": "save_dir", "最小宽度": "min_width", "最大数量": "max_count",
            "下载地址": "download_url", "线程数": "thread_count", "重试次数": "retry_count",
            "工作流": "workflow", "等待完成": "wait_complete",
            "prompt_id": "prompt_id",
            "提示词": "prompt", "负面提示词": "negative_prompt", "模型": "model_name",
            "宽度": "width", "高度": "height", "步数": "steps", "CFG": "cfg",
            "种子": "seed",             "图片路径": "image_path", "覆盖": "overwrite", "子目录": "subfolder",
            "分类": "category",
            "源路径": "source_path", "压缩包路径": "archive_path",
            "解压目录": "extract_dir", "压缩级别": "compression_level",
            "密码": "password", "操作": "action",
            "搜索": "search",
            "等待就绪": "wait_ready",
            "阶段列表": "stage_list",
            "目标": "target",
            "最大轮数": "max_rounds",
            "连续干燥轮数": "dry_rounds",
            "已发现结果": "found_results",
            "条数": "count", "最大循环次数": "max_iterations",
            "位置": "position",
            # 浏览器操作参数
            "元素角色": "element_role",
            "元素名称": "element_name",
            "元素类型": "element_type",
            "值": "value",
            "方向": "direction",
            "像素": "pixels",
            "标签序号": "tab_index",
            "标签标题": "tab_title",
            "站点名称": "site_name",
            "分析目标": "analysis_target",
            "最大深度": "max_depth",
            "回收站名": "trash_name",
            "文档名": "doc_name",
            "变量": "variables",
            "对话ID": "chat_id",
            "包含推理": "include_reasoning",
            "问题列表": "question_list",
        }
        self._参数名反查 = {v: k for k, v in self._参数名映射.items()}

    def 设置文件管理器(self, 文件管理器):
        """注入文件管理器，使文件操作走权限校验"""
        self._文件管理器 = 文件管理器
        for 操作实例 in self._操作表.values():
            操作实例.文件管理器 = 文件管理器

    def 设置模型直连器(self, 模型直连器):
        """注入模型直连器，使操作类可直接调用LLM"""
        self._模型直连器 = 模型直连器
        for 操作实例 in self._操作表.values():
            操作实例.模型直连器 = 模型直连器

    def 设置配置加载器(self, 配置加载器):
        """注入配置加载器，使操作类可读取系统配置"""
        self._配置加载器 = 配置加载器

    _当前工作目录 = None

    def 设置当前工作目录(self, 工作目录: str):
        """注入当前工作目录（前端打开的文件夹），供操作类作为默认保存路径"""
        self._当前工作目录 = 工作目录
        for 操作实例 in self._操作表.values():
            操作实例.当前工作目录 = 工作目录

    def 设置进度回调(self, 回调):
        """注入进度回调，使操作类可推送实时进度到推理流"""
        self._进度回调 = 回调
        for 操作实例 in self._操作表.values():
            操作实例.进度回调 = 回调

    def 设置取消检查(self, 检查函数):
        """注入取消检查函数，使操作类可检测用户取消"""
        self._取消检查 = 检查函数
        for 操作实例 in self._操作表.values():
            操作实例.取消检查 = 检查函数

    def 注册(self, 操作实例: 操作基类):
        """注册一个操作"""
        self._操作表[操作实例.名称] = 操作实例
        # 动态工具注册时同步英文名映射和反查表
        if 操作实例.名称 not in self._英文名映射:
            import hashlib
            哈希 = hashlib.md5(操作实例.名称.encode()).hexdigest()[:8]
            英文名 = f"dynamic_tool_{哈希}"
            self._英文名映射[操作实例.名称] = 英文名
            self._英文反查[英文名] = 操作实例.名称

    def 注册别名(self, 别名: str, 正式名称: str):
        """注册操作别名"""
        self._别名表[别名] = 正式名称

    def 注册内置操作(self):
        """注册所有内置操作"""
        # ComfyUI操作放最前面，确保AI优先看到并使用
        内置操作列表 = [
            ComfyUI一键生图(), ComfyUI列出模型(), ComfyUI列出工作流(),
            ComfyUI提交工作流(), ComfyUI查询进度(), ComfyUI获取图片(),
            ComfyUI队列控制(), ComfyUI上传图片(),
            ComfyUI图片修改(), ComfyUI视频生成(), ComfyUI反推(), ComfyUI启动(),
            ComfyUI诊断(), ComfyUI修复自定义节点(),
            打开程序(), 运行命令(), 创建文件(), 读取文件(), 写入文件(),
            追加文件(), 删除文件(), 替换文本(), 列出目录(), 网页抓取(), 网络搜索(),
            截图(), 获取时间(), 系统信息(), 等待(), 数学计算(), JSON操作(),
            搜索代码(), 批量编辑(), 验证代码(),
            Git状态(), Git提交(), Git回滚(),
            Glob搜索(), 符号搜索(),
            Git差异(), Git日志(), Git分支(),
            自动测试(), 构建验证(),
            网页分析(), 图片分析(),
            Job创建(), Job更新(), Job列表(), Job详情(),
            后台执行(), 获取后台结果(),
            子代理(), 并行执行(),
            Pipeline(), Barrier(), LoopUntilDry(),
            查Bug(), 编程循环(),
            查询运行错误(), 解决运行错误(), 清除已解决错误(),
            添加监控规则(), 查询监控规则(), 删除监控规则(), 搜索操作结果(),
            读取Word(), 替换Word文本(), 追加Word段落(), 插入Word段落(), 删除Word段落(), 新建Word文档(),
            替换Excel文本(),
            下载网页图片(),
            多线程下载(),
            解压文件(), 压缩文件(),
            导入文档(), 搜索知识库(), 列出知识库文档(), 删除知识库文档(),
            开始录制(), 停止录制(), 回放剧本(), 列出剧本(), 删除剧本(),
            导出对话(), 创建工具(),
            列出回收站(), 恢复文件(), 清空回收站(),
            保存记忆(), 搜索记忆(), 遗忘记忆(),
            查看任务账本(), 账本添加任务(), 账本完成任务(),
            # 浏览器操作
            打开网页操作(), 读取页面内容操作(), 读取页面结构操作(),
            读取页面元素操作(), 浏览器截图操作(), 搜索页面内容操作(),
            点击网页元素操作(), 填写网页表单操作(), 滚动网页操作(),
            返回上一页操作(), 切换标签页操作(),
            保存浏览器会话操作(), 加载浏览器会话操作(),
            分析网页操作(),
            询问用户(),
        ]
        for 操作 in 内置操作列表:
            self.注册(操作)

        # 常用别名
        别名映射 = {
            "打开": "打开程序", "运行": "运行命令", "执行命令": "运行命令",
            "创建": "创建文件", "写文件": "写入文件", "读文件": "读取文件",
            "追加": "追加文件", "删除": "删除文件", "列表": "列出目录",
            "替换": "替换文本", "修改代码": "替换文本",
            "抓取": "网页抓取", "搜索": "搜索代码", "截屏": "截图",
            "时间": "获取时间", "系统": "系统信息", "计算": "数学计算",
            "修改JSON": "JSON操作", "读取JSON": "JSON操作",
            "grep": "搜索代码", "查找": "搜索代码", "查找代码": "搜索代码",
            "批量替换": "批量编辑", "多处替换": "批量编辑",
            "检查语法": "验证代码", "语法检查": "验证代码", "验证": "验证代码",
            "git status": "Git状态", "git": "Git状态",
            "git commit": "Git提交", "提交": "Git提交",
            "git checkout": "Git回滚", "回滚": "Git回滚",
            "git diff": "Git差异", "diff": "Git差异",
            "git log": "Git日志", "log": "Git日志",
            "git branch": "Git分支", "分支": "Git分支",
            "glob": "Glob搜索", "文件搜索": "Glob搜索",
            "符号": "符号搜索", "查找符号": "符号搜索", "查找定义": "符号搜索",
            "测试": "自动测试", "run test": "自动测试", "跑测试": "自动测试",
            "lint": "构建验证", "check": "构建验证", "类型检查": "构建验证",
            "分析网页": "网页分析", "fetch": "网页分析",
            "分析图片": "图片分析", "看图": "图片分析",
            "创建Job": "Job创建", "更新Job": "Job更新",
            "Job列表": "Job列表", "Job详情": "Job详情",
            "子agent": "子代理", "agent": "子代理", "sub-agent": "子代理",
            "并行": "并行执行", "parallel": "并行执行",
            "查bug": "查Bug", "检查bug": "查Bug", "bug检查": "查Bug",
            "诊断对话": "查Bug", "对话诊断": "查Bug", "查Bug": "查Bug",
            "编程循环": "编程循环", "code loop": "编程循环", "编程loop": "编程循环",
            "查bug": "查询运行错误", "查错误": "查询运行错误", "诊断": "查询运行错误",
            "修好了": "解决运行错误", "标记解决": "解决运行错误",
            "清错误": "清除已解决错误",
            "加监控": "添加监控规则", "监控": "添加监控规则",
            "查监控": "查询监控规则",
            "删监控": "删除监控规则",
            "读Word": "读取Word", "读word": "读取Word",
            "改Word": "替换Word文本", "替换Word": "替换Word文本",
            "加Word段落": "追加Word段落", "追加Word": "追加Word段落",
            "新建Word": "新建Word文档",
            "改Excel": "替换Excel文本", "替换Excel": "替换Excel文本",
            "下载图片": "下载网页图片", "抓取图片": "下载网页图片", "网页图片": "下载网页图片",
            "下载文件": "多线程下载", "迅雷下载": "多线程下载", "加速下载": "多线程下载",
            "解压": "解压文件", "unzip": "解压文件", "extract": "解压文件", "打开压缩包": "解压文件",
            "压缩": "压缩文件", "zip": "压缩文件", "archive": "压缩文件", "打包": "压缩文件",
            "AI生图": "ComfyUI一键生图", "文生图": "ComfyUI一键生图", "生成图片": "ComfyUI一键生图",
            "提交工作流": "ComfyUI提交工作流",
            "查询进度": "ComfyUI查询进度", "ComfyUI进度": "ComfyUI查询进度",
            "获取图片": "ComfyUI获取图片",
            "列出模型": "ComfyUI列出模型", "ComfyUI模型": "ComfyUI列出模型",
            "队列控制": "ComfyUI队列控制", "中断生成": "ComfyUI队列控制",
            "上传图片": "ComfyUI上传图片",
            "列出工作流": "ComfyUI列出工作流", "ComfyUI工作流": "ComfyUI列出工作流", "工作流列表": "ComfyUI列出工作流",
            "图片修改": "ComfyUI图片修改", "图生图": "ComfyUI图片修改", "修改图片": "ComfyUI图片修改", "多图修改": "ComfyUI图片修改",
            "图片放大": "ComfyUI图片修改", "放大图片": "ComfyUI图片修改", "图片缩放": "ComfyUI图片修改",
            "文生视频": "ComfyUI视频生成", "图生视频": "ComfyUI视频生成", "生成视频": "ComfyUI视频生成", "AI视频": "ComfyUI视频生成",
            "反推": "ComfyUI反推", "图片反推": "ComfyUI反推", "视频反推": "ComfyUI反推", "分析图片": "ComfyUI反推", "提示词反推": "ComfyUI反推",
            "启动ComfyUI": "ComfyUI启动", "启动comfyui": "ComfyUI启动", "ComfyUI启动": "ComfyUI启动",
            "ComfyUI诊断": "ComfyUI诊断", "诊断ComfyUI": "ComfyUI诊断", "comfyui诊断": "ComfyUI诊断", "检查ComfyUI": "ComfyUI诊断",
            "修复节点": "ComfyUI修复自定义节点", "ComfyUI修复节点": "ComfyUI修复自定义节点", "修复自定义节点": "ComfyUI修复自定义节点",
            "扫描节点": "ComfyUI修复自定义节点", "节点修复": "ComfyUI修复自定义节点", "修复comfyui": "ComfyUI修复自定义节点",
            "回收站": "列出回收站", "查看回收站": "列出回收站",
            "还原文件": "恢复文件", "恢复": "恢复文件", "还原": "恢复文件",
            "清空垃圾桶": "清空回收站",
            "导入知识": "导入文档", "知识库导入": "导入文档",
            "查知识库": "搜索知识库", "知识库搜索": "搜索知识库",
            "知识库列表": "列出知识库文档", "查看知识库": "列出知识库文档",
            "删除知识": "删除知识库文档", "知识库删除": "删除知识库文档",
            "录制": "开始录制", "开始录剧本": "开始录制",
            "结束录制": "停止录制", "停止录剧本": "停止录制", "保存剧本": "停止录制",
            "播放剧本": "回放剧本", "执行剧本": "回放剧本", "运行剧本": "回放剧本",
            "剧本列表": "列出剧本", "查看剧本": "列出剧本",
            "移除剧本": "删除剧本",
            "导出": "导出对话", "导出Markdown": "导出对话", "导出记录": "导出对话",
            "AI写配置": "创建工具", "自动创建工具": "创建工具", "生成工具": "创建工具",
        }
        for 别名, 正名 in 别名映射.items():
            self.注册别名(别名, 正名)

    def 执行(self, 操作名: str, 参数: dict = None) -> dict:
        """执行指定操作，返回结果字典"""
        参数 = 参数 or {}

        # 解析别名
        实际名称 = self._别名表.get(操作名, 操作名)

        操作实例 = self._操作表.get(实际名称)
        if not 操作实例:
            # 模糊匹配
            候选 = [名 for 名 in self._操作表.keys() if 操作名 in 名 or 名 in 操作名]
            if 候选:
                操作实例 = self._操作表[候选[0]]
                实际名称 = 候选[0]
            else:
                return {"成功": False, "错误": f"未知操作: {操作名}", "可用操作": list(self._操作表.keys())}

        # 验证参数
        验证结果 = 操作实例.验证参数(参数)
        if 验证结果:
            return {"成功": False, "错误": 验证结果}

        # v2.1: 统计记录
        import time
        开始时间 = time.time()

        # 执行
        try:
            结果 = 操作实例.执行(参数)
            返回结果 = 结果.转字典()
            成功 = 返回结果.get("成功", False)
        except Exception as e:
            返回结果 = {"成功": False, "错误": str(e)}
            成功 = False
            # 记录到运行诊断器
            try:
                from 运行诊断器 import 运行诊断器类
                if 运行诊断器类._实例引用:
                    运行诊断器类._实例引用.记录错误(f"操作注册中心.执行[{实际名称}]", e)
            except Exception:
                pass

        # 记录统计
        耗时 = int((time.time() - 开始时间) * 1000)
        with self._统计锁:
            if 实际名称 not in self._操作统计:
                self._操作统计[实际名称] = {"调用次数": 0, "成功次数": 0, "失败次数": 0, "总耗时毫秒": 0}
            self._操作统计[实际名称]["调用次数"] += 1
            self._操作统计[实际名称]["总耗时毫秒"] += 耗时
            if 成功:
                self._操作统计[实际名称]["成功次数"] += 1
            else:
                self._操作统计[实际名称]["失败次数"] += 1
            self._调用历史.append({
                "时间": time.strftime("%H:%M:%S"),
                "操作": 实际名称,
                "成功": 成功,
                "耗时毫秒": 耗时
            })
            if len(self._调用历史) > 100:
                self._调用历史 = self._调用历史[-100:]

        return 返回结果

    def 列出所有操作(self) -> list:
        """列出所有已注册操作"""
        return list(self._操作表.keys())

    def 获取操作说明(self) -> str:
        """生成所有操作的说明文本（用于系统提示词）"""
        说明 = []
        for 名称, 操作 in self._操作表.items():
            参数说明 = ""
            if 操作.参数结构:
                参数列表 = []
                for 参数名, 规则 in 操作.参数结构.items():
                    必填 = "必填" if 规则.get("必填") else "可选"
                    说明文字 = 规则.get("说明", "")
                    参数列表.append(f"  - {参数名}({规则.get('类型','字符串')},{必填}): {说明文字}")
                参数说明 = "\n".join(参数列表)
            说明.append(f"### {名称}\n{操作.描述}\n{参数说明}")
        return "\n\n".join(说明)

    def 获取操作JSON描述(self) -> list:
        """生成操作列表的JSON描述（用于LLM工具调用）"""
        描述 = []
        for 名称, 操作 in self._操作表.items():
            操作描述 = {
                "名称": 名称,
                "描述": 操作.描述,
                "参数": {}
            }
            for 参数名, 规则 in 操作.参数结构.items():
                操作描述["参数"][参数名] = {
                    "类型": 规则.get("类型", "字符串"),
                    "必填": 规则.get("必填", False),
                    "说明": 规则.get("说明", "")
                }
            描述.append(操作描述)
        return 描述

    def 获取工具定义(self) -> list:
        """生成OpenAI function calling格式的工具定义（函数名和参数名用英文，API要求[a-zA-Z0-9_-]）"""
        类型映射 = {
            "字符串": "string", "整数": "integer", "数字": "number", "布尔": "boolean", "列表": "array"
        }
        工具列表 = []
        for 名称, 操作 in self._操作表.items():
            英文名 = self._英文名映射.get(名称, 名称)
            属性 = {}
            必填列表 = []
            for 参数名, 规则 in 操作.参数结构.items():
                英文参数名 = self._参数名映射.get(参数名, 参数名)
                属性[英文参数名] = {
                    "type": 类型映射.get(规则.get("类型", "字符串"), "string"),
                    "description": 规则.get("说明", "")
                }
                if 规则.get("必填", False):
                    必填列表.append(英文参数名)
            工具列表.append({
                "type": "function",
                "function": {
                    "name": 英文名,
                    "description": f"{名称} — {操作.描述}",
                    "parameters": {
                        "type": "object",
                        "properties": 属性,
                        "required": 必填列表
                    }
                }
            })
        return 工具列表

    def 解析工具调用(self, 英文名: str, 英文参数: dict) -> tuple:
        """将API返回的英文工具名和参数名映射回中文"""
        中文名 = self._英文反查.get(英文名, 英文名)
        中文参数 = {}
        for 键, 值 in 英文参数.items():
            中文键 = self._参数名反查.get(键, 键)
            中文参数[中文键] = 值
        return 中文名, 中文参数

    # ============ v2.1 操作统计 ============
    def 获取操作统计(self) -> dict:
        """获取所有操作的调用统计"""
        return {
            "统计": self._操作统计,
            "调用历史": self._调用历史,
            "总调用数": sum(s["调用次数"] for s in self._操作统计.values()),
            "总成功数": sum(s["成功次数"] for s in self._操作统计.values()),
            "总失败数": sum(s["失败次数"] for s in self._操作统计.values())
        }
