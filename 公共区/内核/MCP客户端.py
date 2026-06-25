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
    def 创建(服务名: str, 工具定义: dict, 客户端: MCP客户端类, 操作注册中心=None):
        """从 MCP 工具定义创建操作基类子类实例"""
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

        def 执行(self, 参数: dict) -> 操作结果:
            # 清理参数中的空值
            干净参数 = {k: v for k, v in 参数.items() if v is not None}
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

        return 实例


class MCP管理器类:
    """管理所有 MCP Server 连接"""

    def __init__(self):
        self.客户端列表 = {}  # 名称 → MCP客户端类实例
        self.总工具数 = 0

    def 从配置加载(self, 配置路径: str, 注册目标=None) -> int:
        """从 JSON 配置文件加载所有 MCP Server

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

        总工具数 = 0

        for 服务 in 服务列表:
            if not 服务.get("启用", True):
                continue

            名称 = 服务.get("名称", "")
            if not 名称:
                continue

            print(f"   🔗 连接 MCP Server [{名称}]...")
            客户端 = MCP客户端类(名称, 服务)

            if not 客户端.连接():
                continue

            工具列表 = 客户端.发现工具()

            if not 工具列表:
                print(f"   ⚠️ MCP [{名称}] 未发现工具")
                客户端.断开()
                continue

            self.客户端列表[名称] = 客户端

            # 包装每个工具为操作
            工具数 = 0
            for 工具定义 in 工具列表:
                实例 = MCP工具操作.创建(名称, 工具定义, 客户端, 注册目标)
                if 实例:
                    工具数 += 1

            总工具数 += 工具数
            print(f"   ✅ MCP [{名称}] 发现 {工具数} 个工具: {', '.join(t['name'] for t in 工具列表[:5])}")

        self.总工具数 = 总工具数
        if 总工具数 > 0:
            print(f"   ✅ MCP服务加载完成: 共 {总工具数} 个工具")
        else:
            print(f"   ℹ️ MCP服务无可加载工具")

        return 总工具数

    def 断开全部(self):
        """关闭所有 MCP Server 连接"""
        for 名称, 客户端 in self.客户端列表.items():
            try:
                客户端.断开()
                print(f"   ✅ MCP [{名称}] 已断开")
            except Exception:
                pass
        self.客户端列表.clear()
