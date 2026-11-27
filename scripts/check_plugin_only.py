# -*- coding: utf-8 -*-
"""check_plugin_only —— 一切皆插件门禁（策划案 v4 §3.3，T0 交付，永久跑）。

判据（只拦"新增"，存量进 --all 报告不拦）：
  R1  server/ 白名单外新增 .py                      → fail
  R2  mixin_ 新增引用（改动文件新增行命中）          → fail
  R3  zf-app-dock.js 新增 register( 调用            → fail
  R4  index.html 新增静态 <script src=（两副本）     → fail
  R5  插件内旧轨 import（db/engines/mixin_/brain）   → fail（全量扫，非仅新增）
  R6  plugins/ 目录缺 manifest 或必填字段缺失        → fail（全量扫）

豁免机制：插件目录放 .gateignore（每行一个豁免规则 id，目前仅 old-track-import），
供 T2~T7 过渡期桥接插件显式登记；豁免清单在 --all 报告中公示，可审计。

用法：
  python scripts/check_plugin_only.py            # 工作区+未跟踪（手工跑）
  python scripts/check_plugin_only.py --staged   # 仅暂存区（pre-commit 钩子用）
  python scripts/check_plugin_only.py --all      # 全仓审计（存量统计，R5/R6 仍硬拦）
退出码：0 通过；1 有违禁（提交应被拦截）。
"""
import argparse
import json
import os
import re
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

# R1：server/ 新增 .py 白名单（内核+boot+config 的精确相对路径；业务代码一律走 plugins/）
SERVER_CORE_WHITELIST = {
    "server/kernel.py", "server/kernel_core.py", "server/kernel_ctx.py",
    "server/kernel_mgr.py", "server/server_runtime.py", "server/config.py",
    # 工程化整改 P1-5（20261123）：内核级基础设施工具，与 config.py 同类——
    # 被 butler_store/comics_download/工作日志存储等核心模块 import，不属于业务，
    # 走 plugins/ 会造成 core->plugin 反向依赖。可审计：见 docs/策划案-工程化整改-* 第八节。
    "server/util_fs.py", "server/util_http.py",
}
# 命名公约（T1 裁决 20261123，双线共建补充）：后续新增纯基础设施工具一律命名
# server/util_<域>.py，自动放行 R1；业务逻辑混入 util_* 仍受 R2/T8 审查兜住。
_SERVER_INFRA_RE = re.compile(r"^server/util_[a-z0-9_]+\.py$")
# 巡检/审计件（与 tools/hygiene_gate 同类）：断言式安全基线，读 mixin 源码做断言是职能本身，
# 放行 R1 并豁免 R2；其余 mixin 引用规则对一切代码文件照常生效。
# 2026-11-24 增补 server/util_enforcement.py：执法设施清单（唯一真源），按路径列出受保护的
# routes/mixin_*.py 是它的数据而非引用；T2 把 mixin 实现迁走后，这里与清单一并清理。
SERVER_AUDIT_ALLOW = {"server/security_baseline.py", "server/util_enforcement.py"}
# T2 接线件公约（复核轮裁决 20261123）：server/routes/domain_*.py 是"路由注册表化"
# 既定架构的合法载体（零业务复制，只做 dispatcher 接线；引用 mixin 实现是其职能，
# 实现体随 T2.4/T8 一并迁插件后再清理本豁免）。放行 R1/R2。
_T2_DOMAIN_RE = re.compile(r"^server/routes/domain_[a-z0-9_]+\.py$")

# R4：index.html（2026-11-22 双副本已消灭：server/public/ 整体删除，唯一真源=根 public/）
INDEX_HTML_CANDIDATES = ["public/index.html"]

_TEXT_EXT = {".py", ".js", ".html", ".json", ".md", ".css", ".txt", ".cmd", ".bat"}
# R2/R3 只盯代码文件：文档(.md/.txt)提及 mixin_ 文件名属正常叙事（治理案/盘点表），不算引用
_CODE_EXT = {".py", ".js", ".html", ".css", ".ts"}

# R5：旧轨 import 模式（T0 口径：db / engines / mixin_ / brain；dispatcher 直调归 T2/T8 收口，
# zf3d_*/tools.coding 等随对应批次迁移后再纳入）
_OLD_TRACK_RE = re.compile(
    r"^\s*(?:import|from)\s+(db\b|engines?\b|mixin_[A-Za-z0-9_]*|routes\.mixin_[A-Za-z0-9_]*|brain\b|brain\.|server\.db\b)")

# R3：dock 硬编码注册调用（排除定义与注释）
_REGISTER_RE = re.compile(r"(?<!function )\bregister\s*\(")
_SCRIPT_SRC_RE = re.compile(r"<script[^>]*\bsrc\s*=")

_COMMENT_PREFIXES = ("#", "//", "*", "/*", "<!--")


def _git(args):
    cmd = ["git", "-c", "core.quotepath=false"] + args
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True)
    return p.stdout.decode("utf-8", "replace")


def _is_comment(line):
    s = line.lstrip()
    return any(s.startswith(p) for p in _COMMENT_PREFIXES)


def _changed_files(staged):
    """返回 (修改文件集, 新增文件集)。staged=True 只看暂存区（vs HEAD）。"""
    out = _git(["status", "--porcelain", "-uall"])
    modified, added = set(), set()
    for line in out.splitlines():
        if len(line) < 4:
            continue
        st, path = line[:2], line[3:].strip().strip('"')
        if st == "??":
            added.add(path)
            continue
        x, y = st[0], st[1]
        if staged:
            # 暂存区 vs HEAD：看 X 列
            if x == "A":
                added.add(path)
            elif x in "MCRT":
                modified.add(path)
            # x == "D" 纯删除 → 跳过
        else:
            # 工作区 vs HEAD：X/Y 任一列有内容变化即算（修复：' M' 的空格曾把
            # 工作区改动整体漏判，致 R3/R4 失效）
            if x == "D" and y in ("D", " "):
                continue  # 纯删除
            if x == "A" or y == "A":
                added.add(path)
            elif x in "MCRT" or y in "MCRT":
                modified.add(path)
    return modified, added


def _added_lines(path, staged):
    """取某文件相对 HEAD 的新增行列表。untracked 文件返回全文件。"""
    ap = os.path.join(ROOT, path)
    if not os.path.isfile(ap):
        return []
    tracked = _git(["ls-files", "--error-unmatch", path]).strip() != ""
    if not tracked:
        try:
            with open(ap, "r", encoding="utf-8", errors="replace") as f:
                return f.readlines()
        except Exception:
            return []
    diff_args = ["diff", "-U0", "--cached" if staged else "", "HEAD", "--", path]
    out = _git([a for a in diff_args if a])
    lines = []
    for ln in out.splitlines():
        if ln.startswith("+") and not ln.startswith("+++"):
            lines.append(ln[1:])
    return lines


# ---------------------------------------------------------------- 规则


def rule1_server_new_py(added, fails):
    for path in sorted(added):
        rel = path.replace("\\", "/")
        if not (rel.startswith("server/") and rel.endswith(".py")):
            continue
        if rel in SERVER_CORE_WHITELIST or rel in SERVER_AUDIT_ALLOW \
                or _SERVER_INFRA_RE.match(rel) or _T2_DOMAIN_RE.match(rel):
            continue
        fails.append(("R1", path, "server/ 白名单外新增 .py —— 业务代码必须走 plugins/（策划案 v4 §3.2）"))


def rule2_mixin_refs(modified, added, staged, fails):
    files = [f for f in list(modified) + list(added) if os.path.splitext(f)[1] in _CODE_EXT]
    # 插件过渡豁免（与 R5 同义）：.gateignore 登记 old-track-import 的插件，R2 一并豁免
    exempt_plugins = set()
    proot = os.path.join(ROOT, "plugins")
    if os.path.isdir(proot):
        for d in os.listdir(proot):
            if "old-track-import" in _plugin_gateignores(os.path.join(proot, d)):
                exempt_plugins.add(os.path.normpath(os.path.join("plugins", d)))
    for path in sorted(set(files)):
        rel = path.replace("\\", "/")
        if rel == "scripts/check_plugin_only.py":
            continue  # 门禁自身要引用 mixin_ 模式来执法，自豁免
        if rel in SERVER_AUDIT_ALLOW or _T2_DOMAIN_RE.match(rel):
            continue  # 巡检件读 mixin 源码做安全断言/T2 接线件桥接 mixin 是职能本身
        norm = os.path.normpath(rel)
        if any(norm.startswith(ep + os.sep) or norm.startswith(ep + "/") for ep in exempt_plugins):
            continue  # 过渡桥插件（.gateignore 登记），R5/R2 同义豁免
        for ln in _added_lines(path, staged):
            if _is_comment(ln):
                continue
            m = re.search(r"\bmixin_[A-Za-z0-9_]+", ln)
            if m:
                fails.append(("R2", path, "新增 mixin_ 引用（%s）——路由一律走 ctx.route" % m.group(0)))
                break


def rule3_dock_register(modified, added, staged, fails):
    for rel in ["public/js/zf-app-dock.js"]:
        if rel not in modified and rel not in added:
            continue
        for ln in _added_lines(rel, staged):
            if _is_comment(ln) or "function register" in ln or "ZFDock.register" in ln:
                continue
            if _REGISTER_RE.search(ln):
                fails.append(("R3", rel, "新增 register( 调用 —— Dock 程序必须以 ui.* 插件经 ui.mount 注册"))
                break


def _script_srcs(text):
    """取 (剥离 ?v= 版本号后的) script src 集合——版本 bump 不算新增。"""
    return {re.sub(r"\?.*$", "", m.group(1)).lstrip("/")
            for m in re.finditer(r"<script[^>]*\bsrc\s*=\s*[\"']([^\"']+)[\"']", text or "")}


def rule4_index_scripts(modified, added, staged, fails):
    """净增检测：对比 HEAD 与当前的 script src 集合（剥 ?v=），新增 base 路径才算。
    行级 diff 会把并行会话的版本号 bump 误判为新增（R4 首跑实证），故用集合差。"""
    for rel in INDEX_HTML_CANDIDATES:
        if rel not in modified and rel not in added:
            continue
        ap = os.path.join(ROOT, rel)
        if not os.path.isfile(ap):
            continue
        try:
            with open(ap, "r", encoding="utf-8", errors="replace") as f:
                cur = _script_srcs(f.read())
        except Exception:
            continue
        head_txt = _git(["show", "HEAD:" + rel])
        head = _script_srcs(head_txt) if head_txt.strip() else set()
        net_new = cur - head
        if net_new:
            fails.append(("R4", rel, "净增静态 <script src=%s —— 前端资源必须经 ui.* 插件 ui.mount 下发" % sorted(net_new)))


def _plugin_gateignores(pdir):
    p = os.path.join(pdir, ".gateignore")
    if not os.path.isfile(p):
        return set()
    try:
        with open(p, "r", encoding="utf-8-sig") as f:
            return {ln.strip() for ln in f if ln.strip() and not ln.startswith("#")}
    except Exception:
        return set()


def rule5_plugin_old_imports(fails):
    proot = os.path.join(ROOT, "plugins")
    if not os.path.isdir(proot):
        return
    for d in sorted(os.listdir(proot)):
        pdir = os.path.join(proot, d)
        if not os.path.isdir(pdir) or d.startswith("_") or d.startswith("."):
            continue
        skip = _plugin_gateignores(pdir)
        if "old-track-import" in skip:
            continue  # 过渡桥显式登记豁免（--all 报告会公示）
        for dirpath, _dirs, files in os.walk(pdir):
            if "__pycache__" in dirpath:
                continue
            for fn in files:
                if os.path.splitext(fn)[1] != ".py":
                    continue
                fp = os.path.join(dirpath, fn)
                rel = os.path.relpath(fp, ROOT).replace("\\", "/")
                try:
                    with open(fp, "r", encoding="utf-8", errors="replace") as f:
                        for i, ln in enumerate(f, 1):
                            if _is_comment(ln):
                                continue
                            if _OLD_TRACK_RE.match(ln):
                                fails.append(("R5", rel, "L%d 旧轨 import（%s）—— 插件只准 ctx API；过渡桥请放 .gateignore 登记豁免" % (i, ln.strip()[:60])))
                except Exception:
                    pass


def rule6_plugin_manifests(fails):
    proot = os.path.join(ROOT, "plugins")
    if not os.path.isdir(proot):
        return
    valid_types = {"tool", "engine", "gateway", "ui", "schedule", "store",
                   "prompt", "brain", "infra", "bundle", "mode"}
    for d in sorted(os.listdir(proot)):
        pdir = os.path.join(proot, d)
        if not os.path.isdir(pdir) or d.startswith("_") or d.startswith("."):
            continue
        mpath = os.path.join(pdir, "manifest.json")
        has_py = any(fn.endswith(".py") for fn in os.listdir(pdir) if os.path.isfile(os.path.join(pdir, fn)))
        if not os.path.isfile(mpath):
            if has_py:
                fails.append(("R6", "plugins/" + d, "含 .py 但缺 manifest.json —— 不是合法插件目录"))
            continue
        try:
            with open(mpath, "r", encoding="utf-8-sig") as f:
                m = json.load(f)
        except Exception as e:
            fails.append(("R6", "plugins/" + d, "manifest.json 解析失败: %s" % e))
            continue
        miss = [k for k in ("id", "name", "version", "type", "entry") if not m.get(k)]
        if miss:
            fails.append(("R6", "plugins/" + d, "manifest 缺必填字段: %s" % ",".join(miss)))
            continue
        if m.get("type") not in valid_types:
            fails.append(("R6", "plugins/" + d, "type 非法: %r（合法: %s）" % (m.get("type"), ",".join(sorted(valid_types)))))
        if m.get("spec", 1) != 1:
            fails.append(("R6", "plugins/" + d, "unsupported spec: %r" % m.get("spec")))
        if not (m.get("entry") or {}).get("py"):
            fails.append(("R6", "plugins/" + d, "entry.py 缺失"))


def _all_mode_survey(warns):
    """--all：存量漂移普查（advisory，不拦）。"""
    def count(pat, files):
        n = 0
        for rel in files:
            ap = os.path.join(ROOT, rel)
            if not os.path.isfile(ap):
                continue
            try:
                with open(ap, "r", encoding="utf-8", errors="replace") as f:
                    n += sum(1 for ln in f if pat.search(ln))
            except Exception:
                pass
        return n

    mixin_files = [os.path.relpath(os.path.join(dp, fn), ROOT).replace("\\", "/")
                   for dp, _d, fns in os.walk(os.path.join(ROOT, "server", "routes"))
                   for fn in fns if fn.startswith("mixin_") and fn.endswith(".py")]
    server_pys = [os.path.relpath(os.path.join(dp, fn), ROOT).replace("\\", "/")
                  for dp, _d, fns in os.walk(os.path.join(ROOT, "server"))
                  for fn in fns if fn.endswith(".py") and "__pycache__" not in dp]
    warns.append(("存量", "server/routes", "mixin_*.py 文件 %d 个（T2 目标：0）" % len(mixin_files)))
    warns.append(("存量", "server", "mixin_ 引用 %d 处（T2 目标：0）" % count(re.compile(r"\bmixin_[A-Za-z0-9_]+"), server_pys)))
    idx = os.path.join(ROOT, "public", "index.html")
    if os.path.isfile(idx):
        with open(idx, "r", encoding="utf-8", errors="replace") as f:
            n = sum(1 for ln in f if _SCRIPT_SRC_RE.search(ln))
        warns.append(("存量", "public/index.html", "静态 <script src= %d 处（T1 目标：≤15）" % n))
    dock = os.path.join(ROOT, "public", "js", "zf-app-dock.js")
    if os.path.isfile(dock):
        with open(dock, "r", encoding="utf-8", errors="replace") as f:
            n = sum(1 for ln in f if _REGISTER_RE.search(ln) and not _is_comment(ln)
                    and "function register" not in ln and "ZFDock.register" not in ln)
        warns.append(("存量", "public/js/zf-app-dock.js", "硬编码 register( %d 处（T1 目标：0）" % n))


def main():
    ap = argparse.ArgumentParser(description="一切皆插件门禁（策划案 v4 §3.3）")
    ap.add_argument("--staged", action="store_true", help="只查暂存区（pre-commit 用）")
    ap.add_argument("--all", action="store_true", help="全仓审计：输出存量普查，R5/R6 仍硬拦")
    args = ap.parse_args()

    fails = []
    warns = []
    if args.all:
        _all_mode_survey(warns)
    else:
        modified, added = _changed_files(args.staged)
        rule1_server_new_py(added, fails)
        rule2_mixin_refs(modified, added, args.staged, fails)
        rule3_dock_register(modified, added, args.staged, fails)
        rule4_index_scripts(modified, added, args.staged, fails)

    rule5_plugin_old_imports(fails)
    rule6_plugin_manifests(fails)

    if warns:
        print("== 存量普查（advisory，不拦提交）==")
        for tag, where, msg in warns:
            print("  [%s] %s: %s" % (tag, where, msg))

    if fails:
        print("== 门禁拦截（一切皆插件·策划案 v4 §3.3）==")
        for rule, path, msg in fails:
            print("  [%s] %s — %s" % (rule, path, msg))
        print("结果: %d 项违禁，提交被拦。修复后重试；过渡豁免用插件目录 .gateignore（可审计）。" % len(fails))
        return 1

    print("门禁通过：无新增违禁（一切皆插件 v4 §3.3）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
