"""
代码操作模块 - 搜索代码/Glob搜索/符号搜索/验证代码/自动测试/构建验证
"""
import os
import re
import ast
import json
import subprocess
from pathlib import Path
from .基类 import 操作结果, 操作基类


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
        关键词 = 参数.get("关键词", "")
        if not 关键词:
            return 操作结果.失败("关键词为空")
        搜索路径 = 参数.get("路径", "./")
        后缀过滤 = 参数.get("后缀过滤", "")
        正则模式 = 参数.get("正则模式", False)
        忽略大小写 = 参数.get("忽略大小写", True)
        上下文行数 = 参数.get("上下文行数", 0)
        输出模式 = 参数.get("输出模式", "content")
        offset = 参数.get("offset", 0)
        maxResults = 参数.get("maxResults", 250)

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
        maxResults = 参数.get("maxResults", 100)

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


class 符号搜索(操作基类):
    名称 = "符号搜索"
    描述 = "在Python文件中搜索函数、类、变量等符号定义，使用ast模块解析（轻量LSP替代）"
    参数结构 = {
        "关键词": {"类型": "字符串", "必填": True, "说明": "符号名或关键词"},
        "路径": {"类型": "字符串", "必填": False, "说明": "搜索目录，默认项目根目录"},
        "符号类型": {"类型": "字符串", "必填": False, "说明": "函数/类/变量/导入/全部，默认全部"},
        "maxResults": {"类型": "整数", "必填": False, "说明": "最大返回结果数，默认100"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        关键词 = 参数.get("关键词", "")
        if not 关键词:
            return 操作结果.失败("关键词为空")
        搜索路径 = 参数.get("路径", "./")
        符号类型 = 参数.get("符号类型", "全部")
        maxResults = 参数.get("maxResults", 100)

        跳过目录 = {"__pycache__", ".git", "node_modules", ".venv", "venv", ".idea", ".vscode", ".codely-cli"}
        结果列表 = []

        try:
            if self.文件管理器:
                基目录 = self.文件管理器._解析路径(搜索路径)
            else:
                基目录 = Path(搜索路径)

            for 根, 目录列表, 文件列表 in os.walk(基目录):
                目录列表[:] = [d for d in 目录列表 if d not in 跳过目录]
                for 文件名 in 文件列表:
                    if not 文件名.endswith(".py"):
                        continue
                    文件完整路径 = os.path.join(根, 文件名)
                    相对路径 = os.path.relpath(文件完整路径, 基目录)
                    try:
                        with open(文件完整路径, "r", encoding="utf-8", errors="ignore") as f:
                            源码 = f.read()
                        树 = ast.parse(源码, filename=文件完整路径)
                    except (SyntaxError, ValueError, OSError):
                        continue

                    for 节点 in ast.walk(树):
                        名字 = ""
                        类型标签 = ""

                        if isinstance(节点, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            名字 = 节点.name
                            类型标签 = "函数"
                        elif isinstance(节点, ast.ClassDef):
                            名字 = 节点.name
                            类型标签 = "类"
                        elif isinstance(节点, ast.Import):
                            for 别名 in 节点.names:
                                名字 = 别名.asname or 别名.name
                                类型标签 = "导入"
                                if 关键词.lower() in 名字.lower():
                                    if 符号类型 == "全部" or 符号类型 == 类型标签:
                                        结果列表.append(f"📥 {相对路径}:{节点.lineno}: {类型标签} {名字}")
                                        if len(结果列表) >= maxResults:
                                            return 操作结果.成功(f"找到 {len(结果列表)} 个符号:\n" + "\n".join(结果列表))
                            continue
                        elif isinstance(节点, ast.ImportFrom):
                            模块名 = 节点.module or ""
                            for 别名 in 节点.names:
                                名字 = f"{模块名}.{别名.asname or 别名.name}"
                                类型标签 = "导入"
                                if 关键词.lower() in 名字.lower():
                                    if 符号类型 == "全部" or 符号类型 == 类型标签:
                                        结果列表.append(f"📥 {相对路径}:{节点.lineno}: {类型标签} {名字}")
                                        if len(结果列表) >= maxResults:
                                            return 操作结果.成功(f"找到 {len(结果列表)} 个符号:\n" + "\n".join(结果列表))
                            continue
                        elif isinstance(节点, ast.Assign):
                            for 目标 in 节点.targets:
                                if isinstance(目标, ast.Name):
                                    名字 = 目标.id
                                    类型标签 = "变量"

                        if 名字 and 关键词.lower() in 名字.lower():
                            if 符号类型 == "全部" or 符号类型 == 类型标签:
                                图标 = {"函数": "🔧", "类": "📦", "变量": "📌", "导入": "📥"}.get(类型标签, "📎")
                                结果列表.append(f"{图标} {相对路径}:{节点.lineno}: {类型标签} {名字}")
                                if len(结果列表) >= maxResults:
                                    return 操作结果.成功(f"找到 {len(结果列表)} 个符号:\n" + "\n".join(结果列表))

            if 结果列表:
                return 操作结果.成功(f"找到 {len(结果列表)} 个符号:\n" + "\n".join(结果列表))
            else:
                return 操作结果.成功(f"未找到包含「{关键词}」的符号")
        except Exception as e:
            return 操作结果.失败(f"符号搜索失败: {e}")


class 验证代码(操作基类):
    名称 = "验证代码"
    描述 = "检查文件语法是否正确（Python检查语法，JSON检查格式），返回错误详情"
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
            elif 后缀 == ".json":
                try:
                    with open(文件路径, "r", encoding="utf-8") as f:
                        json.load(f)
                    return 操作结果.成功(f"✅ JSON格式正确: {路径}")
                except json.JSONDecodeError as e:
                    return 操作结果.失败(f"❌ JSON格式错误 (行{e.lineno} 列{e.colno}): {e.msg}")
            else:
                return 操作结果.成功(f"ℹ️ 文件类型{后缀}无需验证: {路径}")
        except Exception as e:
            return 操作结果.失败(f"验证失败: {e}")


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
