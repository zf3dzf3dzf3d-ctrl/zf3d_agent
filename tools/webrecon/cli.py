"""CLI 入口：python cli.py https://example.com [--json out.json]"""
import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from recon import scan


def main():
    if len(sys.argv) < 2:
        print("用法: python cli.py <网址> [--json 输出文件.json]")
        sys.exit(1)
    url = sys.argv[1]
    try:
        r = scan(url)
    except ValueError as e:
        print(f"[拒绝] {e}")
        sys.exit(2)

    print(f"\n===== 网站体检卡: {r['target']} =====")
    b = r["basic"]
    print(f"[基础] 状态码 {b.get('status_code')} | IP {b.get('ip')} | Server {b.get('server')} | 标题 {b.get('title')}")
    if b.get("redirect_chain"):
        print(f"[重定向] " + " -> ".join(f"{x['status']}" for x in b["redirect_chain"]) + f" -> {b.get('final_url')}")
    print(f"[指纹] {', '.join(r['fingerprints']) or '未识别'}")
    t = r["tls"]
    if t.get("https"):
        print(f"[TLS] 已启用 | 颁发者 {t.get('issuer')} | 到期 {t.get('not_after')} {t.get('warning') or ''}")
    else:
        print(f"[TLS] {t.get('note') or t.get('error') or '未启用'}")
    if r["sensitive_paths"]:
        print("[敏感路径]")
        for f in r["sensitive_paths"]:
            print(f"  200  /{f['path']}  ({f['size']} bytes)")
    else:
        print("[敏感路径] 未发现可访问的常见敏感文件")
    print(f"[DNS] A记录 {r['dns'].get('A')}")
    print(f"[耗时] {r['duration_sec']}s\n")

    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        with open(out, "w", encoding="utf-8") as f:
            json.dump(r, f, ensure_ascii=False, indent=2)
        print(f"JSON 报告已保存: {out}")


if __name__ == "__main__":
    main()
