# -*- coding: utf-8 -*-
"""打包/发布前自检脚本（API Key 与敏感文件防泄露）。

用法:
    python tools/check_release.py [目录]

不传目录时默认检查整个项目根目录（排除 python/ 等运行环境目录）。
发现以下任何一项即报错退出码 1：
  1. private/api_keys.json 或其他 private/ 下的敏感文件混入
  2. 任何 *.bak / *.bak.* 备份文件
  3. 运行时产物：*.pid、*.log、*.jsonl、server.pid、tts_resp.bin 等
  4. private/ 目录整体存在（发布包不应包含）
  5. 签名私钥：*.keystore / *.jks，以及 _sign_* 命名的签名脚本
  6. 源码内硬编码密钥：32位以上hex串、secret/apikey/password/token 赋值、apksigner ks-pass 明文
  7. 开发期垃圾：_audit_* / _tmp_* / _scan_* 前缀文件、根目录 o.txt / e.txt 重定向事故产物
"""
import os
import re
import sys

SENSITIVE_NAMES = {"api_keys.json", "server.pid", "tts_resp.bin"}
RUNTIME_EXT = {".pid", ".log", ".jsonl", ".bin"}
SKIP_DIRS = {"python", "__pycache__", "node_modules", ".git", "plugins"}

# --- 新增：签名私钥与签名脚本 ---
KEYSTORE_EXT = {".keystore", ".jks"}
SIGN_NAME_PREFIX = ("_sign_",)

# --- 新增：开发期垃圾文件（实测散落在根目录/源码目录的事故产物） ---
JUNK_NAME_PREFIX = ("_audit", "_tmp", "_scan")
JUNK_NAMES = {"o.txt", "e.txt"}

# --- 新增：源码硬编码密钥扫描 ---
# 只扫文本类源码，跳过二进制与超大文件，控制误报范围
TEXT_EXT = {
    ".py", ".bat", ".cmd", ".ps1", ".js", ".mjs", ".json", ".txt", ".md",
    ".html", ".css", ".kt", ".java", ".gradle", ".kts", ".properties", ".xml", ".sh", ".sql",
}
CONTENT_SCAN_MAX_BYTES = 1_000_000
RE_HEX_SECRET = re.compile(r"\b[0-9a-fA-F]{32,}\b")
RE_ASSIGN_SECRET = re.compile(
    r"(?i)\b(secret|api[_-]?key|password|passwd|passphrase|token)\b\s*[=:]\s*['\"][^'\"]{12,}['\"]"
)
RE_KS_PASS = re.compile(r"ks-pass", re.IGNORECASE)


def _content_reason(path):
    """扫描文本文件内容，返回命中的规则名，未命中返回 None。"""
    try:
        if os.path.getsize(path) > CONTENT_SCAN_MAX_BYTES:
            return None
        with open(path, "r", encoding="utf-8", errors="ignore") as fp:
            text = fp.read()
    except OSError:
        return None
    if RE_KS_PASS.search(text):
        return "内容含 apksigner ks-pass 明文"
    if RE_ASSIGN_SECRET.search(text):
        return "内容含 secret/apikey/password/token 明文赋值"
    if RE_HEX_SECRET.search(text):
        return "内容含 32 位以上 hex 串（疑似密钥/哈希，人工复核）"
    return None


def find_issues(root):
    """返回 [(相对路径, 命中原因), ...]，一个文件只报第一条命中规则。"""
    issues = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        rel_dir = os.path.relpath(dirpath, root)
        # private/ 整体不应出现在发布包
        top = rel_dir.split(os.sep)[0] if rel_dir != "." else ""
        if top == "private":
            for f in filenames:
                issues.append((os.path.join(rel_dir, f), "private/ 目录整体不应入包"))
            continue
        for f in filenames:
            rel = os.path.join(rel_dir, f) if rel_dir != "." else f
            low = f.lower()
            stem, ext = os.path.splitext(low)
            if f in SENSITIVE_NAMES:
                issues.append((rel, "敏感文件名"))
            elif low.endswith(".bak") or ".bak." in low:
                issues.append((rel, "备份文件"))
            elif ext in RUNTIME_EXT:
                issues.append((rel, "运行时产物"))
            elif ext in KEYSTORE_EXT:
                issues.append((rel, "签名私钥文件"))
            elif low.startswith(SIGN_NAME_PREFIX):
                issues.append((rel, "签名脚本（含明文密码）"))
            elif low.startswith(JUNK_NAME_PREFIX) or f in JUNK_NAMES:
                issues.append((rel, "开发期垃圾文件"))
            elif ext in TEXT_EXT:
                reason = _content_reason(os.path.join(dirpath, f))
                if reason:
                    issues.append((rel, reason))
    return issues


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    print("[check_release] 检查目录:", root)
    issues = find_issues(root)
    if issues:
        print("[check_release] 发现 %d 个不应发布的文件:" % len(issues))
        for p, reason in issues[:200]:
            print("  - %s  [%s]" % (p, reason))
        if len(issues) > 200:
            print("  ...（其余 %d 条省略）" % (len(issues) - 200))
        sys.exit(1)
    print("[check_release] PASS: 无敏感/备份/运行时产物/硬编码密钥文件。")


if __name__ == "__main__":
    main()
