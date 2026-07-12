"""员工管理模块 - 数字员工管理系统

基于母体继承机制，支持角色切换和独立记忆。
母体继承系统全部能力，员工只存差异配置。
"""
import json
from pathlib import Path


class 员工管理模块:
    def __init__(self):
        self.配置 = {}
        self.模型直连器 = None
        self.操作注册中心 = None
        self.项目根目录 = None
        self.当前员工 = "母体"
        self.母体 = {}
        self.员工列表 = []
        self._原始配置 = {}
        self._母体提示词 = ""
        self._母体操作列表 = []
        self._母体模型 = None
        self._员工配置路径 = None

    def 初始化(self, 配置: dict):
        self.配置 = 配置
        self.模型直连器 = 配置.get("模型直连器")
        self.操作注册中心 = 配置.get("操作注册中心")
        项目根 = 配置.get("项目根目录", "")
        if 项目根:
            self.项目根目录 = Path(项目根)
        else:
            self.项目根目录 = Path(__file__).parent.parent.parent.parent
        self._员工配置路径 = self.项目根目录 / "公共区" / "配置" / "员工配置.json"
        self._母体提示词 = "你是一个AI助手。任务完成即停，不做额外操作。以下是你的角色设定："
        if self.操作注册中心:
            self._母体操作列表 = self.操作注册中心.列出所有操作()
        if self.模型直连器:
            self._母体模型 = getattr(self.模型直连器, "当前模型名", None)
        self._加载员工配置()

    def _加载员工配置(self):
        try:
            with open(self._员工配置路径, "r", encoding="utf-8") as f:
                self._原始配置 = json.load(f)
            self.母体 = self._原始配置.get("母体", {})
            self.员工列表 = self._原始配置.get("员工列表", [])
            # 安全检查：如果主文件员工列表为空但备份有数据，从备份恢复
            if not self.员工列表:
                恢复 = self._从备份恢复()
                if 恢复:
                    self._原始配置 = 恢复
                    self.母体 = 恢复.get("母体", {})
                    self.员工列表 = 恢复.get("员工列表", [])
                    print(f"   ✅ 员工配置从备份恢复: {len(self.员工列表)}名员工")
        except (FileNotFoundError, json.JSONDecodeError):
            # 主文件损坏或不存在，尝试从备份恢复
            恢复 = self._从备份恢复()
            if 恢复:
                self._原始配置 = 恢复
                self.母体 = 恢复.get("母体", {})
                self.员工列表 = 恢复.get("员工列表", [])
                print(f"   ✅ 员工配置从备份恢复(主文件损坏): {len(self.员工列表)}名员工")
            else:
                self._原始配置 = {
                    "说明": "数字员工配置。母体自动继承模型规则.json+模块配置.json+文件权限.json，员工只存差异。",
                    "母体": {"姓名": "母体", "头像": "🤖", "角色": "全能助手", "说明": "继承系统全部能力和权限，不可删除"},
                    "员工列表": []
                }
                self.母体 = self._原始配置["母体"]
                self.员工列表 = self._原始配置["员工列表"]

    def _获取备份目录(self):
        """员工配置自动备份目录"""
        备份目录 = self.项目根目录 / "隐私区" / "我的数据" / "员工备份"
        备份目录.mkdir(parents=True, exist_ok=True)
        return 备份目录

    def _从备份恢复(self) -> dict:
        """从备份目录恢复员工配置，返回配置dict或None"""
        备份目录 = self._获取备份目录()
        备份文件列表 = sorted(备份目录.glob("员工配置_*.json"), reverse=True)
        for 备份文件 in 备份文件列表:
            try:
                with open(备份文件, "r", encoding="utf-8") as f:
                    数据 = json.load(f)
                if 数据.get("员工列表"):
                    return 数据
            except Exception:
                continue
        return None

    def _解析员工(self, 员工dict: dict) -> dict:
        运行时 = {
            "姓名": 员工dict.get("姓名", ""),
            "头像": 员工dict.get("头像", ""),
            "角色": 员工dict.get("角色", ""),
            "目标": 员工dict.get("目标", ""),
        }
        追加 = 员工dict.get("人设追加", "")
        运行时["人设追加"] = 追加
        if 追加:
            运行时["系统提示词"] = self._母体提示词 + "\n\n" + 追加
        else:
            运行时["系统提示词"] = self._母体提示词
        可用操作 = 员工dict.get("可用操作")
        if 可用操作 is None:
            运行时["可用操作"] = list(self._母体操作列表)
        else:
            运行时["可用操作"] = 可用操作
        运行时["权限目录"] = 员工dict.get("权限目录")
        模型 = 员工dict.get("模型")
        运行时["模型"] = 模型 if 模型 else self._母体模型
        运行时["独立记忆"] = 员工dict.get("独立记忆", False)
        if 员工dict.get("独立记忆"):
            运行时["记忆路径"] = 员工dict.get("记忆路径")
        else:
            运行时["记忆路径"] = None
        运行时["语音"] = 员工dict.get("语音")
        运行时["状态"] = 员工dict.get("状态", "在岗")
        运行时["工具调用"] = 员工dict.get("工具调用", False)
        return 运行时

    def _获取母体运行时(self) -> dict:
        return {
            "姓名": self.母体.get("姓名", "母体"),
            "头像": self.母体.get("头像", "🤖"),
            "角色": self.母体.get("角色", "全能助手"),
            "目标": "",
            "系统提示词": self._母体提示词,
            "可用操作": list(self._母体操作列表),
            "权限目录": None,
            "模型": self._母体模型,
            "独立记忆": False,
            "记忆路径": None,
            "语音": None,
            "状态": "在岗",
        }

    def 切换员工(self, 姓名: str) -> dict:
        if 姓名 == "母体":
            self.当前员工 = "母体"
            return {"成功": True, "数据": self._获取母体运行时()}
        for 员工 in self.员工列表:
            if 员工.get("姓名") == 姓名:
                self.当前员工 = 姓名
                return {"成功": True, "数据": self._解析员工(员工)}
        return {"成功": False, "错误": f"员工 '{姓名}' 不存在"}

    def 获取当前员工(self) -> dict:
        if self.当前员工 == "母体":
            return {"成功": True, "数据": self._获取母体运行时()}
        for 员工 in self.员工列表:
            if 员工.get("姓名") == self.当前员工:
                return {"成功": True, "数据": self._解析员工(员工)}
        return {"成功": False, "错误": f"当前员工 '{self.当前员工}' 不存在"}

    def 获取员工列表(self) -> dict:
        self._加载员工配置()
        摘要 = [{
            "姓名": self.母体.get("姓名", "母体"),
            "头像": self.母体.get("头像", "🤖"),
            "角色": self.母体.get("角色", "全能助手"),
            "状态": "在岗",
            "是母体": True,
            "上级": [],
        }]
        for 员工 in self.员工列表:
            摘要.append({
                "姓名": 员工.get("姓名", ""),
                "头像": 员工.get("头像", ""),
                "角色": 员工.get("角色", ""),
                "状态": 员工.get("状态", "在岗"),
                "是母体": False,
                "上级": 员工.get("上级", []),
                "工具调用": 员工.get("工具调用", False),
            })
        return {"成功": True, "数据": 摘要}

    def 获取员工树(self) -> dict:
        """返回树形结构：老板→下属"""
        self._加载员工配置()
        顶层 = []
        下属映射 = {}
        for 员工 in self.员工列表:
            上级列表 = 员工.get("上级", [])
            姓名 = 员工.get("姓名", "")
            if not 上级列表:
                顶层.append(姓名)
            for 上级 in 上级列表:
                if 上级 not in 下属映射:
                    下属映射[上级] = []
                if 姓名 not in 下属映射[上级]:
                    下属映射[上级].append(姓名)
        树 = []
        for 姓名 in 顶层:
            员工 = next((e for e in self.员工列表 if e.get("姓名") == 姓名), None)
            if 员工:
                节点 = {
                    "姓名": 姓名,
                    "头像": 员工.get("头像", "🙂"),
                    "角色": 员工.get("角色", ""),
                    "状态": 员工.get("状态", "在岗"),
                    "下属": self._构建子树(姓名, 下属映射, set()),
                }
                树.append(节点)
        return {"成功": True, "数据": 树}

    def _构建子树(self, 上级名, 下属映射, 路径):
        # 路径检测：只防循环引用，不阻止共享
        if 上级名 in 路径:
            return []
        新路径 = 路径 | {上级名}
        下属列表 = 下属映射.get(上级名, [])
        结果 = []
        for 姓名 in 下属列表:
            员工 = next((e for e in self.员工列表 if e.get("姓名") == 姓名), None)
            if 员工:
                结果.append({
                    "姓名": 姓名,
                    "头像": 员工.get("头像", "🙂"),
                    "角色": 员工.get("角色", ""),
                    "状态": 员工.get("状态", "在岗"),
                    "下属": self._构建子树(姓名, 下属映射, 新路径),
                })
        return 结果

    def 分配员工(self, 员工名, 老板名) -> dict:
        """将员工分配到老板名下"""
        if 员工名 == "母体" or 老板名 == "母体":
            return {"成功": False, "错误": "母体不可参与分配"}
        if 员工名 == 老板名:
            return {"成功": False, "错误": "不能分配给自己"}
        员工 = next((e for e in self.员工列表 if e.get("姓名") == 员工名), None)
        老板 = next((e for e in self.员工列表 if e.get("姓名") == 老板名), None)
        if not 员工:
            return {"成功": False, "错误": f"员工 '{员工名}' 不存在"}
        if not 老板:
            return {"成功": False, "错误": f"老板 '{老板名}' 不存在"}
        上级列表 = 员工.get("上级", [])
        if 老板名 in 上级列表:
            return {"成功": False, "错误": f"'{员工名}' 已在 '{老板名}' 名下"}
        if 老板名 not in 上级列表:
            上级列表.append(老板名)
        员工["上级"] = 上级列表
        self._保存配置()
        return {"成功": True, "数据": f"已将 '{员工名}' 分配给 '{老板名}'"}

    def 移除分配(self, 员工名, 老板名) -> dict:
        """将员工从老板名下移除"""
        员工 = next((e for e in self.员工列表 if e.get("姓名") == 员工名), None)
        if not 员工:
            return {"成功": False, "错误": f"员工 '{员工名}' 不存在"}
        上级列表 = 员工.get("上级", [])
        if 老板名 not in 上级列表:
            return {"成功": False, "错误": f"'{员工名}' 不在 '{老板名}' 名下"}
        上级列表.remove(老板名)
        员工["上级"] = 上级列表
        self._保存配置()
        return {"成功": True, "数据": f"已将 '{员工名}' 从 '{老板名}' 名下移除"}

    def 创建员工(self, 配置dict: dict) -> dict:
        姓名 = 配置dict.get("姓名", "")
        if not 姓名:
            return {"成功": False, "错误": "员工姓名不能为空"}
        if 姓名 == "母体":
            return {"成功": False, "错误": "不能创建名为'母体'的员工"}
        for 员工 in self.员工列表:
            if 员工.get("姓名") == 姓名:
                return {"成功": False, "错误": f"员工 '{姓名}' 已存在"}
        self.员工列表.append(配置dict)
        self._保存配置()
        return {"成功": True, "数据": self._解析员工(配置dict)}

    def 更新员工(self, 姓名: str, 配置dict: dict) -> dict:
        if 姓名 == "母体":
            return {"成功": False, "错误": "母体不可修改"}
        for i, 员工 in enumerate(self.员工列表):
            if 员工.get("姓名") == 姓名:
                新姓名 = 配置dict.get("姓名", 姓名)
                if 新姓名 != 姓名:
                    for e in self.员工列表:
                        if 姓名 in (e.get("上级") or []):
                            e["上级"] = [新姓名 if x == 姓名 else x for x in e["上级"]]
                    if self.当前员工 == 姓名:
                        self.当前员工 = 新姓名
                员工.update(配置dict)
                self._保存配置()
                return {"成功": True, "数据": self._解析员工(员工)}
        return {"成功": False, "错误": f"员工 '{姓名}' 不存在"}

    def 删除员工(self, 姓名: str) -> dict:
        姓名 = (姓名 or "").strip()
        if 姓名 == "母体":
            return {"成功": False, "错误": "母体不可删除"}
        # 删除前重新加载配置，确保内存与文件一致
        self._加载员工配置()
        for i, 员工 in enumerate(self.员工列表):
            if (员工.get("姓名") or "").strip() == 姓名:
                del self.员工列表[i]
                if self.当前员工 == 姓名:
                    self.当前员工 = "母体"
                self._保存配置()
                return {"成功": True, "数据": f"员工 '{姓名}' 已删除"}
        return {"成功": False, "错误": f"员工 '{姓名}' 不存在"}

    def 设置状态(self, 姓名: str, 状态: str) -> dict:
        if 状态 not in ("在岗", "离线"):
            return {"成功": False, "错误": f"无效状态: {状态}"}
        if 姓名 == "母体":
            return {"成功": False, "错误": "母体状态不可修改"}
        for 员工 in self.员工列表:
            if 员工.get("姓名") == 姓名:
                员工["状态"] = 状态
                self._保存配置()
                return {"成功": True, "数据": f"员工 '{姓名}' 状态已设为 '{状态}'"}
        return {"成功": False, "错误": f"员工 '{姓名}' 不存在"}

    def 获取运行时配置(self, 姓名: str) -> dict:
        self._加载员工配置()
        if 姓名 == "母体":
            return {"成功": True, "数据": self._获取母体运行时()}
        for 员工 in self.员工列表:
            if 员工.get("姓名") == 姓名:
                return {"成功": True, "数据": self._解析员工(员工)}
        return {"成功": False, "错误": f"员工 '{姓名}' 不存在"}

    def 运行(self, 输入数据: dict) -> dict:
        操作 = 输入数据.get("操作", "")
        if 操作 == "切换员工":
            return self.切换员工(输入数据.get("姓名", ""))
        elif 操作 == "获取列表":
            return self.获取员工列表()
        elif 操作 == "创建员工":
            return self.创建员工(输入数据.get("配置", {}))
        elif 操作 == "更新员工":
            return self.更新员工(输入数据.get("姓名", ""), 输入数据.get("配置", {}))
        elif 操作 == "删除员工":
            return self.删除员工(输入数据.get("姓名", ""))
        elif 操作 == "设置状态":
            return self.设置状态(输入数据.get("姓名", ""), 输入数据.get("状态", ""))
        elif 操作 == "获取配置":
            return self.获取运行时配置(输入数据.get("姓名", ""))
        elif 操作 == "获取当前":
            return self.获取当前员工()
        elif 操作 == "获取树":
            return self.获取员工树()
        elif 操作 == "分配员工":
            return self.分配员工(输入数据.get("员工名", ""), 输入数据.get("老板名", ""))
        elif 操作 == "移除分配":
            return self.移除分配(输入数据.get("员工名", ""), 输入数据.get("老板名", ""))
        else:
            return {"成功": False, "错误": f"未知操作: {操作}"}

    def _保存配置(self):
        # 安全检查：如果员工列表为空但之前有数据，拒绝保存（防止误清空）
        if not self.员工列表 and self._原始配置.get("员工列表"):
            print("   ⚠️ 员工列表为空但之前有数据，拒绝保存（防止误清空）")
            return
        self._原始配置["母体"] = self.母体
        self._原始配置["员工列表"] = self.员工列表
        try:
            # 先写入临时文件，成功后再替换（防止写入中途崩溃损坏文件）
            临时路径 = self._员工配置路径.with_suffix(".tmp")
            with open(临时路径, "w", encoding="utf-8") as f:
                json.dump(self._原始配置, f, ensure_ascii=False, indent=2)
            # 替换主文件
            临时路径.replace(self._员工配置路径)
            # 自动备份到隐私区（保留最近5份）
            self._自动备份()
        except Exception:
            pass

    def _自动备份(self):
        """每次保存时自动备份到隐私区，保留最近5份"""
        import shutil
        from datetime import datetime
        try:
            备份目录 = self._获取备份目录()
            时间戳 = datetime.now().strftime("%Y%m%d_%H%M%S")
            备份路径 = 备份目录 / f"员工配置_{时间戳}.json"
            shutil.copy2(self._员工配置路径, 备份路径)
            # 清理旧备份，只保留最近5份
            备份列表 = sorted(备份目录.glob("员工配置_*.json"), reverse=True)
            for 旧备份 in 备份列表[5:]:
                旧备份.unlink()
        except Exception:
            pass

    def 停止(self):
        pass
