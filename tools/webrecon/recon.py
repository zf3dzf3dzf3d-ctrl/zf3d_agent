"""
网站信息探测工具（WebRecon）—— 仅限对自有或已授权目标使用。
输入一个网址，自动输出：基础信息 / 技术栈指纹 / TLS 证书 / 敏感路径 / DNS 记录。
"""
import ipaddress
import json
import re
import socket
import ssl
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from urllib.parse import urlparse
import requests
import urllib3

urllib3.disable_warnings()

USER_AGENT = "WebRecon/1.0 (authorized security assessment)"
TIMEOUT = 10
SENSITIVE_PATHS = [
    "robots.txt", "sitemap.xml", ".env", ".git/HEAD", "backup.zip",
    "admin/", "phpinfo.php", ".DS_Store", "config.php.bak", "web.config",
    "server-status", ".svn/entries", "composer.json", "package.json",
    "wp-login.php", "actuator/health", ".well-known/security.txt",
]

# ---------------- 合规护栏 ----------------

def _check_target(url: str) -> str:
    """规范化 URL 并校验：禁止内网/回环地址（防 SSRF 式滥用）。返回规范化 URL。"""
    if not re.match(r"^https?://", url):
        url = "http://" + url
    p = urlparse(url)
    host = p.hostname
    if not host:
        raise ValueError("无法解析目标地址")
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(host))
    except socket.gaierror:
        raise ValueError(f"域名无法解析: {host}")
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
        raise ValueError(f"目标解析到内网/保留地址 {ip}，已拒绝扫描（仅允许公网授权目标）")
    return url.rstrip("/")


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    return s

# ---------------- 模块1：基础信息 ----------------

def probe_basic(url: str) -> dict:
    """IP、状态码、服务器、响应头、重定向链。"""
    s = _session()
    result = {"final_url": url, "status_code": None, "headers": {},
              "redirect_chain": [], "ip": None, "title": None, "server": None}
    host = urlparse(url).hostname
    try:
        result["ip"] = socket.gethostbyname(host)
    except socket.gaierror:
        pass
    try:
        resp = s.get(url, timeout=TIMEOUT, verify=False, allow_redirects=True)
        for r in resp.history:
            result["redirect_chain"].append({"url": r.url, "status": r.status_code})
        result["final_url"] = resp.url
        result["status_code"] = resp.status_code
        result["headers"] = dict(resp.headers)
        result["server"] = resp.headers.get("Server")
        m = re.search(r"<title[^>]*>(.*?)</title>", resp.text[:20000], re.S | re.I)
        if m:
            result["title"] = m.group(1).strip()[:120]
        result["_body"] = resp.text[:50000]
    except requests.RequestException as e:
        result["error"] = str(e)[:200]
    return result

# ---------------- 模块2：技术栈指纹 ----------------

def probe_fingerprints(basic: dict, rules: list) -> list:
    """用指纹规则表匹配响应头与页面正文。rules: [{name, header?, header_re?, body_re?}]
    ⚠ 契约锚定：返回值必须是纯字符串数组（[name, ...]）。
    前端 public/js/app-canvas-browser-node.js 直接 join('、') 渲染；
    若改为对象数组，前端需同步加 .map(x => x.name || x)。
    redirect_chain 同理：必须是 [{url, status}] 对象数组（前端已按对象渲染）。"""
    found = []
    headers = {k.lower(): v for k, v in basic.get("headers", {}).items()}
    body = basic.get("_body", "")
    for rule in rules:
        name = rule["name"]
        ok = False
        if rule.get("header") and rule.get("header_re"):
            hv = headers.get(rule["header"].lower(), "")
            if hv and re.search(rule["header_re"], hv, re.I):
                ok = True
        if not ok and rule.get("body_re") and body:
            if re.search(rule["body_re"], body, re.I):
                ok = True
        if ok:
            found.append(name)
    return found

# ---------------- 模块3：TLS 证书 ----------------

def probe_tls(url: str) -> dict:
    p = urlparse(url)
    host = p.hostname
    if not host:
        return {"error": "无主机名"}
    port = p.port or 443

    def _get_cert(verify: bool):
        ctx = ssl.create_default_context() if verify else ssl.create_default_context()
        if not verify:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
        with socket.create_connection((host, port), timeout=TIMEOUT) as sock:
            with ctx.wrap_socket(sock, server_hostname=host) as ss:
                return ss.getpeercert() if verify else None

    try:
        cert = _get_cert(True)
        if not cert:  # CERT_NONE 模式拿不到详情，转 DER 摘要兜底
            der = None
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            with socket.create_connection((host, port), timeout=TIMEOUT) as sock:
                with ctx.wrap_socket(sock, server_hostname=host) as ss:
                    der = ss.getpeercert(binary_form=True)
            return {"https": True, "note": "证书已启用（详情解析需 cryptography 库）",
                    "cert_sha256": __import__("hashlib").sha256(der).hexdigest()[:16] if der else None}
        return {"https": True,
                "subject": dict(x[0] for x in cert.get("subject", ())).get("commonName"),
                "issuer": dict(x[0] for x in cert.get("issuer", ())).get("organizationName"),
                "not_after": cert.get("notAfter")}
    except ssl.SSLCertVerificationError:
        try:
            _get_cert(False)
            return {"https": True, "warning": "证书校验失败（自签名/域名不匹配/过期）"}
        except OSError as e:
            return {"error": str(e)[:150]}
    except ConnectionRefusedError:
        return {"https": False, "note": "目标未启用 TLS（443 端口无服务）"}
    except (socket.timeout, OSError) as e:
        return {"error": str(e)[:150]}

# ---------------- 模块4：敏感路径 ----------------

def probe_paths(url: str) -> list:
    """对常见敏感路径发 HEAD（405 时降级 GET），只探测不利用。"""
    s = _session()
    findings = []

    def check(path):
        try:
            r = s.head(f"{url}/{path}", timeout=5, verify=False, allow_redirects=False)
            if r.status_code == 405:
                r = s.get(f"{url}/{path}", timeout=5, verify=False, allow_redirects=False, stream=True)
            if r.status_code == 200:
                return {"path": path, "status": 200, "size": int(r.headers.get("Content-Length") or 0)}
        except requests.RequestException:
            pass
        return None

    with ThreadPoolExecutor(max_workers=4) as ex:
        for f in ex.map(check, SENSITIVE_PATHS):
            if f:
                findings.append(f)
            time.sleep(0.05)  # 限频
    return findings

# ---------------- 模块5：DNS 记录 ----------------

def probe_dns(host: str) -> dict:
    dns = {"A": None, "MX": [], "NS": [], "TXT": []}
    try:
        dns["A"] = socket.gethostbyname(host)
    except socket.gaierror:
        pass
    # MX/NS/TXT 用 nslookup 兜底（避免引入 dnspython）
    for rtype, key in (("MX", "MX"), ("NS", "NS"), ("TXT", "TXT")):
        try:
            import subprocess
            r = subprocess.run(["nslookup", "-type=" + rtype, host],
                               capture_output=True, timeout=8,
                               encoding="utf-8", errors="ignore")
            text = (r.stdout or "") + (r.stderr or "")
            vals = [ln.split("=", 1)[-1].strip() for ln in text.splitlines()
                    if rtype.lower() in ln.lower() and "=" in ln]
            dns[key] = [v for v in vals if v][:5]
        except Exception:
            pass
    return dns

# ---------------- 汇总 ----------------

def scan(url: str) -> dict:
    """主入口：输入网址，返回结构化报告 dict。"""
    started = time.time()
    url = _check_target(url)
    host = urlparse(url).hostname
    basic = probe_basic(url)
    with open(_rules_path(), encoding="utf-8") as f:
        rules = json.load(f)
    report = {
        "target": url, "scanned_at": datetime.now().isoformat(timespec="seconds"),
        "basic": {k: v for k, v in basic.items() if k != "_body"},
        "fingerprints": probe_fingerprints(basic, rules),
        "tls": probe_tls("https://" + host),
        "sensitive_paths": probe_paths(url),
        "dns": probe_dns(host),
        "disclaimer": "本工具仅限授权安全评估用途",
        "duration_sec": round(time.time() - started, 1),
    }
    return report


def _rules_path():
    import os
    return os.path.join(os.path.dirname(__file__), "fingerprints.json")
