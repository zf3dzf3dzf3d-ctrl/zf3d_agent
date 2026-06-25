"""
文件管理器 v2.1 - 权限校验+审计+3次放行+文件读写+目录树+重命名+写入备份事务化
大模型不可直接访问文件系统，所有操作必须经过此管理器
v2.1新增: 写入前自动备份，写入失败自动还原，dry_run模拟
"""
import json
import os
import shutil
import hashlib
import time
import threading
from pathlib import Path
from datetime import datetime


class 文件管理器类:
    def __init__(self, 权限配置: dict, 项目根目录: Path):
        self.项目根目录 = 项目根目录
        self.授权目录 = 权限配置.get("授权目录", [])
        self.禁止后缀 = 权限配置.get("禁止后缀", [])
        self.禁止关键词路径 = 权限配置.get("禁止关键词路径", [])
        self.最大文件大小MB = 权限配置.get("最大文件大小MB", 10)
        self.默认权限 = 权限配置.get("默认权限", [])
        self.询问规则 = 权限配置.get("询问规则", {})
        self.询问记录路径 = 项目根目录 / (权限配置.get("询问记录路径", "./隐私区/我的配置/询问记录.json")[2:] if 权限配置.get("询问记录路径", "").startswith("./") else 权限配置.get("询问记录路径", "./隐私区/我的配置/询问记录.json"))
        self.审计日志 = []
        self.待确认队列 = []
        self._锁 = threading.Lock()  # 线程安全锁
        self._审计锁 = threading.Lock()
        # v2: 增强权限控制
        self.日写入限额MB = 权限配置.get("日写入限额MB", {})  # 目录 -> MB
        self.允许后缀 = 权限配置.get("允许后缀", {})  # 目录 -> [".py", ".json"]
        self.操作配额 = {}  # 内部追踪: {路径: {"日期": "2026-06-19", "今日写入MB": 0}}
        # v2.1: 事务化写入
        self.写入备份 = 权限配置.get("写入备份", True)  # 全局开关
        self.备份目录 = 项目根目录 / "隐私区" / "我的日志" / ".备份缓存"
        self.备份目录.mkdir(parents=True, exist_ok=True)
        # v2.2: 删除回收站（保留7天）
        self.回收站目录 = 项目根目录 / "隐私区" / "我的日志" / ".回收站"
        self.回收站目录.mkdir(parents=True, exist_ok=True)
        self.回收站保留天 = 7
        # v2.2: 隐私区敏感文件，AI读取需额外检查
        self._敏感文件 = {"密钥.json", "询问记录.json"}
        self._清理回收站()

    # ========== v2.1 事务化写入支持 ==========

    def _备份文件(self, 文件路径: Path) -> str:
        """写入前备份文件，返回备份路径。文件不存在则不备份"""
        if not self.写入备份:
            return ""
        if not 文件路径.exists():
            return ""
        备份名 = f"{文件路径.name}.{int(time.time())}.bak"
        备份路径 = self.备份目录 / 备份名
        try:
            shutil.copy2(文件路径, 备份路径)
            # 自动清理旧备份（保留最近50个）
            self._清理旧备份()
            return str(备份路径)
        except Exception:
            return ""

    def _清理旧备份(self):
        """保留最近50个备份文件，删除超出的"""
        try:
            备份列表 = sorted(self.备份目录.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
            for 旧备份 in 备份列表[50:]:
                旧备份.unlink(missing_ok=True)
        except Exception:
            pass

    def _还原备份(self, 备份路径: str, 目标路径: Path):
        """写入失败时还原备份"""
        if not 备份路径:
            return
        备份文件 = Path(备份路径)
        if 备份文件.exists():
            try:
                shutil.copy2(备份文件, 目标路径)
                self._记录审计("还原备份", str(目标路径), f"从{备份路径}还原")
            except Exception as e:
                self._记录审计("还原备份", str(目标路径), f"还原失败: {e}")

    def _删除备份(self, 备份路径: str):
        """写入成功后删除备份"""
        if 备份路径:
            try:
                Path(备份路径).unlink(missing_ok=True)
            except Exception:
                pass

    def _事务写入(self, 文件路径: Path, 写入函数) -> dict:
        """事务化写入：备份 → 执行写入 → 成功删备份/失败还原

        参数:
            文件路径: 目标文件路径
            写入函数: 无参函数，执行实际写入操作。成功返回True，失败抛异常
        """
        备份路径 = self._备份文件(文件路径)
        try:
            结果 = 写入函数()
            if 结果 is False:
                raise Exception("写入函数返回失败")
            self._删除备份(备份路径)
            return {"成功": True}
        except Exception as e:
            self._还原备份(备份路径, 文件路径)
            return {"成功": False, "错误": f"写入失败已自动还原: {str(e)}"}

    def 读取文件(self, 路径: str, AI调用: bool = False) -> dict:
        校验 = self._校验权限(路径, "读", AI调用)
        if not 校验["允许"]:
            return {"成功": False, "错误": 校验["原因"]}
        文件路径 = self._解析路径(路径)
        if not 文件路径.exists():
            return {"成功": False, "错误": "文件不存在"}
        if 文件路径.stat().st_size > self.最大文件大小MB * 1024 * 1024:
            return {"成功": False, "错误": f"文件超过{self.最大文件大小MB}MB限制"}
        try:
            # 读取原始字节，自动检测编码
            with open(文件路径, "rb") as f:
                原始字节 = f.read()
            内容 = self._自动检测编码(原始字节)
            self._记录审计("读取", 路径, "成功")
            return {"成功": True, "内容": 内容}
        except Exception as e:
            self._记录审计("读取", 路径, f"失败: {str(e)}")
            return {"成功": False, "错误": str(e)}

    def 写入文件(self, 路径: str, 内容: str, AI调用: bool = False, dry_run: bool = False) -> dict:
        校验 = self._校验权限(路径, "写", AI调用)
        if not 校验["允许"]:
            return {"成功": False, "错误": 校验["原因"]}
        配额检查 = self._检查写入配额(路径, len(内容.encode("utf-8")))
        if not 配额检查["允许"]:
            return {"成功": False, "错误": 配额检查["原因"]}
        文件路径 = self._解析路径(路径)

        # dry_run模式：只校验不实际写入
        if dry_run:
            return {"成功": True, "dry_run": True, "提示": f"模拟写入 {路径} ({len(内容)}字符)"}

        def _写():
            文件路径.parent.mkdir(parents=True, exist_ok=True)
            with open(文件路径, "w", encoding="utf-8") as f:
                f.write(内容)
            return True

        结果 = self._事务写入(文件路径, _写)
        if 结果["成功"]:
            self._记录审计("写入", 路径, "成功")
        else:
            self._记录审计("写入", 路径, f"失败已还原: {结果['错误']}")
        return 结果

    def 列目录(self, 路径: str) -> dict:
        校验 = self._校验权限(路径, "读")
        if not 校验["允许"]:
            return {"成功": False, "错误": 校验["原因"]}
        目录路径 = self._解析路径(路径)
        if not 目录路径.exists() or not 目录路径.is_dir():
            return {"成功": False, "错误": "目录不存在"}
        内容 = []
        try:
            for 子项 in sorted(目录路径.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                try:
                    stat = 子项.stat()
                    内容.append({
                        "名称": 子项.name,
                        "类型": "目录" if 子项.is_dir() else "文件",
                        "大小": stat.st_size if 子项.is_file() else 0,
                        "后缀": 子项.suffix.lower() if 子项.is_file() else "",
                        "创建时间": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M")
                    })
                except OSError:
                    continue
        except (PermissionError, OSError) as e:
            return {"成功": False, "错误": f"无法读取目录: {str(e)}"}
        self._记录审计("列目录", 路径, "成功")
        return {"成功": True, "内容": 内容}

    def 目录树(self, 路径: str, 最大深度: int = 3) -> dict:
        """递归获取目录树"""
        校验 = self._校验权限(路径, "读")
        if not 校验["允许"]:
            return {"成功": False, "错误": 校验["原因"]}
        根路径 = self._解析路径(路径)
        if not 根路径.exists() or not 根路径.is_dir():
            return {"成功": False, "错误": "目录不存在"}
        树 = self._递归目录树(根路径, 最大深度, 0)
        self._记录审计("目录树", 路径, "成功")
        return {"成功": True, "树": 树}

    def _递归目录树(self, 目录: Path, 最大深度: int, 当前深度: int) -> dict:
        节点 = {"名称": 目录.name, "类型": "目录", "子项": []}
        if 当前深度 >= 最大深度:
            节点["截断"] = True
            return 节点
        try:
            for 子项 in sorted(目录.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if 子项.name.startswith(".") or 子项.name == "__pycache__":
                    continue
                try:
                    if 子项.is_dir():
                        节点["子项"].append(self._递归目录树(子项, 最大深度, 当前深度 + 1))
                    else:
                        节点["子项"].append({
                            "名称": 子项.name,
                            "类型": "文件",
                            "大小": 子项.stat().st_size,
                            "后缀": 子项.suffix.lower()
                        })
                except OSError:
                    continue
        except (PermissionError, OSError):
            节点["错误"] = "无权限"
        return 节点

    def 新建文件(self, 路径: str, AI调用: bool = False) -> dict:
        校验 = self._校验权限(路径, "写", AI调用)
        if not 校验["允许"]:
            return {"成功": False, "错误": 校验["原因"]}
        文件路径 = self._解析路径(路径)
        if 文件路径.exists():
            return {"成功": False, "错误": "文件已存在"}
        try:
            文件路径.parent.mkdir(parents=True, exist_ok=True)
            文件路径.touch()
            self._记录审计("新建文件", 路径, "成功")
            return {"成功": True}
        except Exception as e:
            return {"成功": False, "错误": str(e)}

    def 替换文本(self, 路径: str, 旧文本: str, 新文本: str, AI调用: bool = False, 全部替换: bool = False, 报告匹配数: bool = True, dry_run: bool = False) -> dict:
        """替换文件中的指定文本，支持全部替换和匹配计数。事务化：失败自动还原"""
        校验 = self._校验权限(路径, "写", AI调用)
        if not 校验["允许"]:
            return {"成功": False, "错误": 校验["原因"]}
        配额检查 = self._检查写入配额(路径, len(新文本.encode("utf-8")))
        if not 配额检查["允许"]:
            return {"成功": False, "错误": 配额检查["原因"]}
        文件路径 = self._解析路径(路径)
        if not 文件路径.exists():
            return {"成功": False, "错误": "文件不存在"}

        # 先读取计算匹配数（不会修改文件）
        try:
            with open(文件路径, "r", encoding="utf-8") as f:
                原始内容 = f.read()
            匹配数 = 原始内容.count(旧文本)
            if 匹配数 == 0:
                # 模糊匹配兜底：strip后查找（处理前后空白差异）
                旧文本trimmed = 旧文本.strip()
                if 旧文本trimmed and 旧文本trimmed != 旧文本:
                    匹配数 = 原始内容.count(旧文本trimmed)
                    if 匹配数 > 0:
                        旧文本 = 旧文本trimmed  # 用trimmed版本替换
                if 匹配数 == 0:
                    return {"成功": False, "错误": "未找到要替换的文本", "匹配数": 0}
        except Exception as e:
            return {"成功": False, "错误": f"读取失败: {str(e)}"}

        # dry_run模式
        if dry_run:
            return {"成功": True, "dry_run": True, "匹配数": 匹配数, "提示": f"模拟替换 {路径}: {匹配数}处匹配"}

        def _替换():
            with open(文件路径, "r", encoding="utf-8") as f:
                内容 = f.read()
            if 全部替换:
                新内容 = 内容.replace(旧文本, 新文本)
            else:
                新内容 = 内容.replace(旧文本, 新文本, 1)
            with open(文件路径, "w", encoding="utf-8") as f:
                f.write(新内容)
            return True

        结果 = self._事务写入(文件路径, _替换)
        if 结果["成功"]:
            替换数 = 匹配数 if 全部替换 else 1
            self._记录审计("替换文本", 路径, f"替换{替换数}/{匹配数}处")
            return {"成功": True, "替换数": 替换数, "匹配数": 匹配数}
        else:
            self._记录审计("替换文本", 路径, f"失败已还原: {结果['错误']}")
            return {"成功": False, "错误": 结果["错误"], "匹配数": 匹配数}

    def 批量替换(self, 路径: str, 编辑列表: list, AI调用: bool = False, dry_run: bool = False) -> dict:
        """批量替换文件中的多个文本片段（一次读取，多次替换，一次写入）。事务化：失败自动还原"""
        校验 = self._校验权限(路径, "写", AI调用)
        if not 校验["允许"]:
            return {"成功": False, "错误": 校验["原因"]}
        文件路径 = self._解析路径(路径)
        if not 文件路径.exists():
            return {"成功": False, "错误": "文件不存在"}

        # 先预检匹配数（不修改文件）
        try:
            with open(文件路径, "r", encoding="utf-8") as f:
                原始内容 = f.read()
            预检详情 = []
            全部失败 = True
            for 编辑 in 编辑列表:
                旧文本 = 编辑.get("旧文本", "")
                匹配数 = 原始内容.count(旧文本) if 旧文本 else 0
                预检详情.append({"旧文本": 旧文本[:30], "匹配数": 匹配数})
                if 匹配数 > 0:
                    全部失败 = False
            if 全部失败:
                return {"成功": False, "错误": "所有编辑项均无匹配"}
        except Exception as e:
            return {"成功": False, "错误": f"读取失败: {str(e)}"}

        # dry_run模式
        if dry_run:
            return {"成功": True, "dry_run": True, "详情": 预检详情, "提示": f"模拟批量替换 {路径}: {len(编辑列表)}项"}

        def _批量替换():
            with open(文件路径, "r", encoding="utf-8") as f:
                内容 = f.read()
            成功数 = 0
            for 编辑 in 编辑列表:
                旧文本 = 编辑.get("旧文本", "")
                新文本 = 编辑.get("新文本", "")
                项全部替换 = 编辑.get("全部替换", False)
                匹配数 = 内容.count(旧文本) if 旧文本 else 0
                if 匹配数 == 0:
                    continue
                if 项全部替换:
                    内容 = 内容.replace(旧文本, 新文本)
                    成功数 += 匹配数
                else:
                    内容 = 内容.replace(旧文本, 新文本, 1)
                    成功数 += 1
            with open(文件路径, "w", encoding="utf-8") as f:
                f.write(内容)
            return True

        结果 = self._事务写入(文件路径, _批量替换)
        if 结果["成功"]:
            self._记录审计("批量替换", 路径, f"成功处理{len(编辑列表)}项")
            return {"成功": True, "替换数": sum(e.get("匹配数", 0) for e in 预检详情 if e.get("匹配数", 0) > 0), "详情": 预检详情}
        else:
            self._记录审计("批量替换", 路径, f"失败已还原: {结果['错误']}")
            return {"成功": False, "错误": 结果["错误"]}

    def 创建目录(self, 路径: str, AI调用: bool = False) -> dict:
        校验 = self._校验权限(路径, "创建", AI调用)
        if not 校验["允许"]:
            return {"成功": False, "错误": 校验["原因"]}
        目录路径 = self._解析路径(路径)
        try:
            目录路径.mkdir(parents=True, exist_ok=True)
            self._记录审计("创建目录", 路径, "成功")
            return {"成功": True}
        except Exception as e:
            self._记录审计("创建目录", 路径, f"失败: {str(e)}")
            return {"成功": False, "错误": str(e)}

    def 重命名(self, 旧路径: str, 新名称: str, AI调用: bool = False) -> dict:
        校验 = self._校验权限(旧路径, "写", AI调用)
        if not 校验["允许"]:
            return {"成功": False, "错误": 校验["原因"]}
        旧 = self._解析路径(旧路径)
        新 = 旧.parent / 新名称
        if 新.exists():
            return {"成功": False, "错误": "目标名称已存在"}

        备份路径 = self._备份文件(旧)
        try:
            旧.rename(新)
            self._删除备份(备份路径)
            self._记录审计("重命名", 旧路径, f"→ {新名称}")
            return {"成功": True}
        except Exception as e:
            self._还原备份(备份路径, 旧)
            self._记录审计("重命名", 旧路径, f"失败: {str(e)}")
            return {"成功": False, "错误": str(e)}

    def 删除(self, 路径: str, AI调用: bool = False) -> dict:
        校验 = self._校验权限(路径, "删除", AI调用)
        if not 校验["允许"]:
            return {"成功": False, "错误": 校验["原因"]}
        目标路径 = self._解析路径(路径)
        if not 目标路径.exists():
            return {"成功": False, "错误": "文件不存在"}
        # v2.2: 删除前移入回收站，而非直接删除
        try:
            回收站名 = f"{目标路径.name}.{int(time.time())}.trash"
            回收站路径 = self.回收站目录 / 回收站名
            shutil.move(str(目标路径), str(回收站路径))
            # v2.3: 记录原始路径到sidecar元数据文件
            元数据 = {"原始路径": str(目标路径), "删除时间": datetime.now().isoformat(), "文件大小": 回收站路径.stat().st_size}
            try:
                with open(self.回收站目录 / f"{回收站名}.meta", "w", encoding="utf-8") as f:
                    json.dump(元数据, f, ensure_ascii=False)
            except Exception:
                pass
            self._记录审计("删除→回收站", 路径, f"已移至回收站: {回收站名}")
            return {"成功": True, "回收站路径": str(回收站路径)}
        except Exception as e:
            self._记录审计("删除", 路径, f"失败: {str(e)}")
            return {"成功": False, "错误": str(e)}

    def 列出回收站(self) -> dict:
        """列出回收站中的所有文件"""
        结果 = []
        try:
            for 文件 in self.回收站目录.iterdir():
                if 文件.suffix == ".meta" or not 文件.is_file():
                    continue
                名 = 文件.name
                原始名 = self._解析回收站文件名(名)
                删除时间 = "未知"
                原始路径 = ""
                # 读取sidecar元数据
                元数据路径 = self.回收站目录 / f"{名}.meta"
                if 元数据路径.exists():
                    try:
                        with open(元数据路径, "r", encoding="utf-8") as f:
                            元数据 = json.load(f)
                        原始路径 = 元数据.get("原始路径", "")
                        删除时间 = 元数据.get("删除时间", "未知")
                    except Exception:
                        pass
                if 删除时间 == "未知":
                    # 从文件名解析时间戳
                    部分 = 名.rsplit(".", 2)
                    if len(部分) == 3 and 部分[1].isdigit():
                        try:
                            删除时间 = datetime.fromtimestamp(int(部分[1])).strftime("%Y-%m-%d %H:%M:%S")
                        except Exception:
                            pass
                try:
                    大小 = 文件.stat().st_size
                except OSError:
                    大小 = 0
                结果.append({
                    "回收站名": 名, "原始名": 原始名,
                    "原始路径": 原始路径, "删除时间": 删除时间, "大小": 大小,
                })
        except Exception:
            pass
        结果.sort(key=lambda x: x.get("删除时间", ""), reverse=True)
        return {"成功": True, "内容": 结果}

    def 恢复文件(self, 回收站名: str, 目标路径: str = "") -> dict:
        """从回收站恢复文件到指定路径（或原始路径）"""
        源路径 = self.回收站目录 / 回收站名
        if not 源路径.exists():
            return {"成功": False, "错误": f"回收站中不存在: {回收站名}"}
        if 目标路径:
            恢复路径 = self._解析路径(目标路径)
        else:
            # 尝试从元数据读取原始路径
            元数据路径 = self.回收站目录 / f"{回收站名}.meta"
            原始路径 = ""
            if 元数据路径.exists():
                try:
                    with open(元数据路径, "r", encoding="utf-8") as f:
                        原始路径 = json.load(f).get("原始路径", "")
                except Exception:
                    pass
            if 原始路径:
                恢复路径 = Path(原始路径)
            else:
                恢复路径 = self.项目根目录 / self._解析回收站文件名(回收站名)
        # 目标已存在则加后缀
        if 恢复路径.exists():
            恢复路径 = 恢复路径.with_name(f"{恢复路径.stem}_恢复{恢复路径.suffix}")
        try:
            恢复路径.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(源路径), str(恢复路径))
            # 删除元数据文件
            (self.回收站目录 / f"{回收站名}.meta").unlink(missing_ok=True)
            self._记录审计("回收站→恢复", 回收站名, f"已恢复到: {恢复路径}")
            return {"成功": True, "恢复路径": str(恢复路径)}
        except Exception as e:
            self._记录审计("回收站→恢复", 回收站名, f"失败: {str(e)}")
            return {"成功": False, "错误": str(e)}

    def 清空回收站(self) -> dict:
        """永久删除回收站中的所有文件"""
        删除数 = 0
        释放字节 = 0
        try:
            for 文件 in self.回收站目录.iterdir():
                try:
                    if 文件.is_dir():
                        shutil.rmtree(文件)
                        删除数 += 1
                    else:
                        释放字节 += 文件.stat().st_size
                        文件.unlink()
                        删除数 += 1
                except Exception:
                    pass
        except Exception:
            pass
        self._记录审计("清空回收站", "", f"已清空{删除数}个文件")
        return {"成功": True, "删除数": 删除数, "释放MB": round(释放字节 / (1024 * 1024), 2)}

    def _解析回收站文件名(self, 回收站名: str) -> str:
        """从回收站文件名解析出原始文件名"""
        名 = 回收站名
        if 名.endswith(".trash"):
            名 = 名[:-6]
        部分 = 名.rsplit(".", 1)
        if len(部分) == 2 and 部分[1].isdigit():
            return 部分[0]
        return 名

    def 请求权限(self, 路径: str, 操作: str) -> dict:
        if self._在禁止路径(路径):
            return {"允许": False, "原因": "路径在禁止列表中", "需确认": False}
        授权 = self._查找授权(路径)
        if 授权:
            权限列表 = 授权.get("权限", [])
            if 操作 in 权限列表:
                授权类型 = 授权.get("授权类型", "永久")
                if 授权类型 == "永久":
                    return {"允许": True, "原因": "永久授权", "需确认": False}
                elif 授权类型 == "一次":
                    return {"允许": True, "原因": "一次授权", "需确认": False}
            if 授权.get("授权类型") == "禁止":
                return {"允许": False, "原因": "用户已禁止此路径", "需确认": False}
        询问次数 = self._获取询问次数(路径)
        自动升级 = (self.询问规则.get("询问超3次自动永久放行", True) and 询问次数 >= 2)
        请求信息 = {"路径": 路径, "操作": 操作, "询问次数": 询问次数 + 1, "自动升级": 自动升级, "需确认": True}
        if 自动升级:
            self._授予权限(路径, ["读", "写", "创建", "删除"], "永久")
            self._记录询问(路径, "自动升级永久", 操作)
            return {"允许": True, "原因": "询问3次自动升级", "需确认": False}
        # 去重：同一路径已有待确认请求时不重复添加
        if not any(r["路径"] == 路径 for r in self.待确认队列):
            self.待确认队列.append(请求信息)
        return 请求信息

    def 用户确认权限(self, 路径: str, 操作: str, 选择: str):
        if 选择 == "允许一次":
            self._授予权限(路径, [操作], "一次")
            self._记录询问(路径, "允许一次", 操作)
            self._记录用户偏好(操作, f"批准_一次")
        elif 选择 == "永久允许":
            self._授予权限(路径, ["读", "写", "创建", "删除"], "永久")
            self._记录询问(路径, "永久允许", 操作)
            self._记录用户偏好(操作, f"批准_永久")
        elif 选择 == "永久授权文件夹":
            父目录 = str(Path(路径).parent)
            self._授予权限(父目录, ["读", "写", "创建", "删除"], "永久")
            self._记录询问(路径, f"永久授权文件夹({父目录})", 操作)
            self._记录用户偏好(操作, "批准_永久_文件夹")
            # 清除同目录下所有待确认请求
            self.待确认队列 = [r for r in self.待确认队列
                              if not str(Path(r["路径"]).parent) == 父目录]
            return
        elif 选择 == "拒绝":
            self._记录询问(路径, "拒绝", 操作)
            self._记录用户偏好(操作, "拒绝")
        self.待确认队列 = [r for r in self.待确认队列 if r["路径"] != 路径]

    def 获取待确认(self) -> list:
        return self.待确认队列

    def _校验权限(self, 路径: str, 操作: str, AI调用: bool = False) -> dict:
        # 禁止路径检查仅对AI调用生效，界面操作不受限
        if AI调用 and self._在禁止路径(路径):
            return {"允许": False, "原因": "路径在禁止列表中"}
        if AI调用 and self._在禁止后缀(路径):
            return {"允许": False, "原因": "文件后缀被禁止"}
        # v2.2: 敏感文件检查 — AI不可直接读取密钥等
        文件名 = Path(路径).name
        if AI调用 and 文件名 in self._敏感文件:
            return {"允许": False, "原因": f"敏感文件 {文件名} 禁止AI读取"}
        # 读操作: 界面操作放行, AI调用需在授权目录内
        if 操作 == "读":
            if AI调用:
                授权 = self._查找授权(路径)
                if not 授权:
                    self.请求权限(路径, 操作)
                    # 等待用户授权（最多30秒轮询）
                    等待开始 = time.time()
                    while time.time() - 等待开始 < 30:
                        time.sleep(1)
                        授权 = self._查找授权(路径)
                        if 授权 and 授权.get("授权类型") != "禁止":
                            break
                    else:
                        return {"允许": False, "原因": f"授权超时（30秒未响应），请先在前端弹窗中授权读取路径: {路径}，然后重试"}
                    if not 授权 or 授权.get("授权类型") == "禁止":
                        return {"允许": False, "原因": f"用户拒绝了读取路径: {路径}"}
                if 授权.get("授权类型") == "禁止":
                    return {"允许": False, "原因": "用户已禁止此路径"}
            return {"允许": True, "原因": "读取放行"}
        # 写/创建/删除需检查授权
        授权 = self._查找授权(路径)
        if not 授权:
            if AI调用:
                # 自动发起授权请求，前端会弹窗让用户选择
                self.请求权限(路径, 操作)
                # 等待用户授权（最多30秒轮询）
                等待开始 = time.time()
                while time.time() - 等待开始 < 30:
                    time.sleep(1)
                    授权 = self._查找授权(路径)
                    if 授权 and 授权.get("授权类型") != "禁止":
                        # 用户已授权，继续校验
                        break
                else:
                    return {"允许": False, "原因": f"授权超时（30秒未响应），请先在前端弹窗中授权{操作}路径: {路径}，然后重试"}
                if not 授权 or 授权.get("授权类型") == "禁止":
                    return {"允许": False, "原因": f"用户拒绝了{操作}路径: {路径}"}
            else:
                return {"允许": True, "原因": "界面操作自动放行"}
        if 授权.get("授权类型") == "禁止":
            return {"允许": False, "原因": "用户已禁止此路径"}
        return {"允许": True, "原因": "权限校验通过"}

    def _查找授权(self, 路径: str) -> dict:
        标准路径 = str(self._解析路径(路径))
        for 授权项 in self.授权目录:
            授权路径 = 授权项.get("路径", "")
            授权完整路径 = str(self._解析路径(授权路径))
            if 标准路径.startswith(授权完整路径) or 标准路径 == 授权完整路径:
                return 授权项
        return None

    def _授予权限(self, 路径: str, 权限列表: list, 授权类型: str):
        self.授权目录 = [d for d in self.授权目录 if d.get("路径") != 路径]
        self.授权目录.append({"路径": 路径, "权限": 权限列表, "授权类型": 授权类型, "授权时间": datetime.now().isoformat(), "说明": f"用户{授权类型}授权"})

    def _检查写入配额(self, 路径: str, 内容长度: int = 0) -> dict:
        """检查写入配额（今日写入量+文件类型限制）"""
        # 文件类型限制
        if self.允许后缀:
            匹配目录 = ""
            路径Obj = self._解析路径(路径)
            for 授权目录, 允许列表 in self.允许后缀.items():
                授权全路径 = str(self._解析路径(授权目录))
                if str(路径Obj).startswith(授权全路径):
                    匹配目录 = 授权目录
                    break
            if 匹配目录:
                后缀 = 路径Obj.suffix.lower()
                允许列表 = self.允许后缀.get(匹配目录, [])
                if 允许列表 and 后缀 and 后缀 not in 允许列表:
                    return {"允许": False, "原因": f"路径[{匹配目录}]只允许文件类型: {', '.join(允许列表)}"}

        # 日写入限额
        if self.日写入限额MB and 内容长度 > 0:
            今天 = datetime.now().strftime("%Y-%m-%d")
            for 授权目录, 限额MB in self.日写入限额MB.items():
                授权全路径 = str(self._解析路径(授权目录))
                if str(self._解析路径(路径)).startswith(授权全路径):
                    配额 = self.操作配额.setdefault(授权目录, {"日期": 今天, "今日写入MB": 0})
                    if 配额["日期"] != 今天:
                        配额["日期"] = 今天
                        配额["今日写入MB"] = 0
                    本次MB = 内容长度 / (1024 * 1024)
                    if 配额["今日写入MB"] + 本次MB > 限额MB:
                        return {"允许": False, "原因": f"今日写入配额不足({配额['今日写入MB']:.1f}/{限额MB}MB)"}
                    配额["今日写入MB"] += 本次MB
                    break
        return {"允许": True}

    def _在禁止路径(self, 路径: str) -> bool:
        for 关键词 in self.禁止关键词路径:
            if 关键词 in 路径:
                return True
        return False

    def _在禁止后缀(self, 路径: str) -> bool:
        后缀 = Path(路径).suffix.lower()
        return 后缀 in self.禁止后缀

    def _获取询问次数(self, 路径: str) -> int:
        询问记录 = self._读取询问记录()
        for 记录 in 询问记录.get("记录", []):
            if 记录.get("路径") == 路径:
                return 记录.get("询问次数", 0)
        return 0

    def _记录询问(self, 路径: str, 用户选择: str, 操作: str):
        询问记录 = self._读取询问记录()
        已存在 = False
        for 记录 in 询问记录.get("记录", []):
            if 记录.get("路径") == 路径:
                记录["询问次数"] = 记录.get("询问次数", 0) + 1
                记录.setdefault("询问历史", []).append({"时间": datetime.now().strftime("%H:%M:%S"), "用户选择": 用户选择, "操作": 操作})
                if 用户选择 == "自动升级永久" or 记录["询问次数"] >= 3:
                    记录["已升级为永久"] = True
                    记录["升级时间"] = datetime.now().isoformat()
                已存在 = True
                break
        if not 已存在:
            询问记录.setdefault("记录", []).append({"路径": 路径, "询问次数": 1, "已升级为永久": False, "升级时间": "", "询问历史": [{"时间": datetime.now().strftime("%H:%M:%S"), "用户选择": 用户选择, "操作": 操作}]})
        self._写入询问记录(询问记录)

    def _读取询问记录(self) -> dict:
        if self.询问记录路径.exists():
            try:
                with open(self.询问记录路径, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {"记录": []}
        return {"记录": []}

    def _写入询问记录(self, 数据: dict):
        self.询问记录路径.parent.mkdir(parents=True, exist_ok=True)
        with open(self.询问记录路径, "w", encoding="utf-8") as f:
            json.dump(数据, f, ensure_ascii=False, indent=2)

    def _自动检测编码(self, 原始字节: bytes) -> str:
        """自动检测并解码文件编码，支持UTF-8/GBK/GB18030/双重编码"""
        # 1. 尝试UTF-8（含BOM）
        try:
            return 原始字节.decode("utf-8-sig")
        except UnicodeDecodeError:
            pass
        # 2. 尝试GBK
        try:
            return 原始字节.decode("gbk")
        except UnicodeDecodeError:
            pass
        # 3. 尝试GB18030（超集，兼容GBK）
        try:
            return 原始字节.decode("gb18030")
        except UnicodeDecodeError:
            pass
        # 4. 双重编码修复：UTF-8解码成功但内容是乱码
        #    原始GBK/UTF-8文件被某工具用错误编码读取后重新保存为UTF-8
        #    修复：UTF-8解码 → gb18030编码 → UTF-8解码
        try:
            文本 = 原始字节.decode("utf-8-sig", errors="strict")
            修复字节 = 文本.encode("gb18030")
            return 修复字节.decode("utf-8")
        except (UnicodeDecodeError, UnicodeEncodeError):
            pass
        # 5. 最终回退：忽略错误
        return 原始字节.decode("utf-8", errors="replace")

    def _解析路径(self, 路径: str) -> Path:
        """解析路径为绝对Path，防止路径穿越攻击"""
        if 路径.startswith("./"):
            子路径 = 路径[2:].lstrip("/\\")
            结果 = self.项目根目录 / 子路径 if 子路径 else self.项目根目录
        elif os.path.isabs(路径):
            结果 = Path(路径)
        else:
            结果 = self.项目根目录 / 路径

        # 规范化路径并检查是否在项目根目录内（防穿越）
        try:
            规范化 = 结果.resolve()
            根规范化 = self.项目根目录.resolve()
            # 检查解析后的路径是否在项目根目录内
            if not (规范化 == 根规范化 or str(规范化).startswith(str(根规范化) + os.sep)):
                # 绝对路径在项目外 — 允许但不走相对路径逻辑
                pass
        except (OSError, RuntimeError):
            pass
        return 结果

    # ========== v2.1 用户行为模式学习 ==========

    def _记录用户偏好(self, 操作类型: str, 结果: str):
        """记录用户的操作偏好（批准/拒绝/权限授予）"""
        画像路径 = self.项目根目录 / "隐私区" / "我的记忆" / "用户画像.json"
        try:
            画像 = {}
            if 画像路径.exists():
                with open(画像路径, "r", encoding="utf-8") as f:
                    画像 = json.load(f)
            if "操作偏好" not in 画像:
                画像["操作偏好"] = {}
            if 操作类型 not in 画像["操作偏好"]:
                画像["操作偏好"][操作类型] = {"提议次数": 0, "批准次数": 0, "拒绝次数": 0, "偏好分": 0.5}
            画像["操作偏好"][操作类型]["提议次数"] += 1
            if "批准" in 结果 or "永久" in 结果 or "允许" in 结果:
                画像["操作偏好"][操作类型]["批准次数"] += 1
            elif "拒绝" in 结果:
                画像["操作偏好"][操作类型]["拒绝次数"] += 1
            # 更新偏好分: 批准率
            偏好 = 画像["操作偏好"][操作类型]
            总 = 偏好["批准次数"] + 偏好["拒绝次数"]
            偏好["偏好分"] = round(偏好["批准次数"] / 总, 2) if 总 > 0 else 0.5
            with open(画像路径, "w", encoding="utf-8") as f:
                json.dump(画像, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def 获取操作偏好(self) -> dict:
        """获取所有操作的用户偏好分数"""
        画像路径 = self.项目根目录 / "隐私区" / "我的记忆" / "用户画像.json"
        try:
            if 画像路径.exists():
                with open(画像路径, "r", encoding="utf-8") as f:
                    画像 = json.load(f)
                return 画像.get("操作偏好", {})
        except Exception:
            pass
        return {}

    def _清理回收站(self):
        """清理超过保留天数的回收站文件"""
        try:
            现在 = time.time()
            保留秒 = self.回收站保留天 * 86400
            for 文件 in self.回收站目录.iterdir():
                try:
                    if (现在 - 文件.stat().st_mtime) > 保留秒:
                        if 文件.is_dir():
                            shutil.rmtree(文件)
                        else:
                            文件.unlink()
                except Exception:
                    pass
            # 清理孤立的meta文件（对应trash已被清理）
            for meta文件 in self.回收站目录.glob("*.meta"):
                对应trash = meta文件.stem  # 去掉.meta后缀
                if not (self.回收站目录 / 对应trash).exists():
                    meta文件.unlink(missing_ok=True)
        except Exception:
            pass

    def _记录审计(self, 操作: str, 路径: str, 结果: str):
        with self._审计锁:
            self.审计日志.append({"时间": datetime.now().isoformat(), "操作者": "智能体", "操作": 操作, "路径": 路径, "结果": 结果})

    def 获取审计日志(self, 最近数: int = 50) -> list:
        return self.审计日志[-最近数:]
