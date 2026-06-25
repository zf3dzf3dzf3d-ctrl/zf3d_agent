"""
测试工具 — 设置sys.path和公共fixtures
零外部依赖，兼容unittest和pytest
"""
import sys
import os
import tempfile
import shutil
from pathlib import Path

# 将内核目录加入搜索路径（与启动器一致）
项目根 = Path(__file__).parent.parent
内核目录 = 项目根 / "公共区" / "内核"
if str(内核目录) not in sys.path:
    sys.path.insert(0, str(内核目录))


def 创建临时目录():
    """创建临时目录，返回Path"""
    return Path(tempfile.mkdtemp(prefix="zf3d_test_"))


def 清理目录(路径):
    """清理目录"""
    try:
        shutil.rmtree(路径, ignore_errors=True)
    except Exception:
        pass
