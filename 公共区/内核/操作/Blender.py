"""
Blender操作模块 - 通过TCP Socket连接Blender插件addon.py，操控Blender 3D
协议：JSON over TCP，端口默认9876
addon.py随智能体附带，启动Blender时自动加载，无需手动安装
"""
import socket
import json
import logging
import tempfile
import os
import re
import subprocess
import shutil
import glob as glob_mod
from pathlib import Path

from .基类 import 操作结果, 操作基类

_logger = logging.getLogger("Blender操作")


class Blender连接类:
    """TCP Socket连接到Blender addon.py插件"""
    _实例 = None

    def __init__(self, 主机="localhost", 端口=9876, 超时=180):
        self.主机 = 主机
        self.端口 = 端口
        self.超时 = 超时
        self.sock = None

    def 连接(self) -> bool:
        """建立或复用TCP连接"""
        if self.sock:
            return True
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(10)
            self.sock.connect((self.主机, self.端口))
            Blender连接类._实例 = self
            _logger.info(f"已连接Blender: {self.主机}:{self.端口}")
            return True
        except Exception as e:
            self.sock = None
            _logger.error(f"连接Blender失败: {e}")
            return False

    def 断开(self):
        """断开TCP连接"""
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            finally:
                self.sock = None
                Blender连接类._实例 = None

    def 发送命令(self, 命令类型: str, 参数: dict = None) -> dict:
        """发送JSON命令到Blender，返回结果字典"""
        if not self.sock and not self.连接():
            raise ConnectionError(
                "无法连接Blender。请确认：\n"
                "1. Blender已打开\n"
                "2. 已安装BlenderMCP插件(Edit > Preferences > Add-ons > Install addon.py)\n"
                "3. 在Blender侧栏(按N)找到BlenderMCP面板，点击Connect"
            )

        命令 = {"type": 命令类型, "params": 参数 or {}}
        try:
            self.sock.sendall(json.dumps(命令).encode('utf-8'))
            self.sock.settimeout(self.超时)
            数据 = self._接收完整响应()
            响应 = json.loads(数据.decode('utf-8'))
            if 响应.get("status") == "error":
                raise Exception(响应.get("message", "Blender返回错误"))
            return 响应.get("result", {})
        except socket.timeout:
            self.sock = None
            raise Exception(f"Blender响应超时({self.超时}秒)，请简化操作或检查Blender是否卡住")
        except (ConnectionError, BrokenPipeError, ConnectionResetError) as e:
            self.sock = None
            raise Exception(f"与Blender的连接断开: {e}")
        except json.JSONDecodeError as e:
            raise Exception(f"Blender返回了无效JSON: {e}")
        except Exception as e:
            if "无法连接" in str(e):
                raise
            self.sock = None
            raise Exception(f"与Blender通信失败: {e}")

    def _接收完整响应(self, 缓冲大小=8192) -> bytes:
        """分块接收直到获得完整JSON"""
        块 = []
        while True:
            片段 = self.sock.recv(缓冲大小)
            if not 片段:
                break
            块.append(片段)
            数据 = b''.join(块)
            try:
                json.loads(数据.decode('utf-8'))
                return 数据
            except json.JSONDecodeError:
                continue
        if 块:
            return b''.join(块)
        raise Exception("Blender未返回任何数据")


def _检查连接是否存活(sock) -> bool:
    """非破坏性检测TCP连接是否仍然存活（MSG_PEEK不消费数据）"""
    if not sock:
        return False
    try:
        sock.setblocking(False)
        try:
            data = sock.recv(1, socket.MSG_PEEK)
            if data == b'':
                # 远程已关闭连接
                return False
            # 有数据可读（协议正常不会出现），连接是活的
        except BlockingIOError:
            # 无数据但连接存活
            pass
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError, OSError):
            return False
        finally:
            sock.setblocking(True)
        return True
    except Exception:
        return False


def _检查Blender进程是否运行() -> bool:
    """检查系统中是否有Blender进程正在运行"""
    try:
        if os.name == 'nt':
            result = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq blender.exe", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
            )
            return "blender.exe" in result.stdout.lower()
        else:
            result = subprocess.run(
                ["pgrep", "-x", "blender"],
                capture_output=True, timeout=5
            )
            return result.returncode == 0
    except Exception:
        return False


def _获取连接() -> Blender连接类:
    """获取或创建Blender连接单例，支持自动重连"""
    # 已有连接且存活
    if Blender连接类._实例 and Blender连接类._实例.sock:
        if _检查连接是否存活(Blender连接类._实例.sock):
            return Blender连接类._实例
        # 连接已死，清理
        try:
            Blender连接类._实例.sock.close()
        except Exception:
            pass
        Blender连接类._实例.sock = None
        Blender连接类._实例 = None
    # 尝试重新连接
    连接 = Blender连接类()
    if 连接.连接():
        return 连接
    # 连接失败，检测端口是否开放（Blender可能刚启动）
    检查sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    检查sock.settimeout(2)
    try:
        检查sock.connect(("localhost", 9876))
        检查sock.close()
        # 端口开放但连接失败，重试一次
        连接2 = Blender连接类()
        if 连接2.连接():
            return 连接2
    except Exception:
        pass
    finally:
        try:
            检查sock.close()
        except Exception:
            pass
    # 给出更精确的错误提示
    if _检查Blender进程是否运行():
        raise ConnectionError(
            "检测到Blender进程正在运行，但端口9876未就绪或连接失败。\n"
            "BlenderMCP插件未加载。请调用「Blender启动」操作来自动安装插件并连接。"
        )
    raise ConnectionError(
        "无法连接Blender。请调用「Blender启动」操作来启动Blender并自动加载插件。"
    )


# ===== 操作类 =====


class Blender场景信息(操作基类):
    名称 = "Blender场景信息"
    描述 = '获取当前Blender场景中所有物体列表、相机、灯光等信息。注意：Blender中文版的对象名可能是中文（如"平面"而非"Plane"，"面光"而非"Area"），操作对象前务必先调用此操作获取真实对象名'
    参数结构 = {}

    def 执行(self, 参数: dict, 上下文: dict = None) -> 操作结果:
        try:
            连接 = _获取连接()
            结果 = 连接.发送命令("get_scene_info")
            return 操作结果.成功(
                json.dumps(结果, indent=2, ensure_ascii=False),
                元数据={"操作类型": "Blender场景信息"}
            )
        except Exception as e:
            return 操作结果.失败(str(e))


class Blender物体信息(操作基类):
    名称 = "Blender物体信息"
    描述 = "获取Blender场景中指定物体的详细信息（位置/旋转/缩放/材质/网格等）。注意：物体名必须是场景中真实存在的名称（可能是中文），先用Blender场景信息查看真实名称"
    参数结构 = {
        "物体名": {"类型": "字符串", "必填": True, "说明": "Blender中的物体名称（先用Blender场景信息查看真实名称）"}
    }

    def 执行(self, 参数: dict, 上下文: dict = None) -> 操作结果:
        try:
            连接 = _获取连接()
            结果 = 连接.发送命令("get_object_info", {"name": 参数["物体名"]})
            return 操作结果.成功(
                json.dumps(结果, indent=2, ensure_ascii=False),
                元数据={"操作类型": "Blender物体信息"}
            )
        except Exception as e:
            return 操作结果.失败(str(e))


class Blender执行代码(操作基类):
    名称 = "Blender执行代码"
    描述 = (
        "在Blender中执行Python代码（bpy API）。"
        "【重要规则】1. 不要猜测对象名！Blender中文版的默认名是中文（如primitive_plane_add创建的是'平面'不是'Plane'，primitive_monkey_add创建的是'苏珊娜'不是'Suzanne'）。"
        "2. 创建对象后用 obj = bpy.context.active_object 获取引用，不要用 bpy.data.objects['英文名']。"
        "3. 一次性写完整脚本！不要分步执行（先创建→再改材质→再加灯），应在一个脚本中完成所有操作。"
        "4. 需要先清空场景时用 bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()。"
    )
    参数结构 = {
        "代码": {"类型": "字符串", "必填": True, "说明": "Python代码，使用bpy API操作Blender"}
    }

    def 执行(self, 参数: dict, 上下文: dict = None) -> 操作结果:
        try:
            连接 = _获取连接()
            结果 = 连接.发送命令("execute_code", {"code": 参数["代码"]})
            返回值 = 结果.get("result", "")
            return 操作结果.成功(
                f"代码执行成功: {返回值}" if 返回值 else "代码执行成功",
                元数据={"操作类型": "Blender执行代码"}
            )
        except Exception as e:
            return 操作结果.失败(str(e))


class BlenderPolyHaven状态(操作基类):
    名称 = "Blender PolyHaven状态"
    描述 = "检查Blender中Poly Haven集成是否已启用（免费模型/贴图/HDRI资产库）"
    参数结构 = {}

    def 执行(self, 参数: dict, 上下文: dict = None) -> 操作结果:
        try:
            连接 = _获取连接()
            结果 = 连接.发送命令("get_polyhaven_status")
            启用 = 结果.get("enabled", False)
            消息 = 结果.get("message", "")
            return 操作结果.成功(
                f"Poly Haven {'已启用' if 启用 else '未启用'}。{消息}",
                元数据={"操作类型": "Blender PolyHaven状态"}
            )
        except Exception as e:
            return 操作结果.失败(str(e))


class Blender搜索资产(操作基类):
    名称 = "Blender搜索资产"
    描述 = "在Poly Haven搜索免费3D资产（模型/贴图/HDRI），返回资产列表"
    参数结构 = {
        "资产类型": {
            "类型": "字符串", "必填": False,
            "说明": "hdris/textures/models/all，默认all"
        },
        "分类": {
            "类型": "字符串", "必填": False,
            "说明": "逗号分隔的分类过滤，如 nature,urban"
        }
    }

    def 执行(self, 参数: dict, 上下文: dict = None) -> 操作结果:
        try:
            连接 = _获取连接()
            结果 = 连接.发送命令("search_polyhaven_assets", {
                "asset_type": 参数.get("资产类型", "all"),
                "categories": 参数.get("分类", None)
            })
            if "error" in 结果:
                return 操作结果.失败(结果["error"])
            资产 = 结果.get("assets", {})
            总数 = 结果.get("total_count", 0)
            返回数 = 结果.get("returned_count", 0)
            输出 = f"找到 {总数} 个资产，显示前 {返回数} 个:\n\n"
            for 资产ID, 信息 in sorted(
                资产.items(),
                key=lambda x: x[1].get("download_count", 0),
                reverse=True
            )[:20]:
                输出 += f"- {信息.get('name', 资产ID)} (ID: {资产ID})\n"
                输出 += f"  分类: {', '.join(信息.get('categories', []))}\n"
                输出 += f"  下载量: {信息.get('download_count', '?')}\n"
            return 操作结果.成功(输出, 元数据={
                "操作类型": "Blender搜索资产",
                "总数": 总数
            })
        except Exception as e:
            return 操作结果.失败(str(e))


class Blender下载资产(操作基类):
    名称 = "Blender下载资产"
    描述 = "从Poly Haven下载并导入3D资产到Blender场景（模型/贴图/HDRI）"
    参数结构 = {
        "资产ID": {"类型": "字符串", "必填": True, "说明": "资产ID（从搜索结果获取）"},
        "资产类型": {
            "类型": "字符串", "必填": True,
            "说明": "hdris/textures/models"
        },
        "分辨率": {
            "类型": "字符串", "必填": False,
            "说明": "1k/2k/4k，默认1k"
        }
    }

    def 执行(self, 参数: dict, 上下文: dict = None) -> 操作结果:
        try:
            连接 = _获取连接()
            结果 = 连接.发送命令("download_polyhaven_asset", {
                "asset_id": 参数["资产ID"],
                "asset_type": 参数["资产类型"],
                "resolution": 参数.get("分辨率", "1k"),
                "file_format": None
            })
            if "error" in 结果:
                return 操作结果.失败(结果["error"])
            if 结果.get("success"):
                消息 = 结果.get("message", "资产下载并导入成功")
                资产类型 = 参数["资产类型"]
                if 资产类型 == "hdris":
                    消息 += "。HDRI已设为世界环境光。"
                elif 资产类型 == "textures":
                    材质名 = 结果.get("material", "")
                    贴图 = ", ".join(结果.get("maps", []))
                    消息 += f"。已创建材质'{材质名}'，贴图: {贴图}。"
                elif 资产类型 == "models":
                    消息 += "。模型已导入当前场景。"
                return 操作结果.成功(消息, 元数据={"操作类型": "Blender下载资产"})
            return 操作结果.失败(结果.get("message", "下载失败"))
        except Exception as e:
            return 操作结果.失败(str(e))


class Blender断开(操作基类):
    名称 = "Blender断开"
    描述 = "断开与Blender的TCP连接"
    参数结构 = {}

    def 执行(self, 参数: dict, 上下文: dict = None) -> 操作结果:
        try:
            连接 = Blender连接类._实例
            if 连接:
                连接.断开()
                return 操作结果.成功("已断开与Blender的连接")
            return 操作结果.成功("当前无Blender连接")
        except Exception as e:
            return 操作结果.失败(str(e))


def _查找Blender路径() -> str:
    """在常见位置搜索Blender可执行文件，返回路径或空字符串"""
    # 1. 环境变量
    env_path = os.environ.get("BLENDER_PATH") or os.environ.get("BLENDER")
    if env_path and os.path.isfile(env_path):
        return env_path
    # 2. Windows注册表
    if os.name == 'nt':
        try:
            import winreg
            for key_path in [
                r"SOFTWARE\BlenderFoundation\Blender",
                r"SOFTWARE\Classes\blenderfile\shell\open\command",
            ]:
                try:
                    key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path)
                    val, _ = winreg.QueryValueEx(key, "")
                    winreg.CloseKey(key)
                    if "blender.exe" in val.lower():
                        p = val.split('"')[1] if '"' in val else val.split()[0]
                        if os.path.isfile(p):
                            return p
                except (FileNotFoundError, OSError, IndexError):
                    pass
        except ImportError:
            pass
    # 3. Windows常见安装路径
    if os.name == 'nt':
        候选 = []
        for 驱动器 in ["C:", "D:", "E:", "F:"]:
            候选.append(f"{驱动器}\\Program Files\\Blender Foundation")
            候选.append(f"{驱动器}\\Blender")
        for base in 候选:
            for exe in glob_mod.glob(os.path.join(base, "*", "blender.exe")):
                return exe
            exe = os.path.join(base, "blender.exe")
            if os.path.isfile(exe):
                return exe
    # 4. PATH中查找
    found = shutil.which("blender")
    if found:
        return found
    return ""


def _查找addon路径() -> str:
    """查找addon.py路径：优先研究目录，其次内核同目录"""
    当前目录 = Path(__file__).parent
    项目根 = 当前目录.parent.parent.parent  # 公共区/内核/操作/ → 项目根
    # 研究目录
    研究 = 项目根 / "研究_BlenderMCP" / "addon.py"
    if 研究.exists():
        return str(研究)
    return ""


def _获取Blender版本(blender路径: str) -> str:
    """运行 blender --version 获取版本号（如 '5.1'）"""
    try:
        result = subprocess.run(
            [blender路径, "--version"],
            capture_output=True, text=True, timeout=15,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
        )
        match = re.search(r'Blender\s+(\d+\.\d+)', result.stdout)
        if match:
            return match.group(1)
    except Exception:
        pass
    return ""


def _获取Blender用户目录(blender版本: str = "") -> str:
    """获取Blender用户配置目录（addons放在其下scripts/addons/）"""
    if os.name == 'nt':
        appdata = os.environ.get('APPDATA', '')
        if not appdata:
            return ""
        base = os.path.join(appdata, 'Blender Foundation', 'Blender')
    else:
        base = os.path.join(os.path.expanduser('~'), '.config', 'blender')
    if not os.path.isdir(base):
        return ""
    # 优先使用指定版本
    if blender版本:
        p = os.path.join(base, blender版本)
        if os.path.isdir(p):
            return p
    # 找最新版本目录
    versions = sorted(
        [d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d))],
        reverse=True
    )
    for v in versions:
        return os.path.join(base, v)
    return ""


def _永久安装addon(blender路径: str, addon源路径: str) -> tuple:
    """将addon.py安装到Blender用户目录并启用，返回(成功bool, 消息str)"""
    # 1. 获取Blender版本
    版本 = _获取Blender版本(blender路径)
    if not 版本:
        return False, "无法获取Blender版本"

    # 2. 获取用户目录
    用户目录 = _获取Blender用户目录(版本)
    if not 用户目录:
        return False, f"无法找到Blender用户目录（版本 {版本}）"

    # 3. 复制addon文件到scripts/addons/
    addons目录 = os.path.join(用户目录, 'scripts', 'addons')
    os.makedirs(addons目录, exist_ok=True)
    目标路径 = os.path.join(addons目录, 'blendermcp.py')
    try:
        shutil.copy2(addon源路径, 目标路径)
    except Exception as e:
        return False, f"复制addon失败: {e}"

    # 4. 通过Blender命令行启用addon并保存偏好设置
    启用脚本 = (
        "import bpy\n"
        "try:\n"
        "    bpy.ops.preferences.addon_enable(module='blendermcp')\n"
        "    bpy.ops.wm.save_userpref()\n"
        "    print('ADDON_ENABLED_OK')\n"
        "except Exception as e:\n"
        "    print(f'ADDON_ENABLE_FAIL: {e}')\n"
    )
    try:
        result = subprocess.run(
            [blender路径, '--background', '--python-expr', 启用脚本],
            capture_output=True, text=True, timeout=20,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
        )
        if 'ADDON_ENABLED_OK' in result.stdout:
            return True, f"已安装到 {目标路径} 并已启用"
        # 检查是否已经启用
        if 'addon_enable' in result.stderr and 'already' in result.stderr.lower():
            return True, f"addon已安装到 {目标路径}（之前已启用）"
        return False, f"安装但启用失败: {result.stdout[:300]}"
    except Exception as e:
        return False, f"启用addon失败: {e}"


class Blender启动(操作基类):
    名称 = "Blender启动"
    描述 = (
        "连接Blender。会自动检测：已连接则跳过，Blender已运行但插件未加载则自动安装插件，Blender未运行则自动启动。"
        "当用户说'我已经打开了Blender'或'连接Blender'时，直接调用此操作，不要问用户是否需要重启。"
    )
    参数结构 = {
        "Blender路径": {
            "类型": "字符串", "必填": False,
            "说明": "Blender可执行文件路径，留空则自动查找"
        }
    }

    def 执行(self, 参数: dict, 上下文: dict = None) -> 操作结果:
        try:
            # 1. 先检查已有连接是否存活
            if Blender连接类._实例 and Blender连接类._实例.sock:
                if _检查连接是否存活(Blender连接类._实例.sock):
                    return 操作结果.成功(
                        "Blender已在运行且已连接，无需重复启动。直接使用Blender执行代码等操作即可。"
                    )
                # 连接已死，清理后继续检查端口
                try:
                    Blender连接类._实例.sock.close()
                except Exception:
                    pass
                Blender连接类._实例.sock = None
                Blender连接类._实例 = None

            # 2. 检查端口9876是否已有服务（Blender已启动且addon已加载）
            检查sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            检查sock.settimeout(2)
            端口已开 = False
            try:
                检查sock.connect(("localhost", 9876))
                检查sock.close()
                端口已开 = True
            except (socket.timeout, ConnectionRefusedError):
                pass
            finally:
                try:
                    检查sock.close()
                except Exception:
                    pass

            if 端口已开:
                # Blender已运行且addon已加载，直接建立连接
                连接 = Blender连接类()
                if 连接.连接():
                    return 操作结果.成功(
                        "检测到Blender已在运行（端口9876已就绪），已自动连接。"
                        "直接使用Blender执行代码等操作即可。"
                    )
                # 端口开但连接失败，不启动新Blender
                return 操作结果.失败(
                    "检测到Blender已在运行（端口9876已开），但连接失败。\n"
                    "可能Blender正忙或插件状态异常，请检查Blender后重试。"
                )

            # 3. 端口未开 — 检查是否有Blender进程在运行（addon未加载）
            if _检查Blender进程是否运行():
                # Blender在运行但addon没加载，尝试安装addon
                blender路径 = 参数.get("Blender路径", "") or _查找Blender路径()
                addon路径 = _查找addon路径()
                if blender路径 and addon路径:
                    成功, 消息 = _永久安装addon(blender路径, addon路径)
                    if 成功:
                        return 操作结果.失败(
                            f"检测到Blender已打开，但连接插件未加载。已自动安装插件。\n"
                            f"请关闭Blender再重新打开，插件就会自动生效，然后告诉我连接。"
                        )
                return 操作结果.失败(
                    "检测到Blender已打开，但连接插件未加载。\n"
                    "请关闭Blender再重新打开，然后告诉我连接。"
                )

            # 4. 没有Blender运行，启动新的
            blender路径 = 参数.get("Blender路径", "") or _查找Blender路径()
            if not blender路径:
                提示 = "未找到Blender，请：\n"
                提示 += "1. 安装Blender（https://www.blender.org/download/）\n"
                提示 += "2. 或手动指定路径：调用Blender启动操作，参数传入Blender路径"
                return 操作结果.失败(提示)

            addon路径 = _查找addon路径()
            if not addon路径:
                return 操作结果.失败("未找到addon.py插件文件，请确认研究_BlenderMCP目录存在")

            # 顺带永久安装addon，这样以后用户手动打开Blender也能自动加载
            安装消息 = ""
            try:
                成功, 消息 = _永久安装addon(blender路径, addon路径)
                if 成功:
                    安装消息 = f"\n(已永久安装插件: {消息})"
            except Exception:
                pass

            # 用 --python 参数启动Blender，addon.py会自动执行register()
            命令 = [blender路径, "--python", addon路径]
            _logger.info(f"启动Blender: {命令}")

            if os.name == 'nt':
                subprocess.Popen(
                    命令,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
                )
            else:
                subprocess.Popen(命令, start_new_session=True)

            return 操作结果.成功(
                f"Blender正在启动，插件已自动加载。\n"
                f"路径: {blender路径}\n"
                f"插件: {addon路径}\n"
                f"端口: 9876（约3-5秒后就绪）\n"
                f"启动后可直接对话操控Blender。{安装消息}",
                元数据={"操作类型": "Blender启动"}
            )
        except Exception as e:
            return 操作结果.失败(f"启动Blender失败: {e}")
