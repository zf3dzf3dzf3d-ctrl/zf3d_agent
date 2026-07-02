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

            from 存储引擎 import 获取存储引擎
            存储 = 获取存储引擎()
            if 存储:
                存储.写入KV_JSON(f"浏览器会话_{站点名}", 数据)
                # 更新会话索引列表
                索引 = 存储.读取KV_JSON("浏览器会话列表", [])
                if 站点名 not in 索引:
                    索引.append(站点名)
                    存储.写入KV_JSON("浏览器会话列表", 索引)
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
            from 存储引擎 import 获取存储引擎
            存储 = 获取存储引擎()
            if not 存储:
                return False

            数据 = 存储.读取KV_JSON(f"浏览器会话_{站点名}", None)
            if not 数据:
                return False

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
        """检查会话是否存在且未过期

        Returns:
            {存在, 过期, 保存时间, URL}
        """
        try:
            from 存储引擎 import 获取存储引擎
            存储 = 获取存储引擎()
            if not 存储:
                return {"存在": False}

            数据 = 存储.读取KV_JSON(f"浏览器会话_{站点名}", None)
            if not 数据:
                return {"存在": False}

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
        try:
            from 存储引擎 import 获取存储引擎
            存储 = 获取存储引擎()
            if not 存储:
                return 结果

            站点列表 = 存储.读取KV_JSON("浏览器会话列表", [])
            for 站点名 in 站点列表:
                数据 = 存储.读取KV_JSON(f"浏览器会话_{站点名}", None)
                if 数据:
                    结果.append({
                        "站点名称": 数据.get("站点名称", 站点名),
                        "保存时间": 数据.get("保存时间", ""),
                        "URL": 数据.get("URL", ""),
                        "Cookie数": len(数据.get("cookies", [])),
                    })
        except Exception:
            pass
        return 结果

    def 删除会话(self, 站点名: str) -> bool:
        """删除指定站点的会话"""
        try:
            from 存储引擎 import 获取存储引擎
            存储 = 获取存储引擎()
            if not 存储:
                return False

            存储.删除KV(f"浏览器会话_{站点名}")
            # 更新索引列表
            索引 = 存储.读取KV_JSON("浏览器会话列表", [])
            if 站点名 in 索引:
                索引.remove(站点名)
                存储.写入KV_JSON("浏览器会话列表", 索引)
            return True
        except Exception:
            return False
