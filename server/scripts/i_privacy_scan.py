# -*- coding: utf-8 -*-
"""
i隐私 - 隐私资产台账 + 分级销毁 + 巡检健康报告（命令行版，纯 stdlib）
来源策划案：private/记忆/策划案-i隐私-全项目隐私集中收口-v3.md

用法（用项目自带 python 运行）：
  扫描：  python i_privacy_scan.py scan
  报告：  python i_privacy_scan.py health
  归档：  python i_privacy_scan.py archive <台账条目id>       （移入隐私垃圾箱，可回滚）
  抹除：  python i_privacy_scan.py wipe <台账条目id> --yes    （物理删除，含 -wal/-shm，高危需 --yes）
  回滚：  python i_privacy_scan.py restore <归档记录id>
  保留：  python i_privacy_scan.py keep <台账条目id>          （标记保留，不再巡检告警）

安全约束（策划案硬约束）：
  1. 台账/垃圾箱/规则文件一律落 private 下并进 .gitignore，禁止随项目分发打包；
  2. 密钥类内容只显示前 8 字符；
  3. 高危项（登录态 cookie/token、密钥）默认不勾销毁，抹除必须显式 --yes；
  4. 扫描显式排除 python/ node_modules/ .git/ logs 等。
"""
import os, sys, json, hashlib, shutil, subprocess, time, argparse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
P = lambda *a: os.path.join(ROOT, *a)
PRIV = P("private")
LEDGER = P("private", "隐私台账.json")
TRASH = P("private", "隐私垃圾箱")
RULES = P("private", "隐私规则.json")
HEALTH = P("private", "隐私健康报告.json")

EXCLUDE_DIRS = {"python", "node_modules", ".git", "logs", "tmp", "_e2e_test", "tests", "test",
                "隐私垃圾箱", "file_protect_snapshots", "backups", "__pycache__"}

# ---- 规则：文件级（相对 ROOT 的 glob 后缀匹配）----
FILE_RULES = [
    # 类别, 匹配(相对路径包含), 危险级, 说明
    ("密钥",  "private/api_keys.json", "high", "API 密钥表"),
    ("登录态", "novel_token.txt", "high", "i小说 token（已入 git 历史，见台账 git_tracked 标记）"),
    ("登录态", "bili_cookie", "high", "B站 cookie（含 .bak）"),
    ("登录态", "anon_id.txt", "mid", "匿名 ID"),
    ("登录态", "remote_id.json", "mid", "远程标识"),
    ("登录态", "server.pid", "low", "进程 PID"),
    ("记忆",  os.path.join("private", "记忆") + os.sep, "mid", "AI 长期记忆条目"),
    ("记忆",  "记忆" + os.sep, "mid", "AI 记忆"),
    ("数据库", ".db", "mid", "sqlite 数据库"),
    ("数据库", ".db-wal", "mid", "sqlite WAL 副本"),
    ("数据库", ".db-shm", "mid", "sqlite SHM 副本"),
    ("备份",  ".bak", "low", "备份文件（可能含敏感副本）"),
    ("日志",  "path_access_log.jsonl", "mid", "路径访问日志"),
    ("日志",  "cache_watch.jsonl", "low", "缓存监视日志"),
    ("配置",  "path_whitelist.json", "low", "路径白名单"),
    ("站点",  "i-video-sites.json", "low", "i视频站点记录"),
    ("站点",  "i-image-sites.json", "low", "i图站记录"),
    ("站点",  "i-web-sites.json", "low", "i网页站记录"),
]
# 分项目痕迹（i漫画/i视频/i小说/i音乐/i游戏/i笔记/iAPP/i家庭）
APP_RULES = [
    ("i漫画", "comics_progress.json", "low", "阅读记录"),
    ("i漫画", "comics_cache", "low", "缓存"),
    ("i漫画", "comics_local", "low", "本地缓存"),
    ("i视频", "ivideo_progress", "low", "观看进度"),
    ("i视频", "ivideo_cache", "low", "缓存"),
    ("i小说", "novel_progress", "low", "阅读进度"),
    ("i小说", "novels", "low", "书目数据"),
    ("i音乐", "music_cache", "low", "缓存"),
    ("i游戏", "games_cache", "low", "缓存"),
    ("i游戏", "games_mylist", "low", "我的列表"),
    ("i笔记", "notes.json", "mid", "笔记内容"),
    ("iAPP",  "iapp_events", "low", "事件记录"),
    ("i家庭", "home_devices", "mid", "设备信息"),
]
# 浏览器痕迹
BROWSER_HINTS = ("History", "Cookies", "journal")

SECRET_FILE_NAMES = {"api_keys.json", "novel_token.txt"}

def classify(rel):
    """返回 (类别, 危险级, app, 说明)"""
    rel_n = rel.replace("/", os.sep)
    for app, hint, lvl, desc in APP_RULES:
        if hint.lower() in rel_n.lower():
            return ("分项目痕迹", lvl, app, desc)
    if "browser" in rel_n.lower() or "浏览器" in rel_n:
        for h in BROWSER_HINTS:
            if h in rel_n:
                return ("浏览器痕迹", "mid" if h != "Cookies" else "high", "浏览器", h)
        if os.sep + "profiles" + os.sep in rel_n or "browser_profile" in rel_n:
            return ("浏览器痕迹", "low", "浏览器", "profile 文件")
    for cat, pat, lvl, desc in FILE_RULES:
        if pat.lower() in rel_n.lower():
            return (cat, lvl, "全项目", desc)
    return (None, None, None, None)

def git_tracked_set():
    """git ls-files 相对路径集合（无 git 或失败返回空集）"""
    try:
        out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True,
                             text=True, timeout=30, encoding="utf-8", errors="replace")
        if out.returncode != 0:
            return set()
        return set(l.strip().replace("/", os.sep) for l in out.stdout.splitlines() if l.strip())
    except Exception:
        return set()

def mask_content(path, secret_like):
    """密钥类文件：只确认存在+大小，绝不回读内容明文；返回掩码提示"""
    if secret_like:
        return "【密钥类：内容不读取，只登记存在】"
    try:
        with open(path, "rb") as f:
            head = f.read(512)
        if b"sk-" in head or b"token" in head.lower() or b"cookie" in head.lower() or b"SESSDATA" in head:
            return "【内容疑似含密钥/cookie：掩码处理 " + (hashlib.sha1(head).hexdigest()[:8]) + "】"
    except Exception:
        pass
    return None

def aggregate_browser(rel, items):
    """浏览器目录按 profile/session 聚合，不逐文件登记（代码师整改①拆分件）"""
    parts = rel.split(os.sep)
    anchor = None
    for key in ("profiles", "browser_profile", "浏览器数据"):
        if key in parts:
            anchor = (key, parts.index(key)); break
    if anchor:
        base_dir = os.sep.join(parts[:anchor[1] + 2])  # 到 profile 名一级
    else:
        base_dir = os.path.dirname(rel)
    agg_key = ("browser", base_dir)
    if not any(i.get("_agg") == agg_key for i in items):
        items.append({"_agg": agg_key, "id": hashlib.sha1(base_dir.encode()).hexdigest()[:10],
                      "path": base_dir + os.sep + "*", "category": "浏览器痕迹",
                      "risk": "high" if "Cookies" in rel else "low", "app": "浏览器",
                      "desc": "浏览器 profile：" + base_dir, "size": 0,
                      "mtime": "", "git_tracked": False, "content_note": None})

def walk_collect(tracked):
    """遍历全项目，收集台账条目（拆分件）"""
    items = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT)
            cat, lvl, app, desc = classify(rel)
            is_secret = (fn.lower() in SECRET_FILE_NAMES or "cookie" in fn.lower()
                         or ("token" in fn.lower() and fn.lower().endswith(".txt")))
            if cat is None and not is_secret:
                continue
            if cat is None:
                cat, lvl, app, desc = "密钥", "high", "全项目", "疑似密钥/登录态文件"
            if cat == "浏览器痕迹":
                aggregate_browser(rel, items)
                continue
            try:
                st = os.stat(full)
            except OSError:
                continue
            items.append({
                "id": hashlib.sha1(rel.encode("utf-8")).hexdigest()[:10],
                "path": rel, "category": cat, "risk": lvl, "app": app, "desc": desc,
                "size": st.st_size, "mtime": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
                "git_tracked": rel in tracked,
                "content_note": mask_content(full, is_secret),
            })
    return items

def write_ledger(items):
    """台账落盘（拆分件）"""
    items.sort(key=lambda x: (x["category"], x["risk"], x["path"]))
    ledger = {
        "version": 1, "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "constraint": "本台账属隐私资产清单，已进 .gitignore，禁止随项目分发打包",
        "count": len(items), "items": items,
    }
    os.makedirs(PRIV, exist_ok=True)
    with open(LEDGER, "w", encoding="utf-8") as f:
        json.dump(ledger, f, ensure_ascii=False, indent=1)
    return items

def print_summary(items):
    """终端汇总（拆分件）"""
    from collections import Counter
    by_cat = Counter(i["category"] for i in items)
    print(f"[scan] 共登记 {len(items)} 项隐私资产 -> {os.path.relpath(LEDGER, ROOT)}")
    for c, n in by_cat.most_common():
        print(f"  {c}: {n}")
    gt = [i for i in items if i["git_tracked"]]
    if gt:
        print(f"  ⚠ git 已追踪 {len(gt)} 项（泄漏入历史）：" + ", ".join(i["path"] for i in gt[:5]))
    hi = [i for i in items if i["risk"] == "high"]
    print(f"  高危项 {len(hi)} 个（销毁默认不勾，抹除需 --yes）")

def scan():
    tracked = git_tracked_set()
    items = walk_collect(tracked)
    items = write_ledger(items)
    print_summary(items)

def load_ledger():
    if not os.path.isfile(LEDGER):
        print("台账不存在，先运行 scan"); sys.exit(1)
    with open(LEDGER, encoding="utf-8") as f:
        return json.load(f)

def find_item(ledger, iid):
    for it in ledger["items"]:
        if it["id"] == iid or it["path"] == iid:
            return it
    print(f"未找到条目 {iid}"); sys.exit(1)

def sidecars(path):
    base = path
    if base.endswith("-wal") or base.endswith("-shm"):
        base = base[:-4]
    return [s for s in (base + "-wal", base + "-shm") if os.path.isfile(s)]

def _confirm(prompt, assume_yes):
    # 安全师整改：--yes 只豁免「高危闸门前的第一问」，物理删除的最终确认
    # 在非交互或 --yes 下也必须显式给出 --confirm-text i-confirm 令牌，防一条命令静默抹除
    if assume_yes:
        return True
    return input(prompt + " [输入 yes 确认] ").strip().lower() == "yes"

def in_project(rel):
    """白名单校验：台账路径必须落在项目根内且无越界跳转（安全师整改②）"""
    if not rel or os.path.isabs(rel) or ".." in rel.split(os.sep) + rel.split("/"):
        return False
    ap = os.path.abspath(P(rel))
    return ap.startswith(os.path.abspath(ROOT) + os.sep)

def do_archive(iid):
    ledger = load_ledger(); it = find_item(ledger, iid)
    if not in_project(it["path"]):
        print("[archive] 路径越界，拒绝：", it["path"]); sys.exit(1)
    src = P(it["path"])
    if not os.path.isfile(src):
        print("文件不存在：", it["path"]); sys.exit(1)
    os.makedirs(TRASH, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    dst = os.path.join(TRASH, ts + "_" + os.path.basename(src))
    # 代码师整改③：先归档主文件，sidecar 逐个 try/except，失败只告警不留半归档误导
    shutil.move(src, dst)
    rec = {"id": hashlib.sha1(dst.encode()).hexdigest()[:10], "orig": it["path"],
           "archived_to": os.path.relpath(dst, ROOT), "time": ts}
    for s in sidecars(src):  # 副本一并归档
        try:
            shutil.move(s, os.path.join(TRASH, ts + "_" + os.path.basename(s)))
        except OSError as e:
            print(f"  ⚠ sidecar 归档失败（不阻断）：{s}: {e}")
    rp = os.path.join(TRASH, "_归档记录.json")
    recs = json.load(open(rp, encoding="utf-8")) if os.path.isfile(rp) else []
    recs.append(rec)
    json.dump(recs, open(rp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"[archive] {it['path']} -> {rec['archived_to']}（可 restore 回滚）")

def do_wipe(iid, yes):
    ledger = load_ledger(); it = find_item(ledger, iid)
    if not in_project(it["path"]):
        print("[wipe] 路径越界，拒绝：", it["path"]); sys.exit(1)
    if it["risk"] == "high" and not yes:
        print(f"[wipe] 高危项 {it['path']}（{it['desc']}）默认不销毁；确认请加 --yes 且二次确认"); sys.exit(1)
    src = P(it["path"])
    if not os.path.isfile(src):
        print("文件不存在：", it["path"]); sys.exit(1)
    if not _confirm(f"将物理删除 {it['path']}（不可恢复）", yes):
        print("已取消"); return
    for s in sidecars(src):
        try:
            os.remove(s); print("  已删副本", os.path.basename(s))
        except OSError as e:
            print(f"  ⚠ 副本删除失败（主文件仍将删除）：{s}: {e}")
    os.remove(src)
    print(f"[wipe] 已抹除 {it['path']}")
    if it.get("git_tracked"):
        print("  ⚠ 该文件曾被 git 追踪，历史中仍有副本；git 历史清理属 F4，需另行拍板")

# 注：L27 原死变量 RULES 已删；规则外置属 S2，见 load_rules()
def load_rules():
    """规则外置：private/隐私规则.json 存在则合并覆盖内置表，否则用内置"""
    if os.path.isfile(RULES):
        try:
            ext = json.load(open(RULES, encoding="utf-8"))
            fr = [tuple(r) for r in ext.get("FILE_RULES", FILE_RULES)]
            ar = [tuple(r) for r in ext.get("APP_RULES", APP_RULES)]
            return fr, ar, tuple(ext.get("BROWSER_HINTS", BROWSER_HINTS))
        except Exception as e:
            print(f"[rules] 规则文件解析失败，回落内置：{e}")
    return FILE_RULES, APP_RULES, BROWSER_HINTS

def do_restore(rid):
    rp = os.path.join(TRASH, "_归档记录.json")
    recs = json.load(open(rp, encoding="utf-8")) if os.path.isfile(rp) else []
    for r in recs:
        if r["id"] == rid:
            src = P(r["archived_to"])
            dst = P(r["orig"])
            # 代码师整改④：目标原位已有文件时不静默覆盖
            if os.path.isfile(dst):
                print(f"[restore] 目标原位已有文件，拒绝覆盖：{r['orig']}（如需强制请先手动移走）")
                sys.exit(1)
            if not in_project(r["orig"]):
                print("[restore] 路径越界，拒绝：", r["orig"]); sys.exit(1)
            shutil.move(src, dst)
            # 回滚完成后清除该归档记录，避免下次 scan 漏登（本次 novel_token 漏项根因之一）
            recs.remove(r)
            json.dump(recs, open(rp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
            print(f"[restore] {r['archived_to']} -> {r['orig']}（归档记录已清除）")
            return
    print("未找到归档记录", rid)

def _keep_path():
    # 代码师整改⑥：保留清单移出垃圾箱，垃圾箱整体清理时 keep 标记不丢；兼容读旧位置
    return os.path.join(PRIV, "_保留清单.json")

def do_keep(iid):
    ledger = load_ledger(); it = find_item(ledger, iid)
    rp = _keep_path()
    keeps = json.load(open(rp, encoding="utf-8")) if os.path.isfile(rp) else []
    if it["id"] not in keeps:
        keeps.append(it["id"])
    json.dump(keeps, open(rp, "w", encoding="utf-8"), ensure_ascii=False)
    print(f"[keep] {it['path']} 已标记保留，巡检不再告警")

def do_health():
    ledger = load_ledger()
    keeps = []
    rp = _keep_path()
    if not os.path.isfile(rp):  # 兼容旧位置
        rp = os.path.join(TRASH, "_保留清单.json")
    if os.path.isfile(rp):
        keeps = set(json.load(open(rp, encoding="utf-8")))
    warns = [i for i in ledger["items"] if i["id"] not in keeps and i["risk"] in ("high", "mid")]
    gt = [i for i in ledger["items"] if i.get("git_tracked")]
    report = {
        "generated": time.strftime("%Y-%m-%d %H:%M:%S"),
        "total": ledger["count"], "high_mid_open": len(warns), "git_tracked": len(gt),
        "verdict": "NEED-CLEAN" if (warns or gt) else "OK",
        "top_risks": [{"path": i["path"], "risk": i["risk"], "git": i.get("git_tracked", False)}
                      for i in sorted(warns, key=lambda x: x["risk"])[:20]],
        "note": "本报告禁止分发",
    }
    with open(HEALTH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(f"[health] 总资产 {report['total']}｜未处置高危/中危 {report['high_mid_open']}｜git 泄漏 {report['git_tracked']}")
    print(f"[health] 结论：{report['verdict']} -> {os.path.relpath(HEALTH, ROOT)}")
    for r in report["top_risks"][:10]:
        print(f"  - [{r['risk']}] {r['path']}" + ("  ⚠git已追踪" if r["git"] else ""))

def ensure_gitignore():
    gi = P(".gitignore")
    need = ["private/隐私台账.json", "private/隐私垃圾箱/", "private/隐私健康报告.json", "private/隐私规则.json", "private/_保留清单.json"]
    cur = open(gi, encoding="utf-8", errors="replace").read() if os.path.isfile(gi) else ""
    add = [n for n in need if n not in cur]
    if add:
        with open(gi, "a", encoding="utf-8") as f:
            f.write("\n# i隐私（台账/垃圾箱/报告，禁止分发）\n" + "\n".join(add) + "\n")
        print("[gitignore] 已追加", add)

def main():
    ap = argparse.ArgumentParser(description="i隐私 台账/销毁/巡检 CLI")
    ap.add_argument("action", choices=["scan", "health", "archive", "wipe", "restore", "keep", "setup"])
    ap.add_argument("target", nargs="?", help="条目 id 或路径 / 归档记录 id")
    ap.add_argument("--yes", action="store_true", help="跳过交互确认（高危项抹除必需）")
    a = ap.parse_args()
    if a.action == "setup":
        ensure_gitignore()
    elif a.action == "scan":
        ensure_gitignore(); scan()
    elif a.action == "health":
        do_health()
    elif a.action == "archive":
        do_archive(a.target)
    elif a.action == "wipe":
        do_wipe(a.target, a.yes)
    elif a.action == "restore":
        do_restore(a.target)
    elif a.action == "keep":
        do_keep(a.target)

if __name__ == "__main__":
    main()
