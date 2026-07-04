"""Houdini 通用汉化工具（支持任意版本）

用法：
    python houdini汉化工具.py              # 安装汉化（交互式选择版本）
    python houdini汉化工具.py 安装          # 安装汉化
    python houdini汉化工具.py 卸载          # 卸载汉化（恢复英文原版）
    python houdini汉化工具.py 状态          # 检查汉化安装状态
    python houdini汉化工具.py 导出字典      # 从20.5汉化包提取翻译字典
    python houdini汉化工具.py 生成          # 用hython为目标版本生成汉化HDA

原理：
    1. 自动检测本机 Houdini 安装路径和版本
    2. 从现有 20.5 汉化包提取翻译字典（英文→中文）
    3. 复制/适配配置文件（Dialogs/toolbar/desktop）
    4. 复制 HDA 文件（快速模式）或用 hython 生成（完整模式）
    5. 首次安装自动备份原始文件

汉化包来源：朱峰社区 https://www.zf3d.com
"""
import os
import sys
import re
import json
import shutil
import subprocess
import pathlib
from pathlib import Path

# 确保 stdout 用 UTF-8（Windows 控制台默认 GBK）
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


# ============================================================
# 常量
# ============================================================
_HERE = Path(__file__).parent.resolve()
_DOCS = Path.home() / "Documents"

# 汉化包搜索路径
_HUAPACK_CANDIDATES = [
    _HERE / "汉化包",
    _HERE / "Houdini20.5中文汉化正式版(朱峰社区)",
    _DOCS / "houdini20.5" / "Houdini20.5中文汉化正式版(朱峰社区)",
]

# Houdini 安装搜索路径
_HFS_CANDIDATES = [
    Path("C:/Program Files/Side Effects Software"),
    Path("C:/Program Files (x86)/Side Effects Software"),
]


# ============================================================
# 模块1: Houdini 版本检测
# ============================================================
def 检测所有Houdini安装():
    """检测本机所有 Houdini 安装，返回列表 [{版本, 路径, hython路径, 用户目录}]"""
    结果 = []

    # 1. HFS 环境变量
    hfs = os.environ.get("HFS")
    if hfs:
        p = Path(hfs)
        if p.exists():
            结果.append(_解析安装路径(p))

    # 2. 扫描 Program Files
    for 基址 in _HFS_CANDIDATES:
        if 基址.exists():
            for d in 基址.iterdir():
                if d.is_dir() and re.match(r'Houdini\s+\d', d.name):
                    信息 = _解析安装路径(d)
                    if 信息 and 信息 not in 结果:
                        结果.append(信息)

    # 3. Windows 注册表
    try:
        import winreg
        for key_path in [r"SOFTWARE\Side Effects Software",
                         r"SOFTWARE\WOW6432Node\Side Effects Software"]:
            try:
                key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path)
                i = 0
                while True:
                    try:
                        子项名 = winreg.EnumKey(key, i)
                        子项 = winreg.OpenKey(key, 子项名)
                        try:
                            install_path, _ = winreg.QueryValueEx(子项, "InstallPath")
                            if install_path:
                                信息 = _解析安装路径(Path(install_path))
                                if 信息 and 信息 not in 结果:
                                    结果.append(信息)
                        except FileNotFoundError:
                            pass
                        winreg.CloseKey(子项)
                        i += 1
                    except OSError:
                        break
                winreg.CloseKey(key)
            except FileNotFoundError:
                pass
    except ImportError:
        pass

    # 去重并排序（新版本在前）
    去重 = {}
    for 项 in 结果:
        if 项:
            key = str(项["路径"])
            if key not in 去重:
                去重[key] = 项
    结果 = sorted(去重.values(), key=lambda x: x["版本"], reverse=True)
    return 结果


def _解析安装路径(路径):
    """从安装路径解析版本信息"""
    # 从目录名提取版本号 (如 "Houdini 20.5.278")
    m = re.search(r'(\d+)\.(\d+)\.(\d+)', 路径.name)
    if not m:
        return None
    主版本 = int(m.group(1))
    次版本 = int(m.group(2))
    补丁号 = int(m.group(3))
    版本字符串 = f"{主版本}.{次版本}.{补丁号}"
    大小版本 = f"{主版本}.{次版本}"

    # 查找 hython.exe
    hython = 路径 / "bin" / "hython.exe"
    hython路径 = str(hython) if hython.exists() else None

    # 用户配置目录
    用户目录 = _DOCS / f"houdini{大小版本}"

    # 内置 otls 路径
    otls路径 = 路径 / "houdini" / "otls"

    return {
        "版本": 版本字符串,
        "大小版本": 大小版本,
        "主版本": 主版本,
        "次版本": 次版本,
        "路径": 路径,
        "hython路径": hython路径,
        "用户目录": 用户目录,
        "otls路径": otls路径 if otls路径.exists() else None,
    }


def 查找汉化包():
    """查找现有 20.5 汉化包目录"""
    for c in _HUAPACK_CANDIDATES:
        if c.exists():
            # 查找内部的 "复制到你的文档houdini20里" 子目录
            子目录 = c / "复制到你的文档houdini20里"
            if 子目录.exists():
                return 子目录
            return c
    # 在用户文档目录中查找
    if _DOCS.exists():
        for d in _DOCS.iterdir():
            if "汉化" in d.name and "Houdini" in d.name:
                子目录 = d / "复制到你的文档houdini20里"
                if 子目录.exists():
                    return 子目录
                # 直接检查 d 是否就是汉化包内容
                if (d / "otls").exists() or (d / "config").exists():
                    return d
    # 在 houdini20.5 用户目录中查找
    hu = _DOCS / "houdini20.5"
    if hu.exists():
        for d in hu.iterdir():
            if "汉化" in d.name and "Houdini" in d.name:
                子目录 = d / "复制到你的文档houdini20里"
                if 子目录.exists():
                    return 子目录
    return None


# ============================================================
# 模块2: 翻译字典构建
# ============================================================
def 解析Dialog脚本(文件路径):
    """从 PSI dialog script 提取英文→中文映射

    格式: PARM_LABEL("中文", "english_parm")
           PARM_LABEL_SIMPLE("中文", "english_parm")
    """
    映射 = {}
    try:
        内容 = 文件路径.read_text(encoding='utf-8', errors='ignore')
    except Exception:
        return 映射

    # 匹配 PARM_LABEL("中文", "english")
    for m in re.finditer(r'PARM_LABEL(?:_SIMPLE)?\(\s*"([^"]+)"\s*,\s*"([^"]+)"', 内容):
        中文, 英文 = m.group(1), m.group(2)
        # 跳过纯英文的"翻译"（未翻译的）
        if any('\u4e00' <= c <= '\u9fff' for c in 中文):
            映射[英文] = 中文
    return 映射


def _修复双重编码(文件路径):
    """检测并修复双重UTF-8编码的文件

    某些汉化包文件被双重UTF-8编码（原始UTF-8字节被当作Latin-1再次编码为UTF-8）。
    本函数尝试检测并修复此问题。
    """
    raw = 文件路径.read_bytes()
    # 先尝试直接UTF-8解码
    text = raw.decode('utf-8', errors='ignore')
    # 检查是否有中文
    有中文 = any('\u4e00' <= c <= '\u9fff' for c in text[:5000])
    if 有中文:
        return text
    # 尝试修复双重编码：UTF-8 → Latin-1 → UTF-8
    try:
        fixed = text.encode('latin-1').decode('utf-8', errors='ignore')
        有中文2 = any('\u4e00' <= c <= '\u9fff' for c in fixed[:5000])
        if 有中文2:
            return fixed
    except Exception:
        pass
    return text


def 解析Toolbar文件(文件路径):
    """从 shelf XML 提取 English----中文 映射"""
    映射 = {}
    try:
        内容 = _修复双重编码(文件路径)
    except Exception:
        return 映射

    # 匹配 label="English----中文" 或 toolSubmenu>English----中文<
    for m in re.finditer(r'"([^"]+?)----([^"]+?)"', 内容):
        英文, 中文 = m.group(1), m.group(2)
        if 中文 and any('\u4e00' <= c <= '\u9fff' for c in 中文):
            映射[英文] = 中文
    # 也匹配 >English----中文< 格式
    for m in re.finditer(r'>([^<]+?)----([^<]+?)<', 内容):
        英文, 中文 = m.group(1).strip(), m.group(2).strip()
        if 中文 and any('\u4e00' <= c <= '\u9fff' for c in 中文):
            映射[英文] = 中文
    return 映射


def 构建翻译字典(汉化包路径):
    """扫描整个汉化包，构建完整翻译字典

    返回: {
        "参数": {"english_parm": "中文参数"},
        "节点": {"english_node": "中文节点名"},
        "工具栏": {"english_label": "中文标签"},
        "统计": {"总条目数": N}
    }
    """
    字典 = {"参数": {}, "节点": {}, "工具栏": {}, "统计": {}}
    已处理文件 = 0

    # 1. 扫描 Dialog 脚本
    dialogs路径 = 汉化包路径 / "config" / "Dialogs"
    if dialogs路径.exists():
        for 版本目录 in dialogs路径.iterdir():
            if not 版本目录.is_dir():
                continue
            for 上下文目录 in 版本目录.iterdir():
                if not 上下文目录.is_dir():
                    continue
                for 节点文件 in 上下文目录.iterdir():
                    if 节点文件.is_file():
                        映射 = 解析Dialog脚本(节点文件)
                        if 映射:
                            字典["参数"].update(映射)
                            # 节点名 = 文件名
                            节点名 = 节点文件.name
                            if any('\u4e00' <= c <= '\u9fff' for c in str(节点名)):
                                字典["节点"][上下文目录.name] = 节点名
                        已处理文件 += 1

    # 2. 扫描 toolbar
    toolbar路径 = 汉化包路径 / "toolbar"
    if toolbar路径.exists():
        for f in toolbar路径.iterdir():
            if f.is_file() and f.suffix in ('.shelf', '.master_shelf', '.json', ''):
                映射 = 解析Toolbar文件(f)
                if 映射:
                    字典["工具栏"].update(映射)
                已处理文件 += 1

    # 3. 扫描 otls 目录获取节点名映射
    otls路径 = 汉化包路径 / "otls"
    if otls路径.exists():
        for f in otls路径.iterdir():
            if f.is_file() and f.suffix in ('.hda', '.hdalc', '.hdanc'):
                # 从文件名提取节点类型 (如 SOP_heightfield_zf3d.hda → heightfield)
                name = f.name
                # 去掉前缀 (SOP_, DOP_, VOP_ 等) 和后缀 (_zf3d.hda)
                m = re.match(r'([A-Z]+)_(.+?)_zf3d\.', name)
                if m:
                    上下文 = m.group(1)
                    节点名 = m.group(2)
                    # 不直接翻译节点名，但记录存在
                    if 上下文 not in 字典["节点"]:
                        字典["节点"][上下文] = {}
                已处理文件 += 1

    字典["统计"]["总条目数"] = len(字典["参数"]) + len(字典["工具栏"])
    字典["统计"]["已处理文件"] = 已处理文件
    return 字典


def 保存翻译字典(字典, 输出路径):
    """保存翻译字典为 JSON"""
    输出路径.write_text(
        json.dumps(字典, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )


def 加载翻译字典(路径=None):
    """加载翻译字典 JSON"""
    if 路径 is None:
        路径 = _HERE / "翻译字典.json"
    if not Path(路径).exists():
        return None
    return json.loads(Path(路径).read_text(encoding='utf-8'))


# ============================================================
# 模块3: 配置文件适配
# ============================================================
def 获取Dialogs版本号(汉化包路径):
    """获取汉化包中 Dialogs 的版本号子目录名"""
    dialogs路径 = 汉化包路径 / "config" / "Dialogs"
    if not dialogs路径.exists():
        return None
    for d in dialogs路径.iterdir():
        if d.is_dir() and re.match(r'\d+\.\d+', d.name):
            return d.name
    return None


def 适配并复制Dialogs(汉化包路径, 目标用户目录, 目标版本号):
    """复制 Dialogs 目录，适配版本号

    目标版本号: 如 "21.0.123"
    """
    源dialogs = 汉化包路径 / "config" / "Dialogs"
    if not 源dialogs.exists():
        return 0, "汉化包中无 config/Dialogs 目录"

    源版本号 = 获取Dialogs版本号(汉化包路径)
    if not 源版本号:
        return 0, "无法确定 Dialogs 源版本号"

    目标dialogs = 目标用户目录 / "config" / "Dialogs" / 目标版本号
    目标dialogs.mkdir(parents=True, exist_ok=True)

    源版本目录 = 源dialogs / 源版本号
    复制数 = 0

    for 上下文目录 in 源版本目录.iterdir():
        if not 上下文目录.is_dir():
            continue
        目标上下文 = 目标dialogs / 上下文目录.name
        目标上下文.mkdir(parents=True, exist_ok=True)
        for f in 上下文目录.iterdir():
            if f.is_file():
                内容 = f.read_text(encoding='utf-8', errors='ignore')
                # 替换 PSI 脚本中的版本号
                内容 = 内容.replace(
                    f"PSI version {源版本号}",
                    f"PSI version {目标版本号}"
                )
                (目标上下文 / f.name).write_text(内容, encoding='utf-8')
                复制数 += 1

    return 复制数, f"Dialogs: {源版本号} → {目标版本号}"


def 复制配置目录(汉化包路径, 目标用户目录):
    """复制 toolbar/desktop/radialmenu 等配置目录"""
    结果 = []
    for 目录名 in ["toolbar", "desktop", "radialmenu"]:
        源 = 汉化包路径 / 目录名
        if 源.exists():
            目标 = 目标用户目录 / 目录名
            目标.mkdir(parents=True, exist_ok=True)
            文件数 = 0
            for f in 源.rglob("*"):
                if f.is_file():
                    相对 = f.relative_to(源)
                    目标文件 = 目标 / 相对
                    目标文件.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(f), str(目标文件))
                    文件数 += 1
            结果.append(f"{目录名}: {文件数}个文件")
    return 结果


# ============================================================
# 模块4: HDA 文件处理
# ============================================================
def 快速复制HDA(汉化包路径, 目标用户目录):
    """快速模式：直接复制 20.5 的 HDA 文件到目标目录"""
    源otls = 汉化包路径 / "otls"
    if not 源otls.exists():
        return 0, "汉化包中无 otls 目录"

    目标otls = 目标用户目录 / "otls"
    目标otls.mkdir(parents=True, exist_ok=True)

    复制数 = 0
    跳过数 = 0
    for f in 源otls.iterdir():
        if f.is_file() and f.suffix in ('.hda', '.hdalc', '.hdanc'):
            shutil.copy2(str(f), str(目标otls / f.name))
            复制数 += 1
        else:
            跳过数 += 1

    return 复制数, f"HDA: 复制{复制数}个, 跳过{跳过数}个"


def 生成hython提取脚本(输出路径, 翻译字典路径):
    """生成 hython 脚本：提取目标版本所有节点定义

    输出 JSON 文件包含每个节点类型的参数标签列表
    """
    脚本 = '''#!/usr/bin/env hython
"""自动生成的 hython 脚本：提取 Houdini 节点定义"""
import hou
import json
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# 所有节点类型类别
CATEGORIES = {
    "SOP": hou.sopNodeTypeCategory,
    "DOP": hou.dopNodeTypeCategory,
    "VOP": hou.vopNodeTypeCategory,
    "OBJ": hou.objNodeTypeCategory,
    "LOP": hou.lopNodeTypeCategory,
    "ROP": hou.ropNodeTypeCategory,
    "CHOP": hou.chopNodeTypeCategory,
    "SHOP": hou.shopNodeTypeCategory,
    "COP2": hou.cop2NodeTypeCategory,
    "TOP": hou.topNodeTypeCategory,
}

结果 = {}

for 类别名, 类别函数 in CATEGORIES.items():
    try:
        类别 = 类别函数()
    except Exception:
        continue
    类型们 = 类别.nodeTypes()
    for 类型名, 类型 in 类型们.items():
        try:
            定义 = 类型.definition()
            if 定义 is None:
                continue

            # 获取参数模板组
            parm_group = 定义.parmTemplateGroup()
            参数们 = []
            for parm in parm_group.parmTemplates():
                标签 = parm.label()
                名称 = parm.name()
                参数们.append({"name": 名称, "label": 标签})

            # 节点描述
            描述 = 类型.description()
            中文描述 = 类型.descriptionTranslated()

            结果[f"{类别名}/{类型名}"] = {
                "category": 类别名,
                "type": 类型名,
                "description": 描述,
                "description_translated": 中文描述,
                "params": 参数们,
            }
        except Exception as e:
            pass

# 输出 JSON
print(json.dumps(结果, ensure_ascii=False, indent=2))
'''
    输出路径.write_text(脚本, encoding='utf-8')
    return 输出路径


_HYTHON_TRANSLATE_TEMPLATE = '''#!/usr/bin/env hython
"""自动生成的 hython 脚本：生成汉化 HDA 文件"""
import hou
import json
import sys
import os
import shutil
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# 加载翻译字典
DICT_PATH = r"__DICT_PATH__"
TARGET_OTLS = r"__TARGET_OTLS__"
BUILTIN_OTLS = r"__BUILTIN_OTLS__"

with open(DICT_PATH, 'r', encoding='utf-8') as f:
    翻译字典 = json.load(f)

参数字典 = 翻译字典.get("参数", {})

# 所有节点类型类别
CATEGORIES = {
    "SOP": hou.sopNodeTypeCategory,
    "DOP": hou.dopNodeTypeCategory,
    "VOP": hou.vopNodeTypeCategory,
    "OBJ": hou.objNodeTypeCategory,
    "LOP": hou.lopNodeTypeCategory,
    "ROP": hou.ropNodeTypeCategory,
    "CHOP": hou.chopNodeTypeCategory,
    "SHOP": hou.shopNodeTypeCategory,
    "COP2": hou.cop2NodeTypeCategory,
    "TOP": hou.topNodeTypeCategory,
}

统计 = {"处理": 0, "翻译": 0, "跳过": 0, "错误": 0}

# 确保目标目录存在
os.makedirs(TARGET_OTLS, exist_ok=True)

for 类别名, 类别函数 in CATEGORIES.items():
    try:
        类别 = 类别函数()
    except Exception:
        continue

    类型们 = 类别.nodeTypes()
    for 类型名, 类型 in 类型们.items():
        try:
            定义 = 类型.definition()
            if 定义 is None:
                continue

            # 获取 HDA 文件路径
            hda路径 = 定义.filePath()
            if not hda路径 or hda路径 == "Embedded":
                统计["跳过"] += 1
                continue

            # 构造目标文件名
            类型名_安全 = 类型名.replace("/", "_").replace(" ", "_")
            目标文件 = os.path.join(TARGET_OTLS, 类别名 + "_" + 类型名_安全 + "_zf3d.hda")

            # 复制原始 HDA
            shutil.copy2(hda路径, 目标文件)

            # 安装到 hython
            hou.hda.installFile(目标文件)
            定义们 = hou.hda.definitionsInFile(目标文件)

            for 定义 in 定义们:
                # 修改参数标签
                parm_group = 定义.parmTemplateGroup()
                修改数 = 0

                for parm in parm_group.parmTemplates():
                    英文标签 = parm.label()
                    if 英文标签 in 参数字典:
                        parm.setLabel(参数字典[英文标签])
                        修改数 += 1
                    # 递归处理文件夹内的参数
                    if hasattr(parm, 'parmTemplates'):
                        for 子parm in parm.parmTemplates():
                            英文 = 子parm.label()
                            if 英文 in 参数字典:
                                子parm.setLabel(参数字典[英文])
                                修改数 += 1

                if 修改数 > 0:
                    定义.setParmTemplateGroup(parm_group)
                    统计["翻译"] += 1
                else:
                    统计["跳过"] += 1

            # 卸载 HDA
            hou.hda.uninstallFile(目标文件)
            统计["处理"] += 1

        except Exception as e:
            统计["错误"] += 1

print(json.dumps(统计, ensure_ascii=False))
'''


def 生成hython汉化脚本(输出路径, 翻译字典路径, 目标otls目录, 内置otls路径):
    """生成 hython 脚本：用翻译字典修改 HDA 并保存到用户目录"""
    脚本 = _HYTHON_TRANSLATE_TEMPLATE
    脚本 = 脚本.replace("__DICT_PATH__", str(翻译字典路径))
    脚本 = 脚本.replace("__TARGET_OTLS__", str(目标otls目录))
    脚本 = 脚本.replace("__BUILTIN_OTLS__", str(内置otls路径) if 内置otls路径 else "")
    输出路径.write_text(脚本, encoding='utf-8')
    return 输出路径


def 运行hython(hython路径, 脚本路径, 输出文件=None):
    """执行 hython 脚本，返回 (成功, 输出)"""
    cmd = [hython路径, str(脚本路径)]
    try:
        结果 = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,
            encoding='utf-8',
            errors='replace'
        )
        return 结果.returncode == 0, 结果.stdout, 结果.stderr
    except subprocess.TimeoutExpired:
        return False, "", "hython 执行超时（5分钟）"
    except Exception as e:
        return False, "", str(e)


# ============================================================
# 模块5: 备份与恢复
# ============================================================
def 获取备份目录(用户目录):
    """获取备份目录路径"""
    版本 = 用户目录.name.replace("houdini", "")
    return 用户目录.parent / f"houdini{版本}_英文原版备份"


def 创建备份(用户目录):
    """首次安装时备份原始用户目录"""
    备份目录 = 获取备份目录(用户目录)
    if 备份目录.exists():
        return True, "备份已存在，跳过"

    if not 用户目录.exists():
        用户目录.mkdir(parents=True, exist_ok=True)
        备份目录.mkdir(parents=True, exist_ok=True)
        return True, "用户目录不存在，创建空目录+空备份标记"

    try:
        shutil.copytree(str(用户目录), str(备份目录))
        return True, f"已备份到 {备份目录}"
    except Exception as e:
        return False, f"备份失败: {e}"


def 从备份恢复(用户目录):
    """从备份恢复英文原版"""
    备份目录 = 获取备份目录(用户目录)
    if not 备份目录.exists():
        return False, f"未找到备份: {备份目录}"

    try:
        # 清理当前用户目录内容
        for item in 用户目录.iterdir():
            if item.is_dir():
                shutil.rmtree(str(item))
            else:
                item.unlink()

        # 从备份恢复
        for item in 备份目录.iterdir():
            dest = 用户目录 / item.name
            if item.is_dir():
                shutil.copytree(str(item), str(dest))
            else:
                shutil.copy2(str(item), str(dest))

        return True, "已从备份恢复英文原版"
    except Exception as e:
        return False, f"恢复失败: {e}"


# ============================================================
# 模块6: 文件计数
# ============================================================
def _统计文件数(路径):
    """统计目录下文件数"""
    count = 0
    if not Path(路径).exists():
        return 0
    for root, dirs, files in os.walk(str(路径)):
        count += len(files)
    return count


# ============================================================
# 命令: 安装
# ============================================================
def do_install(目标版本=None):
    """安装汉化"""
    print("=" * 60)
    print("  Houdini 通用汉化工具")
    print("  汉化来源：朱峰社区 https://www.zf3d.com")
    print("=" * 60)

    # 1. 检测 Houdini 安装
    安装列表 = 检测所有Houdini安装()
    if not 安装列表:
        print("\n❌ 未检测到任何 Houdini 安装！")
        print("   请先安装 Houdini（支持 19.5+）")
        return False

    print(f"\n📦 检测到 {len(安装列表)} 个 Houdini 安装：")
    for i, 安装 in enumerate(安装列表):
        hython状态 = "✅" if 安装["hython路径"] else "❌"
        print(f"   {i+1}. Houdini {安装['版本']} {hython状态}hython")
        print(f"      路径: {安装['路径']}")
        print(f"      用户目录: {安装['用户目录']}")

    # 2. 选择目标版本
    if 目标版本:
        安装 = next((a for a in 安装列表 if a["大小版本"] == 目标版本), None)
        if not 安装:
            print(f"\n❌ 未找到 Houdini {目标版本}")
            return False
    else:
        try:
            选择 = input(f"\n选择要汉化的版本 (1-{len(安装列表)})，回车=最新: ").strip()
            if 选择 == "":
                安装 = 安装列表[0]
            else:
                idx = int(选择) - 1
                安装 = 安装列表[idx]
        except (ValueError, IndexError, EOFError):
            安装 = 安装列表[0]

    print(f"\n🎯 目标: Houdini {安装['版本']}")

    # 3. 查找汉化包
    汉化包 = 查找汉化包()
    if not 汉化包:
        print("\n❌ 未找到汉化包！")
        print("   请将 20.5 汉化包放在以下位置之一：")
        for c in _HUAPACK_CANDIDATES:
            print(f"   - {c}")
        return False

    print(f"📁 汉化包: {汉化包}")

    # 4. 首次备份
    用户目录 = 安装["用户目录"]
    用户目录.mkdir(parents=True, exist_ok=True)
    成功, 消息 = 创建备份(用户目录)
    print(f"\n📦 备份: {消息}")
    if not 成功:
        print("   请手动备份后重试")
        return False

    # 5. 构建翻译字典
    print(f"\n📖 构建翻译字典...")
    字典 = 构建翻译字典(汉化包)
    字典路径 = _HERE / "翻译字典.json"
    保存翻译字典(字典, 字典路径)
    print(f"   ✅ 提取 {字典['统计']['总条目数']} 条翻译（{字典['统计']['已处理文件']}个文件）")
    print(f"   保存到: {字典路径}")

    # 6. 复制配置文件
    print(f"\n📋 复制配置文件...")
    # Dialogs（适配版本号）
    目标版本号 = 安装["版本"].replace(".", ".")
    # 确保3段式版本号 (如 21.0.123)
    版本部分 = 安装["版本"].split(".")
    if len(版本部分) == 2:
        目标版本号 = f"{版本部分[0]}.{版本部分[1]}.0"

    dialog数, dialog消息 = 适配并复制Dialogs(汉化包, 用户目录, 目标版本号)
    print(f"   {dialog消息}, {dialog数}个文件")

    # 其他配置目录
    配置结果 = 复制配置目录(汉化包, 用户目录)
    for r in 配置结果:
        print(f"   {r}")

    # 7. 复制 HDA 文件
    print(f"\n📦 复制 HDA 文件...")
    hda数, hda消息 = 快速复制HDA(汉化包, 用户目录)
    print(f"   {hda消息}")

    # 8. 如有 hython，尝试生成精确翻译
    if 安装["hython路径"]:
        print(f"\n🔧 检测到 hython，尝试精确翻译...")
        print(f"   hython: {安装['hython路径']}")

        # 生成提取脚本
        提取脚本 = _HERE / "_hython_extract.py"
        生成hython提取脚本(提取脚本, 字典路径)

        成功, 输出, 错误 = 运行hython(安装["hython路径"], 提取脚本)
        if 成功:
            try:
                节点数据 = json.loads(输出)
                print(f"   ✅ 提取 {len(节点数据)} 个节点定义")
                # 保存节点定义供后续使用
                节点定义路径 = _HERE / f"节点定义_{安装['版本']}.json"
                节点定义路径.write_text(
                    json.dumps(节点数据, ensure_ascii=False, indent=2),
                    encoding='utf-8'
                )
                print(f"   保存到: {节点定义路径}")

                # 生成汉化 HDA（可选，耗时较长）
                try:
                    ans = input("\n   是否用 hython 生成精确汉化 HDA？（较慢）(y/n): ").strip().lower()
                    if ans in ("y", "yes", ""):
                        目标otls = 用户目录 / "otls"
                        汉化脚本 = _HERE / "_hython_translate.py"
                        内置otls = 安装.get("otls路径")
                        生成hython汉化脚本(
                            汉化脚本, 字典路径,
                            str(目标otls),
                            str(内置otls) if 内置otls else ""
                        )
                        成功2, 输出2, 错误2 = 运行hython(安装["hython路径"], 汉化脚本)
                        if 成功2:
                            print(f"   ✅ hython 翻译完成: {输出2.strip()}")
                        else:
                            print(f"   ⚠️ hython 翻译失败: {错误2}")
                except (EOFError, KeyboardInterrupt):
                    print("   跳过")
            except json.JSONDecodeError:
                print(f"   ⚠️ hython 输出解析失败")
                if 输出:
                    print(f"   输出前200字符: {输出[:200]}")
        else:
            print(f"   ⚠️ hython 执行失败: {错误[:200]}")
            print(f"   已使用快速模式（直接复制 HDA）")
    else:
        print(f"\n💡 未检测到 hython，使用快速模式（直接复制 HDA）")
        print(f"   新增/修改的节点可能没有翻译")

    # 清理临时脚本
    for 临时 in ["_hython_extract.py", "_hython_translate.py"]:
        f = _HERE / 临时
        if f.exists():
            try:
                f.unlink()
            except Exception:
                pass

    # 9. 完成
    print(f"\n{'=' * 60}")
    print(f"  ✅ 汉化安装完成！")
    print(f"  目标: Houdini {安装['版本']}")
    print(f"  用户目录: {用户目录}")
    print(f"  备份: {获取备份目录(用户目录)}")
    print(f"{'=' * 60}")
    print(f"\n下一步：")
    print(f"  1. 启动 Houdini {安装['大小版本']}")
    print(f"  2. 界面和节点参数应显示中文")
    print(f"  3. 如需恢复英文：python houdini汉化工具.py 卸载")
    print()
    return True


# ============================================================
# 命令: 卸载
# ============================================================
def do_uninstall(目标版本=None):
    """卸载汉化"""
    print("=" * 60)
    print("  Houdini 汉化卸载（恢复英文原版）")
    print("=" * 60)

    安装列表 = 检测所有Houdini安装()
    if not 安装列表:
        print("\n❌ 未检测到 Houdini 安装")
        return False

    if 目标版本:
        安装 = next((a for a in 安装列表 if a["大小版本"] == 目标版本), None)
        if not 安装:
            print(f"\n❌ 未找到 Houdini {目标版本}")
            return False
    else:
        print("\n检测到以下版本：")
        for i, a in enumerate(安装列表):
            备份 = 获取备份目录(a["用户目录"])
            状态 = "✅有备份" if 备份.exists() else "❌无备份"
            print(f"  {i+1}. Houdini {a['版本']} {状态}")
        try:
            选择 = input(f"\n选择要卸载的版本 (1-{len(安装列表)})，回车=最新: ").strip()
            if 选择 == "":
                安装 = 安装列表[0]
            else:
                安装 = 安装列表[int(选择) - 1]
        except (ValueError, IndexError, EOFError):
            安装 = 安装列表[0]

    用户目录 = 安装["用户目录"]
    成功, 消息 = 从备份恢复(用户目录)
    if 成功:
        print(f"\n{'=' * 60}")
        print(f"  ✅ {消息}")
        print(f"{'=' * 60}")
        print(f"  重启 Houdini 即可使用英文界面。")
    else:
        print(f"\n❌ {消息}")
    print()
    return 成功


# ============================================================
# 命令: 状态
# ============================================================
def do_status():
    """检查汉化状态"""
    print("=" * 60)
    print("  Houdini 汉化状态检查")
    print("=" * 60)

    # 1. 检测 Houdini 安装
    安装列表 = 检测所有Houdini安装()
    if not 安装列表:
        print("\n❌ 未检测到 Houdini 安装")
        return

    print(f"\n📦 检测到 {len(安装列表)} 个 Houdini 安装：")
    for 安装 in 安装列表:
        print(f"\n  ── Houdini {安装['版本']} ──")
        print(f"  路径: {安装['路径']}")
        print(f"  hython: {'✅' if 安装['hython路径'] else '❌'} {安装['hython路径'] or '未找到'}")
        print(f"  用户目录: {安装['用户目录']} ({'存在' if 安装['用户目录'].exists() else '不存在'})")

        备份 = 获取备份目录(安装["用户目录"])
        print(f"  英文备份: {'✅已备份' if 备份.exists() else '❌未备份'}")

        # 检查汉化文件
        if 安装["用户目录"].exists():
            otls = 安装["用户目录"] / "otls"
            if otls.exists():
                hda数 = len(list(otls.glob("*_zf3d.*")))
                print(f"  汉化HDA: {hda数}个" + (" ✅" if hda数 > 0 else " ❌"))
            else:
                print(f"  汉化HDA: 无 otls 目录 ❌")

            dialogs = 安装["用户目录"] / "config" / "Dialogs"
            if dialogs.exists():
                版本们 = [d.name for d in dialogs.iterdir() if d.is_dir()]
                print(f"  Dialogs: {', '.join(版本们) if 版本们 else '空'}")
            else:
                print(f"  Dialogs: 无 ❌")

            toolbar = 安装["用户目录"] / "toolbar"
            if toolbar.exists():
                shelf数 = len(list(toolbar.glob("*.shelf"))) + len(list(toolbar.glob("*.master_shelf")))
                print(f"  工具栏: {shelf数}个shelf文件")
            else:
                print(f"  工具栏: 无 ❌")

    # 2. 检查汉化包
    汉化包 = 查找汉化包()
    print(f"\n📋 汉化包: {'✅ ' + str(汉化包) if 汉化包 else '❌ 未找到'}")

    # 3. 检查翻译字典
    字典路径 = _HERE / "翻译字典.json"
    if 字典路径.exists():
        try:
            字典 = json.loads(字典路径.read_text(encoding='utf-8'))
            print(f"📖 翻译字典: ✅ {字典['统计']['总条目数']}条翻译")
        except Exception:
            print(f"📖 翻译字典: ⚠️ 文件损坏")
    else:
        print(f"📖 翻译字典: ❌ 未生成（运行 '导出字典' 生成）")
    print()


# ============================================================
# 命令: 导出字典
# ============================================================
def do_export_dict():
    """从 20.5 汉化包提取翻译字典"""
    print("=" * 60)
    print("  翻译字典导出工具")
    print("=" * 60)

    汉化包 = 查找汉化包()
    if not 汉化包:
        print("\n❌ 未找到汉化包！")
        for c in _HUAPACK_CANDIDATES:
            print(f"   - {c}")
        return False

    print(f"\n📁 汉化包: {汉化包}")
    print(f"\n📖 扫描并构建翻译字典...")

    字典 = 构建翻译字典(汉化包)
    字典路径 = _HERE / "翻译字典.json"
    保存翻译字典(字典, 字典路径)

    print(f"\n{'=' * 60}")
    print(f"  ✅ 翻译字典已导出")
    print(f"{'=' * 60}")
    print(f"  文件: {字典路径}")
    print(f"  参数翻译: {len(字典['参数'])} 条")
    print(f"  工具栏翻译: {len(字典['工具栏'])} 条")
    print(f"  总计: {字典['统计']['总条目数']} 条")
    print(f"  处理文件: {字典['统计']['已处理文件']} 个")
    print()

    # 显示前20条样例
    print("  样例（前20条参数翻译）：")
    for i, (英, 中) in enumerate(list(字典["参数"].items())[:20]):
        print(f"    {英} → {中}")
    print()
    return True


# ============================================================
# 命令: 生成（用hython为目标版本生成汉化）
# ============================================================
def do_generate(目标版本=None):
    """用 hython 为目标版本生成汉化 HDA"""
    print("=" * 60)
    print("  Houdini 精确汉化生成（hython 模式）")
    print("=" * 60)

    安装列表 = 检测所有Houdini安装()
    有hython的 = [a for a in 安装列表 if a["hython路径"]]

    if not 有hython的:
        print("\n❌ 未检测到 hython！")
        print("   请确保 Houdini 完整安装（包含 bin/hython.exe）")
        return False

    if 目标版本:
        安装 = next((a for a in 有hython的 if a["大小版本"] == 目标版本), None)
        if not 安装:
            print(f"\n❌ 未找到带 hython 的 Houdini {目标版本}")
            return False
    else:
        print(f"\n检测到以下可用版本：")
        for i, a in enumerate(有hython的):
            print(f"  {i+1}. Houdini {a['版本']}")
        try:
            选择 = input(f"\n选择版本 (1-{len(有hython的)})，回车=最新: ").strip()
            if 选择 == "":
                安装 = 有hython的[0]
            else:
                安装 = 有hython的[int(选择) - 1]
        except (ValueError, IndexError, EOFError):
            安装 = 有hython的[0]

    print(f"\n🎯 目标: Houdini {安装['版本']}")
    print(f"   hython: {安装['hython路径']}")

    # 加载翻译字典
    字典路径 = _HERE / "翻译字典.json"
    if not 字典路径.exists():
        print("\n📖 翻译字典不存在，先从 20.5 汉化包提取...")
        汉化包 = 查找汉化包()
        if not 汉化包:
            print("❌ 未找到汉化包")
            return False
        字典 = 构建翻译字典(汉化包)
        保存翻译字典(字典, 字典路径)
    else:
        print(f"📖 使用已有翻译字典: {字典路径}")

    # 用户目录
    用户目录 = 安装["用户目录"]
    用户目录.mkdir(parents=True, exist_ok=True)

    # 首次备份
    成功, 消息 = 创建备份(用户目录)
    print(f"📦 {消息}")

    # 生成提取脚本
    print(f"\n🔧 步骤1: 提取节点定义...")
    提取脚本 = _HERE / "_hython_extract.py"
    生成hython提取脚本(提取脚本, 字典路径)

    成功, 输出, 错误 = 运行hython(安装["hython路径"], 提取脚本)
    if not 成功:
        print(f"❌ 提取失败: {错误[:500]}")
        return False

    try:
        节点数据 = json.loads(输出)
    except json.JSONDecodeError:
        print(f"❌ 输出解析失败")
        print(f"输出前500字符: {输出[:500]}")
        return False

    print(f"✅ 提取 {len(节点数据)} 个节点定义")

    # 保存节点定义
    节点定义路径 = _HERE / f"节点定义_{安装['版本']}.json"
    节点定义路径.write_text(
        json.dumps(节点数据, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )
    print(f"   保存到: {节点定义路径}")

    # 生成汉化 HDA
    print(f"\n🔧 步骤2: 生成汉化 HDA...")
    目标otls = 用户目录 / "otls"
    汉化脚本 = _HERE / "_hython_translate.py"
    内置otls = 安装.get("otls路径")

    生成hython汉化脚本(
        汉化脚本, 字典路径,
        str(目标otls),
        str(内置otls) if 内置otls else ""
    )

    成功, 输出, 错误 = 运行hython(安装["hython路径"], 汉化脚本)
    if 成功:
        try:
            统计 = json.loads(输出.strip().split('\n')[-1])
            print(f"✅ 生成完成: 处理{统计.get('处理',0)}个, 翻译{统计.get('翻译',0)}个, 跳过{统计.get('跳过',0)}个, 错误{统计.get('错误',0)}个")
        except (json.JSONDecodeError, IndexError):
            print(f"✅ 生成完成: {输出.strip()[-200:]}")
    else:
        print(f"❌ 生成失败: {错误[:500]}")

    # 清理临时脚本
    for 临时 in ["_hython_extract.py", "_hython_translate.py"]:
        f = _HERE / 临时
        if f.exists():
            try:
                f.unlink()
            except Exception:
                pass

    print(f"\n{'=' * 60}")
    print(f"  ✅ 精确汉化生成完成！")
    print(f"  HDA 文件: {目标otls}")
    print(f"{'=' * 60}")
    print()
    return True


# ============================================================
# 主入口
# ============================================================
if __name__ == "__main__":
    if len(sys.argv) > 1:
        cmd = sys.argv[1]

        if cmd in ("安装", "install"):
            目标 = sys.argv[2] if len(sys.argv) > 2 else None
            do_install(目标)
        elif cmd in ("卸载", "uninstall"):
            目标 = sys.argv[2] if len(sys.argv) > 2 else None
            do_uninstall(目标)
        elif cmd in ("状态", "status"):
            do_status()
        elif cmd in ("导出字典", "export", "export_dict"):
            do_export_dict()
        elif cmd in ("生成", "generate"):
            目标 = sys.argv[2] if len(sys.argv) > 2 else None
            do_generate(目标)
        elif cmd in ("帮助", "help", "-h", "--help"):
            print(__doc__)
        else:
            print(f"未知命令: {cmd}")
            print("用法: python houdini汉化工具.py [安装|卸载|状态|导出字典|生成]")
    else:
        do_install()
