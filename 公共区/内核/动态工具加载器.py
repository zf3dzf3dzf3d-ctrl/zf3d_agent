"""
动态工具加载器 — MCP式声明工具
从JSON配置加载工具，自动生成操作类，无需写Python代码

支持的工具类型:
  - http:    调用HTTP API
  - command: 执行系统命令
  - python:  运行Python脚本

工具声明格式（工具声明.json）:
{
  "名称": "查天气",
  "描述": "查询天气",
  "类型": "http",                      // http / command / python
  "配置": {
    "URL": "https://api.weather.com/${city}",
    "方法": "GET",
    "命令模板": "npm test -- ${file}",
    "脚本": "print('hello ${name}')",
    ...
  },
  "参数": [
    {"名称": "city", "类型": "字符串", "必填": true, "说明": "城市名"}
  ],
  "参数映射": {
    "city": "city"
  }
}
"""
import json
import subprocess
import urllib.request
import urllib.error
import re
import sys
import traceback
from pathlib import Path
from 操作基类 import 操作基类, 操作结果


class 动态工具操作(操作基类):
    """由JSON声明生成的动态工具操作

    不直接使用，通过 动态工具加载器类.加载() 获取具体实例
    """
    def __init__(self, 工具声明: dict):
        self.工具声明 = 工具声明
        self.名称 = 工具声明.get("名称", "未命名工具")
        self.描述 = 工具声明.get("描述", "")
        self.工具类型 = 工具声明.get("类型", "http")
        self.工具配置 = 工具声明.get("配置", {})
        self.参数映射 = 工具声明.get("参数映射", {})

        # 构建参数结构
        self.参数结构 = {}
        for 参数 in 工具声明.get("参数", []):
            self.参数结构[参数["名称"]] = {
                "类型": 参数.get("类型", "字符串"),
                "必填": 参数.get("必填", False),
                "说明": 参数.get("说明", "")
            }

    def 执行(self, 参数: dict) -> 操作结果:
        try:
            if self.工具类型 == "http":
                return self._执行HTTP(参数)
            elif self.工具类型 == "command":
                return self._执行命令(参数)
            elif self.工具类型 == "python":
                return self._执行Python(参数)
            else:
                return 操作结果.失败(f"不支持的动态工具类型: {self.工具类型}")
        except Exception as e:
            return 操作结果.失败(f"动态工具执行异常: {e}\n{traceback.format_exc()}")

    def _替换参数(self, 模板: str, 参数: dict) -> str:
        """替换字符串中的 ${参数名} 为实际值"""
        result = 模板
        for 中文名, 实际值 in 参数.items():
            占位符 = f"${{{中文名}}}"
            result = result.replace(占位符, str(实际值))
        # 也支持英文映射
        for 中文名, 英文名 in self.参数映射.items():
            if 中文名 in 参数:
                占位符 = f"${{{英文名}}}"
                result = result.replace(占位符, str(参数[中文名]))
        return result

    def _执行HTTP(self, 参数: dict) -> 操作结果:
        url模板 = self.工具配置.get("URL", "")
        url = self._替换参数(url模板, 参数)
        方法 = self.工具配置.get("方法", "GET")
        请求头 = self.工具配置.get("请求头", {})

        try:
            # 构建请求
            if 方法 == "GET":
                请求 = urllib.request.Request(url, headers=请求头, method="GET")
            else:
                body = self.工具配置.get("请求体", "")
                body = self._替换参数(body, 参数)
                请求 = urllib.request.Request(
                    url,
                    data=body.encode("utf-8") if body else None,
                    headers=请求头,
                    method=方法
                )

            响应 = urllib.request.urlopen(请求, timeout=30)
            内容 = 响应.read().decode("utf-8", errors="replace")

            # 处理响应
            响应处理 = self.工具配置.get("响应处理", {})
            提取方法 = 响应处理.get("提取方法", "直接输出")
            最大长度 = 响应处理.get("最大长度", 2000)

            if 提取方法 == "JSON解析":
                try:
                    data = json.loads(内容)
                    输出字段 = 响应处理.get("输出字段", [])
                    if 输出字段:
                        输出 = "\n".join(f"{k}: {data.get(k, 'N/A')}" for k in 输出字段)
                    else:
                        输出 = json.dumps(data, ensure_ascii=False, indent=2)
                except json.JSONDecodeError:
                    输出 = 内容[:最大长度]
            elif 提取方法 == "JSON路径":
                输出 = 内容[:最大长度]  # 简单返回全文
            else:
                输出 = 内容[:最大长度]

            return 操作结果.成功(输出, 元数据={
                "操作类型": f"动态工具[{self.名称}]",
                "工具类型": "http",
                "URL": url,
                "状态码": 响应.status
            })

        except urllib.error.HTTPError as e:
            return 操作结果.失败(f"HTTP {e.code}: {e.read().decode('utf-8', errors='replace')[:200]}")
        except urllib.error.URLError as e:
            return 操作结果.失败(f"连接失败: {str(e.reason)[:200]}")
        except Exception as e:
            return 操作结果.失败(f"请求异常: {str(e)[:200]}")

    def _执行命令(self, 参数: dict) -> 操作结果:
        命令模板 = self.工具配置.get("命令模板", "")
        命令 = self._替换参数(命令模板, 参数)
        超时 = self.工具配置.get("超时秒数", 30)

        try:
            结果 = subprocess.run(
                命令, shell=True, capture_output=True, text=True,
                timeout=超时, encoding='utf-8', errors='replace'
            )
            if 结果.returncode == 0:
                return 操作结果.成功(
                    结果.stdout.strip() or "(命令执行成功，无输出)",
                    元数据={"操作类型": f"动态工具[{self.名称}]", "工具类型": "command"}
                )
            else:
                return 操作结果.失败(
                    f"命令失败(退出码{结果.returncode}): {结果.stderr or 结果.stdout}"
                )
        except subprocess.TimeoutExpired:
            return 操作结果.失败(f"命令超时({超时}秒)")
        except Exception as e:
            return 操作结果.失败(f"命令执行异常: {e}")

    def _执行Python(self, 参数: dict) -> 操作结果:
        脚本模板 = self.工具配置.get("脚本", "")
        脚本 = self._替换参数(脚本模板, 参数)

        try:
            import io
            from contextlib import redirect_stdout
            from 安全计算器 import 安全计算

            输出流 = io.StringIO()
            # 注入安全计算器，脚本中可用 safe_eval() 替代 eval()
            全局命名空间 = {
                '__builtins__': __builtins__,
                'print': lambda *a, **kw: print(*a, **kw, file=输出流),
                'safe_eval': 安全计算,
            }

            with redirect_stdout(输出流):
                exec(脚本, 全局命名空间)

            输出 = 输出流.getvalue().strip()
            return 操作结果.成功(输出 or "(脚本执行成功，无输出)", 元数据={
                "操作类型": f"动态工具[{self.名称}]", "工具类型": "python"
            })
        except Exception as e:
            return 操作结果.失败(f"Python脚本异常: {e}\n{traceback.format_exc()}")


class 动态工具加载器类:
    """从JSON配置加载动态工具"""

    def __init__(self):
        self.已加载工具 = {}  # 名称 -> 操作实例

    def 从文件加载(self, 文件路径: str, 注册目标: object = None) -> list:
        """从JSON文件加载所有动态工具

        参数:
            文件路径: JSON配置文件路径
            注册目标: 操作注册中心实例，传入则自动注册

        返回: 已加载的(操作实例)列表
        """
        path = Path(文件路径)
        if not path.exists():
            print(f"   ⚠️ 动态工具配置文件不存在: {文件路径}")
            return []

        try:
            with open(path, "r", encoding="utf-8") as f:
                配置 = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            print(f"   ❌ 动态工具配置解析失败: {e}")
            return []

        工具列表 = 配置.get("工具列表", [])
        实例列表 = []

        for 声明 in 工具列表:
            try:
                实例 = 动态工具操作(声明)
                self.已加载工具[实例.名称] = 实例
                实例列表.append(实例)
                if 注册目标:
                    注册目标.注册(实例)
            except Exception as e:
                print(f"   ❌ 动态工具加载失败 [{声明.get('名称', '未知')}]: {e}")

        if 实例列表:
            print(f"   ✅ 已加载 {len(实例列表)} 个动态工具: {', '.join(i.名称 for i in 实例列表)}")

        return 实例列表

    def 从字典加载(self, 工具声明列表: list, 注册目标: object = None) -> list:
        """从字典列表加载动态工具"""
        实例列表 = []
        for 声明 in 工具声明列表:
            try:
                实例 = 动态工具操作(声明)
                self.已加载工具[实例.名称] = 实例
                实例列表.append(实例)
                if 注册目标:
                    注册目标.注册(实例)
            except Exception as e:
                print(f"   ❌ 动态工具加载失败: {e}")
        return 实例列表

    def _中文转英文(self, 中文名: str) -> str:
        """中文工具名转英文（用于function calling）"""
        import hashlib
        哈希 = hashlib.md5(中文名.encode()).hexdigest()[:8]
        return f"dynamic_tool_{哈希}"
