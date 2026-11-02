# -*- coding: utf-8 -*-
"""doctor.py 智能体工作区体检脚本（六项检查，纯标准库）
用法: python\python.exe -X utf8 scripts\doctor.py
退出码: 0=健康 1=有告警
报告: private/记忆/全局/体检/体检报告-YYYYMMDD-HHMMSS.md
"""
import os, re, sys, subprocess, datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPORT_DIR = os.path.join(ROOT, "private", "记忆", "全局", "体检")

# PATHS：所有被检路径集中收敛，启动时自检存在性（路径错=体检脚本自身 FAIL，消除绿灯假象）
PATHS = {
    "记忆目录": os.path.join(ROOT, "private", "记忆"),
    "课题池": os.path.join(ROOT, "private", "记忆", "全局", "进化", "课题池.md"),
    "报告目录": REPORT_DIR,
    "蜂群回收": os.path.join(ROOT, "蜂群回收"),
}

# 白名单：根目录允许存在的非垃圾文件（人工产物/启动配置等）
ROOT_WHITELIST = {
    "ai_keys.json", "start.sh", "restart_server.bat", "一键诊断.bat",
    "package.json", "package-lock.json", "README.md", ".gitignore",
    "robots.txt", "favicon.ico",
}
# 垃圾模式
JUNK_RE = re.compile(
    r"^(tmp[_\-].*|_tmp.*|_analyze.*|_audit.*|_check.*|_chk.*|_scan.*|_diag.*"
    r"|_verify.*|_dump.*|_fs_.*|_ls.*|_rev_.*|_asar.*|_jobs.*|_baks.*|_seg.*|_w\.py"
    r"|debug[_\-].*|.*\.bak\..*|.*\.log)$", re.IGNORECASE)
# 异常目录/文件名模式：%变量、括号截断、空格结尾
WEIRD_RE = re.compile(r"[%()]|\s$")
# 已知人工产物，只 WARN 不入清场清单
HUMAN_HINT = ("一首诗", "屏幕录制", ".mp4", ".mp3")

issues = []   # (级别, 检查项, 描述)
cleanup = []  # 可清场文件清单

def check_paths():
    """检查0：PATHS 存在性自检——被检路径缺失=体检脚本自身 FAIL，不得静默跳过"""
    ok = True
    for name, p in PATHS.items():
        if os.path.exists(p):
            issues.append(("PASS", "路径自检", f"{name} 存在"))
        else:
            issues.append(("FAIL", "路径自检", f"{name} 路径不存在: {p}（体检脚本自身配置错误，本报告部分检查项无效）"))
            ok = False
    return ok

def check_junk_and_weird():
    """检查1/2：根目录垃圾文件 + 异常命名"""
    n_junk = n_weird = 0
    for name in os.listdir(ROOT):
        p = os.path.join(ROOT, name)
        if name in ROOT_WHITELIST or name.startswith(".") or os.path.isdir(p) and name in (
            "node_modules", "__pycache__", ".git", "server", "public", "private",
            "tool", "scripts", "zf-trash", "python", "evolution_lab",
        ):
            continue
        if os.path.isdir(p):
            if WEIRD_RE.search(name):
                n_weird += 1
                issues.append(("FAIL", "异常命名", f"目录 {name!r} 含 %/括号/结尾空格"))
            continue
        if WEIRD_RE.search(name):
            n_weird += 1
            issues.append(("FAIL", "异常命名", f"文件 {name!r} 含 %/括号/结尾空格"))
        if JUNK_RE.match(name) and not any(h in name for h in HUMAN_HINT):
            n_junk += 1
            cleanup.append(name)
        elif JUNK_RE.match(name):
            issues.append(("WARN", "人工产物", f"{name} 疑似人工文件，未入清场清单"))
    if n_junk >= 10:
        issues.append(("FAIL", "根目录垃圾", f"{n_junk} 个调试残留/备份文件"))
    elif n_junk:
        issues.append(("WARN", "根目录垃圾", f"{n_junk} 个垃圾文件"))
    if n_weird == 0:
        issues.append(("PASS", "异常命名", "无 %/括号/空格结尾的异常命名"))
    return n_junk, n_weird

def check_git():
    """检查3：git 工作区脏度（排除已 ignore）"""
    try:
        r = subprocess.run(["git", "status", "--porcelain"], cwd=ROOT,
                           capture_output=True, timeout=30,
                           encoding="utf-8", errors="replace")
        lines = [l for l in (r.stdout or "").splitlines() if l.strip()]
        n = len(lines)
        if n == 0:
            issues.append(("PASS", "git脏度", "工作区干净"))
        elif n > 50:
            issues.append(("FAIL", "git脏度", f"{n} 处未提交改动（含大量删除/未跟踪），需人工排查"))
        else:
            issues.append(("WARN", "git脏度", f"{n} 处未提交改动"))
    except Exception as e:
        issues.append(("WARN", "git脏度", f"git 检查失败: {e}"))

def check_topic_pool():
    """检查4：课题池编号完整性（撞号探测器）"""
    pool = PATHS["课题池"]
    if not os.path.exists(pool):
        issues.append(("FAIL", "课题池", "课题池路径不存在（见路径自检项），检查无效"))
        return
    with open(pool, encoding="utf-8", errors="replace") as f:
        text = f.read()
    nums = [int(m) for m in re.findall(r"^###\s*(\d+)", text, re.M)]
    dup = sorted({n for n in nums if nums.count(n) > 1})
    if dup:
        issues.append(("FAIL", "课题池", f"撞号: {dup}（并行append复发，需人工合并）"))
    elif nums and nums != list(range(min(nums), max(nums) + 1)):
        issues.append(("WARN", "课题池", f"编号不连续: {min(nums)}~{max(nums)} 共{len(nums)}条"))
    else:
        issues.append(("PASS", "课题池", f"编号连续 {min(nums)}~{max(nums)}" if nums else "空池"))

def check_memory():
    """检查5：记忆目录规模 + 蜂群回收堆积"""
    mem = os.path.join(ROOT, "private", "记忆")
    n = 0
    for _, _, files in os.walk(mem):
        n += len(files)
    if n > 1000:
        issues.append(("FAIL", "记忆规模", f"{n} 个文件，需建归档机制"))
    elif n > 400:
        issues.append(("WARN", "记忆规模", f"{n} 个文件，接近阈值"))
    else:
        issues.append(("PASS", "记忆规模", f"{n} 个文件，正常"))
    swarm = os.path.join(ROOT, "蜂群回收")
    if os.path.isdir(swarm):
        sn = len(os.listdir(swarm))
        if sn > 50:
            issues.append(("FAIL", "蜂群回收", f"{sn} 个 sw-*.md 堆积未治理"))
        elif sn > 0:
            issues.append(("WARN", "蜂群回收", f"{sn} 个待归档"))
        else:
            issues.append(("PASS", "蜂群回收", "无堆积"))
    # 蜂群回收目录计入总量但单独报告，避免双计告警
    if n > 400:
        cleanup_note = "(含蜂群回收)" if os.path.isdir(swarm) else ""

def write_report():
    ts = datetime.datetime.now()
    os.makedirs(REPORT_DIR, exist_ok=True)
    path = os.path.join(REPORT_DIR, f"体检报告-{ts:%Y%m%d-%H%M%S}.md")
    fails = [i for i in issues if i[0] == "FAIL"]
    warns = [i for i in issues if i[0] == "WARN"]
    passes = [i for i in issues if i[0] == "PASS"]
    lines = [
        "# 智能体工作区体检报告", "",
        f"- 时间: {ts:%Y-%m-%d %H:%M:%S}",
        f"- 结论: **{'FAIL' if fails else 'WARN' if warns else 'PASS'}** "
        f"(FAIL {len(fails)} / WARN {len(warns)} / PASS {len(passes)})", "",
        "## 检查明细", "",
    ]
    for lv, item, desc in issues:
        lines.append(f"- [{lv}] {item}: {desc}")
    if cleanup:
        lines += ["", f"## 可清场清单（{len(cleanup)} 个，建议移 zf-trash 只移不删）", ""]
        lines += [f"- {c}" for c in cleanup]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return path

def check_public_sync():
    """检查N：课题17机械防线——调用 scripts/check_public_sync.py 检测双副本漂移/引用缺失/缓存号联动"""
    script = os.path.join(ROOT, "scripts", "check_public_sync.py")
    if not os.path.exists(script):
        issues.append(("FAIL", "双副本同步", f"检测脚本缺失: {script}"))
        return
    r = subprocess.run([sys.executable, "-X", "utf8", script],
                       capture_output=True, text=True, cwd=ROOT)
    out = (r.stdout or "") + (r.stderr or "")
    n_fail = out.count("[FAIL]")
    if r.returncode == 0:
        issues.append(("PASS", "双副本同步", f"check_public_sync 通过（详见 {script} 输出）"))
    else:
        issues.append(("FAIL", "双副本同步", f"check_public_sync 发现 {n_fail} 处漂移/缺失，退出码 {r.returncode}"))

def main():
    check_paths()
    check_junk_and_weird()
    check_git()
    check_topic_pool()
    check_memory()
    check_public_sync()
    path = write_report()
    fails = [i for i in issues if i[0] == "FAIL"]
    for lv, item, desc in issues:
        print(f"[{lv}] {item}: {desc}")
    if cleanup:
        print(f"\n可清场 {len(cleanup)} 个（详见报告）")
    print(f"\n报告: {path}")
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(main())
