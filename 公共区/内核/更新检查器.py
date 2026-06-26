"""
更新检查器 — 多源回退检查版本并执行更新
纯标准库实现，零外部依赖

更新源优先级：GitHub → Gitee → 自建服务器
"""
import json
import os
import sys
import shutil
import zipfile
import tempfile
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime


class 更新检查器类:
    """多源回退检查更新，下载并更新公共区文件"""

    def __init__(self, 配置: dict = None):
        self.配置 = 配置 or {}
        更新配置 = self.配置.get("更新", {})
        self.GitHub仓库 = 更新配置.get("GitHub仓库", "zf3dzf3dzf3d-ctrl/zf3d_agent")
        self.Gitee仓库 = 更新配置.get("Gitee仓库", "zf3dzf3dzf3d-ctrl/zf3d_agent")
        self.备用服务器 = 更新配置.get("备用服务器", "")
        self.当前版本 = 更新配置.get("当前版本", self.配置.get("版本", "2.1.0"))
        self.检查间隔小时 = 更新配置.get("检查间隔小时", 24)
        self.项目根目录 = Path(self.配置.get("项目根目录", "."))
        self._上次检查时间 = None
        self._缓存结果 = None

    def 检查更新(self, 强制: bool = False) -> dict:
        """多源检查是否有新版本，依次尝试 GitHub → Gitee → 备用服务器"""
        if not 强制 and self._缓存结果 and self._上次检查时间:
            已过小时 = (datetime.now() - self._上次检查时间).total_seconds() / 3600
            if 已过小时 < self.检查间隔小时:
                return self._缓存结果

        更新源 = [
            ("GitHub", self._检查GitHub),
            ("Gitee", self._检查Gitee),
            ("备用服务器", self._检查备用服务器),
        ]

        错误列表 = []
        for 源名, 检查函数 in 更新源:
            try:
                结果 = 检查函数()
                if 结果 and 结果.get("最新版本"):
                    有更新 = self._比较版本(结果["最新版本"], self.当前版本) > 0
                    结果["有更新"] = 有更新
                    结果["当前版本"] = self.当前版本
                    结果["更新源"] = 源名
                    if not 有更新:
                        结果["消息"] = f"已是最新版本（{源名}）"
                    self._缓存结果 = 结果
                    self._上次检查时间 = datetime.now()
                    return 结果
            except Exception as e:
                错误列表.append(f"{源名}: {e}")
                continue

        return {"有更新": False, "错误": "所有更新源均不可用: " + "; ".join(错误列表)}

    def _检查GitHub(self) -> dict:
        """从GitHub API获取最新Release"""
        api地址 = f"https://api.github.com/repos/{self.GitHub仓库}/releases/latest"
        请求头 = {"Accept": "application/vnd.github.v3+json", "User-Agent": "ZF3D-Agent-Updater"}
        请求 = urllib.request.Request(api地址, headers=请求头)
        响应 = urllib.request.urlopen(请求, timeout=10)
        数据 = json.loads(响应.read().decode("utf-8"))

        下载地址 = ""
        for asset in 数据.get("assets", []):
            名字 = asset.get("name", "")
            if 名字.endswith(".zip"):
                下载地址 = asset.get("browser_download_url", "")
                break
        if not 下载地址:
            下载地址 = 数据.get("zipball_url", "")

        return {
            "最新版本": self._清理版本号(数据.get("tag_name", "")),
            "更新日志": 数据.get("body", "无更新日志")[:2000],
            "下载地址": 下载地址,
            "发布时间": 数据.get("published_at", "")
        }

    def _检查Gitee(self) -> dict:
        """从Gitee API获取最新Release"""
        api地址 = f"https://gitee.com/api/v5/repos/{self.Gitee仓库}/releases/latest"
        请求 = urllib.request.Request(api地址, headers={"User-Agent": "ZF3D-Agent-Updater"})
        响应 = urllib.request.urlopen(请求, timeout=10)
        数据 = json.loads(响应.read().decode("utf-8"))

        下载地址 = ""
        for asset in 数据.get("assets", []):
            名字 = asset.get("name", "")
            if 名字.endswith(".zip"):
                下载地址 = asset.get("browser_download_url", "")
                break

        return {
            "最新版本": self._清理版本号(数据.get("tag_name", "")),
            "更新日志": 数据.get("body", "无更新日志")[:2000],
            "下载地址": 下载地址,
            "发布时间": 数据.get("created_at", "")
        }

    def _检查备用服务器(self) -> dict:
        """从自建服务器检查版本"""
        if not self.备用服务器:
            raise Exception("未配置备用服务器")
        地址 = self.备用服务器.rstrip("/") + "/version.json"
        请求 = urllib.request.Request(地址, headers={"User-Agent": "ZF3D-Agent-Updater"})
        响应 = urllib.request.urlopen(请求, timeout=10)
        数据 = json.loads(响应.read().decode("utf-8"))

        return {
            "最新版本": self._清理版本号(数据.get("版本", "")),
            "更新日志": 数据.get("更新日志", "无更新日志")[:2000],
            "下载地址": 数据.get("下载地址", ""),
            "发布时间": 数据.get("发布时间", "")
        }

    def 执行更新(self, 下载地址: str) -> dict:
        """下载更新包并覆盖公共区文件"""
        if not 下载地址:
            return {"成功": False, "错误": "下载地址为空"}

        临时目录 = None
        备份目录 = None

        try:
            临时目录 = Path(tempfile.mkdtemp(prefix="zf3d_update_"))
            zip路径 = 临时目录 / "更新包.zip"

            请求头 = {"User-Agent": "ZF3D-Agent-Updater"}
            请求 = urllib.request.Request(下载地址, headers=请求头)
            响应 = urllib.request.urlopen(请求, timeout=120)

            with open(zip路径, "wb") as f:
                while True:
                    块 = 响应.read(65536)
                    if not 块:
                        break
                    f.write(块)

            解压目录 = 临时目录 / "解压"
            解压目录.mkdir(exist_ok=True)
            with zipfile.ZipFile(zip路径, "r") as zf:
                zf.extractall(解压目录)

            新公共区 = self._查找公共区(解压目录)
            if not 新公共区:
                return {"成功": False, "错误": "更新包中未找到公共区目录"}

            当前公共区 = self.项目根目录 / "公共区"
            if 当前公共区.exists():
                备份目录名 = f"公共区_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                备份目录 = self.项目根目录 / 备份目录名
                shutil.copytree(当前公共区, 备份目录)

            排除模式 = {"__pycache__", ".pyc", ".pyo", ".DS_Store", "Thumbs.db"}
            self._覆盖目录(新公共区, 当前公共区, 排除模式)

            self._清理旧备份()
            self._更新配置版本()

            shutil.rmtree(临时目录, ignore_errors=True)
            return {"成功": True, "消息": "更新完成，请重启系统"}

        except Exception as e:
            if 备份目录 and 备份目录.exists():
                当前公共区 = self.项目根目录 / "公共区"
                if 当前公共区.exists():
                    shutil.rmtree(当前公共区, ignore_errors=True)
                shutil.move(str(备份目录), str(当前公共区))

            if 临时目录:
                shutil.rmtree(临时目录, ignore_errors=True)

            return {"成功": False, "错误": f"更新失败: {e}"}

    def _清理版本号(self, 版本: str) -> str:
        版本 = 版本.strip()
        if 版本.startswith("v") or 版本.startswith("V"):
            版本 = 版本[1:]
        return 版本

    def _比较版本(self, 版本A: str, 版本B: str) -> int:
        try:
            部分A = [int(x) for x in 版本A.split(".")]
            部分B = [int(x) for x in 版本B.split(".")]
            长度 = max(len(部分A), len(部分B))
            部分A += [0] * (长度 - len(部分A))
            部分B += [0] * (长度 - len(部分B))
            for a, b in zip(部分A, 部分B):
                if a > b:
                    return 1
                if a < b:
                    return -1
            return 0
        except (ValueError, AttributeError):
            return 0

    def _查找公共区(self, 目录: Path) -> Path or None:
        公共区 = 目录 / "公共区"
        if 公共区.exists() and 公共区.is_dir():
            return 公共区
        for 子目录 in 目录.iterdir():
            if 子目录.is_dir():
                公共区 = 子目录 / "公共区"
                if 公共区.exists() and 公共区.is_dir():
                    return 公共区
        return None

    def _覆盖目录(self, 源目录: Path, 目标目录: Path, 排除模式: set):
        目标目录.mkdir(parents=True, exist_ok=True)
        for 项目 in 源目录.iterdir():
            名字 = 项目.name
            if 名字 in 排除模式:
                continue
            if 任何(名字.endswith(后缀) for 后缀 in 排除模式):
                continue
            目标项目 = 目标目录 / 名字
            if 项目.is_dir():
                self._覆盖目录(项目, 目标项目, 排除模式)
            else:
                shutil.copy2(str(项目), str(目标项目))

    def _清理旧备份(self):
        备份列表 = sorted(
            [d for d in self.项目根目录.iterdir()
             if d.is_dir() and d.name.startswith("公共区_backup_")],
            key=lambda d: d.name,
            reverse=True
        )
        for 旧备份 in 备份列表[1:]:
            shutil.rmtree(旧备份, ignore_errors=True)

    def _更新配置版本(self):
        配置路径 = self.项目根目录 / "公共区" / "配置" / "系统配置.json"
        if not 配置路径.exists():
            return
        try:
            with open(配置路径, "r", encoding="utf-8") as f:
                配置 = json.load(f)
            if self._缓存结果:
                配置["版本"] = self._缓存结果.get("最新版本", 配置.get("版本", "2.1.0"))
            if "更新" not in 配置:
                配置["更新"] = {}
            配置["更新"]["当前版本"] = 配置["版本"]
            with open(配置路径, "w", encoding="utf-8") as f:
                json.dump(配置, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
