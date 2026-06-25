"""
ZF3D Agent v2.0 - Main Entry Point
ASCII-safe for bat file compatibility.
"""
import sys
import os
from pathlib import Path

# Project root = grandparent of this file (public/core/main.py -> 新系统_v2/)
# But this file is at 新系统_v2/public/core/main.py
# So parent.parent = 新系统_v2/public, we need parent.parent.parent for safety
# Actually: Path(__file__) = main.py, .parent = core/, .parent.parent = public/
# We need 新系统_v2/ which is .parent.parent.parent... no.
# Let's just go up until we find 公共区/
_current = Path(__file__).resolve().parent
while not (_current / "公共区").exists() and _current != _current.parent:
    _current = _current.parent
PROJECT_ROOT = _current

# Add Chinese core dir to Python path
CN_CORE_DIR = PROJECT_ROOT / "公共区" / "内核"
sys.path.insert(0, str(CN_CORE_DIR))

if __name__ == "__main__":
    try:
        from 启动器 import 启动器类
        launcher = 启动器类()
        # Override project root
        launcher.项目根目录 = PROJECT_ROOT
        launcher.启动()
    except KeyboardInterrupt:
        print("\nSystem stopped.")
    except Exception as e:
        print(f"\nError: {e}")
        import traceback
        traceback.print_exc()
        input("Press Enter to exit...")
