"""
系统操作模块 - 打开程序/运行命令/截图/获取时间/系统信息/等待/数学计算/JSON操作
"""
import subprocess
import os
import sys
import json
import time
from pathlib import Path
from .基类 import 操作结果, 操作基类


class 打开程序(操作基类):
    名称 = "打开程序"
    描述 = "打开一个程序或文件"
    参数结构 = {
        "程序名或路径": {"类型": "字符串", "必填": True, "说明": "程序名如notepad，或完整路径"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        程序 = 参数.get("程序名或路径", "")
        if not 程序:
            return 操作结果.失败("程序名或路径为空")
        try:
            if sys.platform == 'win32':
                os.startfile(程序)
            else:
                subprocess.Popen(["xdg-open", 程序])
            return 操作结果.成功(f"已打开: {程序}")
        except Exception as e:
            return 操作结果.失败(f"打开失败: {e}")


class 运行命令(操作基类):
    名称 = "运行命令"
    描述 = "执行系统命令行命令"
    参数结构 = {
        "命令": {"类型": "字符串", "必填": True, "说明": "要执行的系统命令"},
        "超时秒数": {"类型": "整数", "必填": False, "说明": "命令超时时间，默认30秒"},
        "工作目录": {"类型": "字符串", "必填": False, "说明": "命令执行的工作目录，默认项目根目录"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        命令 = 参数.get("命令", "")
        if not 命令:
            return 操作结果.失败("命令为空")
        超时 = 参数.get("超时秒数", 30)
        工作目录 = 参数.get("工作目录", "")
        if not 工作目录 and self.文件管理器:
            工作目录 = str(self.文件管理器.项目根目录)
        try:
            结果 = subprocess.run(
                命令, shell=True, capture_output=True, text=True,
                timeout=超时, encoding='utf-8', errors='replace',
                cwd=工作目录 if 工作目录 else None
            )
            输出 = 结果.stdout.strip() if 结果.stdout else ""
            错误 = 结果.stderr.strip() if 结果.stderr else ""
            return 操作结果.成功(输出 or "(命令执行成功，无输出)", 元数据={
                "耗时毫秒": 超时 * 1000,
                "操作类型": "运行命令",
                "命令": 命令[:200],
                "退出码": 结果.returncode
            })
        except subprocess.TimeoutExpired:
            return 操作结果.失败(f"命令超时({超时}秒)")
        except Exception as e:
            return 操作结果.失败(f"执行异常: {e}")


class 截图(操作基类):
    名称 = "截图"
    描述 = "截取屏幕截图"
    参数结构 = {
        "保存路径": {"类型": "字符串", "必填": False, "说明": "截图保存路径，默认临时文件"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        try:
            from PIL import ImageGrab
            保存路径 = 参数.get("保存路径", "")
            if not 保存路径:
                import tempfile
                保存路径 = os.path.join(tempfile.gettempdir(), f"截图_{int(time.time())}.png")
            截图对象 = ImageGrab.grab()
            截图对象.save(保存路径)
            return 操作结果.成功(f"截图已保存: {保存路径}")
        except ImportError:
            return 操作结果.失败("需要安装Pillow: pip install Pillow")
        except Exception as e:
            return 操作结果.失败(f"截图失败: {e}")


class 获取时间(操作基类):
    名称 = "获取时间"
    描述 = "获取当前日期和时间"
    参数结构 = {}

    def 执行(self, 参数: dict) -> 操作结果:
        from datetime import datetime
        现在 = datetime.now()
        return 操作结果.成功(f"当前时间: {现在.strftime('%Y-%m-%d %H:%M:%S')} ({'一二三四五六日'[现在.weekday()]})")


class 系统信息(操作基类):
    名称 = "系统信息"
    描述 = "获取系统信息"
    参数结构 = {}

    def 执行(self, 参数: dict) -> 操作结果:
        import platform
        信息 = []
        信息.append(f"系统: {platform.system()} {platform.release()}")
        信息.append(f"主机名: {platform.node()}")
        信息.append(f"Python: {platform.python_version()}")
        信息.append(f"架构: {platform.machine()}")
        try:
            import psutil
            内存 = psutil.virtual_memory()
            信息.append(f"内存: {内存.total // (1024**3)}GB (已用{内存.percent}%)")
            信息.append(f"CPU: {psutil.cpu_percent()}%")
        except ImportError:
            pass
        return 操作结果.成功("\n".join(信息))


class 等待(操作基类):
    名称 = "等待"
    描述 = "等待指定秒数"
    参数结构 = {
        "秒数": {"类型": "数字", "必填": True, "说明": "等待秒数"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        秒数 = float(参数.get("秒数", 1))
        time.sleep(秒数)
        return 操作结果.成功(f"已等待 {秒数} 秒")


class 数学计算(操作基类):
    名称 = "数学计算"
    描述 = "执行数学表达式计算"
    参数结构 = {
        "表达式": {"类型": "字符串", "必填": True, "说明": "数学表达式"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        表达式 = 参数.get("表达式", "")
        if not 表达式:
            return 操作结果.失败("表达式为空")
        try:
            from 安全计算器 import 安全计算
            结果 = 安全计算(表达式)
            # 整数结果去掉小数点
            if isinstance(结果, float) and 结果.is_integer():
                结果 = int(结果)
            return 操作结果.成功(str(结果))
        except ValueError as e:
            return 操作结果.失败(f"表达式错误: {e}")
        except Exception as e:
            return 操作结果.失败(f"计算失败: {e}")


class JSON操作(操作基类):
    名称 = "JSON操作"
    描述 = "读取或修改JSON文件中的指定字段"
    参数结构 = {
        "路径": {"类型": "字符串", "必填": True, "说明": "JSON文件路径"},
        "字段路径": {"类型": "字符串", "必填": False, "说明": "点分字段路径如 a.b.c"},
        "新值": {"类型": "字符串", "必填": False, "说明": "设置新值（留空则只读取）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        路径 = 参数.get("路径", "")
        字段路径 = 参数.get("字段路径", "")
        新值 = 参数.get("新值", None)
        if not 路径:
            return 操作结果.失败("路径为空")
        try:
            with open(路径, "r", encoding="utf-8") as f:
                数据 = json.load(f)
            if not 字段路径:
                return 操作结果.成功(json.dumps(数据, ensure_ascii=False, indent=2))
            部分 = 字段路径.split(".")
            当前 = 数据
            for 键 in 部分[:-1]:
                if 键.isdigit():
                    当前 = 当前[int(键)]
                else:
                    当前 = 当前[键]
            最后键 = 部分[-1]
            if 新值 is not None:
                try:
                    解析值 = json.loads(新值)
                except (json.JSONDecodeError, TypeError):
                    解析值 = 新值
                if 最后键.isdigit():
                    当前[int(最后键)] = 解析值
                else:
                    当前[最后键] = 解析值
                with open(路径, "w", encoding="utf-8") as f:
                    json.dump(数据, f, ensure_ascii=False, indent=2)
                return 操作结果.成功(f"已设置 {字段路径} = {新值}")
            else:
                值 = 当前[int(最后键)] if 最后键.isdigit() else 当前[最后键]
                return 操作结果.成功(json.dumps(值, ensure_ascii=False, indent=2))
        except Exception as e:
            return 操作结果.失败(f"JSON操作失败: {e}")
