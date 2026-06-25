"""
操作基类 - 所有操作的抽象基类和结果包装
"""
import subprocess
import os
import sys
import re
import ast
import json
import time
import base64
import mimetypes
from pathlib import Path


class 操作结果:
    """操作执行结果 - 结构化返回，含元数据

    统一返回格式:
    {
        "成功": True/False,
        "数据": "主要结果文本",
        "错误": "错误信息(失败时)",
        "元数据": {
            "耗时毫秒": 123,
            "总行数": 500,
            "返回行数": 50,
            "下页偏移": 51,
            "匹配数": 5,
            "替换数": 3,
            "文件大小KB": 12.5,
            "编码": "utf-8",
            "操作类型": "读取文件"
        }
    }
    """
    def __init__(self, 成功: bool, 数据: str = "", 错误: str = "", 元数据: dict = None):
        self.成功 = 成功
        self.数据 = 数据
        self.错误 = 错误
        self.元数据 = 元数据 or {}
        if "操作类型" not in self.元数据:
            self.元数据["操作类型"] = "未知"

    @staticmethod
    def 成功(数据: str = "", 元数据: dict = None):
        return 操作结果(True, 数据=数据, 元数据=元数据)

    @staticmethod
    def 失败(错误: str = "", 元数据: dict = None):
        return 操作结果(False, 错误=错误, 元数据=元数据)

    def 转字典(self):
        基础 = {"成功": True, "数据": self.数据, "元数据": self.元数据} if self.成功 else {"成功": False, "错误": self.错误, "元数据": self.元数据}
        return 基础


class 操作基类:
    """所有操作的抽象基类"""
    名称 = "未命名操作"
    描述 = "无描述"
    参数结构 = {}  # {"参数名": {"类型": "字符串", "必填": True, "说明": "..."}}
    文件管理器 = None  # 由操作注册中心注入
    模型直连器 = None  # 由操作注册中心注入
    进度回调 = None  # 由操作注册中心注入，签名: 回调(类型:str, 内容:dict)
    取消检查 = None  # 由操作注册中心注入，签名: 检查() -> bool，返回True表示用户已取消
    当前工作目录 = None  # 由操作注册中心注入（前端打开的文件夹）

    def 执行(self, 参数: dict) -> 操作结果:
        """执行操作，子类必须实现"""
        raise NotImplementedError(f"操作 [{self.名称}] 未实现执行方法")

    def 验证参数(self, 参数: dict) -> str:
        """验证参数，返回空字符串表示通过"""
        for 参数名, 规则 in self.参数结构.items():
            if 规则.get("必填", False) and 参数名 not in 参数:
                return f"缺少必填参数: {参数名}"
        return ""
