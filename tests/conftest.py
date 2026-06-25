"""
pytest公共配置 — 将内核和模块目录加入搜索路径
"""
import sys
import os
import tempfile
import json
import gc
from pathlib import Path

# 项目根目录
项目根 = Path(__file__).parent.parent
内核目录 = 项目根 / "公共区" / "内核"
操作目录 = 项目根 / "公共区" / "内核" / "操作"
模块目录 = 项目根 / "公共区" / "模块"

for p in [str(内核目录), str(操作目录), str(模块目录)]:
    if p not in sys.path:
        sys.path.insert(0, p)

# 操作子包需要在操作目录下作为包导入
sys.path.insert(0, str(操作目录.parent))


import pytest


@pytest.fixture
def 临时目录():
    """创建临时目录，测试结束自动清理（强制GC释放SQLite文件锁）"""
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
        yield Path(d)


@pytest.fixture
def 基础权限配置(临时目录):
    """生成基础权限配置（授权临时目录读写）"""
    return {
        "授权目录": [
            {"路径": str(临时目录), "权限": ["读", "写"], "授权类型": "永久", "授权时间": "2026-01-01", "说明": "测试"}
        ],
        "默认权限": ["读"],
        "最大文件大小MB": 10,
        "禁止后缀": [".exe", ".bat"],
        "禁止关键词路径": ["Windows", "System32"],
        "询问规则": {"新文件夹必须询问": True, "询问超3次自动永久放行": True, "每次询问记录": True}
    }
