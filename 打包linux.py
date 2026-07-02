"""
Linux tar.gz 打包 — 只打公共区+启动脚本，隐私区完全排除
复用发布打包的隐私扫描逻辑
"""
import sys
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import tarfile
import json
import re
from pathlib import Path

排除路径片段 = [
    "__pycache__", "隐私区", ".pytest_cache",
    ".codely", ".codely-cli", ".git", "build", "dist",
    "公共区/内核/隐私区", "公共区/隐私区",
]
排除后缀 = [".log", ".db", ".db-shm", ".db-wal", ".pyc", ".pyo", ".zip", ".spec"]
排除文件名前缀 = ["_test", "_parse", "_read", "_查看", "测试key"]
隐私扫描白名单 = ["highlight.min.js", "marked.min.js", "katex.min.js",
                "katex-auto-render.min.js", "pdf.min.js", "pdf.worker.min.js",
                "xlsx.full.min.js", "mammoth.browser.min.js"]

def 应排除(路径):
    s = str(路径)
    for f in 排除路径片段:
        if f in s:
            return True
    if 路径.suffix.lower() in 排除后缀:
        return True
    for p in 排除文件名前缀:
        if 路径.name.startswith(p):
            return True
    return False

def 扫描隐私(文件):
    if 文件.name in 隐私扫描白名单:
        return []
    if 文件.suffix not in [".py", ".json", ".js", ".html", ".css", ".md", ".bat", ".sh"]:
        return []
    try:
        内容 = 文件.read_text(encoding="utf-8")
    except Exception:
        return []
    模式列表 = [
        (r'sk-[a-zA-Z0-9]{20,}', "API Key"),
        (r'key\s*[:=]\s*["\'][\w-]{10,}["\']', "疑似密钥"),
        (r'tvly-[a-zA-Z0-9-]{20,}', "Tavily Key"),
    ]
    for 模式, desc in 模式列表:
        if re.search(模式, 内容):
            return [{"文件": str(文件), "原因": desc}]
    return []

def 打包():
    根 = Path(__file__).parent
    公共区 = 根 / "公共区"
    引擎管理 = 根 / "引擎管理"

    # 收集文件
    文件列表 = []
    for f in 公共区.rglob("*"):
        if f.is_file() and not 应排除(f):
            文件列表.append(f)
    for f in 引擎管理.rglob("*.json"):
        if not 应排除(f):
            文件列表.append(f)
    for f in 根.iterdir():
        if f.is_file() and f.suffix in [".py", ".md", ".bat", ".sh"]:
            if not 应排除(f):
                文件列表.append(f)
    public_dir = 根 / "public"
    if public_dir.exists():
        for f in public_dir.rglob("*"):
            if f.is_file() and not 应排除(f):
                文件列表.append(f)

    # 隐私扫描
    泄露 = []
    for f in 文件列表:
        泄露.extend(扫描隐私(f))
    if 泄露:
        print("❌ 隐私泄露！")
        for l in 泄露:
            print(f"   {l['文件']}: {l['原因']}")
        return

    # 读版本号
    引擎配置路径 = 引擎管理 / "引擎配置.json"
    版本 = "2.1.1"
    if 引擎配置路径.exists():
        with open(引擎配置路径, encoding="utf-8") as f:
            版本 = json.load(f).get("主引擎", {}).get("版本", 版本)

    输出名 = f"zf3d_agent_v{版本}_linux.tar.gz"
    输出路径 = 根 / 输出名

    print(f"📦 打包 {len(文件列表)} 个文件...")
    with tarfile.open(输出路径, "w:gz") as tar:
        for f in 文件列表:
            arcname = str(f.relative_to(根))
            tar.add(f, arcname=arcname)

    size_kb = 输出路径.stat().st_size / 1024
    print(f"✅ {输出名} ({size_kb:.0f} KB)")
    print(f"   路径: {输出路径}")

if __name__ == "__main__":
    打包()
