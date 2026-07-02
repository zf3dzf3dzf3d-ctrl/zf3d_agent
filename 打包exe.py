"""
打包exe脚本 — 将整个项目打包成单个exe文件
使用PyInstaller，用户不需要安装Python即可运行

使用方法: py 打包exe.py
前提: pip install pyinstaller
"""
import sys
import os

# Windows控制台UTF-8
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
import os
import sys
import shutil
import subprocess
import zipfile
import re
from pathlib import Path

项目根 = Path(__file__).parent

# ============ 配置 ============
EXE名称 = "朱峰社区智能体"
入口文件 = "打包入口.py"
图标文件 = "公共区/界面/favicon.png"

# 需要打包的数据目录（相对路径 → 打包后路径）
数据目录 = [
    ("公共区", "公共区"),
    ("public", "public"),
    ("引擎管理", "引擎管理"),
    ("启动.bat", "启动.bat"),
    ("说明.md", "说明.md"),
]

# 第三方依赖（PyInstaller可能检测不到的）
隐藏导入 = [
    "PIL", "PIL.ImageGrab",
    "psutil",
    "docx", "docx.shared", "docx.enum.text", "docx.oxml.ns",
    "openpyxl",
    "olefile",
    "edge_tts",
    "pygame",
    "win32com", "win32com.client",
    "sqlite3", "_sqlite3",
]


def 检查PyInstaller():
    """检查PyInstaller是否安装"""
    try:
        import PyInstaller
        return True
    except ImportError:
        print("❌ 未安装PyInstaller，正在安装...")
        result = subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"],
                              capture_output=True, text=True)
        if result.returncode == 0:
            print("✅ PyInstaller安装成功")
            return True
        else:
            print(f"❌ 安装失败: {result.stderr}")
            return False


def 扫描隐私泄露():
    """扫描公共区文件中是否有隐私泄露"""
    print("\n🔍 扫描隐私泄露...")
    公共区 = 项目根 / "公共区"
    if not 公共区.exists():
        return True

    隐私模式 = [
        (r'sk-[a-zA-Z0-9]{20,}', "API Key"),
        (r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}', "邮箱"),
        (r'[CDEFGH]:\\Users\\[^\\]+\\', "Windows个人路径"),
    ]

    # 跳过第三方库文件（不可能含用户隐私）
    跳过文件 = {"highlight.min.js", "marked.min.js", "katex.min.js", "katex-auto-render.min.js",
                "xlsx.full.min.js", "mammoth.browser.min.js", "pdf.min.js", "pdf.worker.min.js"}

    发现 = False
    for 文件 in 公共区.rglob("*"):
        if 文件.name in 跳过文件:
            continue
        if 文件.is_file() and 文件.suffix in ('.py', '.json', '.js', '.html', '.css', '.md'):
            try:
                内容 = 文件.read_text(encoding="utf-8", errors="replace")
                for 模式, 描述 in 隐私模式:
                    匹配 = re.search(模式, 内容)
                    if 匹配:
                        # 排除模板占位符、示例文本、代码注释中的路径正则
                        匹配文本 = 匹配.group()
                        if "${" in 匹配文本 or "example" in 匹配文本.lower():
                            continue
                        # 邮箱：跳过第三方库中的作者邮箱
                        if 描述 == "邮箱" and 文件.name.endswith(".min.js"):
                            continue
                        # Windows路径：跳过注释/正则中的示例路径
                        if 描述 == "Windows个人路径":
                            行号 = 内容[:匹配.start()].count('\n') + 1
                            行内容 = 内容.split('\n')[行号 - 1].strip()
                            if 行内容.startswith('//') or 行内容.startswith('*') or 行内容.startswith('#'):
                                continue
                        print(f"  ⚠️ {描述} 泄露: {文件.relative_to(项目根)} → {匹配.group()[:30]}...")
                        发现 = True
            except Exception:
                pass

    if 发现:
        print("❌ 发现隐私泄露，请修复后再打包！")
        return False
    print("✅ 无隐私泄露")
    return True


def 清理旧构建():
    """清理build和dist目录"""
    print("\n🧹 清理旧构建...")
    for 目录 in ["build", "dist"]:
        路径 = 项目根 / 目录
        if 路径.exists():
            shutil.rmtree(路径, ignore_errors=True)
    # 清理spec文件
    spec = 项目根 / f"{EXE名称}.spec"
    if spec.exists():
        spec.unlink()


def 构建PyInstaller命令():
    """构建PyInstaller命令行参数"""
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--console",
        f"--name={EXE名称}",
    ]

    # 图标
    图标路径 = 项目根 / 图标文件
    if 图标路径.exists():
        # PyInstaller需要.ico格式，如果有png先用
        cmd.append(f"--icon={图标路径}")

    # 数据目录
    for 源路径, 目标路径 in 数据目录:
        完整路径 = 项目根 / 源路径
        if 完整路径.exists():
            分隔符 = ";" if sys.platform == "win32" else ":"
            cmd.append(f"--add-data={源路径}{分隔符}{目标路径}")

    # 隐藏导入
    for 模块 in 隐藏导入:
        cmd.append(f"--hidden-import={模块}")

    # 入口文件
    cmd.append(入口文件)

    return cmd


def 打包():
    """执行打包"""
    print("=" * 50)
    print("  朱峰社区智能体 — EXE打包工具")
    print("=" * 50)

    # 1. 检查PyInstaller
    if not 检查PyInstaller():
        return

    # 2. 隐私扫描
    if not 扫描隐私泄露():
        return

    # 3. 清理旧构建
    清理旧构建()

    # 4. 构建命令
    cmd = 构建PyInstaller命令()
    print(f"\n📦 执行PyInstaller打包...")
    print(f"   命令: {' '.join(cmd[:5])}...")

    # 5. 执行
    result = subprocess.run(cmd, cwd=str(项目根))

    if result.returncode != 0:
        print(f"\n❌ 打包失败！")
        return

    # 6. 检查输出
    exe路径 = 项目根 / "dist" / f"{EXE名称}.exe"
    if not exe路径.exists():
        print(f"\n❌ 未找到输出exe: {exe路径}")
        return

    文件大小MB = exe路径.stat().st_size / (1024 * 1024)
    print(f"\n✅ 打包成功！")
    print(f"   文件: {exe路径}")
    print(f"   大小: {文件大小MB:.1f} MB")

    # 7. 创建发布包（exe + 说明 + 隐私区模板）
    创建发布包(exe路径)

    print(f"\n🎉 完成！发布包已生成在 dist/ 目录")


def 创建发布包(exe路径):
    """创建最终发布zip：所有文件在朱峰社区智能体/主文件夹下"""
    print("\n📦 创建发布包...")

    主文件夹名 = EXE名称
    发布根目录 = 项目根 / "dist" / "发布包"
    发布目录 = 发布根目录 / 主文件夹名
    # 清理旧内容
    if 发布根目录.exists():
        shutil.rmtree(发布根目录, ignore_errors=True)
    发布目录.mkdir(parents=True, exist_ok=True)

    # 复制exe
    shutil.copy2(exe路径, 发布目录 / exe路径.name)

    # 创建隐私区模板
    隐私区 = 发布目录 / "隐私区"
    for 子目录 in ["我的配置", "我的记忆", "我的日志", "我的数据", "对话记录"]:
        (隐私区 / 子目录).mkdir(parents=True, exist_ok=True)

    # 创建说明文件
    说明 = 发布目录 / "使用说明.txt"
    说明.write_text(
        "朱峰社区智能体 v2\n"
        "====================\n\n"
        "使用方法:\n"
        "1. 双击 朱峰社区智能体.exe 启动\n"
        "2. 浏览器自动打开 http://localhost:8765\n"
        "3. 首次使用请在设置中配置AI模型密钥\n\n"
        "目录说明:\n"
        "- 朱峰社区智能体.exe  主程序\n"
        "- 隐私区/             你的个人数据（密钥/记忆/对话记录等）\n\n"
        "自动更新:\n"
        "- 系统启动后自动检查新版本并静默更新\n"
        "- 更新后点击右上角✅重启即可\n\n"
        "注意:\n"
        "- 不要删除隐私区文件夹\n"
        "- 首次运行会自动创建所需配置目录\n",
        encoding="utf-8"
    )

    # 打包zip（文件放在主文件夹下，解压后只有一个文件夹）
    zip路径 = 项目根 / "dist" / f"{EXE名称}_发布包.zip"
    with zipfile.ZipFile(zip路径, "w", zipfile.ZIP_DEFLATED) as zf:
        for 文件 in 发布目录.rglob("*"):
            if 文件.is_file():
                # zip内路径：朱峰社区智能体/xxx
                相对路径 = 文件.relative_to(发布根目录)
                zf.write(文件, 相对路径)

    print(f"   发布包: {zip路径}")
    print(f"   大小: {zip路径.stat().st_size / (1024*1024):.1f} MB")


if __name__ == "__main__":
    打包()
