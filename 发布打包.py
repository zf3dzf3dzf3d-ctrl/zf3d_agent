"""
发布打包 - 只打公共区，隐私区完全排除
打包前自动扫描隐私泄露（公共区 + 根目录打包文件）
"""
import json
import shutil
import zipfile
import re
from pathlib import Path

# 打包时排除的路径片段（出现在路径中则跳过）
排除路径片段 = [
    "__pycache__",
    "隐私区",
    ".pytest_cache",
    ".codely",
    ".codely-cli",
    ".git",
]

# 打包时排除的文件后缀
排除后缀 = [".log", ".db", ".db-shm", ".db-wal", ".pyc", ".pyo", ".zip"]

# 打包时排除的文件名前缀（临时测试文件）
排除文件名前缀 = ["_test", "_parse", "_read", "_查看", "测试key"]

# 隐私扫描白名单（第三方库等误报）
隐私扫描白名单 = ["highlight.min.js", "marked.min.js"]

def 打包发布():
    项目根目录 = Path(__file__).parent
    公共区 = 项目根目录 / "公共区"
    引擎管理 = 项目根目录 / "引擎管理"

    print("=" * 50)
    print("  智能体 v2 发布打包")
    print("=" * 50)

    # 1. 收集待打包文件并检查隐私泄露
    print("\n🔍 检查隐私泄露...")
    待打包文件 = 收集打包文件(项目根目录, 公共区, 引擎管理)
    泄露项 = []
    for 文件 in 待打包文件:
        泄露项.extend(扫描隐私泄露(文件))
    if 泄露项:
        print("❌ 发现隐私泄露！")
        for 项 in 泄露项:
            print(f"   {项['文件']}: {项['原因']}")
        print("\n请修复后再打包。")
        return
    print("✅ 无隐私泄露")

    # 2. 读取版本号
    引擎配置 = {}
    引擎配置路径 = 引擎管理 / "引擎配置.json"
    if 引擎配置路径.exists():
        with open(引擎配置路径, "r", encoding="utf-8") as f:
            引擎配置 = json.load(f)
    版本号 = 引擎配置.get("主引擎", {}).get("版本", "1.0.0")

    # 3. 打包
    输出文件名 = f"智能体_v2_发布_v{版本号}.zip"
    输出路径 = 项目根目录 / 输出文件名

    print(f"\n📦 打包中...")
    打包文件数 = 0
    with zipfile.ZipFile(输出路径, "w", zipfile.ZIP_DEFLATED) as zf:
        for 文件 in 待打包文件:
            相对路径 = str(文件.relative_to(项目根目录))
            zf.write(文件, 相对路径)
            打包文件数 += 1

    print(f"✅ 打包完成: {输出文件名}")
    print(f"   文件数: {打包文件数}")
    print(f"   大小: {输出路径.stat().st_size / 1024:.1f} KB")
    print(f"   路径: {输出路径}")

def 应排除(路径: Path) -> bool:
    """判断文件是否应被排除"""
    路径str = str(路径)
    # 排除路径片段
    for 片段 in 排除路径片段:
        if 片段 in 路径str:
            return True
    # 排除后缀
    if 路径.suffix.lower() in 排除后缀:
        return True
    # 排除临时测试文件
    for 前缀 in 排除文件名前缀:
        if 路径.name.startswith(前缀):
            return True
    return False

def 收集打包文件(项目根目录, 公共区, 引擎管理) -> list:
    """收集所有待打包文件"""
    文件列表 = []
    # 公共区（排除内嵌隐私区、缓存等）
    for 文件 in 公共区.rglob("*"):
        if 文件.is_file() and not 应排除(文件):
            文件列表.append(文件)
    # 引擎管理 JSON
    for 文件 in 引擎管理.rglob("*.json"):
        if not 应排除(文件):
            文件列表.append(文件)
    # 根目录文件（仅 .py .md .bat .sh）
    for 文件 in 项目根目录.iterdir():
        if 文件.is_file() and 文件.suffix in [".py", ".md", ".bat", ".sh"]:
            if not 应排除(文件):
                文件列表.append(文件)
    # public/ 目录（ASCII入口）
    public目录 = 项目根目录 / "public"
    if public目录.exists():
        for 文件 in public目录.rglob("*"):
            if 文件.is_file() and not 应排除(文件):
                文件列表.append(文件)
    # tests/ 目录
    tests目录 = 项目根目录 / "tests"
    if tests目录.exists():
        for 文件 in tests目录.rglob("*"):
            if 文件.is_file() and not 应排除(文件):
                文件列表.append(文件)
    return 文件列表

def 扫描隐私泄露(文件: Path) -> list:
    """扫描单个文件是否包含隐私内容"""
    泄露 = []
    if 文件.suffix not in [".py", ".json", ".js", ".html", ".css", ".md", ".bat", ".sh"]:
        return 泄露
    # 第三方库白名单
    if 文件.name in 隐私扫描白名单:
        return 泄露
    敏感模式 = [
        (r'sk-[a-zA-Z0-9]{20,}', "API Key (sk-开头)"),
        (r'key\s*[:=]\s*["\'][\w-]{10,}["\']', "疑似密钥"),
        (r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', "邮箱地址"),
        (r'[D-Z]:\\[Uu]sers\\', "Windows个人路径"),
        (r'/home/[a-z]+/', "Linux个人路径"),
    ]
    try:
        内容 = 文件.read_text(encoding="utf-8")
        for 模式, 描述 in 敏感模式:
            if re.search(模式, 内容):
                泄露.append({"文件": str(文件), "原因": 描述})
    except Exception:
        pass
    return 泄露

if __name__ == "__main__":
    打包发布()
