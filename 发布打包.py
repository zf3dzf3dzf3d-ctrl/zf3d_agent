"""
发布打包 - 只打公共区，隐私区完全排除
打包前自动扫描隐私泄露（公共区 + 根目录打包文件）
"""
import sys
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

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

# 打包时排除的文件名（完整文件名匹配）
排除文件名 = ["开发日志.md", "说明.md"]

# 隐私扫描白名单（第三方库等误报）
隐私扫描白名单 = ["highlight.min.js", "marked.min.js", "ts.worker", "editor.worker", "json.worker", "css.worker", "html.worker"]

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

    # 2. 复制公共区到临时目录，在临时目录上加密（不破坏开发版源码）
    print("\n📁 复制文件到临时打包目录...")
    打包临时目录 = 项目根目录 / "_publish_temp"
    if 打包临时目录.exists():
        shutil.rmtree(打包临时目录)
    # 复制公共区
    shutil.copytree(公共区, 打包临时目录 / "公共区")
    # 复制引擎管理
    if 引擎管理.exists():
        shutil.copytree(引擎管理, 打包临时目录 / "引擎管理")
    # 复制根目录文件
    for 文件 in 项目根目录.iterdir():
        if 文件.is_file() and 文件.suffix in [".py", ".md", ".bat", ".sh"]:
            if not 应排除(文件):
                shutil.copy2(文件, 打包临时目录 / 文件.name)
    # 复制public目录
    public目录 = 项目根目录 / "public"
    if public目录.exists():
        shutil.copytree(public目录, 打包临时目录 / "public")

    # 3. 在临时目录上加密
    print("\n🔒 加密核心文件...")
    加密核心文件(打包临时目录)

    # 4. 读取版本号
    引擎配置 = {}
    引擎配置路径 = 打包临时目录 / "引擎管理" / "引擎配置.json"
    if 引擎配置路径.exists():
        with open(引擎配置路径, "r", encoding="utf-8") as f:
            引擎配置 = json.load(f)
    版本号 = 引擎配置.get("主引擎", {}).get("版本", "1.0.0")

    # 5. 打包（从临时目录）
    输出文件名 = f"智能体_v2_发布_v{版本号}.zip"
    输出路径 = 项目根目录 / 输出文件名

    print(f"\n📦 打包中...")
    打包文件数 = 0
    with zipfile.ZipFile(输出路径, "w", zipfile.ZIP_DEFLATED) as zf:
        for 文件 in 打包临时目录.rglob("*"):
            if 文件.is_file() and not 应排除(文件):
                相对路径 = str(文件.relative_to(打包临时目录))
                zf.write(文件, 相对路径)
                打包文件数 += 1

    # 6. 清理临时目录
    if 打包临时目录.exists():
        shutil.rmtree(打包临时目录)

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
    # 排除指定文件名
    if 路径.name in 排除文件名:
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
    # 第三方库白名单（文件名包含即跳过）
    for 白名单词 in 隐私扫描白名单:
        if 白名单词 in 文件.name:
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

def 加密核心文件(项目根目录: Path):
    """加密Python核心文件：PyArmor加密小文件，compile+混淆处理大文件"""
    import subprocess, sys, os, shutil, compileall, py_compile

    py核心文件 = [
        "公共区/内核/模型直连器.py",
        "公共区/模块/对话/提示词构建器.py",
        "公共区/模块/对话/推理引擎.py",
        "公共区/模块/对话/反思评估器.py",
        "公共区/模块/对话/任务规划器.py",
        "公共区/内核/网页服务.py",
        "公共区/内核/操作/Git.py",
        "公共区/内核/操作/代码.py",
        "公共区/内核/操作/高级.py",
        "公共区/内核/操作/网络.py",
    ]

    pyarmor = os.path.join(sys.prefix, "Scripts", "pyarmor.exe")
    if not os.path.exists(pyarmor):
        pyarmor = shutil.which("pyarmor")

    加密成功数 = 0
    临时输出 = 项目根目录 / "_pyarmor_output"
    if 临时输出.exists():
        shutil.rmtree(临时输出)

    for 文件 in py核心文件:
        源路径 = 项目根目录 / 文件
        if not 源路径.exists():
            print(f"  ⚠️ 跳过（不存在）: {文件}")
            continue

        # 先尝试PyArmor
        用pyarmor = False
        if pyarmor:
            try:
                结果 = subprocess.run(
                    [pyarmor, "gen", "--output", str(临时输出), str(源路径)],
                    capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30
                )
                if 结果.returncode == 0:
                    加密文件名 = 源路径.name
                    加密后路径 = 临时输出 / 加密文件名
                    if 加密后路径.exists():
                        shutil.copy2(加密后路径, 源路径)
                        加密成功数 += 1
                        用pyarmor = True
                        print(f"  🔒 PyArmor加密: {文件}")
            except Exception:
                pass

        # PyArmor失败或未安装：用compile+混淆
        if not 用pyarmor:
            try:
                _混淆py文件(源路径)
                加密成功数 += 1
                print(f"  🔒 compile混淆: {文件}")
            except Exception as e:
                print(f"  ❌ 加密失败: {文件} - {e}")

    # 复制pyarmor运行时
    runtime目录 = 临时输出 / "pyarmor_runtime_000000"
    if runtime目录.exists():
        目标runtime = 项目根目录 / "公共区" / "内核" / "pyarmor_runtime_000000"
        if 目标runtime.exists():
            shutil.rmtree(目标runtime)
        shutil.copytree(runtime目录, 目标runtime)
        print(f"  ✅ PyArmor运行时已复制")

    if 临时输出.exists():
        shutil.rmtree(临时输出)

    print(f"  ✅ 加密完成: {加密成功数}/{len(py核心文件)}个文件")

    # === JS混淆 ===
    js核心文件 = [
        "公共区/界面/员工浮窗.js",
        "公共区/界面/模块/网站登录.js",
        "公共区/界面/模块/动画工坊.js",
    ]
    js混淆器 = shutil.which("javascript-obfuscator")
    if js混淆器:
        js成功数 = 0
        for js文件 in js核心文件:
            js路径 = 项目根目录 / js文件
            if not js路径.exists():
                print(f"  ⚠️ 跳过（不存在）: {js文件}")
                continue
            try:
                结果 = subprocess.run(
                    [js混淆器, str(js路径), "--output", str(js路径),
                     "--compact", "true",
                     "--string-array", "true",
                     "--string-array-encoding", "base64",
                     "--string-array-threshold", "0.75",
                     "--identifier-names-generator", "hexadecimal",
                     "--rename-globals", "false",
                     "--reserved-names", "require,exports,module,define,amd",
                     "--self-defending", "true"],
                    capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30
                )
                if 结果.returncode == 0:
                    js成功数 += 1
                    print(f"  🔒 JS混淆: {js文件}")
                else:
                    print(f"  ⚠️ JS混淆失败: {js文件} - {结果.stderr[:100]}")
            except Exception as e:
                print(f"  ⚠️ JS混淆异常: {js文件} - {e}")
        print(f"  ✅ JS混淆完成: {js成功数}/{len(js核心文件)}个文件")
    else:
        print("  ⚠️ 未安装 javascript-obfuscator，跳过JS混淆")

    return 加密成功数 > 0


def _混淆py文件(文件路径: Path):
    """Python源码混淆：去除注释/文档字符串+编译pyc+替换源码为加载器"""
    import ast, marshal, zlib

    源码 = 文件路径.read_text(encoding="utf-8")

    # 1. 用AST去除文档字符串和注释
    try:
        树 = ast.parse(源码)
        # 移除模块级docstring
        if (树.body and isinstance(树.body[0], ast.Expr) and
            isinstance(树.body[0].value, (ast.Constant, ast.Str))):
            树.body.pop(0)
        源码 = compile(树, str(文件路径), "exec")
        # 编译成字节码
        源码 = marshal.dumps(源码)
        # zlib压缩
        源码 = zlib.compress(源码, 9)
        # base64编码
        import base64
        编码 = base64.b64encode(源码).decode("ascii")

        # 2. 生成加载器代码
        加载器 = f'''# Protected by ZF3D Agent
import marshal,zlib,base64 as _b
exec(marshal.loads(zlib.decompress(_b.b64decode("{编码}"))))
'''
        文件路径.write_text(加载器, encoding="utf-8")
    except Exception as e:
        # AST解析失败时用简单方式：编译pyc替换
        pyc路径 = 文件路径.with_suffix('.pyc')
        py_compile.compile(str(文件路径), str(pyc路径), doraise=True)
        # 生成加载器
        加载器 = f'''# Protected by ZF3D Agent
import importlib.util as _u,sys as _s
_spec = _u.spec_from_file_location("_m", r"{文件路径.name}c")
_m = _u.module_from_spec(_spec)
_s.modules["_m"] = _m
_spec.loader.exec_module(_m)
'''
        文件路径.write_text(加载器, encoding="utf-8")


if __name__ == "__main__":
    打包发布()
