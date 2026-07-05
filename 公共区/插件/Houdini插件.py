"""Houdini 插件 — 通过 Bridge 连接 Houdini，执行节点操作/VEX/参数设置/网络查询等

完全自包含，不修改任何核心代码。
删除 公共区/插件/Houdini插件.py 和 公共区/插件/Houdini/ 目录即可完全卸载。

需要先在 Houdini 中安装 Bridge Server（见 公共区/插件/Houdini/bridge_server_for_houdini.py）
"""
import os
import sys

# 添加插件目录到 sys.path 以便导入支持包
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from 操作.基类 import 操作基类, 操作结果
from Houdini._bridge_client import get_client
from Houdini._data import NODE_INPUTS, SEMANTIC_MAP
from Houdini._node_labels_data import NODE_LABELS, NODE_DESCRIPTION_CN


def _bridge_ok():
    """检测 Bridge 是否在线"""
    info = get_client().ping()
    return info is not None


def _send(tool_name, args=None):
    """发送工具到 Bridge 并包装结果"""
    resp = get_client().execute_tool(tool_name, args)
    if resp.get("success"):
        result = resp.get("result", {})
        # 提取主要文本
        if isinstance(result, dict):
            text = result.get("text") or result.get("summary") or result.get("message") or str(result)
            return 操作结果(成功=True, 数据=text, 元数据=result if isinstance(result, dict) else {})
        return 操作结果(成功=True, 数据=str(result))
    else:
        return 操作结果(成功=False, 错误=resp.get("error", "未知错误"))


# ============================================================
# 1. 连接检测
# ============================================================

class Houdini连接检测(操作基类):
    """检测 Houdini Bridge 连接状态，获取场景信息"""
    名称 = "Houdini连接检测"
    描述 = "检测 Houdini 是否运行且 Bridge 已连接。返回 Houdini 版本、当前网络路径、选中节点数。首次使用 Houdini 前先调用此操作确认连接。"
    参数结构 = {}

    def 执行(self, 参数, 上下文=None):
        info = get_client().ping()
        if info is None:
            return 操作结果(成功=False, 错误="无法连接 Houdini Bridge。可能原因：1)Houdini 未启动 2)Bridge 未安装。你可以告诉我「安装Houdini桥接」来自动安装，或确认 Houdini 已启动。")

        ctx = get_client().scene_context() or {}
        version = info.get("houdini", "未知")
        network = ctx.get("network", "未知")
        selection = ctx.get("selection_count", 0)

        return 操作结果(
            成功=True,
            数据=f"Houdini {version} 已连接\n当前网络: {network}\n选中节点: {selection} 个",
            元数据={"houdini版本": version, "网络路径": network, "选中数": selection}
        )


# ============================================================
# 2. 节点创建
# ============================================================

class Houdini节点创建(操作基类):
    """创建 Houdini 节点"""
    名称 = "Houdini节点创建"
    描述 = """在 Houdini 中创建节点。命令：
- "创建节点": 创建单个节点。参数：类型(如box/sphere/grid/attribwrangle)、名称(可选)、父路径(可选,默认/obj/geo1)、参数(可选,JSON)
- "创建Wrangle": 创建VEX Wrangle节点并设置代码。参数：VEX代码、名称(可选)、运行类型(可选,Points/Primitives/Vertex/Detail/Cycle,默认Points)、父路径(可选)
- "批量创建": 批量创建多个节点并自动连接。参数：计划(JSON,格式:[{类型,名称,参数},...],连接:[[0,1],[1,2],...])、父路径(可选)

【重要】复杂效果（如动画、VEX逻辑）应一次性写完整代码，不要分步创建-修改-再连接。用"批量创建"一次搞定节点拓扑，用"创建Wrangle"一次写完整VEX代码，避免反复修改导致循环。"""
    参数结构 = {
        "命令": {"类型": "字符串", "必填": True, "说明": "创建节点/创建Wrangle/批量创建"},
        "类型": {"类型": "字符串", "必填": False, "说明": "节点类型(创建节点时必填), 如 box, sphere, attribwrangle"},
        "名称": {"类型": "字符串", "必填": False, "说明": "节点名称(可选)"},
        "父路径": {"类型": "字符串", "必填": False, "说明": "父网络路径(可选,默认/obj/geo1)"},
        "VEX代码": {"类型": "字符串", "必填": False, "说明": "VEX代码(创建Wrangle时必填)"},
        "运行类型": {"类型": "字符串", "必填": False, "说明": "Wrangle运行类型(可选): Points/Primitives/Vertex/Detail"},
        "参数": {"类型": "对象", "必填": False, "说明": "节点参数JSON(创建节点时可选)"},
        "计划": {"类型": "数组", "必填": False, "说明": "批量创建计划JSON(批量创建时必填)"},
        "连接": {"类型": "数组", "必填": False, "说明": "连接关系[[输出索引,输入索引],...](批量创建时可选)"},
    }

    def 执行(self, 参数, 上下文=None):
        if not _bridge_ok():
            return 操作结果(成功=False, 错误="Houdini Bridge 未连接，请先确认 Houdini 已启动")
        命令 = 参数.get("命令", "")

        if 命令 == "创建节点":
            return _send("create_node", {
                "type_hint": 参数.get("类型", ""),
                "node_name": 参数.get("名称", ""),
                "parent_path": 参数.get("父路径", "/obj/geo1"),
                "parameters": 参数.get("参数", {}),
            })
        elif 命令 == "创建Wrangle":
            run_over = 参数.get("运行类型", "Points")
            return _send("create_wrangle_node", {
                "vex_code": 参数.get("VEX代码", ""),
                "node_name": 参数.get("名称", ""),
                "run_over": run_over,
                "parent_path": 参数.get("父路径", "/obj/geo1"),
            })
        elif 命令 == "批量创建":
            return _send("create_nodes_batch", {
                "plan": 参数.get("计划", []),
                "connections": 参数.get("连接", []),
                "parent_path": 参数.get("父路径", "/obj/geo1"),
            })
        else:
            return 操作结果(成功=False, 错误=f"未知命令: {命令}。可用: 创建节点/创建Wrangle/批量创建")


# ============================================================
# 3. 节点修改
# ============================================================

class Houdini节点修改(操作基类):
    """修改 Houdini 节点"""
    名称 = "Houdini节点修改"
    描述 = """修改已有节点。命令：
- "删除": 删除节点。参数：节点路径
- "连接": 连接两个节点（数据从源节点流向目标节点）。参数：源节点路径、目标节点路径、输入端口(可选,默认0)
- "复制": 复制节点。参数：源节点路径、目标网络(可选)、新名称(可选)
- "设置显示": 设置显示/渲染标志。参数：节点路径、显示(可选,默认True)、渲染(可选,默认True)
- "布局": 自动布局节点。参数：网络路径(可选)、策略(可选,auto/grid/columns,默认auto)、间距(可选)
- "保存": 保存.hip文件。参数：文件路径(可选)"""
    参数结构 = {
        "命令": {"类型": "字符串", "必填": True, "说明": "删除/连接/复制/设置显示/布局/保存"},
        "节点路径": {"类型": "字符串", "必填": False, "说明": "目标节点路径"},
        "源节点路径": {"类型": "字符串", "必填": False, "说明": "连接-数据来源节点路径(上游节点)"},
        "目标节点路径": {"类型": "字符串", "必填": False, "说明": "连接-数据接收节点路径(下游节点)"},
        "输入端口": {"类型": "整数", "必填": False, "说明": "连接-目标节点的输入端口号(可选,默认0)"},
        "目标网络": {"类型": "字符串", "必填": False, "说明": "复制-目标网络路径(可选)"},
        "新名称": {"类型": "字符串", "必填": False, "说明": "复制-新节点名称(可选)"},
        "显示": {"类型": "布尔", "必填": False, "说明": "设置显示标志(可选,默认True)"},
        "渲染": {"类型": "布尔", "必填": False, "说明": "设置渲染标志(可选,默认True)"},
        "网络路径": {"类型": "字符串", "必填": False, "说明": "布局-网络路径(可选)"},
        "策略": {"类型": "字符串", "必填": False, "说明": "布局策略(可选): auto/grid/columns"},
        "间距": {"类型": "数字", "必填": False, "说明": "布局间距(可选)"},
        "文件路径": {"类型": "字符串", "必填": False, "说明": "保存-文件路径(可选)"},
    }

    def 执行(self, 参数, 上下文=None):
        if not _bridge_ok():
            return 操作结果(成功=False, 错误="Houdini Bridge 未连接")
        命令 = 参数.get("命令", "")

        if 命令 == "删除":
            return _send("delete_node", {"node_path": 参数.get("节点路径", "")})
        elif 命令 == "连接":
            return _send("connect_nodes", {
                "源节点路径": 参数.get("源节点路径", ""),
                "目标节点路径": 参数.get("目标节点路径", ""),
                "输入端口": 参数.get("输入端口", 0),
            })
        elif 命令 == "复制":
            return _send("copy_node", {
                "source_path": 参数.get("源节点路径", ""),
                "dest_network": 参数.get("目标网络", ""),
                "new_name": 参数.get("新名称", ""),
            })
        elif 命令 == "设置显示":
            return _send("set_display_flag", {
                "node_path": 参数.get("节点路径", ""),
                "display": 参数.get("显示", True),
                "render": 参数.get("渲染", True),
            })
        elif 命令 == "布局":
            return _send("layout_nodes", {
                "network_path": 参数.get("网络路径", ""),
                "strategy": 参数.get("策略", "auto"),
                "spacing": 参数.get("间距", 2),
            })
        elif 命令 == "保存":
            return _send("save_hip", {"file_path": 参数.get("文件路径", "")})
        else:
            return 操作结果(成功=False, 错误=f"未知命令: {命令}。可用: 删除/连接/复制/设置显示/布局/保存")


# ============================================================
# 4. 参数设置
# ============================================================

class Houdini参数设置(操作基类):
    """设置或查询 Houdini 节点参数"""
    名称 = "Houdini参数设置"
    描述 = """设置节点参数值。命令：
- "设置": 设置单个参数。参数：节点路径、参数名、参数值
- "批量设置": 对多个节点设置同一参数。参数：节点路径列表(JSON数组)、参数名、参数值
- "按参数搜索": 按参数值查找节点。参数：参数名、参数值、网络路径(可选)"""
    参数结构 = {
        "命令": {"类型": "字符串", "必填": True, "说明": "设置/批量设置/按参数搜索"},
        "节点路径": {"类型": "字符串", "必填": False, "说明": "节点路径(设置时必填)"},
        "参数名": {"类型": "字符串", "必填": True, "说明": "参数名称"},
        "参数值": {"类型": "字符串", "必填": False, "说明": "参数值(设置时必填)"},
        "节点路径列表": {"类型": "数组", "必填": False, "说明": "节点路径JSON数组(批量设置时必填)"},
        "网络路径": {"类型": "字符串", "必填": False, "说明": "搜索范围(可选)"},
    }

    def 执行(self, 参数, 上下文=None):
        if not _bridge_ok():
            return 操作结果(成功=False, 错误="Houdini Bridge 未连接")
        命令 = 参数.get("命令", "")

        if 命令 == "设置":
            return _send("set_node_parameter", {
                "node_path": 参数.get("节点路径", ""),
                "param_name": 参数.get("参数名", ""),
                "value": 参数.get("参数值", ""),
            })
        elif 命令 == "批量设置":
            return _send("batch_set_parameters", {
                "node_paths": 参数.get("节点路径列表", []),
                "param_name": 参数.get("参数名", ""),
                "value": 参数.get("参数值", ""),
            })
        elif 命令 == "按参数搜索":
            return _send("find_nodes_by_param", {
                "param_name": 参数.get("参数名", ""),
                "value": 参数.get("参数值", ""),
                "network_path": 参数.get("网络路径", ""),
            })
        else:
            return 操作结果(成功=False, 错误=f"未知命令: {命令}。可用: 设置/批量设置/按参数搜索")


# ============================================================
# 5. 网络查询
# ============================================================

class Houdini网络查询(操作基类):
    """查询 Houdini 节点网络结构和参数"""
    名称 = "Houdini网络查询"
    描述 = """查询节点网络（只读，不修改场景）。命令：
- "网络结构": 获取节点网络拓扑。参数：网络路径(可选)、盒子名(可选,钻入查看某个NetworkBox)
- "节点参数": 获取节点所有参数和状态。参数：节点路径
- "子节点": 列出子节点。参数：网络路径(可选)、递归(可选,默认False)
- "选中节点": 读取视口当前选中节点。参数：限制数(可选,默认10)
- "检查错误": 检查节点错误和警告。参数：节点路径(可选,检查整个网络)
- "几何信息": 获取几何体信息(点数/面数/属性)。参数：节点路径"""
    参数结构 = {
        "命令": {"类型": "字符串", "必填": True, "说明": "网络结构/节点参数/子节点/选中节点/检查错误/几何信息"},
        "网络路径": {"类型": "字符串", "必填": False, "说明": "网络路径(可选)"},
        "盒子名": {"类型": "字符串", "必填": False, "说明": "NetworkBox名称(网络结构时可选)"},
        "节点路径": {"类型": "字符串", "必填": False, "说明": "节点路径"},
        "递归": {"类型": "布尔", "必填": False, "说明": "是否递归列出(子节点时可选)"},
        "限制数": {"类型": "整数", "必填": False, "说明": "返回数量限制(选中节点时可选,默认10)"},
    }

    def 执行(self, 参数, 上下文=None):
        if not _bridge_ok():
            return 操作结果(成功=False, 错误="Houdini Bridge 未连接")
        命令 = 参数.get("命令", "")

        if 命令 == "网络结构":
            return _send("get_network_structure", {
                "network_path": 参数.get("网络路径", ""),
                "box_name": 参数.get("盒子名", ""),
            })
        elif 命令 == "节点参数":
            return _send("get_node_parameters", {
                "node_path": 参数.get("节点路径", ""),
            })
        elif 命令 == "子节点":
            return _send("list_children", {
                "network_path": 参数.get("网络路径", ""),
                "recursive": 参数.get("递归", False),
            })
        elif 命令 == "选中节点":
            return _send("read_selection", {
                "limit": 参数.get("限制数", 10),
            })
        elif 命令 == "检查错误":
            return _send("check_errors", {
                "node_path": 参数.get("节点路径", ""),
            })
        elif 命令 == "几何信息":
            return _send("get_geometry_info", {
                "node_path": 参数.get("节点路径", ""),
            })
        else:
            return 操作结果(成功=False, 错误=f"未知命令: {命令}。可用: 网络结构/节点参数/子节点/选中节点/检查错误/几何信息")


# ============================================================
# 6. 执行代码
# ============================================================

class Houdini执行代码(操作基类):
    """在 Houdini 中执行 Python 或 Shell 代码"""
    名称 = "Houdini执行代码"
    描述 = """在 Houdini 环境中执行代码。命令：
- "Python": 在 Houdini Python Shell 中执行代码(可使用hou模块)。参数：代码、超时(可选,默认30秒)
- "Shell": 执行系统命令(pip/git/ffmpeg等)。参数：命令、超时(可选,默认120秒)

【重要】一次性写完整Python脚本完成所有操作（创建节点+连接+设置参数+写VEX），不要分步执行多次代码。避免反复调用导致循环。

危险操作会被拦截：Python禁止os.remove/shutil.rmtree/os.system/__import__等；Shell禁止rm -rf/format/shutdown等。"""
    参数结构 = {
        "命令": {"类型": "字符串", "必填": True, "说明": "Python/Shell"},
        "代码": {"类型": "字符串", "必填": False, "说明": "Python代码(Python命令时必填)"},
        "Shell命令": {"类型": "字符串", "必填": False, "说明": "Shell命令(Shell命令时必填)"},
        "超时": {"类型": "整数", "必填": False, "说明": "超时秒数(可选)"},
    }

    def 执行(self, 参数, 上下文=None):
        if not _bridge_ok():
            return 操作结果(成功=False, 错误="Houdini Bridge 未连接")
        命令 = 参数.get("命令", "")

        if 命令 == "Python":
            return _send("execute_python", {
                "code": 参数.get("代码", ""),
                "timeout": 参数.get("超时", 30),
            })
        elif 命令 == "Shell":
            return _send("execute_shell", {
                "command": 参数.get("Shell命令", ""),
                "timeout": 参数.get("超时", 120),
            })
        else:
            return 操作结果(成功=False, 错误=f"未知命令: {命令}。可用: Python/Shell")


# ============================================================
# 7. 搜索节点
# ============================================================

class Houdini搜索节点(操作基类):
    """搜索 Houdini 节点类型"""
    名称 = "Houdini搜索节点"
    描述 = """搜索可用的 Houdini 节点类型。命令：
- "关键词": 按关键词搜索节点类型。参数：关键词
- "语义": 自然语言搜索(如"在表面散布点"→scatter)。参数：描述
- "输入端口": 查询节点的输入端口信息。参数：节点类型名"""
    参数结构 = {
        "命令": {"类型": "字符串", "必填": True, "说明": "关键词/语义/输入端口"},
        "关键词": {"类型": "字符串", "必填": False, "说明": "搜索关键词(关键词命令时必填)"},
        "描述": {"类型": "字符串", "必填": False, "说明": "自然语言描述(语义命令时必填)"},
        "节点类型名": {"类型": "字符串", "必填": False, "说明": "节点类型名(输入端口命令时必填)"},
    }

    def 执行(self, 参数, 上下文=None):
        if not _bridge_ok():
            return 操作结果(成功=False, 错误="Houdini Bridge 未连接")
        命令 = 参数.get("命令", "")

        if 命令 == "关键词":
            return _send("search_node_types", {
                "keyword": 参数.get("关键词", ""),
            })
        elif 命令 == "语义":
            kw = 参数.get("描述", "")
            # 先查本地语义映射
            mapped = []
            for key, node_types in SEMANTIC_MAP.items():
                if key in kw:
                    mapped.extend(node_types)
            if mapped:
                # 去重并查找中文标签
                unique = list(dict.fromkeys(mapped))
                lines = [f"语义匹配: '{kw}' → {', '.join(unique)}"]
                for nt in unique[:10]:
                    if nt in NODE_DESCRIPTION_CN:
                        lines.append(f"  {nt} — {NODE_DESCRIPTION_CN[nt]}")
                    elif nt in NODE_LABELS:
                        labels = NODE_LABELS[nt][:3]
                        lines.append(f"  {nt} — 中文标签: {', '.join(labels)}")
                return 操作结果(成功=True, 数据="\n".join(lines))
            return _send("semantic_search_nodes", {"description": kw})
        elif 命令 == "输入端口":
            type_name = 参数.get("节点类型名", "").lower()
            if type_name in NODE_INPUTS:
                return 操作结果(成功=True, 数据=NODE_INPUTS[type_name])
            # 查询 Bridge
            return _send("get_node_inputs", {"node_type": type_name})
        else:
            return 操作结果(成功=False, 错误=f"未知命令: {命令}。可用: 关键词/语义/输入端口")


# ============================================================
# 9. 撤销重做
# ============================================================

class Houdini撤销重做(操作基类):
    """撤销或重做 Houdini 操作"""
    名称 = "Houdini撤销重做"
    描述 = "撤销或重做 Houdini 中的操作。参数：动作(undo/redo)"
    参数结构 = {
        "动作": {"类型": "字符串", "必填": True, "说明": "undo(撤销) 或 redo(重做)"},
    }

    def 执行(self, 参数, 上下文=None):
        if not _bridge_ok():
            return 操作结果(成功=False, 错误="Houdini Bridge 未连接")
        return _send("undo_redo", {"action": 参数.get("动作", "undo")})


# ============================================================
# 10. 网络分组
# ============================================================

class Houdini网络分组(操作基类):
    """管理 Houdini NetworkBox（节点分组框）"""
    名称 = "Houdini网络分组"
    描述 = """管理 NetworkBox 节点分组。命令：
- "创建": 创建 NetworkBox。参数：名称、网络路径(可选)、节点列表(可选,JSON数组)
- "添加": 将节点添加到已有 Box。参数：名称、网络路径(可选)、节点列表(JSON数组)
- "列出": 列出所有 NetworkBox。参数：网络路径(可选)"""
    参数结构 = {
        "命令": {"类型": "字符串", "必填": True, "说明": "创建/添加/列出"},
        "名称": {"类型": "字符串", "必填": False, "说明": "NetworkBox名称"},
        "网络路径": {"类型": "字符串", "必填": False, "说明": "网络路径(可选)"},
        "节点列表": {"类型": "数组", "必填": False, "说明": "节点路径JSON数组"},
    }

    def 执行(self, 参数, 上下文=None):
        if not _bridge_ok():
            return 操作结果(成功=False, 错误="Houdini Bridge 未连接")
        命令 = 参数.get("命令", "")

        if 命令 == "创建":
            return _send("create_network_box", {
                "name": 参数.get("名称", ""),
                "network_path": 参数.get("网络路径", ""),
                "nodes": 参数.get("节点列表", []),
            })
        elif 命令 == "添加":
            return _send("add_nodes_to_box", {
                "name": 参数.get("名称", ""),
                "network_path": 参数.get("网络路径", ""),
                "nodes": 参数.get("节点列表", []),
            })
        elif 命令 == "列出":
            return _send("list_network_boxes", {
                "network_path": 参数.get("网络路径", ""),
            })
        else:
            return 操作结果(成功=False, 错误=f"未知命令: {命令}。可用: 创建/添加/列出")


# ============================================================
# 11. 自动安装 Bridge
# ============================================================

class Houdini安装桥接(操作基类):
    """自动安装 Houdini Bridge Server"""
    名称 = "Houdini安装桥接"
    描述 = """当 Houdini连接检测 失败时调用此操作自动安装 Bridge。
它会自动检测电脑上安装的 Houdini 版本，将 Bridge Server 代码写入 Houdini 的 pythonrc.py。
如果 Houdini 正在运行且旧 Bridge 还能通信，会自动热重载新代码，无需重启 Houdini。
参数：卸载(可选,默认False) — True时卸载而非安装"""
    参数结构 = {
        "卸载": {"类型": "布尔", "必填": False, "说明": "True=卸载Bridge, False=安装(默认)"},
    }

    def 执行(self, 参数, 上下文=None):
        import json as _json
        import subprocess
        from pathlib import Path

        卸载 = 参数.get("卸载", False)
        插件目录 = Path(_THIS_DIR)
        bridge源码 = 插件目录 / "Houdini" / "bridge_server_for_houdini.py"
        安装器 = 插件目录 / "安装Houdini桥接.py"
        MARKER = "# ===== Houdini Bridge Server (zf3d_Agent) ====="

        # 检测 Houdini 安装路径
        def _find_houdini():
            versions = []
            # 注册表
            try:
                import winreg
                for hive in [winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_LOCAL_MACHINE | winreg.KEY_WOW64_32KEY]:
                    try:
                        key = winreg.OpenKey(hive, r"SOFTWARE\Side Effects Software")
                        i = 0
                        while True:
                            try:
                                name = winreg.EnumKey(key, i)
                                i += 1
                                if name.startswith("Houdini"):
                                    try:
                                        subkey = winreg.OpenKey(key, name)
                                        path = winreg.QueryValueEx(subkey, "InstallPath")[0]
                                        versions.append({"version": name, "path": path})
                                        winreg.CloseKey(subkey)
                                    except (FileNotFoundError, OSError):
                                        pass
                            except OSError:
                                break
                        winreg.CloseKey(key)
                    except (FileNotFoundError, OSError):
                        pass
            except ImportError:
                pass
            # 文件系统
            for drive in ["C:\\", "D:\\", "E:\\"]:
                base = Path(drive, "Program Files", "Side Effects Software")
                if base.exists():
                    for d in base.iterdir():
                        if d.name.startswith("Houdini") and d.is_dir():
                            if not any(v["version"] == d.name for v in versions):
                                versions.append({"version": d.name, "path": str(d)})
            return versions

        def _get_user_dir(version_str):
            parts = version_str.replace("Houdini", "").strip().split(".")
            major_minor = f"{parts[0]}.{parts[1]}" if len(parts) >= 2 else parts[0]
            from pathlib import Path as P
            return P.home() / "Documents" / f"houdini{major_minor}"

        def _is_installed(pythonrc):
            if not pythonrc.exists():
                return False
            return MARKER in pythonrc.read_text(encoding="utf-8", errors="ignore")

        def _install(pythonrc):
            code = bridge源码.read_text(encoding="utf-8")
            block = f"\n\n{MARKER}\n# 自动安装于 zf3d_Agent 智能体\n# 卸载: 在智能体中说 卸载Houdini桥接\n"
            block += code
            block += f"\n# ===== Houdini Bridge Server END =====\n"
            if not pythonrc.exists():
                pythonrc.parent.mkdir(parents=True, exist_ok=True)
                pythonrc.write_text(block, encoding="utf-8")
            else:
                existing = pythonrc.read_text(encoding="utf-8", errors="ignore")
                if MARKER in existing:
                    start = existing.find(MARKER)
                    end = existing.find("# ===== Houdini Bridge Server END =====")
                    if end != -1:
                        end += len("# ===== Houdini Bridge Server END =====") + 1
                        existing = existing[:start] + block + existing[end:]
                    else:
                        existing += block
                else:
                    existing += block
                pythonrc.write_text(existing, encoding="utf-8")

        def _uninstall(pythonrc):
            if not pythonrc.exists():
                return False
            content = pythonrc.read_text(encoding="utf-8", errors="ignore")
            if MARKER not in content:
                return False
            start = content.find(MARKER)
            end = content.find("# ===== Houdini Bridge Server END =====")
            if end != -1:
                end += len("# ===== Houdini Bridge Server END =====") + 1
            else:
                end = len(content)
            content = content[:start] + content[end:]
            pythonrc.write_text(content, encoding="utf-8")
            return True

        def _install_package_json(user_dir):
            packages_dir = user_dir / "packages"
            packages_dir.mkdir(parents=True, exist_ok=True)
            pkg = packages_dir / "zf3d_bridge.json"
            pkg.write_text(_json.dumps({
                "enable": True,
                "env": [{"HOUDINI_BRIDGE_PORT": "45172"}]
            }, indent=2, ensure_ascii=False), encoding="utf-8")
            return pkg

        def _uninstall_package_json(user_dir):
            pkg = user_dir / "packages" / "zf3d_bridge.json"
            if pkg.exists():
                pkg.unlink()
                return True
            return False

        # 检测 Houdini
        versions = _find_houdini()
        if not versions:
            return 操作结果(成功=False, 错误="未检测到 Houdini 安装。请确认 Houdini 已安装在此电脑上。")

        results = []
        for v in versions:
            vs = v["version"]
            user_dir = _get_user_dir(vs)
            pythonrc = user_dir / "scripts" / "python" / "pythonrc.py"

            if 卸载:
                _uninstall(pythonrc)
                _uninstall_package_json(user_dir)
                results.append(f"  ✅ {vs}: 已卸载 Bridge")
            else:
                already = _is_installed(pythonrc)
                _install(pythonrc)
                _install_package_json(user_dir)
                if already:
                    results.append(f"  ✅ {vs}: Bridge 已更新 ({pythonrc})")
                else:
                    results.append(f"  ✅ {vs}: Bridge 已安装 ({pythonrc})")

        if 卸载:
            return 操作结果(成功=True, 数据=f"卸载完成！\n" + "\n".join(results) + "\n\n重启 Houdini 后 Bridge 将不再运行。")
        else:
            # 检测 Houdini 是否在运行
            houdini_running = False
            try:
                result = subprocess.run('tasklist /FI "IMAGENAME eq houdini.exe" /NH',
                                       shell=True, capture_output=True, text=True, timeout=5)
                if "houdini.exe" in result.stdout:
                    houdini_running = True
            except Exception:
                pass

            # 尝试热重载：如果旧 Bridge 还连着，直接在 Houdini 进程内替换代码
            热重载结果 = ""
            info = get_client().ping()
            if info:
                # Bridge 在线，尝试热重载
                bridge代码 = bridge源码.read_text(encoding="utf-8")
                # 转义为可传输的字符串
                热重载代码 = (
                    "import sys as _sys\n"
                    "found = False\n"
                    "for _name, _mod in list(_sys.modules.items()):\n"
                    "    if _mod and hasattr(_mod, '_dispatch_tool') and hasattr(_mod, '_tool_exec_python'):\n"
                    "        try:\n"
                    "            exec(_code, _mod.__dict__)\n"
                    "            found = True\n"
                    "            print('HOT_RELOAD_OK')\n"
                    "        except Exception as _e:\n"
                    "            print('HOT_RELOAD_FAIL: ' + str(_e))\n"
                    "        break\n"
                    "if not found:\n"
                    "    print('HOT_RELOAD_NOT_FOUND')\n"
                )
                resp = get_client().execute_tool("execute_python", {
                    "code": 热重载代码,
                    "timeout": 10,
                })
                # 注入 _code 变量
                # 由于 execute_python 用 exec(code, global_ns, local_ns)，
                # 我们需要在 local_ns 中有 _code
                # 改用拼接方式：把代码直接嵌入
                完整代码 = f"_code = {repr(bridge代码)}\n" + 热重载代码
                resp = get_client().execute_tool("execute_python", {
                    "code": 完整代码,
                    "timeout": 10,
                })
                if resp.get("success"):
                    result_text = resp.get("result", {}).get("text", "")
                    if "HOT_RELOAD_OK" in result_text:
                        热重载结果 = "✅ 热重载成功！Bridge 代码已更新，无需重启 Houdini。"
                    elif "HOT_RELOAD_FAIL" in result_text:
                        热重载结果 = "⚠️ 热重载失败: " + result_text + "\n请重启 Houdini。"
                    elif "HOT_RELOAD_NOT_FOUND" in result_text:
                        热重载结果 = "⚠️ 未找到 Bridge 模块，请重启 Houdini。"
                    else:
                        热重载结果 = "⚠️ 热重载结果未知: " + result_text + "\n请重启 Houdini 确认。"
                else:
                    热重载结果 = "⚠️ 热重载请求失败: " + resp.get("error", "") + "\n请重启 Houdini。"

            # 重新检测连接
            import time
            time.sleep(0.5)
            info = get_client().ping()

            if info:
                version = info.get("houdini", "未知")
                msg = f"安装完成并检测到 Houdini 已连接！\n版本: {version}\n\n" + "\n".join(results)
                if 热重载结果:
                    msg += f"\n\n{热重载结果}"
                return 操作结果(成功=True, 数据=msg)
            else:
                tip = "⚠️ 请重启 Houdini 才能生效！\nBridge 代码会在 Houdini 启动时自动加载。" if houdini_running else "✅ 下次启动 Houdini 时 Bridge 会自动加载。"
                msg = f"安装完成！\n\n" + "\n".join(results) + f"\n\n{tip}"
                if 热重载结果:
                    msg += f"\n\n{热重载结果}"
                return 操作结果(成功=True, 数据=msg)
