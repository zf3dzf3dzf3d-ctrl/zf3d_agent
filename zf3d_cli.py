"""
ZF3D Agent - 命令行启动入口
pip install zf3d 后，终端输入 zf3d 即可启动
"""
import sys
import os
from pathlib import Path


def main():
    # 定位项目根目录（pip安装后包文件所在位置）
    包目录 = Path(__file__).parent

    # 优先查找 公共区/ 内核
    公共区 = 包目录 / "公共区"
    if not 公共区.exists():
        # 开发模式：从当前工作目录查找
        当前 = Path.cwd()
        公共区 = 当前 / "公共区"
        if not 公共区.exists():
            print("❌ 未找到公共区目录，请确保在项目根目录运行")
            print("   或重新安装: pip install --force zf3d")
            sys.exit(1)
        包目录 = 当前

    内核目录 = 公共区 / "内核"
    sys.path.insert(0, str(内核目录))

    try:
        from 启动器 import 启动器类
        启动器 = 启动器类()
        启动器.项目根目录 = 包目录
        启动器.启动()
    except KeyboardInterrupt:
        print("\n系统已停止")
    except Exception as e:
        print(f"\n启动失败: {e}")
        import traceback
        traceback.print_exc()
        input("按回车键退出...")


if __name__ == "__main__":
    main()
