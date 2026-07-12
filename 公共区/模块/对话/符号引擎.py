"""符号引擎 — 实时代码符号查询（类LSP）

不预生成索引文件，每次调用实时查询：
1. 文件符号(documentSymbol) — 列出文件中所有函数/类/方法+行号+签名
2. 符号搜索(workspaceSymbol) — 在整个项目中搜索符号名，返回定义位置
3. 查找引用(findReferences) — 在项目中搜索符号的所有引用处

设计原则：
- Python用AST精确提取，JS/ASP用正则近似
- 两级缓存：文件列表缓存(60s TTL) + 单文件符号缓存(30s TTL)
- 跳过 .git/node_modules/__pycache__ 等
"""
import os
import re
import ast
import time
from pathlib import Path


_跳过目录 = {"__pycache__", ".git", "node_modules", ".venv", "venv",
             ".idea", ".vscode", ".codely-cli", ".codely", ".pytest_cache",
             ".git-rewrite", "dist", "build"}
_代码后缀 = {".py", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".asp",
             ".go", ".rs", ".java", ".kt", ".cs", ".c", ".cpp", ".h", ".hpp",
             ".html", ".css", ".vue", ".svelte"}


class 符号引擎类:
    """实时符号查询引擎"""

    def __init__(self):
        # 文件列表缓存：{搜索路径: {"时间": float, "文件列表": list}}
        self._文件列表缓存 = {}
        self._文件列表TTL = 60  # 60秒后过期重新扫描
        # 单文件符号缓存：{文件路径: {"时间": float, "符号": list}}
        self._符号缓存 = {}
        self._符号缓存TTL = 30  # 30秒后过期

    def 文件符号(self, 文件路径: str) -> list:
        """列出文件中所有函数/类/方法+行号+签名（类似LSP documentSymbol）

        返回: [{"名称", "类型", "行号", "签名", "所属类"}]
        """
        路径 = Path(文件路径)
        if not 路径.exists() or not 路径.is_file():
            return []
        # 检查缓存
        缓存键 = str(路径.absolute())
        缓存 = self._符号缓存.get(缓存键)
        if 缓存 and time.time() - 缓存["时间"] < self._符号缓存TTL:
            return 缓存["符号"]
        # 解析
        后缀 = 路径.suffix.lower()
        if 后缀 == ".py":
            符号 = self._python文件符号(路径)
        elif 后缀 in (".js", ".mjs", ".jsx"):
            符号 = self._js文件符号(路径)
        elif 后缀 in (".ts", ".tsx"):
            符号 = self._ts文件符号(路径)
        elif 后缀 == ".asp":
            符号 = self._asp文件符号(路径)
        elif 后缀 == ".go":
            符号 = self._go文件符号(路径)
        elif 后缀 == ".rs":
            符号 = self._rust文件符号(路径)
        elif 后缀 in (".java", ".kt"):
            符号 = self._java文件符号(路径)
        elif 后缀 == ".cs":
            符号 = self._csharp文件符号(路径)
        elif 后缀 in (".c", ".cpp", ".h", ".hpp"):
            符号 = self._cpp文件符号(路径)
        elif 后缀 == ".css":
            符号 = self._css文件符号(路径)
        elif 后缀 == ".html":
            符号 = self._html文件符号(路径)
        elif 后缀 in (".vue", ".svelte"):
            符号 = self._js文件符号(路径)
        else:
            符号 = []
        self._符号缓存[缓存键] = {"时间": time.time(), "符号": 符号}
        return 符号

    def 符号搜索(self, 符号名: str, 搜索路径: str = "./") -> list:
        """在项目中搜索符号定义位置（类似LSP workspaceSymbol）

        返回: [{"名称", "类型", "文件", "行号", "签名"}]
        """
        if not 符号名:
            return []
        根 = self._解析路径(搜索路径)
        结果 = []
        文件列表 = self._获取文件列表(根)
        for 文件路径 in 文件列表:
            符号 = self.文件符号(str(文件路径))
            相对路径 = str(文件路径.relative_to(根)).replace("\\", "/") if 文件路径.is_relative_to(根) else str(文件路径)
            for s in 符号:
                if 符号名.lower() in s["名称"].lower():
                    结果.append({
                        "名称": s["名称"], "类型": s["类型"],
                        "文件": 相对路径, "行号": s["行号"],
                        "签名": s.get("签名", "")
                    })
            if len(结果) >= 50:
                break
        return 结果

    def 查找引用(self, 符号名: str, 搜索路径: str = "./") -> list:
        """在项目中搜索符号的所有引用处（类似LSP findReferences）

        返回: [{"文件", "行号", "行内容"}]
        """
        if not 符号名:
            return []
        根 = self._解析路径(搜索路径)
        结果 = []
        模式 = re.compile(r'\b' + re.escape(符号名) + r'\b')
        文件列表 = self._获取文件列表(根)
        for 文件路径 in 文件列表:
            try:
                with open(文件路径, "r", encoding="utf-8", errors="ignore") as f:
                    行列表 = f.readlines()
            except (PermissionError, OSError):
                continue
            相对路径 = str(文件路径.relative_to(根)).replace("\\", "/") if 文件路径.is_relative_to(根) else str(文件路径)
            for 行号, 行内容 in enumerate(行列表, 1):
                if 模式.search(行内容):
                    结果.append({
                        "文件": 相对路径,
                        "行号": 行号,
                        "行内容": 行内容.rstrip()[:200]
                    })
                    if len(结果) >= 100:
                        return 结果
        return 结果

    def _解析路径(self, 搜索路径: str) -> Path:
        根 = Path(搜索路径)
        if not 根.exists():
            根 = Path("./")
        return 根

    def _获取文件列表(self, 根: Path) -> list:
        """获取代码文件列表（带60秒缓存）"""
        缓存键 = str(根.absolute())
        缓存 = self._文件列表缓存.get(缓存键)
        if 缓存 and time.time() - 缓存["时间"] < self._文件列表TTL:
            return 缓存["文件列表"]
        # 重新扫描
        文件列表 = list(self._遍历代码文件(根))
        self._文件列表缓存[缓存键] = {"时间": time.time(), "文件列表": 文件列表}
        return 文件列表

    def _遍历代码文件(self, 根: Path):
        """遍历目录下所有代码文件"""
        for 目录根, 目录列表, 文件名列表 in os.walk(根):
            目录列表[:] = [d for d in 目录列表 if d not in _跳过目录]
            for 文件名 in 文件名列表:
                if Path(文件名).suffix.lower() in _代码后缀:
                    yield Path(目录根) / 文件名

    def _python文件符号(self, 路径: Path) -> list:
        """AST解析Python文件符号"""
        符号 = []
        try:
            with open(路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            树 = ast.parse(源码, filename=str(路径))
            for 节点 in ast.iter_child_nodes(树):
                if isinstance(节点, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    符号.append({
                        "名称": 节点.name, "类型": "函数",
                        "行号": 节点.lineno,
                        "签名": self._py签名(节点),
                        "所属类": ""
                    })
                elif isinstance(节点, ast.ClassDef):
                    符号.append({
                        "名称": 节点.name, "类型": "类",
                        "行号": 节点.lineno,
                        "签名": "", "所属类": ""
                    })
                    for 子节点 in ast.iter_child_nodes(节点):
                        if isinstance(子节点, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            符号.append({
                                "名称": 子节点.name, "类型": "方法",
                                "行号": 子节点.lineno,
                                "签名": self._py签名(子节点),
                                "所属类": 节点.name
                            })
        except Exception:
            pass
        return 符号

    def _py签名(self, 节点) -> str:
        try:
            参数 = [arg.arg for arg in 节点.args.args]
            return f"({', '.join(参数)})"
        except Exception:
            return ""

    def _js文件符号(self, 路径: Path) -> list:
        """正则提取JS符号"""
        符号 = []
        try:
            with open(路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            for m in re.finditer(r'function\s+(\w+)\s*\(([^)]*)\)', 源码):
                符号.append({"名称": m.group(1), "类型": "函数",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": f"({m.group(2)})", "所属类": ""})
            for m in re.finditer(r'(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>', 源码):
                符号.append({"名称": m.group(1), "类型": "函数",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": f"({m.group(2)})", "所属类": ""})
            for m in re.finditer(r'class\s+(\w+)', 源码):
                符号.append({"名称": m.group(1), "类型": "类",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
        except Exception:
            pass
        return 符号

    def _asp文件符号(self, 路径: Path) -> list:
        """正则提取ASP符号"""
        符号 = []
        try:
            with open(路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            for m in re.finditer(r'(?:Sub|Function)\s+(\w+)\s*\(([^)]*)\)', 源码, re.IGNORECASE):
                符号.append({"名称": m.group(1), "类型": "函数",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": f"({m.group(2)})", "所属类": ""})
        except Exception:
            pass
        return 符号

    def _ts文件符号(self, 路径: Path) -> list:
        """正则提取TypeScript符号"""
        符号 = []
        try:
            with open(路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            # 复用JS正则
            for m in re.finditer(r'function\s+(\w+)\s*\(([^)]*)\)', 源码):
                符号.append({"名称": m.group(1), "类型": "函数",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": f"({m.group(2)})", "所属类": ""})
            for m in re.finditer(r'(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*[:=>]', 源码):
                符号.append({"名称": m.group(1), "类型": "函数",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": f"({m.group(2)})", "所属类": ""})
            for m in re.finditer(r'class\s+(\w+)', 源码):
                符号.append({"名称": m.group(1), "类型": "类",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
            for m in re.finditer(r'(?:interface|type|enum|namespace)\s+(\w+)', 源码):
                符号.append({"名称": m.group(1), "类型": "类型",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
        except Exception:
            pass
        return 符号

    def _go文件符号(self, 路径: Path) -> list:
        """正则提取Go符号"""
        符号 = []
        try:
            with open(路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            for m in re.finditer(r'func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(([^)]*)\)', 源码):
                符号.append({"名称": m.group(1), "类型": "函数",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": f"({m.group(2)})", "所属类": ""})
            for m in re.finditer(r'type\s+(\w+)\s+struct', 源码):
                符号.append({"名称": m.group(1), "类型": "类",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
            for m in re.finditer(r'type\s+(\w+)\s+interface', 源码):
                符号.append({"名称": m.group(1), "类型": "接口",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
        except Exception:
            pass
        return 符号

    def _rust文件符号(self, 路径: Path) -> list:
        """正则提取Rust符号"""
        符号 = []
        try:
            with open(路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            for m in re.finditer(r'(?:pub\s+)?fn\s+(\w+)\s*\(([^)]*)\)', 源码):
                符号.append({"名称": m.group(1), "类型": "函数",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": f"({m.group(2)})", "所属类": ""})
            for m in re.finditer(r'(?:pub\s+)?struct\s+(\w+)', 源码):
                符号.append({"名称": m.group(1), "类型": "类",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
            for m in re.finditer(r'(?:pub\s+)?enum\s+(\w+)', 源码):
                符号.append({"名称": m.group(1), "类型": "枚举",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
            for m in re.finditer(r'(?:pub\s+)?trait\s+(\w+)', 源码):
                符号.append({"名称": m.group(1), "类型": "接口",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
            for m in re.finditer(r'impl\s+(\w+)', 源码):
                符号.append({"名称": m.group(1), "类型": "实现",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
        except Exception:
            pass
        return 符号

    def _java文件符号(self, 路径: Path) -> list:
        """正则提取Java/Kotlin符号"""
        符号 = []
        try:
            with open(路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            for m in re.finditer(r'(?:public|private|protected|static)?\s*(?:class|interface)\s+(\w+)', 源码):
                符号.append({"名称": m.group(1), "类型": "类",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
            for m in re.finditer(r'(?:public|private|protected)?\s*(?:static\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)', 源码):
                方法名 = m.group(1)
                if 方法名 not in ("if", "for", "while", "switch", "catch", "return"):
                    符号.append({"名称": 方法名, "类型": "方法",
                                 "行号": 源码[:m.start()].count('\n') + 1,
                                 "签名": f"({m.group(2)})", "所属类": ""})
        except Exception:
            pass
        return 符号

    def _csharp文件符号(self, 路径: Path) -> list:
        """正则提取C#符号"""
        return self._java文件符号(路径)

    def _cpp文件符号(self, 路径: Path) -> list:
        """正则提取C/C++符号"""
        符号 = []
        try:
            with open(路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            for m in re.finditer(r'(?:class|struct)\s+(\w+)', 源码):
                符号.append({"名称": m.group(1), "类型": "类",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
            for m in re.finditer(r'(?:\w+[\s\*]+)+(\w+)\s*\(([^)]*)\)\s*\{', 源码):
                方法名 = m.group(1)
                if 方法名 not in ("if", "for", "while", "switch", "catch", "return"):
                    符号.append({"名称": 方法名, "类型": "函数",
                                 "行号": 源码[:m.start()].count('\n') + 1,
                                 "签名": f"({m.group(2)})", "所属类": ""})
        except Exception:
            pass
        return 符号

    def _css文件符号(self, 路径: Path) -> list:
        """正则提取CSS选择器符号"""
        符号 = []
        try:
            with open(路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            for m in re.finditer(r'^([^{}]+)\s*\{', 源码, re.MULTILINE):
                选择器 = m.group(1).strip()
                if 选择器 and not 选择器.startswith("/*"):
                    符号.append({"名称": 选择器[:50], "类型": "选择器",
                                 "行号": 源码[:m.start()].count('\n') + 1,
                                 "签名": "", "所属类": ""})
        except Exception:
            pass
        return 符号

    def _html文件符号(self, 路径: Path) -> list:
        """正则提取HTML符号（id和script函数）"""
        符号 = []
        try:
            with open(路径, "r", encoding="utf-8", errors="ignore") as f:
                源码 = f.read()
            for m in re.finditer(r'id="([^"]+)"', 源码):
                符号.append({"名称": m.group(1), "类型": "ID",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": "", "所属类": ""})
            for m in re.finditer(r'function\s+(\w+)\s*\(([^)]*)\)', 源码):
                符号.append({"名称": m.group(1), "类型": "函数",
                             "行号": 源码[:m.start()].count('\n') + 1,
                             "签名": f"({m.group(2)})", "所属类": ""})
        except Exception:
            pass
        return 符号
