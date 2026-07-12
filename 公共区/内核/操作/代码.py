"""
代码操作模块 - 搜索代码/Glob搜索/符号搜索/验证代码/自动测试/构建验证/代码分析/代码差异
🔒加密发布：含AST代码分析操作，发布时建议PyArmor加密
"""
import os
import re
import ast
import json
import subprocess
from pathlib import Path
from .基类 import 操作结果, 操作基类


def _获取符号引擎实例(文件管理器=None):
    """延迟导入符号引擎，返回实例或None"""
    try:
        import sys as _sys
        if 文件管理器:
            对话目录 = str(Path(文件管理器.项目根目录) / "公共区" / "模块" / "对话")
            if 对话目录 not in _sys.path:
                _sys.path.insert(0, 对话目录)
        from 符号引擎 import 符号引擎类
        return 符号引擎类()
    except Exception:
        return None


class 搜索代码(操作基类):
    名称 = "搜索代码"
    描述 = "在项目文件中搜索关键词或正则表达式，返回匹配的文件路径、行号和行内容。支持正则模式、上下文行、分页和多种输出模式"
    参数结构 = {
        "关键词": {"类型": "字符串", "必填": True, "说明": "搜索关键词或正则表达式"},
        "路径": {"类型": "字符串", "必填": False, "说明": "搜索目录路径，默认项目根目录"},
        "后缀过滤": {"类型": "字符串", "必填": False, "说明": "只搜索指定后缀的文件，如 .py 多个用逗号分隔"},
        "正则模式": {"类型": "布尔", "必填": False, "说明": "是否启用正则表达式匹配，默认false(纯文本匹配)"},
        "忽略大小写": {"类型": "布尔", "必填": False, "说明": "是否忽略大小写，默认true"},
        "上下文行数": {"类型": "整数", "必填": False, "说明": "匹配行前后显示的上下文行数，默认0(只显示匹配行)"},
        "输出模式": {"类型": "字符串", "必填": False, "说明": "content=返回匹配行(默认) | files_with_matches=只返回文件路径 | count=返回每文件匹配数"},
        "offset": {"类型": "整数", "必填": False, "说明": "跳过前N条匹配结果，用于分页，默认0"},
        "maxResults": {"类型": "整数", "必填": False, "说明": "最大返回结果数，默认250"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        关键词 = 参数.get("关键词", "") or 参数.get("keyword", "") or 参数.get("pattern", "") or 参数.get("搜索词", "") or 参数.get("关键字", "")
        if not 关键词:
            return 操作结果.失败("关键词为空")
        搜索路径 = 参数.get("路径", "./") or 参数.get("path", "./")
        后缀过滤 = 参数.get("后缀过滤", "")
        正则模式 = 参数.get("正则模式", False)
        忽略大小写 = 参数.get("忽略大小写", True)
        上下文行数 = 参数.get("上下文行数", 0)
        输出模式 = 参数.get("输出模式", "content")
        offset = 参数.get("offset", 0)
        maxResults = 参数.get("maxResults", 250) or 参数.get("max_results", 250)

        标志 = re.IGNORECASE if 忽略大小写 else 0
        try:
            if 正则模式:
                模式 = re.compile(关键词, 标志)
            else:
                模式 = re.compile(re.escape(关键词), 标志)
        except re.error as e:
            return 操作结果.失败(f"正则表达式错误: {e}")

        后缀集合 = set()
        if 后缀过滤:
            后缀集合 = {s.strip() if s.strip().startswith(".") else "." + s.strip() for s in 后缀过滤.split(",") if s.strip()}

        跳过目录 = {"__pycache__", ".git", "node_modules", ".venv", "venv", ".idea", ".vscode", ".codely-cli"}

        try:
            if self.文件管理器:
                基目录 = self.文件管理器._解析路径(搜索路径)
            else:
                基目录 = Path(搜索路径)

            匹配文件数 = 0
            总匹配数 = 0
            结果列表 = []
            文件匹配表 = {}

            for 根, 目录列表, 文件列表 in os.walk(基目录):
                目录列表[:] = [d for d in 目录列表 if d not in 跳过目录]
                for 文件名 in 文件列表:
                    if 后缀集合:
                        后缀 = os.path.splitext(文件名)[1].lower()
                        if 后缀 not in 后缀集合:
                            continue
                    文件完整路径 = os.path.join(根, 文件名)
                    相对路径 = os.path.relpath(文件完整路径, 基目录)
                    try:
                        with open(文件完整路径, "r", encoding="utf-8", errors="ignore") as f:
                            行列表 = f.readlines()
                    except (PermissionError, OSError):
                        continue

                    文件匹配数 = 0
                    文件行匹配 = []

                    for 行号, 行内容 in enumerate(行列表, 1):
                        if 模式.search(行内容):
                            文件匹配数 += 1
                            总匹配数 += 1
                            文件行匹配.append((行号, 行内容.rstrip()))

                    if 文件匹配数 > 0:
                        匹配文件数 += 1
                        文件匹配表[相对路径] = 文件匹配数

                        if 输出模式 == "files_with_matches":
                            结果列表.append(相对路径)
                        elif 输出模式 == "count":
                            结果列表.append(f"{相对路径}: {文件匹配数}")
                        else:
                            for 行号, 行内容 in 文件行匹配:
                                if 上下文行数 > 0:
                                    起始 = max(0, 行号 - 1 - 上下文行数)
                                    结束 = min(len(行列表), 行号 + 上下文行数)
                                    for ctx行号 in range(起始, 结束):
                                        前缀 = ">>" if ctx行号 == 行号 - 1 else "  "
                                        结果列表.append(f"{前缀} {相对路径}:{ctx行号+1}: {行列表[ctx行号].rstrip()}")
                                    结果列表.append("")
                                else:
                                    结果列表.append(f"📄 {相对路径}:{行号}: {行内容}")

                                if len(结果列表) >= maxResults:
                                    break

                        if len(结果列表) >= maxResults:
                            break
                if len(结果列表) >= maxResults:
                    break

            是否截断 = 总匹配数 > offset + len(结果列表)
            下页offset = offset + len(结果列表) if 是否截断 else None

            元数据 = {"操作类型": "搜索代码", "匹配文件数": 匹配文件数, "总匹配数": 总匹配数, "是否截断": 是否截断}
            if 下页offset:
                元数据["下页偏移"] = 下页offset

            if 输出模式 == "files_with_matches":
                汇总 = f"找到 {匹配文件数} 个匹配文件"
                if 是否截断:
                    汇总 += f" [结果已截断，下页offset={下页offset}]"
                return 操作结果.成功(汇总 + "\n" + "\n".join(结果列表) if 结果列表 else "未找到匹配文件", 元数据=元数据)
            elif 输出模式 == "count":
                汇总 = f"共 {匹配文件数} 个文件，{总匹配数} 处匹配"
                if 是否截断:
                    汇总 += f" [下页offset={下页offset}]"
                return 操作结果.成功(汇总 + "\n" + "\n".join(结果列表) if 结果列表 else "未找到匹配", 元数据=元数据)
            else:
                if not 结果列表:
                    return 操作结果.成功(f"未找到包含「{关键词}」的内容", 元数据=元数据)
                汇总 = f"找到 {总匹配数} 处匹配 (在{匹配文件数}个文件中)"
                if 是否截断:
                    汇总 += f" [结果已截断，下页offset={下页offset}]"
                return 操作结果.成功(汇总 + "\n" + "\n".join(结果列表), 元数据=元数据)

        except Exception as e:
            return 操作结果.失败(f"搜索失败: {e}")


class Glob搜索(操作基类):
    名称 = "Glob搜索"
    描述 = "按glob模式快速查找文件，如 **/*.py 查找所有Python文件，支持递归和非递归"
    参数结构 = {
        "pattern": {"类型": "字符串", "必填": True, "说明": "glob模式，如 **/*.py, *.json, src/**/*.ts"},
        "路径": {"类型": "字符串", "必填": False, "说明": "搜索目录，默认项目根目录"},
        "递归": {"类型": "布尔", "必填": False, "说明": "是否递归子目录，默认true"},
        "maxResults": {"类型": "整数", "必填": False, "说明": "最大返回路径数，默认100"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        pattern = 参数.get("pattern", "")
        if not pattern:
            return 操作结果.失败("pattern为空")
        搜索路径 = 参数.get("路径", "./")
        递归 = 参数.get("递归", True)
        maxResults = 参数.get("maxResults", 100) or 参数.get("max_results", 100)

        try:
            if self.文件管理器:
                基目录 = self.文件管理器._解析路径(搜索路径)
            else:
                基目录 = Path(搜索路径)

            跳过目录 = {"__pycache__", ".git", "node_modules", ".venv", "venv", ".idea", ".vscode", ".codely-cli"}

            if 递归:
                匹配列表 = list(基目录.rglob(pattern))
            else:
                匹配列表 = list(基目录.glob(pattern))

            过滤后 = []
            for p in 匹配列表:
                if not any(跳过名 in p.parts for 跳过名 in 跳过目录):
                    过滤后.append(p)

            过滤后.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)

            截断 = len(过滤后) > maxResults
            过滤后 = 过滤后[:maxResults]

            路径列表 = [str(p.relative_to(基目录)) for p in 过滤后 if p.is_file()]

            汇总 = f"找到 {len(路径列表)} 个文件"
            if 截断:
                汇总 += f" (总{len(匹配列表)}个，已截断至{maxResults})"
            if 路径列表:
                return 操作结果.成功(汇总 + "\n" + "\n".join(路径列表))
            else:
                return 操作结果.成功(f"未找到匹配 {pattern} 的文件")
        except Exception as e:
            return 操作结果.失败(f"Glob搜索失败: {e}")


class 验证代码(操作基类):
    名称 = "验证代码"
    描述 = "检查文件语法是否正确。支持: Python(.py)、JSON(.json)、JS(.js/.mjs)、TypeScript(.ts)、HTML(.html)、CSS(.css)、XML(.xml/.svg)、YAML(.yaml/.yml)、Shell(.sh)"
    参数结构 = {
        "路径": {"类型": "字符串", "必填": True, "说明": "要验证的文件路径"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        路径 = 参数.get("路径", "")
        if not 路径:
            return 操作结果.失败("路径为空")
        try:
            文件路径 = Path(路径) if not self.文件管理器 else self.文件管理器._解析路径(路径)
            if not 文件路径.exists():
                return 操作结果.失败(f"文件不存在: {路径}")
            后缀 = 文件路径.suffix.lower()

            if 后缀 == ".py":
                import py_compile
                try:
                    py_compile.compile(str(文件路径), doraise=True)
                    return 操作结果.成功(f"✅ Python语法检查通过: {路径}")
                except py_compile.PyCompileError as e:
                    return 操作结果.失败(f"❌ Python语法错误:\n{str(e)}")

            if 后缀 == ".json":
                try:
                    with open(文件路径, "r", encoding="utf-8") as f:
                        json.load(f)
                    return 操作结果.成功(f"✅ JSON格式正确: {路径}")
                except json.JSONDecodeError as e:
                    return 操作结果.失败(f"❌ JSON格式错误 (行{e.lineno} 列{e.colno}): {e.msg}")

            if 后缀 in (".js", ".mjs"):
                return self._验证外部工具("node", ["--check", str(文件路径)], 路径, "JavaScript")

            if 后缀 == ".ts":
                return self._验证外部工具("npx", ["tsc", "--noEmit", str(文件路径)], 路径, "TypeScript")

            if 后缀 == ".sh":
                return self._验证外部工具("bash", ["-n", str(文件路径)], 路径, "Shell")

            if 后缀 in (".xml", ".svg", ".xsd", ".xsl"):
                import xml.etree.ElementTree as ET
                try:
                    ET.parse(str(文件路径))
                    return 操作结果.成功(f"✅ XML格式正确: {路径}")
                except ET.ParseError as e:
                    return 操作结果.失败(f"❌ XML格式错误: {e}")

            if 后缀 == ".html":
                return self._验证HTML(文件路径, 路径)

            if 后缀 == ".css":
                return self._验证CSS(文件路径, 路径)

            if 后缀 in (".yaml", ".yml"):
                return self._验证YAML(文件路径, 路径)

            return 操作结果.成功(f"ℹ️ 文件类型{后缀}暂不支持验证: {路径}")
        except Exception as e:
            return 操作结果.失败(f"验证失败: {e}")

    def _验证外部工具(self, 工具名, 参数列表, 显示路径, 类型名):
        """用外部工具验证（工具不存在则提示）"""
        import shutil
        if not shutil.which(工具名) and 工具名 != "npx":
            return 操作结果.成功(f"ℹ️ 未安装{工具名}，跳过{类型名}验证: {显示路径}")
        try:
            结果 = subprocess.run([工具名] + 参数列表, capture_output=True, text=True,
                               timeout=30, encoding='utf-8', errors='replace')
            if 结果.returncode == 0:
                return 操作结果.成功(f"✅ {类型名}语法检查通过: {显示路径}")
            错误 = 结果.stderr.strip() if 结果.stderr else 结果.stdout.strip()
            return 操作结果.失败(f"❌ {类型名}语法错误:\n{错误[:500]}")
        except subprocess.TimeoutExpired:
            return 操作结果.失败(f"❌ {类型名}验证超时")
        except FileNotFoundError:
            return 操作结果.成功(f"ℹ️ 未安装{工具名}，跳过{类型名}验证: {显示路径}")

    def _验证HTML(self, 文件路径, 显示路径):
        """纯Python HTML标签匹配检查"""
        try:
            with open(文件路径, "r", encoding="utf-8", errors="ignore") as f:
                内容 = f.read()
            # 提取所有标签
            import re
            标签列表 = re.findall(r'<(/?)(\w+)[^>]*?(/?)>', 内容)
            栈 = []
            自闭合 = {"meta", "link", "br", "hr", "img", "input", "area", "base", "col", "embed", "source", "track", "wbr"}
            for 闭合, 标签名, 自闭 in 标签列表:
                标签名 = 标签名.lower()
                if 自闭 == "/" or 标签名 in 自闭合:
                    continue
                if 闭合 == "/":
                    if not 栈 or 栈[-1] != 标签名:
                        return 操作结果.失败(f"❌ HTML标签不匹配: </{标签名}> 无对应开标签")
                    栈.pop()
                else:
                    栈.append(标签名)
            if 栈:
                return 操作结果.失败(f"❌ HTML标签未闭合: <{栈[-1]}>")
            return 操作结果.成功(f"✅ HTML标签匹配检查通过: {显示路径}")
        except Exception as e:
            return 操作结果.失败(f"❌ HTML验证失败: {e}")

    def _验证CSS(self, 文件路径, 显示路径):
        """纯Python CSS括号匹配检查"""
        try:
            with open(文件路径, "r", encoding="utf-8", errors="ignore") as f:
                内容 = f.read()
            计数 = 0
            行号 = 1
            for char in 内容:
                if char == "{":
                    计数 += 1
                elif char == "}":
                    计数 -= 1
                    if 计数 < 0:
                        return 操作结果.失败(f"❌ CSS花括号不匹配: 多余的}}")
                elif char == "\n":
                    行号 += 1
            if 计数 != 0:
                return 操作结果.失败(f"❌ CSS花括号不匹配: {计数}个未闭合的{{")
            return 操作结果.成功(f"✅ CSS括号匹配检查通过: {显示路径}")
        except Exception as e:
            return 操作结果.失败(f"❌ CSS验证失败: {e}")

    def _验证YAML(self, 文件路径, 显示路径):
        """纯Python YAML基本缩进检查"""
        try:
            with open(文件路径, "r", encoding="utf-8", errors="ignore") as f:
                行列表 = f.readlines()
            前导空格栈 = [0]
            for i, 行 in enumerate(行列表, 1):
                if not 行.strip() or 行.strip().startswith("#"):
                    continue
                缩进 = len(行) - len(行.lstrip())
                if 缩进 % 2 != 0 and 缩进 > 0:
                    return 操作结果.失败(f"❌ YAML缩进错误(行{i}): 缩进{缩进}不是2的倍数")
                while 缩进 < 前导空格栈[-1]:
                    前导空格栈.pop()
                if 缩进 > 前导空格栈[-1]:
                    前导空格栈.append(缩进)
            return 操作结果.成功(f"✅ YAML基本格式检查通过: {显示路径}")
        except Exception as e:
            return 操作结果.失败(f"❌ YAML验证失败: {e}")


class 自动测试(操作基类):
    名称 = "自动测试"
    描述 = "自动检测项目类型并运行对应测试命令（npm test/pytest/cargo test/go test等），也可手动指定测试命令"
    参数结构 = {
        "路径": {"类型": "字符串", "必填": False, "说明": "项目目录，默认项目根目录"},
        "命令": {"类型": "字符串", "必填": False, "说明": "手动指定测试命令，覆盖自动检测"},
        "超时秒数": {"类型": "整数", "必填": False, "说明": "测试超时时间，默认120秒"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        项目路径 = 参数.get("路径", "./")
        手动命令 = 参数.get("命令", "")
        超时 = 参数.get("超时秒数", 120)
        工作目录 = str(self.文件管理器._解析路径(项目路径)) if self.文件管理器 else 项目路径
        工作目录路径 = Path(工作目录)

        if 手动命令:
            命令 = 手动命令
            检测信息 = "手动指定"
        else:
            检测结果 = self._检测测试命令(工作目录路径)
            if not 检测结果:
                return 操作结果.失败("未检测到项目测试配置，请手动指定命令参数")
            命令 = 检测结果["命令"]
            检测信息 = 检测结果["类型"]

        try:
            结果 = subprocess.run(命令, shell=True, capture_output=True, text=True,
                               timeout=超时, cwd=工作目录, encoding='utf-8', errors='replace')
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            错误 = 结果.stderr.strip() if 结果.stderr else ""
            汇总 = f"[{检测信息}] 运行: {命令}\n退出码: {结果.returncode}\n"
            if 输出:
                汇总 += f"\n--- stdout ---\n{输出[-3000:]}"
            if 错误:
                汇总 += f"\n--- stderr ---\n{错误[-2000:]}"
            if 结果.returncode == 0:
                return 操作结果.成功(f"✅ 测试通过\n{汇总}")
            else:
                return 操作结果.失败(f"❌ 测试失败\n{汇总}")
        except subprocess.TimeoutExpired:
            return 操作结果.失败(f"测试超时({超时}秒)，命令: {命令}")
        except Exception as e:
            return 操作结果.失败(f"测试执行异常: {e}")

    def _检测测试命令(self, 项目目录: Path) -> dict:
        """检测项目类型并返回测试命令"""
        if (项目目录 / "package.json").exists():
            return {"类型": "Node.js", "命令": "npm test"}
        if (项目目录 / "pyproject.toml").exists() or (项目目录 / "pytest.ini").exists():
            return {"类型": "Python(pytest)", "命令": "python -m pytest"}
        if (项目目录 / "requirements.txt").exists() or (项目目录 / "setup.py").exists():
            return {"类型": "Python(pytest)", "命令": "python -m pytest"}
        if (项目目录 / "Cargo.toml").exists():
            return {"类型": "Rust", "命令": "cargo test"}
        if (项目目录 / "go.mod").exists():
            return {"类型": "Go", "命令": "go test ./..."}
        if (项目目录 / "pom.xml").exists():
            return {"类型": "Maven", "命令": "mvn test"}
        if (项目目录 / "build.gradle").exists():
            return {"类型": "Gradle", "命令": "gradle test"}
        if (项目目录 / "Makefile").exists():
            return {"类型": "Make", "命令": "make test"}
        for f in 项目目录.glob("*.csproj"):
            return {"类型": ".NET", "命令": "dotnet test"}
        return None


class 构建验证(操作基类):
    名称 = "构建验证"
    描述 = "自动检测项目类型并运行lint/类型检查(tsc/ruff/eslint/cargo check等)，也可手动指定验证命令"
    参数结构 = {
        "路径": {"类型": "字符串", "必填": False, "说明": "项目目录，默认项目根目录"},
        "命令": {"类型": "字符串", "必填": False, "说明": "手动指定验证命令，覆盖自动检测"},
        "超时秒数": {"类型": "整数", "必填": False, "说明": "验证超时时间，默认60秒"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        项目路径 = 参数.get("路径", "./")
        手动命令 = 参数.get("命令", "")
        超时 = 参数.get("超时秒数", 60)
        工作目录 = str(self.文件管理器._解析路径(项目路径)) if self.文件管理器 else 项目路径
        工作目录路径 = Path(工作目录)

        if 手动命令:
            命令 = 手动命令
            检测信息 = "手动指定"
        else:
            检测结果 = self._检测验证命令(工作目录路径)
            if not 检测结果:
                return 操作结果.失败("未检测到项目lint/类型检查配置，请手动指定命令参数")
            命令 = 检测结果["命令"]
            检测信息 = 检测结果["类型"]

        try:
            结果 = subprocess.run(命令, shell=True, capture_output=True, text=True,
                               timeout=超时, cwd=工作目录, encoding='utf-8', errors='replace')
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            错误 = 结果.stderr.strip() if 结果.stderr else ""
            汇总 = f"[{检测信息}] 运行: {命令}\n退出码: {结果.returncode}\n"
            if 输出:
                汇总 += f"\n--- stdout ---\n{输出[-3000:]}"
            if 错误:
                汇总 += f"\n--- stderr ---\n{错误[-2000:]}"
            if 结果.returncode == 0:
                return 操作结果.成功(f"✅ 验证通过\n{汇总}")
            else:
                return 操作结果.失败(f"❌ 验证失败\n{汇总}")
        except subprocess.TimeoutExpired:
            return 操作结果.失败(f"验证超时({超时}秒)，命令: {命令}")
        except Exception as e:
            return 操作结果.失败(f"验证执行异常: {e}")

    def _检测验证命令(self, 项目目录: Path) -> dict:
        """检测项目类型并返回lint/类型检查命令"""
        if (项目目录 / "tsconfig.json").exists():
            return {"类型": "TypeScript", "命令": "npx tsc --noEmit"}
        if (项目目录 / "package.json").exists():
            return {"类型": "JavaScript", "命令": "npx eslint ."}
        if (项目目录 / "pyproject.toml").exists() or (项目目录 / "ruff.toml").exists():
            return {"类型": "Python(ruff)", "命令": "python -m ruff check ."}
        if (项目目录 / "requirements.txt").exists() or (项目目录 / "setup.py").exists():
            return {"类型": "Python(compile)", "命令": "python -m py_compile *.py"}
        if (项目目录 / "Cargo.toml").exists():
            return {"类型": "Rust", "命令": "cargo check"}
        if (项目目录 / "go.mod").exists():
            return {"类型": "Go", "命令": "go vet ./..."}
        return None


class 文件符号(操作基类):
    名称 = "文件符号"
    描述 = "列出文件中所有函数/类/方法及行号签名（类似LSP documentSymbol）。不读文件内容，零token浪费，直接获取结构"
    参数结构 = {
        "路径": {"类型": "字符串", "必填": True, "说明": "文件路径"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        路径 = 参数.get("路径", "")
        if not 路径:
            return 操作结果.失败("路径为空")
        try:
            引擎 = _获取符号引擎实例(self.文件管理器)
            if not 引擎:
                return 操作结果.失败("符号引擎初始化失败")
            符号列表 = 引擎.文件符号(路径)
            if not 符号列表:
                return 操作结果.成功("未找到符号（可能不是代码文件或解析失败）")
            行列表 = []
            for s in 符号列表:
                所属 = f" (类:{s['所属类']})" if s.get("所属类") else ""
                行列表.append(f"  {s['类型']:4s} L{s['行号']:4d}  {s['名称']}{s.get('签名', '')}{所属}")
            return 操作结果.成功(f"共{len(符号列表)}个符号:\n" + "\n".join(行列表))
        except Exception as e:
            return 操作结果.失败(f"文件符号查询失败: {e}")


class 符号搜索(操作基类):
    名称 = "符号搜索"
    描述 = "在整个项目中搜索符号名（函数/类/方法），返回定义位置（类似LSP workspaceSymbol）。比搜索代码更精确，只返回定义不返回引用"
    参数结构 = {
        "符号名": {"类型": "字符串", "必填": True, "说明": "要搜索的符号名（支持模糊匹配）"},
        "路径": {"类型": "字符串", "必填": False, "说明": "搜索目录，默认项目根目录"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        符号名 = 参数.get("符号名", "")
        if not 符号名:
            return 操作结果.失败("符号名为空")
        搜索路径 = 参数.get("路径", "")
        if not 搜索路径 and self.文件管理器:
            搜索路径 = str(self.文件管理器.项目根目录)
        if not 搜索路径:
            搜索路径 = "./"
        try:
            引擎 = _获取符号引擎实例(self.文件管理器)
            if not 引擎:
                return 操作结果.失败("符号引擎初始化失败")
            结果 = 引擎.符号搜索(符号名, 搜索路径)
            if not 结果:
                return 操作结果.成功(f"未找到符号: {符号名}")
            行列表 = []
            for r in 结果:
                行列表.append(f"  {r['类型']:4s} {r['文件']}:{r['行号']}  {r['名称']}{r.get('签名', '')}")
            return 操作结果.成功(f"找到{len(结果)}个匹配:\n" + "\n".join(行列表))
        except Exception as e:
            return 操作结果.失败(f"符号搜索失败: {e}")


class 查找引用(操作基类):
    名称 = "查找引用"
    描述 = "在项目中查找符号的所有引用处（类似LSP findReferences）。返回文件:行号:行内容"
    参数结构 = {
        "符号名": {"类型": "字符串", "必填": True, "说明": "要查找引用的符号名"},
        "路径": {"类型": "字符串", "必填": False, "说明": "搜索目录，默认项目根目录"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        符号名 = 参数.get("符号名", "")
        if not 符号名:
            return 操作结果.失败("符号名为空")
        搜索路径 = 参数.get("路径", "")
        if not 搜索路径 and self.文件管理器:
            搜索路径 = str(self.文件管理器.项目根目录)
        if not 搜索路径:
            搜索路径 = "./"
        try:
            引擎 = _获取符号引擎实例(self.文件管理器)
            if not 引擎:
                return 操作结果.失败("符号引擎初始化失败")
            结果 = 引擎.查找引用(符号名, 搜索路径)
            if not 结果:
                return 操作结果.成功(f"未找到引用: {符号名}")
            行列表 = []
            for r in 结果[:50]:
                行列表.append(f"  {r['文件']}:{r['行号']}: {r['行内容']}")
            摘要 = f"找到{len(结果)}处引用" + (f"（仅显示前50处）" if len(结果) > 50 else "")
            return 操作结果.成功(摘要 + "\n" + "\n".join(行列表))
        except Exception as e:
            return 操作结果.失败(f"查找引用失败: {e}")


class 代码分析(操作基类):
    名称 = "代码分析"
    描述 = "分析Python文件的代码质量：未使用导入、未使用函数、圈复杂度、最大嵌套深度。纯AST实现，零外部依赖"
    参数结构 = {
        "路径": {"类型": "字符串", "必填": True, "说明": "要分析的Python文件路径"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        路径 = 参数.get("路径", "")
        if not 路径:
            return 操作结果.失败("路径为空")
        try:
            文件路径 = Path(路径) if not self.文件管理器 else self.文件管理器._解析路径(路径)
            if not 文件路径.exists():
                return 操作结果.失败(f"文件不存在: {路径}")
            if 文件路径.suffix.lower() != ".py":
                return 操作结果.失败("代码分析目前仅支持Python(.py)文件")
            with open(文件路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            树 = ast.parse(源码, filename=str(文件路径))

            报告 = []

            # 1. 未使用导入检测
            导入名集 = {}
            for 节点 in ast.walk(树):
                if isinstance(节点, ast.Import):
                    for 别名 in 节点.names:
                        名 = 别名.asname or 别名.name.split(".")[0]
                        导入名集[名] = 节点.lineno
                elif isinstance(节点, ast.ImportFrom):
                    for 别名 in 节点.names:
                        名 = 别名.asname or 别名.name
                        导入名集[名] = 节点.lineno
            # 检查每个导入名是否在源码中被引用（排除导入行本身）
            未使用导入 = []
            for 名, 行号 in 导入名集.items():
                # 简单检查：名字是否在源码其他行出现
                引用数 = sum(1 for line in 源码.split("\n") if 名 in line) - 1
                if 引用数 <= 0:
                    未使用导入.append(f"  L{行号}: {名}")
            if 未使用导入:
                报告.append(f"📌 未使用导入({len(未使用导入)}):")
                报告.extend(未使用导入)
            else:
                报告.append("✅ 无未使用导入")

            # 2. 未使用函数检测
            函数名集 = {}
            for 节点 in ast.walk(树):
                if isinstance(节点, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    函数名集[节点.name] = 节点.lineno
            未使用函数 = []
            for 名, 行号 in 函数名集.items():
                # 排除__init__等特殊方法
                if 名.startswith("__") and 名.endswith("__"):
                    continue
                引用数 = sum(1 for line in 源码.split("\n") if 名 in line) - 1
                if 引用数 <= 0:
                    未使用函数.append(f"  L{行号}: {名}()")
            if 未使用函数:
                报告.append(f"\n📌 未使用函数({len(未使用函数)}):")
                报告.extend(未使用函数)
            else:
                报告.append("\n✅ 无未使用函数")

            # 3. 圈复杂度（统计if/for/while/and/or/elif/try/except）
            复杂度 = 0
            for 节点 in ast.walk(树):
                if isinstance(节点, (ast.If, ast.For, ast.AsyncFor, ast.While,
                                     ast.ExceptHandler)):
                    复杂度 += 1
                elif isinstance(节点, ast.BoolOp):
                    复杂度 += len(节点.values) - 1
            报告.append(f"\n📊 圈复杂度: {复杂度}")
            if 复杂度 > 15:
                报告.append("  ⚠️ 复杂度偏高(>15)，建议拆分函数")
            elif 复杂度 > 10:
                报告.append("  ⚠️ 复杂度中等(>10)，可考虑优化")

            # 4. 最大嵌套深度
            最大嵌套 = 0
            def 计算嵌套(节点, 当前深度=0):
                nonlocal 最大嵌套
                最大嵌套 = max(最大嵌套, 当前深度)
                for 子 in ast.iter_child_nodes(节点):
                    if isinstance(子, (ast.If, ast.For, ast.AsyncFor, ast.While,
                                       ast.With, ast.AsyncWith, ast.Try,
                                       ast.ExceptHandler, ast.FunctionDef,
                                       ast.AsyncFunctionDef, ast.ClassDef)):
                        计算嵌套(子, 当前深度 + 1)
                    else:
                        计算嵌套(子, 当前深度)
            计算嵌套(树)
            报告.append(f"📊 最大嵌套深度: {最大嵌套}")
            if 最大嵌套 > 5:
                报告.append("  ⚠️ 嵌套过深(>5)，建议提取子函数")

            return 操作结果.成功("\n".join(报告), 元数据={
                "操作类型": "代码分析", "路径": 路径,
                "未使用导入数": len(未使用导入),
                "未使用函数数": len(未使用函数),
                "圈复杂度": 复杂度,
                "最大嵌套深度": 最大嵌套
            })
        except SyntaxError as e:
            return 操作结果.失败(f"语法错误，无法分析: {e}")
        except Exception as e:
            return 操作结果.失败(f"代码分析失败: {e}")


class 代码差异(操作基类):
    名称 = "代码差异"
    描述 = "比较两个文件的差异或文件与文本的差异，输出unified diff格式。用于替换前预览变更"
    参数结构 = {
        "旧文件路径": {"类型": "字符串", "必填": True, "说明": "旧文件路径（变更前）"},
        "新文件路径": {"类型": "字符串", "必填": False, "说明": "新文件路径（变更后）。不填则用新内容参数"},
        "新内容": {"类型": "字符串", "必填": False, "说明": "变更后的文本内容（当不需要写文件时使用）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        import difflib
        旧路径 = 参数.get("旧文件路径", "")
        新路径 = 参数.get("新文件路径", "")
        新内容 = 参数.get("新内容", "")
        if not 旧路径:
            return 操作结果.失败("旧文件路径为空")
        if not 新路径 and not 新内容:
            return 操作结果.失败("需要指定新文件路径或新内容")
        try:
            解析旧路径 = self.文件管理器._解析路径(旧路径) if self.文件管理器 else Path(旧路径)
            with open(解析旧路径, "r", encoding="utf-8", errors="ignore") as f:
                旧行列表 = f.readlines()
            if 新路径:
                解析新路径 = self.文件管理器._解析路径(新路径) if self.文件管理器 else Path(新路径)
                with open(解析新路径, "r", encoding="utf-8", errors="ignore") as f:
                    新行列表 = f.readlines()
            else:
                新行列表 = 新内容.splitlines(keepends=True)

            差异 = list(difflib.unified_diff(
                旧行列表, 新行列表,
                fromfile=str(旧路径), tofile=新路径 or "(内存内容)",
                lineterm=""
            ))
            if not 差异:
                return 操作结果.成功("无差异（两文件内容相同）")
            差异文本 = "\n".join(差异)
            增加行 = sum(1 for l in 差异 if l.startswith("+") and not l.startswith("+++"))
            删除行 = sum(1 for l in 差异 if l.startswith("-") and not l.startswith("---"))
            摘要 = f"差异: +{增加行}行 -{删除行}行\n\n{差异文本}"
            return 操作结果.成功(摘要, 元数据={
                "操作类型": "代码差异", "增加行": 增加行, "删除行": 删除行
            })
        except FileNotFoundError as e:
            return 操作结果.失败(f"文件不存在: {e}")
        except Exception as e:
            return 操作结果.失败(f"代码差异失败: {e}")
