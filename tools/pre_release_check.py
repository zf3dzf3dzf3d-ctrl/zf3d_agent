# -*- coding: utf-8 -*-
"""
发布前风险自查脚本 pre_release_check.py
用法: python pre_release_check.py [待打包目录]   # 缺省 = 当前目录
      加 --all 参数扫描目录下全部文件（含未跟踪/运行时文件，噪声大）；
      默认只扫 git 跟踪的文件（即真正会被打进发布包的内容），避免误报噪声。
作用: 打包/分发前一键扫描敏感文件，防止隐私数据/凭据/未授权内容被打进发布包；
      并核验分发完整性必需项（Dock 图标链 ui.dockapps-* 三插件 + 内核首启播种标记），
      缺一禁止发布（2026-11-25 6.1.0 首发图标全空事故沉淀）。
退出码: 0=通过可发布  1=发现风险/缺失禁止发布
"""
import os, re, subprocess, sys

# ── 目录/文件黑名单（路径含即报警）──
PATH_BLACKLIST = [
    "server/data/", "server\\data\\",
    "/data/", "\\data\\",          # 运行时数据目录（注意会误报 src/data 类，人工复核）
    "private/", "private\\",
    "plugins/data/", "plugins\\data\\",       # 插件运行时令牌目录（plugin_console_token.txt）
    "plugins/uploads/", "plugins\\uploads\\", # 插件上传产物（运行时残留）
    "plugins/private/", "plugins\\private\\", # 插件目录内混入的私有记忆残留
    ".git/",
    "node_modules/",
    "__pycache__/",
    ".bak",
]
# ── 敏感文件名模式 ──
NAME_PATTERNS = [
    r"tok\.json$", r"novel_token", r"trustee", r"\.env", r"\.pem$",
    r"\.m3u$", r"\.db$", r"\.sqlite", r"\.jsonl$", r"iapp_events",
    r"user_brief_state", r"user_growth", r"_crew",
]
# ── 已知误报白名单（rel 路径精确匹配，逐条注明理由；新增豁免须经人工确认后登记）──
EXEMPT = {
    "public/data/news.json",            # 内置公开新闻数据目录，非运行时 server/data
    "server/engines/data/crew_order.json",  # 程序内置编队配置，非用户数据
    "server/public/data/news.json",     # 内置公开新闻数据
    "server/public/data/tv-status.json",# 内置公开电视状态示例数据
    "public/js/zf-app-trustee.js",      # trustee=系统功能名（托管代理），代码文件非凭据
    "server/public/js/zf-app-trustee.js",
    "server/routes/mixin_trustee.py",
    "server/tools/selftest-trustee-redispatch.cmd",
    "server/trustee_evidence.py",
    "server/trustee_llm_review.py",
    "server/self_check.py",             # L102 为自检假样本串（sk- 加 32 位假 hex），非真实密钥
}
# ── 官方运行库目录白名单（前缀匹配，2026-11-26 bravo 加）──
# python/Lib/ 是随包分发的 Python 官方运行库+site-packages（numpy 测试数据/certifi pem 等），
# 内容不由本项目维护、不随项目改动，扫它会喷 200+ 误报淹没真命中（实测 272 命中里 207 处在此）。
# 边界：仅豁免该前缀；若怀疑 python 运行时本身被污染，应单独审计 python/ 目录，不属本门禁粒度。
EXEMPT_DIR_PREFIX = "python/lib/"

# ── 分发完整性必需项（2026-11-25 新增，缺一禁止发布）──
# 背景：6.1.0 首发"全新环境 Dock 图标全空"事故——图标全靠 ui.dockapps-* 三插件注入，
# 打包漏掉任何一个，新装环境即空图标。此清单 = "该带的必须带"白名单核验。
REQUIRED_ITEMS = [
    "plugins/ui.dockapps-basic/main.py",
    "plugins/ui.dockapps-basic/manifest.json",
    "plugins/ui.dockapps-basic/ui/",
    "plugins/ui.dockapps-extra/main.py",
    "plugins/ui.dockapps-extra/manifest.json",
    "plugins/ui.dockapps-extra/ui/",
    "plugins/ui.dockapps-main/main.py",
    "plugins/ui.dockapps-main/manifest.json",
    "plugins/ui.dockapps-main/ui/",
    "server/kernel_mgr.py",
]
# 内核播种标记：kernel_mgr.py 必须含 _first_boot_seed（无 plugin_states.json 时自动播种启用官方插件）
KERNEL_SEED_MARKER = "_first_boot_seed"
# ── 视频缓存扩展名 ──
EXT_BLACKLIST = {".ts", ".mp4", ".log"}
# ── 文本内容密钥正则（仅扫小文本文件）──
SECRET_REGEX = re.compile(r"sk-[A-Za-z0-9]{20,}")
MAX_TEXT_SCAN_BYTES = 512 * 1024  # 超512KB不扫内容

def scan(root):
    findings = []
    nfiles = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules", "__pycache__")]
        for fn in filenames:
            nfiles += 1
            p = os.path.join(dirpath, fn)
            rel = os.path.relpath(p, root).replace("\\", "/")
            low_rel = rel.lower()
            hit = None
            if rel in EXEMPT or low_rel.startswith(EXEMPT_DIR_PREFIX):
                continue  # 已知误报白名单豁免（含 python/Lib 官方运行库前缀豁免）
            for b in PATH_BLACKLIST:
                bl = b.replace("\\", "/").lower()
                if bl in low_rel + "/" and bl not in (".git/", ".bak"):
                    hit = f"路径黑名单: {b}"; break
            if not hit:
                for pat in NAME_PATTERNS:
                    if re.search(pat, fn, re.I):
                        hit = f"敏感文件名: /{pat}/"; break
            if not hit:
                ext = os.path.splitext(fn)[1].lower()
                if ext in EXT_BLACKLIST:
                    hit = f"缓存/日志扩展名: {ext}"
            if not hit:
                try:
                    if os.path.getsize(p) <= MAX_TEXT_SCAN_BYTES:
                        with open(p, "rb") as f:
                            data = f.read()
                        if SECRET_REGEX.search(data.decode("utf-8", "ignore")):
                            hit = "内容含疑似密钥 sk-..."
                except OSError:
                    pass
            if hit:
                findings.append((rel, hit))
    return findings, nfiles

def check_required(root):
    """分发完整性必需项核验（2026-11-25 新增）：图标插件链缺一即禁发。

    背景：Dock 图标不硬编码，全部由 ui.dockapps-basic/extra/main 三插件注入；
    打包漏带任何一个 → 全新环境首启 0 图标（6.1.0 首发事故）。
    """
    missing = []
    for item in REQUIRED_ITEMS:
        p = os.path.join(root, item.replace("/", os.sep))
        if not os.path.exists(p):
            missing.append((item, "分发缺必需项(图标将全空!)"))
    km = os.path.join(root, "server", "kernel_mgr.py")
    if os.path.isfile(km):
        try:
            with open(km, "rb") as f:
                if KERNEL_SEED_MARKER.encode() not in f.read():
                    missing.append(("server/kernel_mgr.py",
                                    f"内核缺首启播种标记 {KERNEL_SEED_MARKER}(新环境将 0 插件启用)"))
        except OSError:
            pass
    else:
        missing.append(("server/kernel_mgr.py", "分发缺必需项(内核文件不存在)"))
    return missing

def main():
    args = [a for a in sys.argv[1:] if a != "--all"]
    scan_all = "--all" in sys.argv[1:]
    root = args[0] if args else "."
    if not os.path.isdir(root):
        print(f"[错误] 目录不存在: {root}"); sys.exit(2)
    print(f"扫描目录: {os.path.abspath(root)}  模式: {'全量(--all)' if scan_all else '仅git跟踪文件'}")
    if not scan_all:
        # 只扫 git 跟踪文件：发布包只包含已跟踪内容，未跟踪的运行时/隐私文件天然排除
        try:
            out = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True,
                                 encoding="utf-8", errors="replace", timeout=60)
            tracked = [os.path.join(root, line.strip()) for line in out.stdout.splitlines() if line.strip()]
            # 非 git 目录（复制出来的待打包目录无 .git）→ git 退出码非 0 或 0 文件，
            # 此时绝不能空转放行，必须回退全量扫描（2026-11-25 修复：原逻辑 0 文件直接判通过）
            if out.returncode != 0 or not tracked:
                print("[警告] 目录非 git 仓库（复制打包场景），回退全量扫描")
                tracked = None
        except Exception as e:
            print(f"[警告] git ls-files 失败({e})，回退全量扫描"); tracked = None
        if tracked is not None:
            nfiles = len(tracked)
            findings = []
            for p in tracked:
                fn = os.path.basename(p)
                rel = os.path.relpath(p, root).replace("\\", "/")
                low_rel = rel.lower()
                hit = None
                if rel in EXEMPT or low_rel.startswith(EXEMPT_DIR_PREFIX):
                    continue  # 已知误报白名单豁免（含 python/Lib 官方运行库前缀豁免；逐条理由见 EXEMPT 注释）
                for b in PATH_BLACKLIST:
                    bl = b.replace("\\", "/").lower()
                    if bl in low_rel + "/" and bl not in (".git/", ".bak"):
                        hit = f"路径黑名单: {b}"; break
                if not hit:
                    for pat in NAME_PATTERNS:
                        if re.search(pat, fn, re.I):
                            hit = f"敏感文件名: /{pat}/"; break
                if not hit:
                    ext = os.path.splitext(fn)[1].lower()
                    if ext in EXT_BLACKLIST:
                        hit = f"缓存/日志扩展名: {ext}"
                if not hit:
                    try:
                        if os.path.getsize(p) <= MAX_TEXT_SCAN_BYTES:
                            with open(p, "rb") as f:
                                data = f.read()
                            if SECRET_REGEX.search(data.decode("utf-8", "ignore")):
                                hit = "内容含疑似密钥 sk-..."
                    except OSError:
                        pass
                if hit:
                    findings.append((rel, hit))
            print(f"共扫描 {nfiles} 个文件（仅git跟踪）\n")
            _report(findings, check_required(root))
            return
    findings, nfiles = scan(root)
    print(f"共扫描 {nfiles} 个文件\n")
    _report(findings, check_required(root))

def _report(findings, missing):
    if missing:
        print("=" * 60)
        print(f"⛔ 分发完整性缺失 {len(missing)} 项，禁止发布（缺图标=新环境空 Dock）:")
        print("=" * 60)
        for item, why in missing:
            print(f"  [缺失] {item}  —— {why}")
        print()
    if findings:
        print("=" * 60)
        print(f"发现 {len(findings)} 处风险，禁止发布！逐条人工复核：")
        print("=" * 60)
        for rel, why in findings:
            print(f"  [{why}]  {rel}")
        print("\n处置: 隐私/凭据/视频缓存 = 从发布包排除; 误报(如代码里的 data 目录名) = 人工确认放行")
        sys.exit(1)
    if missing:
        sys.exit(1)
    print("✅ 通过：未发现敏感文件，图标插件链完整，可打包发布。")
    sys.exit(0)

if __name__ == "__main__":
    main()
