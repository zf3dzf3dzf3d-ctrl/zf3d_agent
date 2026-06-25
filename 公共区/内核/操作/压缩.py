"""
压缩操作模块 - 解压和压缩文件 (7z/zip/rar/tar/gz)
优先使用7-Zip，其次WinRAR，最后回退Python内置zipfile/tarfile
"""
import subprocess
import os
import zipfile
import tarfile
from .基类 import 操作结果, 操作基类

# 常见安装路径
_7Z候选 = [
    r"C:\Program Files\7-Zip\7z.exe",
    r"C:\Program Files (x86)\7-Zip\7z.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\7-Zip\7z.exe"),
    os.path.expandvars(r"%ProgramData%\chocolatey\bin\7z.exe"),
]
_WINRAR候选 = [
    r"C:\Program Files\WinRAR\WinRAR.exe",
    r"C:\Program Files\WinRAR\Rar.exe",
    r"C:\Program Files (x86)\WinRAR\WinRAR.exe",
    r"C:\Program Files (x86)\WinRAR\Rar.exe",
]


def _查找7z():
    for p in _7Z候选:
        if os.path.isfile(p):
            return p
    # 尝试PATH
    try:
        r = subprocess.run(["where", "7z"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0:
            line = r.stdout.strip().split("\n")[0].strip()
            if line and os.path.isfile(line):
                return line
    except:
        pass
    return None


def _查找WinRAR():
    for p in _WINRAR候选:
        if os.path.isfile(p):
            # 优先返回Rar.exe（命令行版），其次WinRAR.exe
            if p.endswith("Rar.exe"):
                return p
    # 再找WinRAR.exe
    for p in _WINRAR候选:
        if os.path.isfile(p):
            return p
    return None


class 解压文件(操作基类):
    名称 = "解压文件"
    描述 = "解压7z/zip/rar/tar/gz等压缩包到指定目录"
    参数结构 = {
        "压缩包路径": {"类型": "字符串", "必填": True, "说明": "压缩包文件路径"},
        "解压目录": {"类型": "字符串", "必填": False, "说明": "解压目标目录，不填则解压到压缩包所在目录"},
        "密码": {"类型": "字符串", "必填": False, "说明": "压缩包密码（如果有）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        压缩包 = 参数.get("压缩包路径", "").strip()
        if not 压缩包:
            return 操作结果.失败("压缩包路径为空")

        if self.文件管理器:
            校验 = self.文件管理器._校验权限(压缩包, "读")
            if not 校验["允许"]:
                return 操作结果.失败(校验["原因"])
            压缩包 = str(self.文件管理器._解析路径(压缩包))

        if not os.path.isfile(压缩包):
            return 操作结果.失败(f"文件不存在: {压缩包}")

        解压目录 = 参数.get("解压目录", "").strip()
        if not 解压目录:
            解压目录 = os.path.dirname(压缩包) or "."
        else:
            if self.文件管理器:
                解压目录 = str(self.文件管理器._解析路径(解压目录))

        os.makedirs(解压目录, exist_ok=True)

        密码 = 参数.get("密码", "")
        后缀 = os.path.splitext(压缩包)[1].lower()

        # 策略1: 7-Zip
        z7 = _查找7z()
        if z7:
            命令 = [z7, "x", 压缩包, f"-o{解压目录}", "-y"]
            if 密码:
                命令.append(f"-p{密码}")
            else:
                命令.append("-p")
            try:
                结果 = subprocess.run(命令, capture_output=True, timeout=300)
                if 结果.returncode == 0:
                    stdout = 结果.stdout.decode('gbk', errors='replace')
                    文件数 = sum(1 for l in stdout.split("\n") if l.startswith("Extracting") and not l.endswith(":"))
                    return 操作结果.成功(
                        f"✅ 解压完成！(7-Zip)\n压缩包: {os.path.basename(压缩包)}\n解压到: {解压目录}\n解压文件数: {文件数}",
                        元数据={"操作类型": "解压文件", "压缩包": 压缩包, "解压目录": 解压目录, "文件数": 文件数}
                    )
                stderr = 结果.stderr.decode('gbk', errors='replace').strip()
                stdout = 结果.stdout.decode('gbk', errors='replace').strip()
                错误 = stderr or stdout
                # 7z失败则继续尝试Python兜底
            except Exception as e:
                错误 = f"7z执行异常: {e}"

        # 策略2: WinRAR (仅rar)
        rar = _查找WinRAR()
        if rar and 后缀 == ".rar":
            命令 = [rar, "x", "-o+", "-y"]
            if 密码:
                命令.append(f"-p{密码}")
            命令 += [压缩包, 解压目录 + os.sep]
            try:
                结果 = subprocess.run(命令, capture_output=True, timeout=300)
                if 结果.returncode == 0:
                    return 操作结果.成功(
                        f"✅ 解压完成！(WinRAR)\n压缩包: {os.path.basename(压缩包)}\n解压到: {解压目录}",
                        元数据={"操作类型": "解压文件", "压缩包": 压缩包, "解压目录": 解压目录}
                    )
            except:
                pass

        # 策略3: Python内置 (zip/tar/gz)
        if 后缀 == ".zip":
            return self._解压zip(压缩包, 解压目录, 密码)
        elif 后缀 in (".tar", ".gz", ".tgz", ".bz2", ".xz"):
            return self._解压tar(压缩包, 解压目录)

        return 操作结果.失败(
            f"无法解压 {后缀} 文件：{'7-Zip执行失败: ' + 错误 if '错误' in dir() and 错误 else '未安装7-Zip或WinRAR，且Python内置不支持此格式。'}\n"
            f"请确认文件存在且未损坏。如需安装7-Zip: https://www.7-zip.org/"
        )

    def _解压zip(self, 压缩包, 解压目录, 密码):
        try:
            with zipfile.ZipFile(压缩包, 'r') as zf:
                if 密码:
                    zf.setpassword(密码.encode())
                zf.extractall(解压目录)
                文件数 = len(zf.namelist())
            return 操作结果.成功(
                f"✅ 解压完成！(Python内置zipfile)\n压缩包: {os.path.basename(压缩包)}\n解压到: {解压目录}\n解压文件数: {文件数}",
                元数据={"操作类型": "解压文件", "压缩包": 压缩包, "解压目录": 解压目录, "文件数": 文件数}
            )
        except RuntimeError as e:
            if "password" in str(e).lower():
                return 操作结果.失败("需要密码才能解压，请提供密码参数")
            return 操作结果.失败(f"解压失败: {e}")
        except Exception as e:
            return 操作结果.失败(f"解压异常: {e}")

    def _解压tar(self, 压缩包, 解压目录):
        try:
            with tarfile.open(压缩包, 'r:*') as tf:
                tf.extractall(解压目录)
                文件数 = len(tf.getnames())
            return 操作结果.成功(
                f"✅ 解压完成！(Python内置tarfile)\n压缩包: {os.path.basename(压缩包)}\n解压到: {解压目录}\n解压文件数: {文件数}",
                元数据={"操作类型": "解压文件", "压缩包": 压缩包, "解压目录": 解压目录, "文件数": 文件数}
            )
        except Exception as e:
            return 操作结果.失败(f"解压异常: {e}")


class 压缩文件(操作基类):
    名称 = "压缩文件"
    描述 = "将文件或文件夹压缩为7z/zip/tar格式"
    参数结构 = {
        "源路径": {"类型": "字符串", "必填": True, "说明": "要压缩的文件或文件夹路径"},
        "压缩包路径": {"类型": "字符串", "必填": False, "说明": "输出压缩包路径，不填则在源路径同目录生成"},
        "格式": {"类型": "字符串", "必填": False, "说明": "压缩格式：7z(默认)、zip、tar、gz、tar.gz"},
        "压缩级别": {"类型": "字符串", "必填": False, "说明": "压缩级别：存储(0)、最快(1)、快速(3)、正常(5默认)、最大(9)"},
        "密码": {"类型": "字符串", "必填": False, "说明": "设置密码保护（仅7z/zip+7-Zip时有效）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        源路径 = 参数.get("源路径", "").strip()
        if not 源路径:
            return 操作结果.失败("源路径为空")

        if self.文件管理器:
            校验 = self.文件管理器._校验权限(源路径, "读")
            if not 校验["允许"]:
                return 操作结果.失败(校验["原因"])
            源路径 = str(self.文件管理器._解析路径(源路径))

        if not os.path.exists(源路径):
            return 操作结果.失败(f"路径不存在: {源路径}")

        格式 = 参数.get("格式", "7z").strip().lower()

        # 默认输出路径
        压缩包路径 = 参数.get("压缩包路径", "").strip()
        if not 压缩包路径:
            压缩包路径 = 源路径.rstrip("\\/") + f".{格式}"
        else:
            if self.文件管理器:
                压缩包路径 = str(self.文件管理器._解析路径(压缩包路径))

        # 如果目标已存在，自动加序号
        if os.path.exists(压缩包路径):
            基名, 扩展 = os.path.splitext(压缩包路径)
            i = 1
            while os.path.exists(f"{基名}_{i}{扩展}"):
                i += 1
            压缩包路径 = f"{基名}_{i}{扩展}"

        级别映射 = {"存储": 0, "最快": 1, "快速": 3, "正常": 5, "最大": 9}
        级别文本 = 参数.get("压缩级别", "正常")
        级别 = 级别映射.get(级别文本, 5)
        密码 = 参数.get("密码", "")

        # 策略1: 7-Zip (支持7z/zip)
        z7 = _查找7z()
        if z7 and 格式 in ("7z", "zip"):
            命令 = [z7, "a", "-t" + 格式, f"-mx={级别}", 压缩包路径, 源路径, "-y"]
            if 密码:
                命令.append(f"-p{密码}")
                if 格式 == "7z":
                    命令.append("-mhe=on")
            try:
                结果 = subprocess.run(命令, capture_output=True, timeout=600)
                if 结果.returncode == 0:
                    return self._成功返回(源路径, 压缩包路径, 格式, 级别文本, "7-Zip")
            except:
                pass

        # 策略2: WinRAR (仅rar)
        rar = _查找WinRAR()
        if rar and 格式 == "rar":
            命令 = [rar, "a", "-ep1", f"-m{级别}", "-y"]
            if 密码:
                命令.append(f"-p{密码}")
            命令 += [压缩包路径, 源路径]
            try:
                结果 = subprocess.run(命令, capture_output=True, timeout=600)
                if 结果.returncode == 0:
                    return self._成功返回(源路径, 压缩包路径, 格式, 级别文本, "WinRAR")
            except:
                pass

        # 策略3: Python内置 (zip/tar/gz)
        if 格式 == "zip":
            return self._压缩zip(源路径, 压缩包路径, 级别, 密码)
        elif 格式 in ("tar", "gz", "tar.gz", "tgz"):
            return self._压缩tar(源路径, 压缩包路径, 格式)

        # 格式是7z/rar但没有外部工具
        工具列表 = []
        if 格式 == "7z":
            工具列表.append("7-Zip: https://www.7-zip.org/")
        if 格式 == "rar":
            工具列表.append("WinRAR: https://www.win-rar.com/")
        return 操作结果.失败(
            f"无法压缩为 {格式} 格式：未安装7-Zip或WinRAR。\n"
            f"请安装 {' 或 '.join(工具列表)}\n"
            f"或者改用 zip 格式（无需安装额外软件）"
        )

    def _压缩zip(self, 源路径, 压缩包路径, 级别, 密码):
        try:
            zf_mode = zipfile.ZIP_DEFLATED
            zf_level = max(0, min(9, 级别))
            with zipfile.ZipFile(压缩包路径, 'w', compression=zf_mode, compresslevel=zf_level) as zf:
                if os.path.isfile(源路径):
                    zf.write(源路径, os.path.basename(源路径))
                elif os.path.isdir(源路径):
                    基名 = os.path.basename(源路径.rstrip("\\/"))
                    for root, dirs, files in os.walk(源路径):
                        for f in files:
                            完整 = os.path.join(root, f)
                            相对 = os.path.relpath(完整, os.path.dirname(源路径.rstrip("\\/")))
                            zf.write(完整, 相对)
            return self._成功返回(源路径, 压缩包路径, "zip", "Python内置", "Python内置zipfile")
        except Exception as e:
            return 操作结果.失败(f"压缩异常: {e}")

    def _压缩tar(self, 源路径, 压缩包路径, 格式):
        try:
            if 格式 in ("gz", "tar.gz", "tgz"):
                模式 = "w:gz"
            elif 格式 == "bz2":
                模式 = "w:bz2"
            elif 格式 == "xz":
                模式 = "w:xz"
            else:
                模式 = "w"
            with tarfile.open(压缩包路径, 模式) as tf:
                if os.path.isfile(源路径):
                    tf.add(源路径, os.path.basename(源路径))
                else:
                    tf.add(源路径, os.path.basename(源路径.rstrip("\\/")))
            return self._成功返回(源路径, 压缩包路径, 格式, "Python内置", "Python内置tarfile")
        except Exception as e:
            return 操作结果.失败(f"压缩异常: {e}")

    def _成功返回(self, 源路径, 压缩包路径, 格式, 级别文本, 引擎="7-Zip"):
        压缩后大小 = os.path.getsize(压缩包路径)
        源大小 = 0
        if os.path.isfile(源路径):
            源大小 = os.path.getsize(源路径)
        elif os.path.isdir(源路径):
            for root, dirs, files in os.walk(源路径):
                for f in files:
                    try:
                        源大小 += os.path.getsize(os.path.join(root, f))
                    except:
                        pass
        压缩率 = f"{压缩后大小 / 源大小 * 100:.1f}%" if 源大小 > 0 else "N/A"
        return 操作结果.成功(
            f"✅ 压缩完成！({引擎})\n"
            f"源: {os.path.basename(源路径)}\n"
            f"压缩包: {压缩包路径}\n"
            f"格式: {格式} | 级别: {级别文本}\n"
            f"原始大小: {源大小 / 1024 / 1024:.1f} MB\n"
            f"压缩后: {压缩后大小 / 1024 / 1024:.1f} MB\n"
            f"压缩率: {压缩率}",
            元数据={
                "操作类型": "压缩文件", "源路径": 源路径,
                "压缩包路径": 压缩包路径, "格式": 格式,
                "原始大小MB": round(源大小 / 1024 / 1024, 1),
                "压缩后MB": round(压缩后大小 / 1024 / 1024, 1)
            }
        )
