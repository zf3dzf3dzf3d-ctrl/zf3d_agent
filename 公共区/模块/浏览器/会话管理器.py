"""会话管理器 — 浏览器会话持久化（Cookie/localStorage）

职责：
1. 保存当前浏览器上下文的Cookie和localStorage
2. 加载已保存的会话到浏览器上下文
3. 检查会话文件是否存在且未过期
4. 列出/删除会话

用户手动登录一次后，后续AI操作自动复用登录态。
"""
import os
import json
import time
from pathlib import Path


class 会话管理器类:
    """浏览器会话持久化管理"""

    def __init__(self, 会话目录: str):
        self._会话目录 = Path(会话目录)
        self._会话目录.mkdir(parents=True, exist_ok=True)

    def 保存会话(self, 站点名: str, 引擎) -> bool:
        """保存当前浏览器上下文的cookie和localStorage

        Args:
            站点名: 站点标识（如"朱峰社区"）
            引擎: 浏览器引擎实例
        Returns:
            成功与否
        """
        try:
            cookies = 引擎.获取Cookie()
            local_storage = 引擎.获取localStorage()
            页面信息 = 引擎.获取页面信息()

            数据 = {
                "站点名称": 站点名,
                "保存时间": time.strftime("%Y-%m-%d %H:%M:%S"),
                "保存时间戳": time.time(),
                "URL": 页面信息.get("URL", ""),
                "标题": 页面信息.get("标题", ""),
                "cookies": cookies,
                "localStorage": local_storage,
            }

            文件路径 = self._会话目录 / f"{站点名}.json"
            with open(文件路径, "w", encoding="utf-8") as f:
                json.dump(数据, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            return False

    def 加载会话(self, 站点名: str, 引擎) -> bool:
        """加载已保存的会话到浏览器上下文

        Args:
            站点名: 站点标识
            引擎: 浏览器引擎实例
        Returns:
            成功与否
        """
        try:
            文件路径 = self._会话目录 / f"{站点名}.json"
            if not 文件路径.exists():
                return False

            with open(文件路径, "r", encoding="utf-8") as f:
                数据 = json.load(f)

            cookies = 数据.get("cookies", [])
            if cookies:
                引擎.设置Cookie(cookies)

            # localStorage需要先打开对应域名页面才能设置
            url = 数据.get("URL", "")
            if url:
                引擎.打开页面(url)
                local_storage = 数据.get("localStorage", {})
                if local_storage:
                    引擎.设置localStorage(local_storage)

            return True
        except Exception:
            return False

    def 检查会话有效性(self, 站点名: str) -> dict:
        """检查会话文件是否存在且未过期

        Returns:
            {存在, 过期, 保存时间, URL}
        """
        文件路径 = self._会话目录 / f"{站点名}.json"
        if not 文件路径.exists():
            return {"存在": False}

        try:
            with open(文件路径, "r", encoding="utf-8") as f:
                数据 = json.load(f)

            保存时间戳 = 数据.get("保存时间戳", 0)
            当前时间 = time.time()
            过期天数 = 30
            已过期 = (当前时间 - 保存时间戳) > (过期天数 * 86400)

            return {
                "存在": True,
                "过期": 已过期,
                "保存时间": 数据.get("保存时间", ""),
                "URL": 数据.get("URL", ""),
                "Cookie数": len(数据.get("cookies", [])),
            }
        except Exception:
            return {"存在": False}

    def 列出所有会话(self) -> list:
        """列出所有已保存的会话"""
        结果 = []
        if not self._会话目录.exists():
            return 结果

        for 文件 in self._会话目录.glob("*.json"):
            try:
                with open(文件, "r", encoding="utf-8") as f:
                    数据 = json.load(f)
                结果.append({
                    "站点名称": 数据.get("站点名称", 文件.stem),
                    "保存时间": 数据.get("保存时间", ""),
                    "URL": 数据.get("URL", ""),
                    "Cookie数": len(数据.get("cookies", [])),
                })
            except Exception:
                continue
        return 结果

    def 删除会话(self, 站点名: str) -> bool:
        """删除指定站点的会话"""
        文件路径 = self._会话目录 / f"{站点名}.json"
        if 文件路径.exists():
            文件路径.unlink()
            return True
        return False
