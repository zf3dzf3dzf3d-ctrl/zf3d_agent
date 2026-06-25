"""
技能加载器 — 扫描技能目录，解析SKILL.md，注入指令到提示词，包装脚本为操作

兼容主流 Skill 格式（Codely CLI / Claude Code 生态）：
    skill-name/
    ├── SKILL.md          # 必须：YAML头(name+description) + Markdown指令体
    ├── scripts/          # 可选：可执行脚本(.py/.cjs/.sh)
    ├── references/       # 可选：参考文档(.md)
    └── assets/           # 可选：资源文件

也支持 .skill / .zip 文件（自动解压到同名目录）。

用法：
    加载器 = 技能加载器类()
    加载器.扫描加载("公共区/技能", 注册目标=操作注册中心)

    # 对话时根据用户消息匹配技能
    指令 = 加载器.获取技能指令("帮我处理PDF")
    if 指令:
        # 注入到系统提示词
"""
import os
import re
import sys
import json
import zipfile
import subprocess
from pathlib import Path


class 技能信息:
    """单个技能的元数据"""
    def __init__(self):
        self.名称 = ""
        self.描述 = ""
        self.指令体 = ""        # SKILL.md 的 Markdown 正文
        self.目录 = None         # Path 对象
        self.脚本列表 = []       # [Path, ...]
        self.参考文档列表 = []   # [Path, ...]
        self.关键词 = []         # 从描述提取的触发关键词


class 技能脚本操作包装器:
    """将技能 scripts/ 下的脚本包装为操作基类子类的动态工厂"""

    @staticmethod
    def 创建(脚本路径: Path, 技能名: str, 操作注册中心=None):
        """从脚本文件创建一个操作基类子类实例"""
        from 操作基类 import 操作基类, 操作结果

        脚本名 = 脚本路径.stem
        操作名 = f"{技能名}_{脚本名}"

        # 解析脚本头部注释提取参数定义
        参数结构 = {}
        try:
            with open(脚本路径, "r", encoding="utf-8", errors="replace") as f:
                头部 = f.read(2048)
            # 约定格式: # @param 参数名 类型 必填 说明
            for match in re.finditer(
                r'#\s*@param\s+(\S+)\s+(\S+)\s+(必填|可选)\s*(.*)', 头部
            ):
                参数名, 类型, 必填文本, 说明 = match.groups()
                参数结构[参数名] = {
                    "类型": 类型,
                    "必填": 必填文本 == "必填",
                    "说明": 说明.strip()
                }
        except Exception:
            pass

        # 确定执行器
        后缀 = 脚本路径.suffix.lower()
        if 后缀 == ".py":
            执行器 = "python"
        elif 后缀 in (".cjs", ".js"):
            执行器 = "node"
        elif 后缀 in (".sh", ".bash"):
            执行器 = "bash"
        else:
            return None

        # 动态创建操作子类
        class 包装操作(操作基类):
            pass

        包装操作.名称 = 操作名
        包装操作.描述 = f"技能[{技能名}]脚本: {脚本名}"
        包装操作.参数结构 = 参数结构

        def 执行(self, 参数: dict) -> 操作结果:
            try:
                # 构建命令
                if 执行器 == "python":
                    命令 = [sys.executable, str(脚本路径)]
                elif 执行器 == "node":
                    命令 = ["node", str(脚本路径)]
                else:
                    命令 = ["bash", str(脚本路径)]

                # 参数通过命令行参数传递: --参数名 值
                for 键, 值 in 参数.items():
                    命令.extend([f"--{键}", str(值)])

                # 也通过环境变量传递（方便脚本读取）
                环境变量 = dict(os.environ)
                for 键, 值 in 参数.items():
                    环境变量[f"SKILL_PARAM_{键}"] = str(值)

                结果 = subprocess.run(
                    命令,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    encoding="utf-8",
                    errors="replace",
                    env=环境变量
                )

                if 结果.returncode == 0:
                    return 操作结果.成功(
                        结果.stdout.strip() or "(脚本执行成功，无输出)",
                        元数据={"操作类型": f"技能脚本[{操作名}]", "脚本": str(脚本路径)}
                    )
                else:
                    return 操作结果.失败(
                        f"脚本失败(退出码{结果.returncode}): {结果.stderr or 结果.stdout}"
                    )
            except subprocess.TimeoutExpired:
                return 操作结果.失败("脚本执行超时(60秒)")
            except Exception as e:
                return 操作结果.失败(f"脚本执行异常: {e}")

        包装操作.执行 = 执行

        实例 = 包装操作()
        if 操作注册中心:
            操作注册中心.注册(实例)
            # 注册英文映射
            英文名 = f"skill_{技能名}_{脚本名}".replace("-", "_").lower()
            操作注册中心._英文名映射[操作名] = 英文名
            操作注册中心._英文反查[英文名] = 操作名

        return 实例


class 技能加载器类:
    """扫描技能目录，加载技能，提供指令注入"""

    def __init__(self):
        self.已加载技能 = {}      # 名称 → 技能信息
        self.技能目录 = None      # Path 对象

    def 扫描加载(self, 目录路径: str, 注册目标=None) -> list:
        """扫描目录，加载所有技能

        参数:
            目录路径: 技能目录路径
            注册目标: 操作注册中心实例

        返回: 加载成功的技能信息列表
        """
        self.技能目录 = Path(目录路径)
        if not self.技能目录.exists():
            self.技能目录.mkdir(parents=True, exist_ok=True)
            print(f"   ℹ️ 技能目录已创建: {目录路径}")
            return []

        加载列表 = []

        # 先处理 .skill / .zip 文件（解压）
        for 压缩包 in sorted(self.技能目录.glob("*.skill")) + sorted(self.技能目录.glob("*.zip")):
            解压目录 = 压缩包.parent / 压缩包.stem
            if not 解压目录.exists():
                try:
                    with zipfile.ZipFile(压缩包, "r") as zf:
                        zf.extractall(解压目录)
                    print(f"   📦 技能包 [{压缩包.name}] 已解压")
                except Exception as e:
                    print(f"   ❌ 技能包 [{压缩包.name}] 解压失败: {e}")
                    continue

        # 扫描子目录（每个子目录是一个技能）
        for 子目录 in sorted(self.技能目录.iterdir()):
            if not 子目录.is_dir():
                continue
            if 子目录.name.startswith("_") or 子目录.name.startswith("."):
                continue

            skill_md = 子目录 / "SKILL.md"
            if not skill_md.exists():
                # 检查是否是嵌套结构（解压后多一层）
                内层 = list(子目录.glob("*/SKILL.md"))
                if 内层:
                    skill_md = 内层[0]
                    子目录 = skill_md.parent
                else:
                    continue

            技能 = self._解析技能(skill_md, 子目录)
            if 技能:
                self.已加载技能[技能.名称] = 技能
                加载列表.append(技能)

                # 加载脚本
                脚本数 = 0
                脚本目录 = 子目录 / "scripts"
                if 脚本目录.exists():
                    for 脚本 in sorted(脚本目录.iterdir()):
                        if 脚本.is_file() and 脚本.suffix in (".py", ".cjs", ".js", ".sh", ".bash"):
                            技能.脚本列表.append(脚本)
                            if 注册目标:
                                实例 = 技能脚本操作包装器.创建(脚本, 技能.名称, 注册目标)
                                if 实例:
                                    脚本数 += 1

                # 记录参考文档
                参考目录 = 子目录 / "references"
                if 参考目录.exists():
                    技能.参考文档列表 = sorted(参考目录.glob("*.md"))

                脚本信息 = f"，{脚本数}个脚本" if 脚本数 else ""
                print(f"   🎓 技能 [{技能.名称}] 已加载{脚本信息}")

        if 加载列表:
            print(f"   ✅ 技能加载完成: 共 {len(加载列表)} 个技能")
        else:
            print(f"   ℹ️ 技能目录无可用技能: {目录路径}")

        return 加载列表

    def _解析技能(self, skill_md路径: Path, 技能目录: Path) -> 技能信息:
        """解析 SKILL.md 文件"""
        try:
            with open(skill_md路径, "r", encoding="utf-8", errors="replace") as f:
                内容 = f.read()
        except Exception as e:
            print(f"   ❌ 技能 [{技能目录.name}] 读取失败: {e}")
            return None

        技能 = 技能信息()
        技能.目录 = 技能目录

        # 解析 YAML frontmatter（--- 包裹的部分）
        frontmatter匹配 = re.match(r'^---\s*\n(.*?)\n---\s*\n?(.*)', 内容, re.DOTALL)
        if frontmatter匹配:
            yaml块 = frontmatter匹配.group(1)
            技能.指令体 = frontmatter匹配.group(2).strip()
            # 提取 name 和 description
            name匹配 = re.search(r'^name:\s*(.+?)$', yaml块, re.MULTILINE)
            desc匹配 = re.search(r'^description:\s*(.+?)(?:\n[a-z]|\Z)', yaml块, re.MULTILINE | re.DOTALL)
            技能.名称 = name匹配.group(1).strip().strip('"\'') if name匹配 else 技能目录.name
            技能.描述 = desc匹配.group(1).strip().strip('"\'') if desc匹配 else ""
        else:
            # 无 frontmatter，整个文件作为指令体
            技能.名称 = 技能目录.name
            技能.描述 = ""
            技能.指令体 = 内容.strip()

        # 从描述提取触发关键词
        技能.关键词 = self._提取关键词(技能.名称, 技能.描述)

        return 技能

    def _提取关键词(self, 名称: str, 描述: str) -> list:
        """从技能名称和描述中提取触发关键词"""
        关键词 = set()
        # 名称本身作为关键词（按 - 分拆）
        for 部分 in 名称.replace("_", "-").split("-"):
            if len(部分) >= 2:
                关键词.add(部分.lower())
        # 描述中提取有意义的词
        # 取描述前100字符，按空格/标点分词
        前100 = 描述[:200]
        for 词 in re.split(r'[\s,，。、；;：:（）()\[\]{}]+', 前100):
            词 = 词.strip().lower()
            if len(词) >= 2 and 词 not in ("the", "and", "for", "with", "use", "when", "this", "that", "from", "you", "your", "的", "了", "在", "和", "与"):
                关键词.add(词)
        return list(关键词)

    def 匹配技能(self, 用户消息: str) -> list:
        """根据用户消息匹配技能，返回匹配的技能信息列表"""
        if not self.已加载技能:
            return []

        消息小写 = 用户消息.lower()
        匹配列表 = []

        for 技能 in self.已加载技能.values():
            命中 = False
            for 词 in 技能.关键词:
                if 词 in 消息小写:
                    命中 = True
                    break
            if 命中:
                匹配列表.append(技能)

        return 匹配列表[:3]  # 最多返回3个

    def 获取技能指令(self, 用户消息: str) -> str:
        """获取匹配技能的指令文本，用于注入系统提示词"""
        匹配 = self.匹配技能(用户消息)
        if not 匹配:
            return ""

        部分 = []
        for 技能 in 匹配:
            指令 = f"### 技能: {技能.名称}\n"
            if 技能.描述:
                指令 += f"描述: {技能.描述}\n"
            指令 += f"\n{技能.指令体}"
            # 如果有参考文档，提示LLM可以读取
            if 技能.参考文档列表:
                文档名 = [f.name for f in 技能.参考文档列表]
                指令 += f"\n\n参考文档（可用读取文件操作查看）: {', '.join(文档名)}"
            部分.append(指令)

        return "\n\n---\n\n".join(部分)

    def 获取技能摘要(self) -> str:
        """获取所有已加载技能的摘要（始终注入提示词，让LLM知道有哪些技能可用）"""
        if not self.已加载技能:
            return ""

        行 = []
        for 技能 in self.已加载技能.values():
            描述截断 = 技能.描述[:80] + "..." if len(技能.描述) > 80 else 技能.描述
            行.append(f"- {技能.名称}: {描述截断}")

        return "\n".join(行)

    def 列出技能(self) -> list:
        """列出所有已加载技能"""
        return list(self.已加载技能.keys())
