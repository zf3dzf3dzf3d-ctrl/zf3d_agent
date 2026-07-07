"""
启动器 - 系统启动入口+模块调度
读取配置 → 加载模块 → 启动服务
"""
import sys
import os
import json

# Windows控制台默认GBK编码，emoji字符会崩溃，强制UTF-8输出
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import importlib.util
from pathlib import Path

# 将内核目录加入搜索路径
内核目录 = Path(__file__).parent
sys.path.insert(0, str(内核目录))

from 配置加载器 import 配置加载器类, 全局事件中心, 全局命令中心
from 模型直连器 import 模型直连器类
from 文件管理器 import 文件管理器类
from 网页服务 import 网页服务类
from 操作注册中心 import 操作注册中心类
from 动态工具加载器 import 动态工具加载器类
from 定时任务与影响分析 import 定时任务调度器
from 运行诊断器 import 运行诊断器类
from Bug追踪器 import Bug追踪器类
from 操作注册中心 import 操作注册中心类
from 动态工具加载器 import 动态工具加载器类
from 定时任务与影响分析 import 定时任务调度器


class 启动器类:
    def __init__(self):
        self.项目根目录 = Path(__file__).parent.parent.parent  # 内核/公共区/项目根
        self.配置加载器 = None
        self.模型直连器 = None
        self.文件管理器 = None
        self.网页服务 = None
        self.操作注册中心 = None
        self.运行诊断器 = None
        self.Bug追踪器 = None
        self.模块注册 = {}
        self.运行中 = False

    def 启动(self):

        """启动系统"""

        import time as _time


        # ── 启动动画 ──
        宽度 = 44
        _z = ['█████','   █ ','  █  ',' █   ','█████']
        _f = ['█████','█    ','████ ','█    ','█    ']
        _3 = ['█████','    █',' ████','    █','█████']
        _d = ['████ ','█   █','█    █','█   █','████ ']
        banner = [
            "+" + "-" * 宽度 + "+",
            "|" + "".center(宽度) + "|",
        ]
        for _i in range(5):
            banner.append("|" + f"  {_z[_i]}  {_f[_i]}  {_3[_i]}  {_d[_i]}".center(宽度) + "|")
        banner.extend([
            "|" + "".center(宽度) + "|",
            "|" + "Zhu Feng Community Agent".center(宽度) + "|",
            "|" + "".center(宽度) + "|",
            "+" + "-" * 宽度 + "+",
        ])


        print()


        for line in banner:


            print("  " + line)


            _time.sleep(0.05)


        版本 = "v3.0.1"

        启动步骤 = []

        def _步(图标, 名称, 状态="...", 详情=""):

            启动步骤.append((图标, 名称, 状态, 详情))


        # ── 1. 加载配置 ──

        _步("📋", "加载配置")

        self.配置加载器 = 配置加载器类(self.项目根目录)

        配置 = self.配置加载器.加载全部配置()

        self.配置加载器.启动热重载()

        启动步骤[-1] = ("📋", "加载配置", "✅", f"{len(配置)}个配置文件, 热重载已启动")

        # ── 2. 模型直连器 ──
        _步("🤖", "模型直连器")
        模型配置 = 配置.get("模型规则", {})
        密钥配置 = 配置.get("密钥", {})
        self.模型直连器 = 模型直连器类(模型配置, 密钥配置)
        连通结果 = self.模型直连器.验证连通性()
        if 连通结果["连通"]:
            启动步骤[-1] = ("🤖", "模型直连器", "✅", "接口连通")
        else:
            启动步骤[-1] = ("🤖", "模型直连器", "⚠️", f"未连通: {连通结果['原因']}")

        # ── 3. 文件管理器+诊断器+Bug追踪器 ──
        _步("🔒", "文件管理器")
        权限配置 = 配置.get("文件权限", {})
        self.文件管理器 = 文件管理器类(权限配置, self.项目根目录)
        启动步骤[-1] = ("🔒", "文件管理器", "✅", "权限校验就绪")

        _步("🔬", "诊断器+Bug追踪器")
        self.运行诊断器 = 运行诊断器类(self.项目根目录)
        self.Bug追踪器 = Bug追踪器类(self.项目根目录)
        启动步骤[-1] = ("🔬", "诊断器+Bug追踪器", "✅", "错误记录+Bug追踪就绪")

        # ── 4. 操作注册中心+动态工具+插件+技能+MCP ──
        _步("⚡", "操作注册中心")
        self.操作注册中心 = 操作注册中心类()
        self.操作注册中心.注册内置操作()
        self.操作注册中心.设置文件管理器(self.文件管理器)
        self.操作注册中心.设置模型直连器(self.模型直连器)
        self.操作注册中心.设置配置加载器(self.配置加载器)
        操作数 = len(self.操作注册中心.列出所有操作())
        启动步骤[-1] = ("⚡", "操作注册中心", "✅", f"{操作数}个内置操作")

        _步("🔧", "动态工具")
        工具声明路径 = self.项目根目录 / "公共区" / "配置" / "工具声明.json"
        self.动态工具加载器 = 动态工具加载器类()
        self.动态工具加载器.从文件加载(str(工具声明路径), 注册目标=self.操作注册中心)
        操作数 = len(self.操作注册中心.列出所有操作())
        启动步骤[-1] = ("🔧", "动态工具", "✅", f"共{操作数}个操作")

        _步("🔌", "插件")
        from 插件加载器 import 插件加载器类
        插件目录 = self.项目根目录 / "公共区" / "插件"
        self.插件加载器 = 插件加载器类()
        self.插件加载器.扫描加载(str(插件目录), 注册目标=self.操作注册中心)
        操作数 = len(self.操作注册中心.列出所有操作())
        启动步骤[-1] = ("🔌", "插件", "✅", f"共{操作数}个操作")

        _step_detail_skills = ""
        _步("🎓", "技能")
        from 技能加载器 import 技能加载器类
        技能目录 = self.项目根目录 / "公共区" / "技能"
        self.技能加载器 = 技能加载器类()
        self.技能加载器.扫描加载(str(技能目录), 注册目标=self.操作注册中心)
        技能数 = len(self.技能加载器.列出技能())
        操作数 = len(self.操作注册中心.列出所有操作())
        启动步骤[-1] = ("🎓", "技能", "✅", f"{技能数}个技能, 共{操作数}个操作")

        _步("🔗", "MCP服务")
        from MCP客户端 import MCP管理器类
        self.MCP管理器 = MCP管理器类()
        MCP配置路径 = self.项目根目录 / "公共区" / "配置" / "MCP服务.json"
        self.MCP管理器.从配置加载(str(MCP配置路径), 注册目标=self.操作注册中心)
        self.操作注册中心.设置MCP管理器(self.MCP管理器)
        操作数 = len(self.操作注册中心.列出所有操作())
        启动步骤[-1] = ("🔗", "MCP服务", "✅", f"共{操作数}个操作")

        # ── 4e2. Blender ──
        _步("🎨", "Blender")
        _blender状态 = "⏭️ 未启用"
        try:
            系统配置 = self.配置加载器.获取配置("系统配置")
            blender配置 = 系统配置.get("Blender", {})
            if blender配置.get("启用", False) and blender配置.get("自动连接", False):
                import threading as _threading
                from 操作.Blender import Blender连接类
                _host = blender配置.get("主机", "localhost")
                _port = blender配置.get("端口", 9876)
                _超时 = blender配置.get("超时秒数", 180)
                def _连blender():
                    连接 = Blender连接类(主机=_host, 端口=_port, 超时=_超时)
                    if 连接.连接():
                        return f"✅ 已连接 {_host}:{_port}"
                    else:
                        return "⚠️ 未连接（插件未启动）"
                _t = _threading.Thread(target=_连blender, daemon=True)
                _t.start()
                _t.join(timeout=5)
            else:
                _blender状态 = "⏭️ 未启用自动连接"
        except Exception as e:
            _blender状态 = f"⚠️ {e}"
        启动步骤[-1] = ("🎨", "Blender", _blender状态.split()[0] if _blender状态 else "✅", _blender状态)

        # ── 4f. 知识库 ──
        _步("📚", "知识库")
        _知识库父目录 = str(self.项目根目录 / "公共区" / "模块" / "记忆")
        if _知识库父目录 not in sys.path:
            sys.path.insert(0, _知识库父目录)
        from 操作.知识库操作 import 设置知识库实例
        from 知识库 import 知识库模块
        知识库配置路径 = self.项目根目录 / "公共区" / "配置" / "知识库配置.json"
        try:
            with open(知识库配置路径, "r", encoding="utf-8") as f:
                知识库配置 = json.load(f)
        except Exception:
            知识库配置 = {}
        知识库配置["项目根目录"] = str(self.项目根目录)
        self.知识库 = 知识库模块()
        self.知识库.初始化(知识库配置)
        设置知识库实例(self.知识库)
        文档数 = len(self.知识库.列出文档())
        启动步骤[-1] = ("📚", "知识库", "✅", f"{文档数}个文档")

        # ── 4g. 剧本管理器 ──
        _步("🎬", "剧本管理器")
        from 剧本管理器 import 获取剧本管理器
        from 操作.剧本操作 import 设置剧本管理器
        self.剧本管理器 = 获取剧本管理器(self.操作注册中心, str(self.项目根目录))
        设置剧本管理器(self.剧本管理器)
        剧本数 = len(self.剧本管理器.列出剧本())
        启动步骤[-1] = ("🎬", "剧本管理器", "✅", f"{剧本数}个剧本")
        print(f"   ✅ 剧本管理器就绪（已保存 {剧本数} 个剧本）")

        # 4h. 初始化系统托盘（仅Windows）
        _步("📌", "系统托盘")
        if sys.platform == 'win32':
            try:
                from 系统托盘 import 系统托盘 as 系统托盘类
                self.系统托盘 = 系统托盘类(self)
                self.系统托盘.启动("朱峰社区智能体 v3.0.1 运行中")
                启动步骤[-1] = ("📌", "系统托盘", "✅", "已创建")
            except Exception as e:
                启动步骤[-1] = ("📌", "系统托盘", "⚠️", str(e)[:50])
        else:
            启动步骤[-1] = ("📌", "系统托盘", "⏭️", "非Windows")

        # 5. 加载模块
        _步("📦", "模块加载")
        模块配置 = 配置.get("模块配置", {})
        已启用列表 = 模块配置.get("已启用", [])
        _模块状态 = []
        for 模块名 in 已启用列表:
            结果 = self._加载模块(模块名, 模块配置.get("配置", {}).get(模块名, {}))
            _模块状态.append(f"{'✅' if 结果 else '❌'}{模块名}")
        启动步骤[-1] = ("📦", "模块加载", "✅", ", ".join(_模块状态))

        # 5a. 注入模块注册到操作注册中心（使记忆操作等可访问记忆模块）
        self.操作注册中心.设置模块注册(self.模块注册)

        # 5b. 启动定时任务调度器
        _步("⏰", "定时任务调度器")
        self.定时任务调度器 = 定时任务调度器(
            操作注册中心=self.操作注册中心,
            项目根目录=str(self.项目根目录)
        )
        self.定时任务调度器.启动()
        启动步骤[-1] = ("⏰", "定时任务调度器", "✅", "已启动")

        # 6. 注册全局命令（静默）
        全局命令中心.注册命令("重载配置", self._命令_重载配置)
        全局命令中心.注册命令("开关模块", self._命令_开关模块)
        全局命令中心.注册命令("退出", self._命令_退出)

        # 6b. 初始化快速呼出轮盘（仅Windows）
        if sys.platform == 'win32':
            _步("⚡", "快速呼出轮盘")
            try:
                快速配置路径 = self.项目根目录 / "公共区" / "配置" / "快速呼出配置.json"
                with open(快速配置路径, "r", encoding="utf-8") as f:
                    快速配置 = json.load(f)
                if 快速配置.get("启用", False):
                    from 快速浮窗 import 快速浮窗
                    from 全局呼出器 import 全局呼出器

                    # 获取用户画像的回调（dict引用，零IO）
                    def 获取画像():
                        记忆模块 = self.模块注册.get("记忆")
                        if 记忆模块:
                            return getattr(记忆模块, "用户画像", {})
                        return {}

                    # TTS回调（走Web服务的 /api/wheel-tts，轮盘独立通道）
                    def TTS回调(文本):
                        import urllib.request
                        try:
                            端口 = 配置.get("系统配置", {}).get("网页端口", 8765)
                            data = json.dumps({"文本": 文本[:500], "音量": 100}).encode("utf-8")
                            req = urllib.request.Request(
                                f"http://localhost:{端口}/api/wheel-tts",
                                data=data,
                                headers={"Content-Type": "application/json"},
                                method="POST"
                            )
                            urllib.request.urlopen(req, timeout=5)
                        except Exception as e:
                            print(f"⚠️ TTS回调失败: {e}")

                    # 获取主对话历史的回调（快速浮窗问答注入上下文）
                    def 获取对话历史():
                        对话模块 = self.模块注册.get("对话")
                        if 对话模块:
                            try:
                                return 对话模块.获取历史()
                            except Exception:
                                return []
                        return []

                    # 追加问答到主对话的回调（双向连通）
                    def 追加到对话(用户消息, 助手回复):
                        对话模块 = self.模块注册.get("对话")
                        if not 对话模块:
                            return
                        try:
                            from datetime import datetime
                            now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                            with 对话模块._锁:
                                对话模块.对话历史.append(
                                    {"角色": "用户", "内容": f"[快速问答] {用户消息}", "时间": now})
                                对话模块.对话历史.append(
                                    {"角色": "助手", "内容": 助手回复, "时间": now})
                            对话模块._保存当前对话()
                        except Exception as e:
                            print(f"⚠️ 快速问答回写主对话失败: {e}")

                    self.快速浮窗 = 快速浮窗(快速配置, self.模型直连器, 获取画像, TTS回调,
                                        获取对话历史, 追加到对话)
                    self.快速浮窗.启动()

                    def 呼出回调(鼠标坐标, 窗口标题, 选中文本):
                        self.快速浮窗.弹出(鼠标坐标, 窗口标题, 选中文本)

                    self.全局呼出器 = 全局呼出器(呼出回调)
                    self.全局呼出器.启动()
                    启动步骤[-1] = ("⚡", "快速呼出轮盘", "✅", "Ctrl+~ 呼出")
                else:
                    启动步骤[-1] = ("⚡", "快速呼出轮盘", "⏭️", "已禁用")
            except Exception as e:
                启动步骤[-1] = ("⚡", "快速呼出轮盘", "⚠️", str(e)[:50])

        # 进化引擎
        进化配置 = 配置.get("模型规则", {}).get("自我进化", {})
        if 进化配置.get("启用", False) and 进化配置.get("进化触发") == "自动":
            _步("🧬", "进化引擎")
            try:
                from 进化引擎 import 进化引擎类
                self.进化引擎 = 进化引擎类(self.模型直连器, self.项目根目录, 进化配置)
                self.进化引擎.启动()
                启动步骤[-1] = ("🧬", "进化引擎", "✅", "已启动")
            except Exception as e:
                启动步骤[-1] = ("🧬", "进化引擎", "⚠️", str(e)[:50])
        else:
            try:
                from 进化引擎 import 进化引擎类
                self._进化引擎类 = 进化引擎类
                self._进化配置 = 进化配置
                _步("🧬", "进化引擎")
                启动步骤[-1] = ("🧬", "进化引擎", "✅", "手动启动")
            except Exception:
                pass

        # 7. 启动Web服务
        系统配置 = 配置.get("系统配置", {})
        端口 = 系统配置.get("网页端口", 8765)
        界面目录 = self.项目根目录 / "公共区" / "界面"

        # ── 恢复下载任务（静默）──
        try:
            from 操作.多线程下载 import 多线程下载
            多线程下载.恢复未完成任务()
        except Exception:
            pass

        # ── 检查语音模型安装中断恢复 ──
        try:
            import tarfile, shutil, tempfile
            # 模型存放在纯英文路径（sherpa-onnx的C++底层不支持中文路径）
            # 优先用Python安装目录旁边，其次系统Temp，最后C盘根目录
            def _找英文目录():
                for p in [Path(sys.executable).parent / "zf3d_voice_model",
                          Path(tempfile.gettempdir()) / "zf3d_voice_model",
                          Path("C:/zf3d_voice_model")]:
                    try:
                        str(p).encode('ascii')
                        p.mkdir(parents=True, exist_ok=True)
                        return p
                    except (UnicodeEncodeError, OSError, PermissionError):
                        continue
                p = Path(tempfile.gettempdir()) / "zf3d_voice_model"
                p.mkdir(parents=True, exist_ok=True)
                return p
            模型目录 = _找英文目录()
            目标目录 = 模型目录 / "paraformer-streaming"
            tar文件 = 模型目录 / "语音模型.tar.bz2"
            if tar文件.exists() and not (目标目录 / "encoder.int8.onnx").exists():
                # tar.bz2 已下完但模型未解压 → 自动解压
                print("📦 检测到流式语音模型未解压，正在解压...")
                目标目录.mkdir(parents=True, exist_ok=True)
                with tarfile.open(str(tar文件), "r:bz2") as tar:
                    for member in tar.getmembers():
                        基名 = os.path.basename(member.name)
                        if 基名 in ("encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"):
                            member.name = 基名
                            tar.extract(member, 目标目录)
                try: os.remove(str(tar文件))
                except: pass
                for d in 模型目录.glob("sherpa-onnx-paraformer-*"):
                    if d.is_dir():
                        shutil.rmtree(d, ignore_errors=True)
                print("✅ 语音模型解压完成")
        except Exception as e:
            print(f"⚠️ 语音模型恢复失败: {e}")

        # ── 6b. 预加载Kokoro TTS引擎（后台线程，不阻塞启动） ──
        try:
            语音输出配置 = 系统配置.get("语音输出", {})
            if 语音输出配置.get("引擎", "本地") == "本地":
                import threading
                def _预加载TTS():
                    try:
                        from 网页服务 import _获取KokoroTTS引擎
                        引擎 = _获取KokoroTTS引擎()
                        if 引擎:
                            print("✅ Kokoro TTS引擎预加载完成")
                        else:
                            print("⚠️ Kokoro TTS引擎未加载（模型可能未下载）")
                    except Exception as e:
                        print(f"⚠️ Kokoro TTS预加载失败: {e}")
                threading.Thread(target=_预加载TTS, daemon=True).start()
        except Exception:
            pass

        # ── 7. Web服务 ──
        系统配置 = 配置.get("系统配置", {})
        端口 = 系统配置.get("网页端口", 8765)
        界面目录 = self.项目根目录 / "公共区" / "界面"
        self.网页服务 = 网页服务类(端口, 界面目录)
        self.运行中 = True
        全局事件中心.发布("系统启动", {})

        # ── 渲染启动摘要 ──
        print()
        for 图标, 名称, 状态, 详情 in 启动步骤:
            if 状态 == "✅":
                标记 = "✅"
            elif 状态 == "⚠️":
                标记 = "⚠"
            elif 状态 == "⏭️":
                标记 = "▶"
            else:
                标记 = "··"
            显示宽 = sum(2 if ord(c) > 127 else 1 for c in 名称)
            补空格 = " " * max(0, 20 - 显示宽)
            print(f"  {名称}{补空格} {标记}  {详情}")
            _time.sleep(0.03)

        print()
        宽 = 50
        print("  " + "+" + "-" * 宽 + "+")
        print("  " + "|" + f"  [OK] System Ready  {版本}".center(宽) + "|")
        print("  " + "|" + f"  http://localhost:{端口}".center(宽) + "|")
        print("  " + "+" + "-" * 宽 + "+")
        print()

        # 自动打开浏览器
        try:
            import webbrowser
            webbrowser.open(f"http://localhost:{端口}")
        except Exception:
            pass

        try:
            self.网页服务.启动(
                文件管理器=self.文件管理器,
                配置加载器=self.配置加载器,
                模型直连器=self.模型直连器,
                模块注册=self.模块注册,
                操作注册中心=self.操作注册中心,
                启动器实例=self,
                运行诊断器=self.运行诊断器
            )
        except KeyboardInterrupt:
            self.停止()

    def 自检(self) -> dict:
        """系统健康自检：检查所有核心组件状态"""
        检查结果 = {"状态": "正常", "项": [], "警告": []}

        # 1. 配置加载
        if self.配置加载器:
            配置数 = len(self.配置加载器.配置缓存)
            检查结果["项"].append({"名称": "配置加载器", "状态": "✅", "详情": f"已加载{配置数}个配置文件"})

        # 2. 模型连通性
        if self.模型直连器:
            连通 = self.模型直连器.验证连通性()
            if 连通["连通"]:
                检查结果["项"].append({"名称": "模型接口", "状态": "✅", "详情": "配置就绪"})
            else:
                检查结果["项"].append({"名称": "模型接口", "状态": "⚠️", "详情": 连通["原因"]})
                检查结果["警告"].append("模型接口未配置，对话功能不可用")

        # 3. 文件管理器
        if self.文件管理器:
            检查结果["项"].append({"名称": "文件管理器", "状态": "✅", "详情": f"已授权{len(self.文件管理器.授权目录)}个目录"})

        # 4. 操作注册中心
        if self.操作注册中心:
            操作数 = len(self.操作注册中心.列出所有操作())
            检查结果["项"].append({"名称": "操作注册中心", "状态": "✅", "详情": f"已注册{操作数}个操作"})

        # 5. 模块状态
        if self.模块注册:
            for 模块名, 模块 in self.模块注册.items():
                模块状态 = getattr(模块, '获取状态', None)
                if 模块状态:
                    try:
                        状态 = 模块状态()
                        检查结果["项"].append({"名称": f"模块:{模块名}", "状态": "✅", "详情": f"消息数:{状态.get('历史消息数','N/A')} 步数:{状态.get('最大步数','N/A')}"})
                    except:
                        检查结果["项"].append({"名称": f"模块:{模块名}", "状态": "⚠️", "详情": "状态获取失败"})
                else:
                    检查结果["项"].append({"名称": f"模块:{模块名}", "状态": "✅", "详情": "已加载"})

        # 6. 隐私区完整性
        隐私检查项 = [
            self.项目根目录 / "隐私区" / "我的配置" / "密钥.json",
            self.项目根目录 / "隐私区" / "我的记忆",
        ]
        for 路径 in 隐私检查项:
            if 路径.exists():
                标签 = "密钥文件" if "密钥" in str(路径) else "记忆目录"
                检查结果["项"].append({"名称": f"隐私:{标签}", "状态": "✅", "详情": "存在"})

        # 总体状态
        if 检查结果["警告"]:
            检查结果["状态"] = "⚠️ 有警告"
        return 检查结果

    def 停止(self):
        """停止系统"""
        print("\n🛑 系统关闭中...")
        self.运行中 = False
        # 立即停止录屏+点击效果子进程（防止关闭后鼠标还有点击音效和圆圈动画）
        try:
            from 录屏器 import 录屏器
            录屏器.停止录制()
        except Exception:
            pass
        for 模块名, 模块实例 in self.模块注册.items():
            try:
                模块实例.停止()
            except Exception:
                pass
        if hasattr(self, 'MCP管理器'):
            self.MCP管理器.断开全部()
        if hasattr(self, '系统托盘'):
            self.系统托盘.停止()
        if hasattr(self, '全局呼出器'):
            self.全局呼出器.停止()
        if hasattr(self, '快速浮窗'):
            self.快速浮窗.停止()
        if hasattr(self, '进化引擎'):
            self.进化引擎.停止()
        # 通知Ollama卸载模型释放显存
        if self.模型直连器 and "localhost:11434" in str(getattr(self.模型直连器, "接口地址", "")):
            try:
                import urllib.request
                # 从配置读模型名
                模型名 = ""
                当前模型 = self.配置加载器.配置缓存.get("模型规则", {}).get("当前模型", "")
                模型列表 = self.配置加载器.配置缓存.get("模型规则", {}).get("模型配置列表", [])
                for m in 模型列表:
                    if m.get("名称") == 当前模型:
                        模型名 = m.get("请求模板", {}).get("model", "")
                        break
                if not 模型名:
                    模型名 = "qwen3:14b"  # fallback
                req = urllib.request.Request(
                    "http://localhost:11434/api/generate",
                    data=json.dumps({"model": 模型名, "keep_alive": 0}).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                urllib.request.urlopen(req, timeout=3)
                print(f"   ✅ 已通知Ollama卸载模型({模型名})释放显存")
            except Exception as e:
                print(f"   ⚠️ 通知Ollama卸载失败: {e}")
        if self.网页服务:
            self.网页服务.停止()
        全局事件中心.发布("系统关闭", {})
        print("✅ 系统已安全关闭")

    def _加载模块(self, 模块名: str, 模块参数: dict) -> bool:
        """加载指定模块"""
        模块目录 = self.项目根目录 / "公共区" / "模块" / 模块名
        声明文件 = 模块目录 / "模块声明.json"
        入口文件 = 模块目录 / "主程序.py"

        if not 入口文件.exists():
            print(f"   ❌ 模块入口文件不存在: {入口文件}")
            return False

        try:
            # 动态导入模块
            规格 = importlib.util.spec_from_file_location(模块名, 入口文件)
            模块 = importlib.util.module_from_spec(规格)
            规格.loader.exec_module(模块)

            # 实例化（约定：主类名=模块名+模块）
            主类名 = 模块名 + "模块"
            if hasattr(模块, 主类名):
                实例 = getattr(模块, 主类名)()
            elif hasattr(模块, "主模块"):
                实例 = 模块.主模块()
            else:
                # 取第一个类
                for 属性名 in dir(模块):
                    属性 = getattr(模块, 属性名)
                    if isinstance(属性, type):
                        实例 = 属性()
                        break
                else:
                    return False

            # 初始化 — 注入核心依赖
            # 合并模型规则.规则到模块参数（让对话模块能读到最大推理步数等配置）
            模型规则_规则 = self.配置加载器.配置缓存.get("模型规则", {}).get("规则", {})
            完整参数 = {
                **模块参数,
                **模型规则_规则,
                "项目根目录": str(self.项目根目录),
                "模型直连器": self.模型直连器,
                "操作注册中心": self.操作注册中心,
                "模块注册": self.模块注册,
                "技能加载器": getattr(self, "技能加载器", None),
                "知识库": getattr(self, "知识库", None)
            }
            实例.初始化(完整参数)
            self.模块注册[模块名] = 实例
            全局事件中心.发布("模块加载", {"模块名": 模块名})
            return True
        except Exception as e:
            print(f"   ❌ 模块加载异常: {str(e)}")
            import traceback
            traceback.print_exc()
            return False

    def _命令_重载配置(self, 参数: dict = None):
        """全局命令：重载配置"""
        self.配置加载器.重载配置()
        return {"成功": True, "消息": "配置已重载"}

    def _命令_开关模块(self, 参数: dict = None):
        """全局命令：开关模块"""
        参数 = 参数 or {}
        模块名 = 参数.get("模块名", "")
        状态 = 参数.get("状态", "")
        if 状态 == "禁用" and 模块名 in self.模块注册:
            self.模块注册[模块名].停止()
            del self.模块注册[模块名]
            return {"成功": True, "消息": f"模块 {模块名} 已禁用"}
        elif 状态 == "启用":
            模块配置 = self.配置加载器.获取配置("模块配置")
            self._加载模块(模块名, 模块配置.get("配置", {}).get(模块名, {}))
            return {"成功": True, "消息": f"模块 {模块名} 已启用"}
        return {"成功": False, "消息": "参数不完整"}

    def _命令_退出(self, 参数: dict = None):
        """全局命令：退出"""
        self.停止()
        return {"成功": True}


if __name__ == "__main__":
    启动器 = 启动器类()
    启动器.启动()
