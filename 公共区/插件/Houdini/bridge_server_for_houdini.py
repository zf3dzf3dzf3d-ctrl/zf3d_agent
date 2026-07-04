"""Houdini Bridge Server — 安装到 Houdini packages 目录，Houdini 启动时自动运行

安装方法：
  方式一（推荐）：将此文件内容复制到 Houdini 的 pythonrc.py
    路径：~/Documents/houdini20.5/scripts/python/pythonrc.py
    （如果文件不存在则创建，存在则追加）

  方式二：作为 Houdini Package 安装
    1. 在 ~/Documents/houdini20.5/packages/ 下创建 zf3d_bridge.json
    2. 内容：
       {
         "enable": true,
         "env": [
           {"PYTHONPATH": "C:\\\\Users\\\\Administrator\\\\Desktop\\\\zf3d_Agent\\\\新系统_v2_开发版\\\\公共区\\\\插件;&"}
         ]
       }
    3. 将此文件放到 ~/Documents/houdini20.5/scripts/python/pythonrc.py

协议：JSON-lines over TCP（localhost only）
端口：45172（可通过环境变量 HOUDINI_BRIDGE_PORT 修改）

参考自 Kazama-Suichiku/Houdini-Agent (MIT License)
"""
import json
import os
import socket
import socketserver
import threading
import traceback
import uuid
from contextlib import contextmanager


# ============================================================
# Undo 兼容层 — Houdini 18+ 用 group() 上下文管理器，旧版用 beginGroup/endGroup
# ============================================================
@contextmanager
def _undo_group(hou, label="Houdini Agent"):
    """兼容不同 Houdini 版本的 undo 分组"""
    _group = None
    try:
        # Houdini 18+ : with hou.undos.group("name"):
        _group = hou.undos.group(label)
        _group.__enter__()
    except (AttributeError, TypeError):
        # 旧版 API: beginGroup / endGroup
        try:
            hou.undos.beginGroup(label)
        except Exception:
            pass
    try:
        yield
    finally:
        if _group is not None:
            try:
                _group.__exit__(None, None, None)
            except Exception:
                pass
        else:
            try:
                hou.undos.endGroup()
            except Exception:
                pass


# ============================================================
# 配置
# ============================================================
_HOST = "127.0.0.1"
_DEFAULT_PORT = 45172
_MAX_MSG_SIZE = 16 * 1024 * 1024  # 16MB

# 危险 Python 模式（黑名单）
_PY_DANGEROUS = [
    "os.remove", "os.unlink", "shutil.rmtree", "os.system",
    "subprocess.call", "subprocess.run", "subprocess.Popen",
    "__import__", "hou.exit", "hou.hipFile.clear",
    "os.rmdir", "os.removedirs",
]

# 危险 Shell 模式（黑名单）
_SHELL_DANGEROUS = [
    "rm -r", "rm -f", "rmdir", "format", "reg delete",
    "shutdown", "sudo", "mkfs", "dd if=",
    "Invoke-Expression", ":(){:|:&};:",
]

# 变更类工具（需要 undo 分组）
_MUTATING_TOOLS = {
    "create_node", "create_wrangle_node", "create_nodes_batch",
    "delete_node", "set_node_parameter", "batch_set_parameters",
    "connect_nodes", "copy_node", "set_display_flag",
    "execute_python", "save_hip", "import_3d_asset",
}


# ============================================================
# 端口发现文件
# ============================================================
def _get_port_file():
    """获取端口发现文件路径"""
    base = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
    return os.path.join(base, "HoudiniAgent", "bridge.port")


def _write_port_file(port):
    """写入端口到发现文件"""
    try:
        path = _get_port_file()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(str(port))
    except Exception:
        pass


def _resolve_port():
    """解析端口：环境变量 → 默认"""
    env = os.environ.get("HOUDINI_BRIDGE_PORT")
    if env:
        try:
            return int(env)
        except ValueError:
            pass
    return _DEFAULT_PORT


# ============================================================
# Houdini 工具执行（主线程安全）
# ============================================================
def _main_thread(fn):
    """将函数调用编组到 Houdini 主线程执行"""
    try:
        import hdefereval
        return hdefereval.executeInMainThreadWithResult(fn)
    except ImportError:
        return fn()


def _execute_tool(payload):
    """执行一个 Houdini 工具（在主线程上）"""
    name = payload.get("name", "")
    args = payload.get("args", {})

    if not name:
        return {"success": False, "error": "缺少工具名 'name'"}

    def run():
        return _dispatch_tool(name, args)

    result = _main_thread(run)

    # 变更类工具：包裹 undo 分组
    # （_dispatch_tool 内部已处理 undo，这里只透传结果）
    return result


def _auto_parse_args(args):
    """自动修复 AI 传入 JSON 字符串而非 dict/list 的问题"""
    if not isinstance(args, dict):
        return args
    fixed = {}
    for k, v in args.items():
        if isinstance(v, str) and v.strip().startswith(("{", "[")):
            try:
                fixed[k] = json.loads(v)
                continue
            except (json.JSONDecodeError, ValueError):
                pass
        fixed[k] = v
    return fixed


def _dispatch_tool(name, args):
    """工具分派 — 根据工具名调用对应的 Houdini 操作"""
    args = _auto_parse_args(args)
    try:
        import hou
    except ImportError:
        return {"success": False, "error": "hou 模块不可用 — 此脚本必须在 Houdini 内运行"}

    # ===== 节点操作 =====
    if name == "create_node":
        return _tool_create_node(hou, args)
    elif name == "create_wrangle_node":
        return _tool_create_wrangle(hou, args)
    elif name == "create_nodes_batch":
        return _tool_create_nodes_batch(hou, args)
    elif name == "connect_nodes":
        return _tool_connect_nodes(hou, args)
    elif name == "delete_node":
        return _tool_delete_node(hou, args)
    elif name == "copy_node":
        return _tool_copy_node(hou, args)
    elif name == "set_display_flag":
        return _tool_set_display_flag(hou, args)
    elif name == "set_node_parameter":
        return _tool_set_parameter(hou, args)
    elif name == "batch_set_parameters":
        return _tool_batch_set_parameters(hou, args)
    elif name == "find_nodes_by_param":
        return _tool_find_by_param(hou, args)
    elif name == "layout_nodes":
        return _tool_layout_nodes(hou, args)
    elif name == "save_hip":
        return _tool_save_hip(hou, args)
    elif name == "undo_redo":
        return _tool_undo_redo(hou, args)

    # ===== 查询操作 =====
    elif name == "get_network_structure":
        return _tool_get_network(hou, args)
    elif name == "get_node_parameters":
        return _tool_get_params(hou, args)
    elif name == "list_children":
        return _tool_list_children(hou, args)
    elif name == "read_selection":
        return _tool_read_selection(hou, args)
    elif name == "check_errors":
        return _tool_check_errors(hou, args)
    elif name == "get_geometry_info":
        return _tool_get_geo_info(hou, args)
    elif name == "search_node_types":
        return _tool_search_types(hou, args)
    elif name == "semantic_search_nodes":
        return _tool_semantic_search(hou, args)
    elif name == "get_node_inputs":
        return _tool_get_inputs(hou, args)

    # ===== 代码执行 =====
    elif name == "execute_python":
        return _tool_exec_python(hou, args)
    elif name == "execute_shell":
        return _tool_exec_shell(hou, args)

    # ===== NetworkBox =====
    elif name == "create_network_box":
        return _tool_create_box(hou, args)
    elif name == "add_nodes_to_box":
        return _tool_add_to_box(hou, args)
    elif name == "list_network_boxes":
        return _tool_list_boxes(hou, args)

    else:
        return {"success": False, "error": f"未知工具: {name}"}


# ============================================================
# 工具实现 — 节点操作
# ============================================================
def _get_network(hou, path=None):
    """获取目标网络"""
    if path:
        try:
            return hou.node(path)
        except Exception:
            pass
    # 尝试当前 NetworkEditor
    try:
        panes = [p for p in hou.ui.paneTabs() if p.type() == hou.paneTabType.NetworkEditor]
        if panes:
            return panes[0].pwd()
    except Exception:
        pass
    # 默认 /obj/geo1
    try:
        geo = hou.node("/obj/geo1")
        if geo:
            return geo
    except Exception:
        pass
    try:
        return hou.node("/obj")
    except Exception:
        return None


def _tool_create_node(hou, args):
    type_hint = args.get("type_hint", "")
    node_name = args.get("node_name", "")
    parent_path = args.get("parent_path", "/obj/geo1")
    parameters = args.get("parameters", {})

    parent = hou.node(parent_path)
    if not parent:
        return {"success": False, "error": f"父网络不存在: {parent_path}"}

    try:
        with _undo_group(hou, "Houdini Agent: create_node"):
            node = parent.createNode(type_hint, node_name)
            if parameters:
                for k, v in parameters.items():
                    parm = node.parm(k)
                    if parm:
                        parm.set(v)
            node.setDisplayFlag(True)
            return {"success": True, "result": {"text": f"已创建节点: {node.path()} (类型: {type_hint})", "path": node.path()}}
    except Exception as e:
        err_str = str(e)
        # 如果是无效节点类型，列出可用类型帮助 AI 自我修正
        if "Invalid node type" in err_str or "OperationFailed" in err_str:
            suggestions = _find_similar_types(hou, type_hint, parent)
            if suggestions:
                err_str += f"\n\n可用类型(含 '{type_hint}'): {suggestions}"
            else:
                # 列出该上下文所有可用类型(前30个)
                all_types = _list_child_types(hou, parent)
                err_str += f"\n\n该网络可用类型(前30): {all_types}"
        return {"success": False, "error": f"创建节点失败: {err_str}"}


def _tool_create_wrangle(hou, args):
    vex_code = args.get("vex_code", "")
    node_name = args.get("node_name", "wrangle")
    run_over = args.get("run_over", "Points")
    parent_path = args.get("parent_path", "/obj/geo1")

    parent = hou.node(parent_path)
    if not parent:
        return {"success": False, "error": f"父网络不存在: {parent_path}"}

    run_map = {"Points": 0, "Primitives": 1, "Vertices": 3, "Detail": 0, "Numbers": 4}
    class_val = run_map.get(run_over, 0)

    try:
        with _undo_group(hou, "Houdini Agent: create_wrangle"):
            node = parent.createNode("attribwrangle", node_name)
            node.parm("class").set(class_val)
            node.parm("snippet").set(vex_code)
            return {"success": True, "result": {"text": f"已创建 Wrangle 节点: {node.path()}\nVEX:\n{vex_code}", "path": node.path()}}
    except Exception as e:
        return {"success": False, "error": f"创建 Wrangle 失败: {e}"}


def _find_similar_types(hou, keyword, parent):
    """查找包含关键词的可用节点类型"""
    try:
        matched = []
        cats = hou.nodeTypeCategories()
        # 根据父节点类型确定搜索范围
        parent_type = parent.type().category().name() if hasattr(parent.type(), 'category') else "Sop"
        for cat_name, cat in cats.items():
            try:
                for type_name in cat.nodeTypes():
                    if keyword.lower() in type_name.lower():
                        matched.append(f"{type_name} ({cat_name})")
            except Exception:
                pass
        return matched[:20]
    except Exception:
        return []


def _list_child_types(hou, parent):
    """列出父节点可创建的子节点类型"""
    try:
        cat = parent.type().category()
        if not cat:
            return []
        types = list(cat.nodeTypes().keys())
        return sorted(types)[:30]
    except Exception:
        return []


def _tool_create_nodes_batch(hou, args):
    plan = args.get("plan", [])
    connections = args.get("connections", [])
    parent_path = args.get("parent_path", "/obj/geo1")

    parent = hou.node(parent_path)
    if not parent:
        return {"success": False, "error": f"父网络不存在: {parent_path}"}

    try:
        with _undo_group(hou, "Houdini Agent: batch_create"):
            created = []
            for item in plan:
                # 兼容中文键名
                t = item.get("type") or item.get("类型", "")
                n = item.get("name") or item.get("名称", "")
                params = item.get("parameters") or item.get("参数", {})
                node = parent.createNode(t, n)
                for k, v in params.items():
                    parm = node.parm(k)
                    if parm:
                        parm.set(v)
                created.append(node)

            for conn in connections:
                out_idx, in_idx = conn[0], conn[1]
                if out_idx < len(created) and in_idx < len(created):
                    created[out_idx].setInput(0, created[in_idx])

            if created:
                created[-1].setDisplayFlag(True)
            paths = [n.path() for n in created]
            return {"success": True, "result": {"text": f"已创建 {len(created)} 个节点: {', '.join(paths)}", "paths": paths}}
    except Exception as e:
        return {"success": False, "error": f"批量创建失败: {e}"}


def _tool_connect_nodes(hou, args):
    # 源节点(数据提供方) → 目标节点(数据接收方)的指定输入端口
    # 兼容旧参数名：output_node_path(旧=接收方) / input_node_path(旧=源)
    src_path = args.get("源节点路径") or args.get("source_node_path") or args.get("input_node_path") or ""
    dst_path = args.get("目标节点路径") or args.get("dest_node_path") or args.get("output_node_path") or ""
    in_idx = args.get("输入端口") or args.get("input_index", 0)

    src_node = hou.node(src_path)
    dst_node = hou.node(dst_path)
    if not src_node or not dst_node:
        return {"success": False, "error": f"节点不存在: 源={src_path} 或 目标={dst_path}"}

    try:
        with _undo_group(hou, "Houdini Agent: connect"):
            dst_node.setInput(in_idx, src_node)
            return {"success": True, "result": {"text": f"已连接: {src_path} → {dst_path}[{in_idx}]"}}
    except Exception as e:
        return {"success": False, "error": f"连接失败: {e}"}


def _tool_delete_node(hou, args):
    path = args.get("node_path", "")
    node = hou.node(path)
    if not node:
        return {"success": False, "error": f"节点不存在: {path}"}
    try:
        with _undo_group(hou, "Houdini Agent: delete"):
            node.destroy()
            return {"success": True, "result": {"text": f"已删除节点: {path}"}}
    except Exception as e:
        return {"success": False, "error": f"删除失败: {e}"}


def _tool_copy_node(hou, args):
    src = args.get("source_path", "")
    dest_net = args.get("dest_network", "")
    new_name = args.get("new_name", "")

    src_node = hou.node(src)
    if not src_node:
        return {"success": False, "error": f"源节点不存在: {src}"}
    dest = hou.node(dest_net) if dest_net else src_node.parent()
    if not dest:
        return {"success": False, "error": f"目标网络不存在: {dest_net}"}

    try:
        with _undo_group(hou, "Houdini Agent: copy"):
            new_node = dest.copyItem(src_node)
            if new_name:
                new_node.setName(new_name)
            return {"success": True, "result": {"text": f"已复制: {src} → {new_node.path()}", "path": new_node.path()}}
    except Exception as e:
        return {"success": False, "error": f"复制失败: {e}"}


def _tool_set_display_flag(hou, args):
    path = args.get("node_path", "")
    display = args.get("display", True)
    render = args.get("render", True)
    node = hou.node(path)
    if not node:
        return {"success": False, "error": f"节点不存在: {path}"}
    try:
        if display:
            node.setDisplayFlag(True)
        if render:
            node.setRenderFlag(True)
        return {"success": True, "result": {"text": f"已设置标志: {path} display={display} render={render}"}}
    except Exception as e:
        return {"success": False, "error": f"设置标志失败: {e}"}


def _tool_set_parameter(hou, args):
    path = args.get("node_path", "")
    param_name = args.get("param_name", "")
    value = args.get("value", "")

    node = hou.node(path)
    if not node:
        return {"success": False, "error": f"节点不存在: {path}"}
    parm = node.parm(param_name)
    if not parm:
        # 尝试 parmTuple
        pt = node.parmTuple(param_name)
        if pt:
            with _undo_group(hou, "Houdini Agent: set_param"):
                try:
                    if isinstance(value, list):
                        pt.set(tuple(value))
                    else:
                        pt.set((value,))
                    return {"success": True, "result": {"text": f"已设置 {path}/{param_name} = {value}"}}
                except Exception as e:
                    return {"success": False, "error": f"设置失败: {e}"}
        # 模糊匹配
        all_parms = [p.name() for p in node.parms()][:50]
        similar = [p for p in all_parms if param_name.lower() in p.lower()][:5]
        hint = f"\n相似参数: {similar}" if similar else f"\n可用参数(前50): {all_parms}"
        return {"success": False, "error": f"参数不存在: {param_name}{hint}"}

    try:
        with _undo_group(hou, "Houdini Agent: set_param"):
            if isinstance(value, (int, float)):
                parm.set(value)
            else:
                try:
                    parm.set(float(value))
                except (ValueError, TypeError):
                    parm.set(str(value))
            return {"success": True, "result": {"text": f"已设置 {path}/{param_name} = {value}"}}
    except Exception as e:
        return {"success": False, "error": f"设置参数失败: {e}"}


def _tool_batch_set_parameters(hou, args):
    paths = args.get("node_paths", [])
    param_name = args.get("param_name", "")
    value = args.get("value", "")
    results = []
    ok = 0
    for p in paths:
        node = hou.node(p)
        if node:
            parm = node.parm(param_name)
            if parm:
                try:
                    parm.set(value)
                    ok += 1
                except Exception:
                    pass
    return {"success": True, "result": {"text": f"批量设置完成: {ok}/{len(paths)} 个节点成功"}}


def _tool_find_by_param(hou, args):
    param_name = args.get("param_name", "")
    value = args.get("value", "")
    net_path = args.get("network_path", "")
    parent = hou.node(net_path) if net_path else hou.node("/obj")
    if not parent:
        return {"success": False, "error": f"网络不存在: {net_path}"}
    found = []
    for node in parent.allSubChildren():
        parm = node.parm(param_name)
        if parm and str(parm.eval()) == str(value):
            found.append(node.path())
    return {"success": True, "result": {"text": f"找到 {len(found)} 个节点:\n" + "\n".join(found[:20]), "nodes": found}}


def _tool_layout_nodes(hou, args):
    net_path = args.get("network_path", "")
    strategy = args.get("strategy", "auto")
    parent = hou.node(net_path) if net_path else _get_network(hou)
    if not parent:
        return {"success": False, "error": "无法确定网络路径"}
    try:
        children = parent.children()
        if strategy == "auto":
            try:
                parent.moveToGoodPosition()
            except Exception:
                pass
        elif strategy == "grid":
            x, y = 0, 0
            for child in children:
                child.setPosition((x, y))
                x += 4
                if x > 20:
                    x = 0
                    y -= 3
        elif strategy == "columns":
            x = 0
            for child in children:
                child.setPosition((x, 0))
                x += 4
        return {"success": True, "result": {"text": f"已布局 {len(children)} 个节点 (策略: {strategy})"}}
    except Exception as e:
        return {"success": False, "error": f"布局失败: {e}"}


def _tool_save_hip(hou, args):
    path = args.get("file_path", "")
    try:
        if path:
            hou.hipFile.save(path)
        else:
            hou.hipFile.save()
        return {"success": True, "result": {"text": f"已保存: {path or hou.hipFile.path()}"}}
    except Exception as e:
        return {"success": False, "error": f"保存失败: {e}"}


def _tool_undo_redo(hou, args):
    action = args.get("action", "undo")
    try:
        if action == "undo":
            hou.undos.performUndo()
        else:
            hou.undos.performRedo()
        return {"success": True, "result": {"text": f"已执行: {action}"}}
    except Exception as e:
        return {"success": False, "error": f"{action} 失败: {e}"}


# ============================================================
# 工具实现 — 查询操作
# ============================================================
def _tool_get_network(hou, args):
    net_path = args.get("network_path", "")
    parent = hou.node(net_path) if net_path else _get_network(hou)
    if not parent:
        return {"success": False, "error": "无法确定网络路径"}
    children = parent.children()
    lines = [f"网络: {parent.path()} ({len(children)} 个子节点)"]
    for c in children:
        flags = ""
        if c.isDisplayFlagSet():
            flags += " [Display]"
        try:
            if c.isBypassed():
                flags += " [Bypass]"
        except Exception:
            pass
        errs = c.errors() or c.warnings()
        if errs:
            flags += " [ERROR]"
        pos = c.position()
        lines.append(f"  {c.name()} ({c.type().name()}){flags} @({pos[0]:.1f},{pos[1]:.1f})")
    return {"success": True, "result": {"text": "\n".join(lines)}}


def _tool_get_params(hou, args):
    path = args.get("node_path", "")
    node = hou.node(path)
    if not node:
        return {"success": False, "error": f"节点不存在: {path}"}
    lines = [f"节点: {node.path()} ({node.type().name()})"]
    if node.errors():
        lines.append(f"错误: {node.errors()}")
    if node.warnings():
        lines.append(f"警告: {node.warnings()}")
    lines.append("参数:")
    for parm in node.parms()[:60]:
        try:
            val = parm.eval()
            if isinstance(val, float) and val == int(val):
                val = int(val)
            lines.append(f"  {parm.name()} = {val}")
        except Exception:
            lines.append(f"  {parm.name()} = (无法评估)")
    # 输入连接
    inputs = node.inputs()
    if any(inputs):
        lines.append("输入:")
        for i, inp in enumerate(inputs):
            if inp:
                lines.append(f"  [{i}] ← {inp.path()}")
    return {"success": True, "result": {"text": "\n".join(lines)}}


def _tool_list_children(hou, args):
    net_path = args.get("network_path", "")
    recursive = args.get("recursive", False)
    parent = hou.node(net_path) if net_path else _get_network(hou)
    if not parent:
        return {"success": False, "error": "无法确定网络路径"}
    if recursive:
        children = parent.allSubChildren()
    else:
        children = parent.children()
    lines = [f"{parent.path()} 的子节点 ({len(children)}):"]
    for c in children[:100]:
        lines.append(f"  {c.name()} ({c.type().name()})")
    return {"success": True, "result": {"text": "\n".join(lines)}}


def _tool_read_selection(hou, args):
    limit = args.get("limit", 10)
    try:
        selected = hou.selectedNodes()
    except Exception:
        selected = []
    if not selected:
        return {"success": True, "result": {"text": "当前没有选中节点"}}
    lines = [f"选中 {len(selected)} 个节点:"]
    for n in selected[:limit]:
        lines.append(f"  {n.path()} ({n.type().name()})")
    return {"success": True, "result": {"text": "\n".join(lines)}}


def _tool_check_errors(hou, args):
    path = args.get("node_path", "")
    if path:
        node = hou.node(path)
        if not node:
            return {"success": False, "error": f"节点不存在: {path}"}
        nodes_to_check = [node] + list(node.allSubChildren())
    else:
        parent = _get_network(hou)
        nodes_to_check = list(parent.allSubChildren()) if parent else []

    errors = []
    warnings = []
    for n in nodes_to_check:
        e = n.errors()
        w = n.warnings()
        if e:
            errors.append(f"  {n.path()}: {e}")
        if w:
            warnings.append(f"  {n.path()}: {w}")
    lines = []
    if errors:
        lines.append(f"错误 ({len(errors)}):")
        lines.extend(errors)
    if warnings:
        lines.append(f"警告 ({len(warnings)}):")
        lines.extend(warnings)
    if not errors and not warnings:
        lines.append("没有错误和警告 ✓")
    return {"success": True, "result": {"text": "\n".join(lines)}}


def _tool_get_geo_info(hou, args):
    path = args.get("node_path", "")
    node = hou.node(path)
    if not node:
        return {"success": False, "error": f"节点不存在: {path}"}
    try:
        geo = node.geometry()
        if not geo:
            return {"success": False, "error": f"节点无几何体: {path}"}
        lines = [
            f"几何体信息: {path}",
            f"  点数: {len(geo.points())}",
            f"  面数: {len(geo.prims())}",
        ]
        # 顶点数：兼容不同版本
        try:
            vertex_count = sum(len(p.vertices()) for p in geo.prims()[:100])
            lines.append(f"  顶点数(前100面): {vertex_count}")
        except Exception:
            pass
        point_attribs = [a.name() for a in geo.pointAttribs()]
        if point_attribs:
            lines.append(f"  点属性: {', '.join(point_attribs)}")
        prim_attribs = [a.name() for a in geo.primAttribs()]
        if prim_attribs:
            lines.append(f"  Prim属性: {', '.join(prim_attribs)}")
        return {"success": True, "result": {"text": "\n".join(lines)}}
    except Exception as e:
        return {"success": False, "error": f"获取几何信息失败: {e}"}


def _tool_search_types(hou, args):
    keyword = args.get("keyword", "").lower()
    if not keyword:
        return {"success": False, "error": "请提供搜索关键词"}
    # 兼容不同 Houdini 版本：hou.nodeTypeAll() 在 20.0 不存在
    all_types = []
    try:
        all_types = hou.nodeTypeAll()
    except AttributeError:
        try:
            for cat in hou.nodeTypeCategories().values():
                all_types.extend(cat.nodeTypes().values())
        except Exception:
            pass
    matched = []
    for nt in all_types:
        name = nt.name()
        desc = nt.description()
        if keyword in name.lower() or keyword in desc.lower():
            matched.append(f"  {name} — {desc}")
    matched = matched[:30]
    return {"success": True, "result": {"text": f"找到 {len(matched)} 个匹配类型:\n" + "\n".join(matched)}}


def _tool_semantic_search(hou, args):
    desc = args.get("description", "")
    # 简单关键词匹配
    mapping = {
        "散点": "scatter", "撒点": "scatter", "分布": "scatter",
        "复制到点": "copytopoints", "变换": "transform",
        "挤出": "polyextrude", "细分": "subdivide", "焊接": "fuse",
        "噪声": "mountain", "地形": "heightfield",
        "颜色": "color", "随机": "attribrandomize",
    }
    results = []
    for key, node_type in mapping.items():
        if key in desc:
            results.append(f"  {node_type} — 匹配 '{key}'")
    if not results:
        return {"success": True, "result": {"text": f"未找到匹配 '{desc}' 的节点类型，请用关键词搜索"}}
    return {"success": True, "result": {"text": f"语义搜索结果:\n" + "\n".join(results)}}


def _tool_get_inputs(hou, args):
    type_name = args.get("node_type", "").lower()
    try:
        # 尝试动态获取
        nts = hou.nodeType(hou.sopNodeTypeCategory(), type_name)
        if nts:
            n = nts.maxNumInputs()
            lines = [f"节点: {type_name}", f"输入数: {n}"]
            for i in range(n):
                try:
                    label = nts.inputLabel(i)
                    lines.append(f"  [{i}] {label}")
                except Exception:
                    lines.append(f"  [{i}] 输入{i}")
            return {"success": True, "result": {"text": "\n".join(lines)}}
    except Exception:
        pass
    return {"success": False, "error": f"无法获取节点类型 {type_name} 的输入信息"}


# ============================================================
# 工具实现 — 代码执行
# ============================================================
def _tool_exec_python(hou, args):
    code = args.get("code", "")
    timeout = args.get("timeout", 30)

    # 危险模式检查
    for pattern in _PY_DANGEROUS:
        if pattern in code:
            return {"success": False, "error": f"代码包含危险操作: {pattern}（已被拦截）"}

    if not code.strip():
        return {"success": False, "error": "代码为空"}

    local_ns = {"hou": hou}
    global_ns = {"__builtins__": __builtins__, "__name__": "__main__", "__file__": "<houdini_exec>"}

    # 捕获 print 输出
    import io
    from contextlib import redirect_stdout, redirect_stderr
    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    try:
        # 多行代码用 exec，单行表达式用 eval
        is_expr = not "\n" in code.strip() and not code.strip().startswith(("import ", "from ", "for ", "while ", "if ", "with ", "class ", "def ", "try:", "else:", "elif ", "except"))
        if is_expr:
            try:
                result = eval(code, global_ns, local_ns)
                stdout_val = stdout_buf.getvalue()
                text_parts = []
                if stdout_val:
                    text_parts.append(stdout_val.strip())
                if result is not None:
                    text_parts.append(f"结果: {result}")
                return {"success": True, "result": {"text": "\n".join(text_parts) if text_parts else "执行完成(无返回值)"}}
            except SyntaxError:
                pass  # 落到 exec

        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            exec(code, global_ns, local_ns)

        stdout_val = stdout_buf.getvalue()
        stderr_val = stderr_buf.getvalue()
        output_keys = [k for k in local_ns if k != "hou" and not k.startswith("__")]

        text_parts = []
        if stdout_val:
            text_parts.append(stdout_val.rstrip())
        if stderr_val:
            text_parts.append(f"[stderr]\n{stderr_val.rstrip()}")
        if output_keys:
            text_parts.append(f"变量: {output_keys}")
        if not text_parts:
            text_parts.append("执行完成")

        return {"success": True, "result": {"text": "\n".join(text_parts)}}
    except Exception as e:
        stdout_val = stdout_buf.getvalue()
        stderr_val = stderr_buf.getvalue()
        # 过滤 traceback：只保留用户代码行，去掉 pythonrc.py 内部帧
        import traceback as tb_mod
        tb_lines = tb_mod.format_exception(type(e), e, e.__traceback__)
        clean_tb = []
        for line in tb_lines:
            # 跳过 redirect/contextlib 内部帧
            if "redirect_stdout" in line or "redirect_stderr" in line or "contextlib" in line:
                continue
            # 跳过 pythonrc.py 的 _tool_exec_python 内部帧
            if "pythonrc.py" in line and "_tool_exec_python" in line:
                continue
            clean_tb.append(line)
        err_text = f"Python 执行错误: {e}\n{''.join(clean_tb)}"
        if stdout_val:
            err_text = f"[stdout]\n{stdout_val.rstrip()}\n\n{err_text}"
        return {"success": False, "error": err_text}


def _tool_exec_shell(hou, args):
    import subprocess
    cmd = args.get("command", "")
    timeout = args.get("timeout", 120)

    for pattern in _SHELL_DANGEROUS:
        if pattern in cmd:
            return {"success": False, "error": f"命令包含危险操作: {pattern}（已被拦截）"}

    if not cmd.strip():
        return {"success": False, "error": "命令为空"}

    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True,
            timeout=timeout, creationflags=0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW
        )
        output = result.stdout
        if result.stderr:
            output += f"\n[stderr]\n{result.stderr}"
        return {"success": True, "result": {"text": output or "(无输出)", "returncode": result.returncode}}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"命令超时 ({timeout}s)"}
    except Exception as e:
        return {"success": False, "error": f"Shell 执行错误: {e}"}


# ============================================================
# 工具实现 — NetworkBox
# ============================================================
def _tool_create_box(hou, args):
    name = args.get("name", "box1")
    net_path = args.get("network_path", "")
    nodes = args.get("nodes", [])
    parent = hou.node(net_path) if net_path else _get_network(hou)
    if not parent:
        return {"success": False, "error": "无法确定网络路径"}
    try:
        box = parent.createNetworkBox(name)
        for path in nodes:
            n = hou.node(path)
            if n:
                box.addItem(n)
        return {"success": True, "result": {"text": f"已创建 NetworkBox: {name}"}}
    except Exception as e:
        return {"success": False, "error": f"创建 NetworkBox 失败: {e}"}


def _tool_add_to_box(hou, args):
    name = args.get("name", "")
    net_path = args.get("network_path", "")
    nodes = args.get("nodes", [])
    parent = hou.node(net_path) if net_path else _get_network(hou)
    if not parent:
        return {"success": False, "error": "无法确定网络路径"}
    boxes = parent.networkBoxes()
    box = None
    for b in boxes:
        if b.name() == name:
            box = b
            break
    if not box:
        return {"success": False, "error": f"NetworkBox 不存在: {name}"}
    try:
        for path in nodes:
            n = hou.node(path)
            if n:
                box.addItem(n)
        return {"success": True, "result": {"text": f"已添加 {len(nodes)} 个节点到 {name}"}}
    except Exception as e:
        return {"success": False, "error": f"添加失败: {e}"}


def _tool_list_boxes(hou, args):
    net_path = args.get("network_path", "")
    parent = hou.node(net_path) if net_path else _get_network(hou)
    if not parent:
        return {"success": False, "error": "无法确定网络路径"}
    boxes = parent.networkBoxes()
    if not boxes:
        return {"success": True, "result": {"text": "没有 NetworkBox"}}
    lines = [f"NetworkBox 列表 ({len(boxes)}):"]
    for b in boxes:
        items = b.nodes()
        lines.append(f"  {b.name()} ({len(items)} 个节点)")
    return {"success": True, "result": {"text": "\n".join(lines)}}


# ============================================================
# TCP Server
# ============================================================
class _Handler(socketserver.StreamRequestHandler):
    def handle(self):
        line = self.rfile.readline(_MAX_MSG_SIZE)
        if not line:
            return
        try:
            req = json.loads(line.decode("utf-8").strip())
        except json.JSONDecodeError as e:
            self._send({"id": "error", "success": False, "error": f"JSON 解析错误: {e}"})
            return

        action = req.get("action", "")
        payload = req.get("payload", {})
        req_id = req.get("id", "")

        try:
            if action == "ping":
                ver = ""
                try:
                    import hou
                    ver = hou.applicationVersionString()
                except Exception:
                    ver = "unknown"
                self._send({"id": req_id, "success": True, "result": {"status": "ok", "houdini": ver}})

            elif action == "scene_context":
                ctx = self._get_scene_context()
                self._send({"id": req_id, "success": True, "result": ctx})

            elif action == "execute_tool":
                result = _execute_tool(payload)
                self._send({"id": req_id, **result})

            elif action == "undo_node_op":
                # 简单撤销：直接调用 hou.undos.performUndo()
                def do_undo():
                    try:
                        import hou
                        hou.undos.performUndo()
                        return {"success": True, "result": {"text": "已撤销"}}
                    except Exception as e:
                        return {"success": False, "error": str(e)}
                result = _main_thread(do_undo)
                self._send({"id": req_id, **result})

            else:
                self._send({"id": req_id, "success": False, "error": f"未知动作: {action}"})

        except Exception as e:
            self._send({"id": req_id, "success": False, "error": f"{e}", "traceback": traceback.format_exc()})

    def _send(self, obj):
        data = json.dumps(obj, ensure_ascii=False, default=str) + "\n"
        self.wfile.write(data.encode("utf-8"))
        self.wfile.flush()

    def _get_scene_context(self):
        def get_ctx():
            try:
                import hou
                # 当前网络
                network = "/obj"
                try:
                    panes = [p for p in hou.ui.paneTabs() if p.type() == hou.paneTabType.NetworkEditor]
                    if panes:
                        network = str(panes[0].pwd().path())
                except Exception:
                    pass
                # 选中节点数
                sel_count = 0
                try:
                    sel_count = len(hou.selectedNodes())
                except Exception:
                    pass
                ver = hou.applicationVersionString()
                return {"network": network, "selection_count": sel_count, "houdini": ver}
            except Exception:
                return {"network": "unknown", "selection_count": 0, "houdini": "unknown"}
        return _main_thread(get_ctx)


class _Server(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


# ============================================================
# 全局状态
# ============================================================
_SERVER = None
_THREAD = None


def start_bridge(host=_HOST, port=None):
    """启动 Bridge Server"""
    global _SERVER, _THREAD

    if _SERVER is not None:
        return _SERVER

    base_port = port or _resolve_port()

    # 尝试端口（base ~ base+20）
    for p in range(base_port, base_port + 21):
        try:
            _SERVER = _Server((host, p), _Handler)
            _write_port_file(p)
            _THREAD = threading.Thread(target=_SERVER.serve_forever, name="HoudiniBridge", daemon=True)
            _THREAD.start()
            print(f"[Houdini Bridge] 监听 {host}:{p}")
            return _SERVER
        except (OSError, socket.error):
            continue

    print(f"[Houdini Bridge] 端口 {base_port}-{base_port+20} 均不可用。设置 HOUDINI_BRIDGE_PORT 环境变量指定其他端口。")
    return None


# ============================================================
# 自动启动入口（Houdini pythonrc.py 调用）
# ============================================================
def _auto_start():
    """Houdini 启动时自动调用"""
    try:
        # 延迟启动（等 UI 稳定）
        try:
            from PySide6.QtCore import QTimer
            QTimer.singleShot(1500, lambda: start_bridge())
        except ImportError:
            try:
                from PySide2.QtCore import QTimer
                QTimer.singleShot(1500, lambda: start_bridge())
            except ImportError:
                start_bridge()
    except Exception as e:
        print(f"[Houdini Bridge] 启动失败: {e}")


# 如果在 Houdini 内运行，自动启动
try:
    import hou
    _auto_start()
except ImportError:
    pass
