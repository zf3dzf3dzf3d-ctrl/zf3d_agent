"""
Git操作模块 - 状态/提交/回滚/差异/日志/分支/推送/拉取/暂存/标签
🔒加密发布：含Git操作（push/pull/stash/tag），发布时建议PyArmor加密
"""
import subprocess
import os
from pathlib import Path
from .基类 import 操作结果, 操作基类


class Git状态(操作基类):
    名称 = "Git状态"
    描述 = "查看Git仓库状态，显示变更的文件列表"
    参数结构 = {}

    def 执行(self, 参数: dict) -> 操作结果:
        工作目录 = str(self.文件管理器.项目根目录) if self.文件管理器 else "."
        try:
            结果 = subprocess.run(
                ["git", "status", "--short"], shell=False, capture_output=True, text=True,
                timeout=10, cwd=工作目录, encoding='utf-8', errors='replace'
            )
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            if not 输出:
                return 操作结果.成功("工作区干净，无变更")
            return 操作结果.成功(输出)
        except Exception as e:
            return 操作结果.失败(f"Git状态失败: {e}")


class Git提交(操作基类):
    名称 = "Git提交"
    描述 = "将所有变更暂存并提交到Git"
    参数结构 = {
        "消息": {"类型": "字符串", "必填": True, "说明": "提交信息"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        提交消息 = 参数.get("消息", "")
        if not 提交消息:
            return 操作结果.失败("提交消息为空")
        工作目录 = str(self.文件管理器.项目根目录) if self.文件管理器 else "."
        try:
            subprocess.run(["git", "add", "-A"], shell=False, capture_output=True, text=True,
                          timeout=10, cwd=工作目录, encoding='utf-8', errors='replace')
            结果 = subprocess.run(
                ["git", "commit", "-m", 提交消息], shell=False, capture_output=True, text=True,
                timeout=10, cwd=工作目录, encoding='utf-8', errors='replace'
            )
            if 结果.returncode == 0:
                return 操作结果.成功(f"✅ 提交成功: {提交消息}")
            else:
                错误 = 结果.stderr.strip() if 结果.stderr else ""
                if "nothing to commit" in (结果.stdout or ""):
                    return 操作结果.成功("没有变更需要提交")
                return 操作结果.失败(f"提交失败: {错误}")
        except Exception as e:
            return 操作结果.失败(f"Git提交失败: {e}")


class Git回滚(操作基类):
    名称 = "Git回滚"
    描述 = "回滚文件到上次提交的状态（恢复未提交的修改）"
    参数结构 = {
        "路径": {"类型": "字符串", "必填": False, "说明": "要回滚的文件路径，留空则回滚所有变更"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        路径 = 参数.get("路径", "")
        工作目录 = str(self.文件管理器.项目根目录) if self.文件管理器 else "."
        try:
            状态检查 = subprocess.run(["git", "status", "--porcelain"], shell=False, capture_output=True,
                                       text=True, timeout=10, cwd=工作目录, encoding='utf-8', errors='replace')
            未提交文件 = 状态检查.stdout.strip() if 状态检查.returncode == 0 else ""
            if 未提交文件:
                文件列表 = [l.strip() for l in 未提交文件.split('\n') if l.strip()]
                if len(文件列表) <= 5:
                    提示 = "以下未提交的修改将被丢弃且不可恢复：\n" + "\n".join(文件列表)
                else:
                    提示 = f"共 {len(文件列表)} 个文件有未提交的修改，将被丢弃且不可恢复"
                if self.文件管理器:
                    self.文件管理器._记录审计("Git回滚", "警告", 提示)

            if 路径:
                文件路径 = self.文件管理器._解析路径(路径) if self.文件管理器 else Path(路径)
                相对路径 = os.path.relpath(文件路径, 工作目录)
                结果 = subprocess.run(["git", "checkout", "--", 相对路径], shell=False, capture_output=True, text=True,
                                   timeout=10, cwd=工作目录, encoding='utf-8', errors='replace')
                if 结果.returncode == 0:
                    return 操作结果.成功(f"✅ 已回滚: {路径}" + (f"\n⚠️ {提示}" if 未提交文件 else ""))
                return 操作结果.失败(f"回滚失败: {结果.stderr.strip()}")
            else:
                结果 = subprocess.run(["git", "checkout", "--", "."], shell=False, capture_output=True, text=True,
                                   timeout=10, cwd=工作目录, encoding='utf-8', errors='replace')
                if 结果.returncode == 0:
                    return 操作结果.成功("✅ 已回滚所有变更" + (f"\n⚠️ {提示}" if 未提交文件 else ""))
                return 操作结果.失败(f"回滚失败: {结果.stderr.strip()}")
        except Exception as e:
            return 操作结果.失败(f"Git回滚失败: {e}")


class Git差异(操作基类):
    名称 = "Git差异"
    描述 = "查看Git差异：工作区vs HEAD、已暂存变更、指定文件差异、与指定提交比较"
    参数结构 = {
        "模式": {"类型": "字符串", "必填": False, "说明": "working=工作区vs HEAD(默认) | staged=已暂存变更 | file=指定文件 | commit=与指定提交比较"},
        "文件路径": {"类型": "字符串", "必填": False, "说明": "模式为file时指定文件路径"},
        "提交": {"类型": "字符串", "必填": False, "说明": "模式为commit时指定提交hash或分支名"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        模式 = 参数.get("模式", "working")
        工作目录 = str(self.文件管理器.项目根目录) if self.文件管理器 else "."
        try:
            if 模式 == "staged":
                cmd = ["git", "diff", "--staged"]
            elif 模式 == "file":
                文件路径 = 参数.get("文件路径", "")
                if not 文件路径:
                    return 操作结果.失败("file模式需要指定文件路径")
                解析路径 = self.文件管理器._解析路径(文件路径) if self.文件管理器 else Path(文件路径)
                相对路径 = os.path.relpath(解析路径, 工作目录)
                cmd = ["git", "diff", "--", 相对路径]
            elif 模式 == "commit":
                提交 = 参数.get("提交", "")
                if not 提交:
                    return 操作结果.失败("commit模式需要指定提交hash或分支名")
                cmd = ["git", "diff", 提交]
            else:
                cmd = ["git", "diff", "HEAD"]

            结果 = subprocess.run(cmd, shell=False, capture_output=True, text=True,
                               timeout=15, cwd=工作目录, encoding='utf-8', errors='replace')
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            if not 输出:
                return 操作结果.成功("无差异（工作区与HEAD一致）")
            return 操作结果.成功(输出)
        except Exception as e:
            return 操作结果.失败(f"Git差异失败: {e}")


class Git日志(操作基类):
    名称 = "Git日志"
    描述 = "查看Git提交历史日志，支持多种格式"
    参数结构 = {
        "数量": {"类型": "整数", "必填": False, "说明": "显示最近N条提交，默认10"},
        "格式": {"类型": "字符串", "必填": False, "说明": "oneline=一行格式(默认) | full=完整格式 | stat=含变更文件统计"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        数量 = 参数.get("数量", 10)
        if not isinstance(数量, int) or 数量 < 1:
            数量 = 10
        格式 = 参数.get("格式", "oneline")
        工作目录 = str(self.文件管理器.项目根目录) if self.文件管理器 else "."
        try:
            if 格式 == "full":
                cmd = ["git", "log", f"-{数量}", "--format=%H%n%an <%ae>%n%ai%n%n%s%n%b%n---"]
            elif 格式 == "stat":
                cmd = ["git", "log", f"-{数量}", "--oneline", "--stat"]
            else:
                cmd = ["git", "log", f"-{数量}", "--oneline"]

            结果 = subprocess.run(cmd, shell=False, capture_output=True, text=True,
                               timeout=10, cwd=工作目录, encoding='utf-8', errors='replace')
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            if not 输出:
                return 操作结果.成功("无提交历史")
            return 操作结果.成功(输出)
        except Exception as e:
            return 操作结果.失败(f"Git日志失败: {e}")


class Git分支(操作基类):
    名称 = "Git分支"
    描述 = "管理Git分支：列出所有分支、创建分支、切换分支、删除分支"
    参数结构 = {
        "操作类型": {"类型": "字符串", "必填": False, "说明": "list=列出所有分支(默认) | create=创建分支 | switch=切换分支 | delete=删除分支"},
        "分支名": {"类型": "字符串", "必填": False, "说明": "create/switch/delete时需要指定分支名"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        操作类型 = 参数.get("操作类型", "list")
        分支名 = 参数.get("分支名", "")
        工作目录 = str(self.文件管理器.项目根目录) if self.文件管理器 else "."
        try:
            if 操作类型 == "list":
                cmd = ["git", "branch", "-a"]
            elif 操作类型 == "create":
                if not 分支名:
                    return 操作结果.失败("创建分支需要指定分支名")
                cmd = ["git", "branch", 分支名]
            elif 操作类型 == "switch":
                if not 分支名:
                    return 操作结果.失败("切换分支需要指定分支名")
                cmd = ["git", "checkout", 分支名]
            elif 操作类型 == "delete":
                if not 分支名:
                    return 操作结果.失败("删除分支需要指定分支名")
                cmd = ["git", "branch", "-d", 分支名]
            else:
                return 操作结果.失败(f"未知操作类型: {操作类型}")

            结果 = subprocess.run(cmd, shell=False, capture_output=True, text=True,
                               timeout=10, cwd=工作目录, encoding='utf-8', errors='replace')
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            错误 = 结果.stderr.strip() if 结果.stderr else ""

            if 结果.returncode == 0:
                if 操作类型 == "list":
                    return 操作结果.成功(输出 or "无分支")
                else:
                    return 操作结果.成功(f"✅ {操作类型}分支 {分支名}: {输出 or '成功'}")
            else:
                return 操作结果.失败(f"Git分支操作失败: {错误 or 输出}")
        except Exception as e:
            return 操作结果.失败(f"Git分支失败: {e}")


class Git推送(操作基类):
    名称 = "Git推送"
    描述 = "将本地提交推送到远程仓库"
    参数结构 = {
        "远程名": {"类型": "字符串", "必填": False, "说明": "远程仓库名，默认origin"},
        "分支名": {"类型": "字符串", "必填": False, "说明": "要推送的分支，默认当前分支"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        远程名 = 参数.get("远程名", "origin")
        工作目录 = str(self.文件管理器.项目根目录) if self.文件管理器 else "."
        try:
            cmd = ["git", "push", 远程名]
            分支名 = 参数.get("分支名", "")
            if 分支名:
                cmd.append(分支名)
            结果 = subprocess.run(cmd, shell=False, capture_output=True, text=True,
                               timeout=30, cwd=工作目录, encoding='utf-8', errors='replace')
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            错误 = 结果.stderr.strip() if 结果.stderr else ""
            if 结果.returncode == 0:
                return 操作结果.成功(f"✅ 推送成功\n{输出 or '完成'}")
            return 操作结果.失败(f"推送失败: {错误 or 输出}")
        except Exception as e:
            return 操作结果.失败(f"Git推送失败: {e}")


class Git拉取(操作基类):
    名称 = "Git拉取"
    描述 = "从远程仓库拉取并合并到当前分支"
    参数结构 = {
        "远程名": {"类型": "字符串", "必填": False, "说明": "远程仓库名，默认origin"},
        "分支名": {"类型": "字符串", "必填": False, "说明": "要拉取的分支，默认当前分支"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        远程名 = 参数.get("远程名", "origin")
        工作目录 = str(self.文件管理器.项目根目录) if self.文件管理器 else "."
        try:
            cmd = ["git", "pull", 远程名]
            分支名 = 参数.get("分支名", "")
            if 分支名:
                cmd.append(分支名)
            结果 = subprocess.run(cmd, shell=False, capture_output=True, text=True,
                               timeout=30, cwd=工作目录, encoding='utf-8', errors='replace')
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            错误 = 结果.stderr.strip() if 结果.stderr else ""
            if 结果.returncode == 0:
                return 操作结果.成功(f"✅ 拉取成功\n{输出 or '已是最新'}")
            return 操作结果.失败(f"拉取失败: {错误 or 输出}")
        except Exception as e:
            return 操作结果.失败(f"Git拉取失败: {e}")


class Git暂存(操作基类):
    名称 = "Git暂存"
    描述 = "管理Git暂存区(stash)：保存当前工作、恢复、查看列表、删除"
    参数结构 = {
        "操作类型": {"类型": "字符串", "必填": False, "说明": "save=暂存当前工作(默认) | pop=恢复最近暂存 | list=列出暂存 | drop=删除最近暂存"},
        "说明": {"类型": "字符串", "必填": False, "说明": "save时附加说明"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        操作类型 = 参数.get("操作类型", "save")
        工作目录 = str(self.文件管理器.项目根目录) if self.文件管理器 else "."
        try:
            if 操作类型 == "save":
                说明 = 参数.get("说明", "")
                cmd = ["git", "stash", "push", "-m", 说明] if 说明 else ["git", "stash", "push"]
            elif 操作类型 == "pop":
                cmd = ["git", "stash", "pop"]
            elif 操作类型 == "list":
                cmd = ["git", "stash", "list"]
            elif 操作类型 == "drop":
                cmd = ["git", "stash", "drop"]
            else:
                return 操作结果.失败(f"未知操作类型: {操作类型}")

            结果 = subprocess.run(cmd, shell=False, capture_output=True, text=True,
                               timeout=10, cwd=工作目录, encoding='utf-8', errors='replace')
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            错误 = 结果.stderr.strip() if 结果.stderr else ""
            if 结果.returncode == 0:
                return 操作结果.成功(f"✅ stash {操作类型}: {输出 or '完成'}")
            return 操作结果.失败(f"stash失败: {错误 or 输出}")
        except Exception as e:
            return 操作结果.失败(f"Git暂存失败: {e}")


class Git标签(操作基类):
    名称 = "Git标签"
    描述 = "管理Git标签：列出、创建、删除标签"
    参数结构 = {
        "操作类型": {"类型": "字符串", "必填": False, "说明": "list=列出标签(默认) | create=创建标签 | delete=删除标签"},
        "标签名": {"类型": "字符串", "必填": False, "说明": "create/delete时指定标签名"},
        "说明": {"类型": "字符串", "必填": False, "说明": "create时附加说明"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        操作类型 = 参数.get("操作类型", "list")
        工作目录 = str(self.文件管理器.项目根目录) if self.文件管理器 else "."
        try:
            if 操作类型 == "list":
                cmd = ["git", "tag", "-l"]
            elif 操作类型 == "create":
                标签名 = 参数.get("标签名", "")
                if not 标签名:
                    return 操作结果.失败("创建标签需要指定标签名")
                说明 = 参数.get("说明", "")
                if 说明:
                    cmd = ["git", "tag", "-a", 标签名, "-m", 说明]
                else:
                    cmd = ["git", "tag", 标签名]
            elif 操作类型 == "delete":
                标签名 = 参数.get("标签名", "")
                if not 标签名:
                    return 操作结果.失败("删除标签需要指定标签名")
                cmd = ["git", "tag", "-d", 标签名]
            else:
                return 操作结果.失败(f"未知操作类型: {操作类型}")

            结果 = subprocess.run(cmd, shell=False, capture_output=True, text=True,
                               timeout=10, cwd=工作目录, encoding='utf-8', errors='replace')
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            错误 = 结果.stderr.strip() if 结果.stderr else ""
            if 结果.returncode == 0:
                return 操作结果.成功(f"✅ tag {操作类型}: {输出 or '完成'}")
            return 操作结果.失败(f"tag失败: {错误 or 输出}")
        except Exception as e:
            return 操作结果.失败(f"Git标签失败: {e}")
