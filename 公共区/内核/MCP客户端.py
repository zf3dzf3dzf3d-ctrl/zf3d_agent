"""
MCP客户端 — 连接外部 MCP Server，自动发现工具并注册为操作

零依赖实现 MCP（Model Context Protocol）客户端：
- stdio 传输：subprocess + JSON-RPC over stdin/stdout
- 自动发现：initialize → tools/list → 包装为操作基类子类
- 与内置操作/插件/技能并列，LLM 无感知差异

配置格式见 公共区/配置/MCP服务.json
"""
import json
import subprocess
import threading
import time
import sys
from pathlib import Path


class MCP客户端类:
    """单个 MCP Server 的客户端连接"""

    def __init__(self, 名称: str, 配置: dict):
        self.名称 = 名称
        self.配置 = 配置
        self.进程 = None
        self.工具列表 = []
        self.请求ID = 0
        self.已连接 = False
        self.锁 = threading.Lock()
        self.读缓冲 = ""

    def 连接(self) -> bool:
        """启动子进程并握手"""
        try:
            传输 = self.配置.get("传输方式", "stdio")
            if 传输 != "stdio":
                print(f"   ⚠️ MCP [{self.名称}] 暂不支持传输方式: {传输}")
                return False

            命令 = self.配置.get("命令", [])
            if not 命令:
                print(f"   ❌ MCP [{self.名称}] 未配置命令")
                return False

            参数 = self.配置.get("参数", [])
            环境变量 = dict(__import__("os").environ)
            环境变量.update(self.配置.get("环境变量", {}))
            # 确保命令中可执行文件所在目录在PATH中
            if 命令:
                import os as _os
                命令目录 = _os.path.dirname(_os.path.abspath(命令[0]))
                if 命令目录 not in 环境变量.get("PATH", ""):
                    环境变量["PATH"] = 命令目录 + _os.pathsep + 环境变量.get("PATH", "")

            完整命令 = list(命令) + list(参数)

            self.进程 = subprocess.Popen(
                完整命令,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=环境变量,
                text=True,
                bufsize=1,
                encoding="utf-8",
                errors="replace"
            )

            # 给 Server 一点启动时间
            time.sleep(0.5)

            if self.进程.poll() is not None:
                stderr输出 = self.进程.stderr.read()[:500] if self.进程.stderr else ""
                print(f"   ❌ MCP [{self.名称}] 进程启动失败: {stderr输出}")
                self.进程 = None
                return False

            # MCP 握手: initialize
            响应 = self._发送请求("initialize", {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "ZF3D-Agent",
                    "version": "2.1.0"
                }
            })

            if not 响应 or "result" not in 响应:
                print(f"   ❌ MCP [{self.名称}] 握手失败")
                self.断开()
                return False

            # 发送 initialized 通知
            self._发送通知("notifications/initialized")

            self.已连接 = True
            return True

        except Exception as e:
            print(f"   ❌ MCP [{self.名称}] 连接异常: {e}")
            self.断开()
            return False

    def 发现工具(self) -> list:
        """调用 tools/list 获取工具列表"""
        if not self.已连接:
            return []

        响应 = self._发送请求("tools/list", {})

        if not 响应 or "result" not in 响应:
            print(f"   ⚠️ MCP [{self.名称}] 获取工具列表失败")
            return []

        工具 = 响应["result"].get("tools", [])
        self.工具列表 = 工具
        return 工具

    def 调用工具(self, 工具名: str, 参数: dict) -> dict:
        """调用 tools/call 执行工具"""
        if not self.已连接:
            return {"成功": False, "错误": "MCP Server 未连接"}

        响应 = self._发送请求("tools/call", {
            "name": 工具名,
            "arguments": 参数
        })

        if not 响应:
            return {"成功": False, "错误": "MCP Server 无响应"}

        if "error" in 响应:
            return {"成功": False, "错误": 响应["error"].get("message", "未知错误")}

        if "result" not in 响应:
            return {"成功": False, "错误": "MCP 响应格式异常"}

        结果 = 响应["result"]
        # MCP 返回格式: {"content": [{"type": "text", "text": "..."}], "isError": false}
        if 结果.get("isError", False):
            文本 = ""
            for 块 in 结果.get("content", []):
                if 块.get("type") == "text":
                    文本 += 块.get("text", "")
            return {"成功": False, "错误": 文本 or "工具执行错误"}

        文本 = ""
        for 块 in 结果.get("content", []):
            if 块.get("type") == "text":
                文本 += 块.get("text", "")
            elif 块.get("type") == "image":
                文本 += f"[图片数据: {块.get('mimeType', 'unknown')}]"

        return {"成功": True, "数据": 文本 or "(工具执行成功，无输出)"}

    def 断开(self):
        """关闭连接"""
        self.已连接 = False
        if self.进程:
            try:
                self.进程.stdin.close()
            except Exception:
                pass
            try:
                self.进程.terminate()
                self.进程.wait(timeout=3)
            except Exception:
                try:
                    self.进程.kill()
                except Exception:
                    pass
            self.进程 = None

    def _发送请求(self, 方法: str, 参数: dict = None) -> dict:
        """发送 JSON-RPC 请求，等待并返回响应"""
        with self.锁:
            if not self.进程 or self.进程.poll() is not None:
                return None

            self.请求ID += 1
            请求 = {
                "jsonrpc": "2.0",
                "id": self.请求ID,
                "method": 方法
            }
            if 参数:
                请求["params"] = 参数

            try:
                self.进程.stdin.write(json.dumps(请求) + "\n")
                self.进程.stdin.flush()
            except Exception as e:
                print(f"   ❌ MCP [{self.名称}] 发送失败: {e}")
                return None

            return self._读取响应(self.请求ID)

    def _发送通知(self, 方法: str, 参数: dict = None):
        """发送 JSON-RPC 通知（无ID无响应）"""
        if not self.进程 or self.进程.poll() is not None:
            return

        通知 = {
            "jsonrpc": "2.0",
            "method": 方法
        }
        if 参数:
            通知["params"] = 参数

        try:
            self.进程.stdin.write(json.dumps(通知) + "\n")
            self.进程.stdin.flush()
        except Exception:
            pass

    def _读取响应(self, 期望ID: int, 超时秒: float = 30) -> dict:
        """从 stdout 读取 JSON-RPC 响应，匹配指定ID"""
        import select
        截止 = time.time() + 超时秒

        while time.time() < 截止:
            if not self.进程 or self.进程.poll() is not None:
                return None

            行 = self.进程.stdout.readline()

            if not 行:
                time.sleep(0.01)
                continue

            行 = 行.strip()

            if not 行:
                continue

            # 跳过非 JSON 行（MCP Server 可能输出日志到 stdout）
            if not 行.startswith("{"):
                continue

            try:
                数据 = json.loads(行)
            except json.JSONDecodeError:
                continue

            # 跳过通知（无 id 字段）
            if "id" not in 数据:
                continue

            if 数据["id"] == 期望ID:
                return 数据

        return None


class MCP工具操作:
    """将 MCP 工具包装为操作基类子类的动态工厂"""

    @staticmethod
    def 创建(服务名: str, 工具定义: dict, 客户端: MCP客户端类, 操作注册中心=None, 软件组: str = None):
        """从 MCP 工具定义创建操作基类子类实例

        参数:
            软件组: 若指定（如"3dsMax"/"Houdini"），工具将加入该软件互斥组，
                    一旦调用即锁定该组，排除其他3D软件工具，避免打架。
        """
        from 操作基类 import 操作基类, 操作结果

        工具名 = 工具定义.get("name", "unknown")
        操作名 = f"MCP_{服务名}_{工具名}"
        描述 = 工具定义.get("description", "")
        输入schema = 工具定义.get("inputSchema", {})

        # JSON Schema → 参数结构 转换
        参数结构 = {}
        属性 = 输入schema.get("properties", {})
        必填列表 = 输入schema.get("required", [])

        类型映射 = {
            "string": "字符串", "integer": "整数",
            "number": "数字", "boolean": "布尔",
            "array": "字符串", "object": "字符串"
        }

        for 参数名, schema in 属性.items():
            参数结构[参数名] = {
                "类型": 类型映射.get(schema.get("type", "string"), "字符串"),
                "必填": 参数名 in 必填列表,
                "说明": schema.get("description", "")
            }

        class 包装操作(操作基类):
            pass

        包装操作.名称 = 操作名
        包装操作.描述 = f"[MCP:{服务名}] {描述}"
        包装操作.参数结构 = 参数结构

        # 中文→英文参数名映射（AI可能用中文参数名调用MCP工具）
        # 覆盖3ds Max / Houdini / Blender / 通用MCP工具的所有常见参数
        _中英映射 = {
            # 通用
            "操作": "action", "名称": "name", "类型": "type",
            "路径": "path", "目标": "target", "值": "value",
            "时间": "time", "代码": "code", "命令": "command",
            "参数": "params", "结果": "result", "数据": "data",
            "描述": "description", "启用": "enabled", "状态": "status",
            "数量": "count", "索引": "index", "关键词": "keyword",
            "文件": "file", "文件名": "filename", "目录": "directory",
            "脚本": "code", "备注": "note", "标签": "label",
            "选项": "option", "模式": "mode", "级别": "level",
            # 3D场景 - 物体
            "物体名": "name", "物体": "name", "名称列表": "names",
            "选择": "selection", "选中": "selection", "选择集": "selection",
            "父级": "parent", "子级": "children", "层级": "hierarchy",
            "实例": "instance", "依赖": "dependencies",
            # 3D场景 - 变换
            "位置": "position", "旋转": "rotation", "缩放": "scale",
            "坐标": "pos", "偏移": "offset", "角度": "angle",
            "方向": "direction", "轴向": "axis",
            # 3D场景 - 材质纹理
            "颜色": "color", "材质": "material", "材质名": "material_name",
            "纹理": "texture", "贴图": "texture", "UV": "uv",
            "粗糙度": "roughness", "金属度": "metalness",
            "高光": "specular", "反射": "reflection", "折射": "refraction",
            "透明度": "opacity", "发光": "emission",
            "槽位": "slot", "子材质": "sub_material",
            # 3D场景 - 修改器
            "修改器": "modifier", "修改器名": "modifier_name",
            "属性": "property", "属性名": "property_name",
            "参数值": "value", "启用状态": "enabled",
            # 3D场景 - 动画关键帧
            "轨道": "tracks", "帧": "frame", "帧时间": "time",
            "关键帧": "keyframe", "时间线": "timeline",
            "开始帧": "start_frame", "结束帧": "end_frame",
            "起始": "start", "终止": "end",
            # 3D场景 - 渲染
            "宽度": "width", "高度": "height",
            "分辨率": "resolution", "输出": "output",
            "输出路径": "output_path", "输出文件": "output_file",
            "渲染器": "renderer", "采样": "samples",
            "相机": "camera", "灯光": "light",
            # 3D场景 - 视口截图
            "截图": "capture", "视口": "viewport",
            "最大宽度": "max_width", "最大高度": "max_height",
            # 3D场景 - 图层/组
            "图层": "layer", "图层名": "layer_name",
            "组": "group", "组名": "group_name",
            # 3D场景 - 控制器
            "控制器": "controller", "控制器类型": "controller_type",
            "轨道视图": "track_view",
            # 3D场景 - 插件
            "插件": "plugin", "插件名": "plugin_name",
            "类名": "class_name", "类": "class",
            # 3D场景 - 文件
            "文件路径": "filepath", "保存路径": "save_path",
            "合并": "merge", "搜索": "search",
            "最大数": "max_results", "最大数量": "max_results",
            "最大项": "max_items", "最近数": "max_results",
            # 3D场景 - 查询
            "过滤": "filter", "概览": "overview",
            "变化": "delta", "查询": "query",
            # 3D场景 - 其他
            "半径": "radius", "半径1": "radius1", "半径2": "radius2",
            "长度": "length", "宽度_": "width", "深度": "depth",
            "分段": "segments", "平滑": "smooth",
            "圆角": "fillet", "盖高度": "capheight",
            "布尔": "boolean", "镜像": "mirror",
            "法线": "normal", "切线": "tangent",
            "顶点": "vertex", "顶点数": "num_verts",
            "面": "face", "面数": "num_faces",
            "边": "edge", "边界": "border",
            # Houdini 特有
            "节点": "node", "节点名": "node_name", "节点路径": "node_path",
            "网络": "network", "参数名": "parm_name",
            "几何体": "geometry", "体积": "volume",
            "粒子": "particles", "模拟": "simulation",
            "缓存": "cache", "渲染输出": "render_output",
            # 复合/多词
            "目标物体": "target", "源物体": "source",
            "起始位置": "start_pos", "结束位置": "end_pos",
            "颜色列表": "colors", "名称数组": "names",
            "时间列表": "times", "值列表": "values",
            "轨道列表": "tracks", "参数字典": "params",
        }

        def 执行(self, 参数: dict) -> 操作结果:
            # 参数名自动映射：中文→英文
            干净参数 = {}
            for k, v in 参数.items():
                if v is None:
                    continue
                if k in 参数结构:
                    干净参数[k] = v
                elif k in _中英映射 and _中英映射[k] in 参数结构:
                    干净参数[_中英映射[k]] = v
                else:
                    干净参数[k] = v  # 未知参数原样传递
            结果 = 客户端.调用工具(工具名, 干净参数)
            if 结果.get("成功"):
                return 操作结果.成功(
                    结果["数据"],
                    元数据={"操作类型": f"MCP[{服务名}:{工具名}]"}
                )
            else:
                return 操作结果.失败(结果.get("错误", "未知错误"))

        包装操作.执行 = 执行

        实例 = 包装操作()
        if 操作注册中心:
            操作注册中心.注册(实例)
            # 注册英文映射
            英文名 = f"mcp_{服务名}_{工具名}".replace("-", "_").lower()
            操作注册中心._英文名映射[操作名] = 英文名
            操作注册中心._英文反查[英文名] = 操作名
            # 加入软件互斥组（如3dsMax），实现Blender/3dsMax/Houdini互斥
            if 软件组:
                操作注册中心.添加到软件组(软件组, 操作名)

        return 实例


class MCP管理器类:
    """管理所有 MCP Server 连接"""

    def __init__(self):
        self.客户端列表 = {}  # 名称 → MCP客户端类实例
        self.总工具数 = 0

    def _自动安装环境(self, 服务: dict) -> bool:
        """检查并自动安装 MCP Server 所需的运行环境

        通用检查项：
        1. uv 包管理器 → pip install uv
        2. 项目依赖 → uv sync（若配置了"项目目录"且该目录有pyproject.toml）
        3. 安装脚本 → 执行"安装命令"（如3ds Max插件部署）

        返回 True 表示环境就绪或无需安装，False 表示安装失败
        """
        import shutil
        import os

        自动安装 = 服务.get("自动安装", False)
        if not 自动安装:
            return True

        名称 = 服务.get("名称", "?")
        项目目录 = 服务.get("项目目录", "")

        # ① 检查 uv
        uv路径 = shutil.which("uv")
        if not uv路径:
            print(f"   🔧 MCP [{名称}] uv未安装，正在自动安装...")
            try:
                result = subprocess.run(
                    [sys.executable, "-m", "pip", "install", "uv"],
                    capture_output=True, text=True, timeout=120,
                    encoding="utf-8", errors="replace"
                )
                if result.returncode != 0:
                    print(f"   ❌ MCP [{名称}] uv安装失败: {result.stderr[:300]}")
                    return False
                uv路径 = shutil.which("uv")
                if not uv路径:
                    # uv可能装到了Scripts目录但PATH未刷新
                    import site
                    脚本目录 = os.path.join(os.path.dirname(sys.executable), "Scripts")
                    候选 = os.path.join(脚本目录, "uv.exe")
                    if os.path.exists(候选):
                        uv路径 = 候选
                    else:
                        for p in site.getsitepackages():
                            候选2 = os.path.join(os.path.dirname(p), "Scripts", "uv.exe")
                            if os.path.exists(候选2):
                                uv路径 = 候选2
                                break
                if not uv路径:
                    print(f"   ❌ MCP [{名称}] uv安装后仍找不到可执行文件")
                    return False
                print(f"   ✅ MCP [{名称}] uv已安装: {uv路径}")
            except Exception as e:
                print(f"   ❌ MCP [{名称}] uv安装异常: {e}")
                return False

        # 关键修复：用完整路径替换配置中的 "uv" 命令，解决PATH不生效问题
        # 安装命令中的 uv → 完整路径
        安装命令 = 服务.get("安装命令", [])
        if 安装命令 and 安装命令[0] == "uv":
            服务["安装命令"] = [uv路径] + 安装命令[1:]

        # MCP Server启动命令中的 uv → 完整路径
        启动命令 = 服务.get("命令", [])
        if 启动命令 and 启动命令[0] == "uv":
            服务["命令"] = [uv路径] + 启动命令[1:]
            print(f"   ℹ️ MCP [{名称}] 命令路径已修正: {uv路径}")

        # 检查是否已安装（安装标记存在 = 插件已部署，跳过所有安装步骤）
        安装标记 = 服务.get("安装标记", "")
        已安装 = False
        if 安装标记:
            已安装 = Path(安装标记).exists()

        if 已安装:
            print(f"   ✅ MCP [{名称}] 已安装，跳过安装步骤")
        else:
            # ② 检查项目依赖
            if 项目目录:
                项目路径 = Path(项目目录)
                锁文件 = 项目路径 / "uv.lock"
                虚拟环境 = 项目路径 / ".venv"

                if (项目路径 / "pyproject.toml").exists() and not (虚拟环境.exists() and 锁文件.exists()):
                    print(f"   🔧 MCP [{名称}] 正在安装项目依赖 (uv sync)...")
                    try:
                        result = subprocess.run(
                            [uv路径, "sync"],
                            cwd=str(项目路径),
                            capture_output=True, text=True, timeout=300,
                            encoding="utf-8", errors="replace"
                        )
                        if result.returncode != 0:
                            print(f"   ❌ MCP [{名称}] 依赖安装失败: {result.stderr[:300]}")
                            return False
                        print(f"   ✅ MCP [{名称}] 项目依赖已安装")
                    except Exception as e:
                        print(f"   ❌ MCP [{名称}] 依赖安装异常: {e}")
                        return False

            # ③ 复制gup插件和MAXScript（避免install.py的交互输入和UAC弹窗）
            if 项目目录:
                项目路径 = Path(项目目录)
                print(f"   🔧 MCP [{名称}] 正在部署插件...")
                try:
                    gup源 = 项目路径 / "native" / "bin" / "mcp_bridge_2026.gup"
                    if not gup源.exists():
                        for year in range(2027, 2022, -1):
                            候选 = 项目路径 / "native" / "bin" / f"mcp_bridge_{year}.gup"
                            if 候选.exists():
                                gup源 = 候选
                                break

                    if gup源.exists():
                        max_plugins = Path(r"C:\Program Files\Autodesk")
                        if max_plugins.exists():
                            for d in max_plugins.iterdir():
                                if d.name.startswith("3ds Max") and d.is_dir():
                                    plugins_dir = d / "plugins"
                                    目标gup = plugins_dir / "mcp_bridge.gup"
                                    if not 目标gup.exists():
                                        try:
                                            import shutil as _shutil
                                            _shutil.copy2(str(gup源), str(目标gup))
                                            print(f"   ✅ MCP [{名称}] gup插件已复制到 {目标gup}")
                                        except PermissionError:
                                            subprocess.run(
                                                ["powershell", "-Command",
                                                 f'Start-Process -FilePath cmd.exe -ArgumentList \'/c copy /Y "{gup源}" "{目标gup}"\' -Verb RunAs -Wait'],
                                                capture_output=True, timeout=30,
                                                encoding="utf-8", errors="replace"
                                            )
                                            if 目标gup.exists():
                                                print(f"   ✅ MCP [{名称}] gup插件已复制(管理员)")
                                            else:
                                                print(f"   ⚠️ MCP [{名称}] gup复制失败，可能需要手动以管理员身份运行install.py")
                                    else:
                                        print(f"   ℹ️ MCP [{名称}] gup插件已存在")

                                    # 复制MAXScript
                                    ms源 = 项目路径 / "maxscript" / "mcp_server.ms"
                                    ms目标 = d / "scripts" / "mcp" / "mcp_server.ms"
                                    autostart源 = 项目路径 / "maxscript" / "startup" / "mcp_autostart.ms"
                                    autostart目标 = d / "scripts" / "startup" / "mcp_autostart.ms"

                                    for src, dst in [(ms源, ms目标), (autostart源, autostart目标)]:
                                        if src.exists() and not dst.exists():
                                            try:
                                                dst.parent.mkdir(parents=True, exist_ok=True)
                                                import shutil as _shutil
                                                _shutil.copy2(str(src), str(dst))
                                            except PermissionError:
                                                subprocess.run(
                                                    ["powershell", "-Command",
                                                     f'Start-Process -FilePath cmd.exe -ArgumentList \'/c copy /Y "{src}" "{dst}"\' -Verb RunAs -Wait'],
                                                    capture_output=True, timeout=30,
                                                    encoding="utf-8", errors="replace"
                                                )

                                    # 复制配置文件
                                    配置目录 = Path(os.environ.get("LOCALAPPDATA", "")) / "3dsmax-mcp"
                                    配置目录.mkdir(parents=True, exist_ok=True)
                                    配置文件 = 配置目录 / "mcp_config.ini"
                                    if not 配置文件.exists():
                                        配置源 = 项目路径 / "mcp_config.ini"
                                        if 配置源.exists():
                                            import shutil as _shutil
                                            _shutil.copy2(str(配置源), str(配置文件))

                                    break
                    else:
                        print(f"   ⚠️ MCP [{名称}] 未找到gup插件文件")
                except Exception as e:
                    print(f"   ⚠️ MCP [{名称}] 插件安装异常: {e}")

        return True

    def 从配置加载(self, 配置路径: str, 注册目标=None) -> int:
        """从 JSON 配置文件加载所有 MCP Server

        自动安装服务（"自动安装": true）在启动时跳过，
        由用户通过"连接MCP服务"操作按需触发安装和连接。

        参数:
            配置路径: MCP服务.json 路径
            注册目标: 操作注册中心实例

        返回: 注册的工具总数
        """
        path = Path(配置路径)
        if not path.exists():
            print(f"   ℹ️ MCP配置文件不存在: {配置路径}")
            return 0

        try:
            with open(path, "r", encoding="utf-8") as f:
                配置 = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"   ❌ MCP配置解析失败: {e}")
            return 0

        if not 配置.get("启用", True):
            print("   ℹ️ MCP服务已禁用")
            return 0

        服务列表 = 配置.get("服务列表", [])
        if not 服务列表:
            print("   ℹ️ MCP服务列表为空")
            return 0

        # 存储配置路径和注册目标供 按名称连接 使用
        self._配置路径 = 配置路径
        self._配置 = 配置
        self._注册目标 = 注册目标

        总工具数 = 0

        for 服务 in 服务列表:
            if not 服务.get("启用", True):
                continue

            名称 = 服务.get("名称", "")
            if not 名称:
                continue

            # 自动安装服务跳过启动时连接，等用户按需触发
            if 服务.get("自动安装", False):
                print(f"   ⏳ MCP [{名称}] 待连接（用户说\"连接{名称}\"后自动安装）")
                continue

            工具数 = self.连接单个服务(服务, 注册目标)
            总工具数 += 工具数

        self.总工具数 = 总工具数
        if 总工具数 > 0:
            print(f"   ✅ MCP服务加载完成: 共 {总工具数} 个工具")
        else:
            print(f"   ℹ️ MCP服务暂无可加载工具（自动安装服务待用户触发）")

        return 总工具数

    def 连接单个服务(self, 服务: dict, 注册目标=None) -> int:
        """安装环境并连接单个 MCP Server，注册其工具为操作

        由"连接MCP服务"操作调用，实现按需懒加载。
        返回注册的工具数（0表示失败）
        """
        名称 = 服务.get("名称", "")
        if not 名称:
            return 0

        # 已连接则跳过
        if 名称 in self.客户端列表:
            print(f"   ℹ️ MCP [{名称}] 已连接")
            return 0

        软件组 = 服务.get("软件组", None)

        # 自动安装运行环境（uv、依赖、插件等）
        if 服务.get("自动安装", False):
            if not self._自动安装环境(服务):
                print(f"   ❌ MCP [{名称}] 环境安装失败")
                return 0

        print(f"   🔗 连接 MCP Server [{名称}]...")
        客户端 = MCP客户端类(名称, 服务)

        if not 客户端.连接():
            return 0

        工具列表 = 客户端.发现工具()

        if not 工具列表:
            print(f"   ⚠️ MCP [{名称}] 未发现工具")
            客户端.断开()
            return 0

        self.客户端列表[名称] = 客户端

        # 包装每个工具为操作
        工具数 = 0
        for 工具定义 in 工具列表:
            实例 = MCP工具操作.创建(名称, 工具定义, 客户端, 注册目标, 软件组=软件组)
            if 实例:
                工具数 += 1

        组提示 = f"（软件组: {软件组}）" if 软件组 else ""
        print(f"   ✅ MCP [{名称}] 发现 {工具数} 个工具{组提示}")

        return 工具数

    def 按名称连接(self, 服务名: str, 注册目标=None) -> int:
        """按服务名称从配置查找并连接单个MCP服务

        供"连接MCP服务"操作调用。返回注册工具数，-1表示未找到服务。
        """
        配置 = getattr(self, "_配置", None)
        if not 配置:
            return -1

        # 优先使用传入的注册目标，其次使用从配置加载时存储的
        目标 = 注册目标 or getattr(self, "_注册目标", None)

        for 服务 in 配置.get("服务列表", []):
            if 服务.get("名称", "") == 服务名:
                return self.连接单个服务(服务, 目标)

        return -1

    def 断开全部(self):
        """关闭所有 MCP Server 连接"""
        for 名称, 客户端 in self.客户端列表.items():
            try:
                客户端.断开()
                print(f"   ✅ MCP [{名称}] 已断开")
            except Exception:
                pass
        self.客户端列表.clear()
