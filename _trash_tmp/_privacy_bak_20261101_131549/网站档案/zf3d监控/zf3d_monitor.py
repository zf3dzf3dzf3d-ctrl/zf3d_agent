# -*- coding: utf-8 -*-
"""监控 zf3d.com 首页标题：抓取标题与上次对比，变化或首次则记录日志"""
import urllib.request, re, os, datetime, json

URL = "https://www.zf3d.com/"
BASE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(BASE, "zf3d_state.json")
LOG = os.path.join(BASE, "zf3d_monitor_log.md")

def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=20).read().decode("utf-8", "ignore")
    m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    title = m.group(1).strip() if m else "(未找到标题)"
    m2 = re.search(r'<a[^>]*href="[^"]*thread[^"]*"[^>]*>([^<]{6,80})</a>', html, re.I)
    first_thread = m2.group(1).strip() if m2 else ""

    last = None
    if os.path.exists(STATE):
        try:
            last = json.load(open(STATE, encoding="utf-8")).get("title")
        except Exception:
            pass

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    changed = (last is None) or (last != title)
    if changed:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"- **{now}** 标题: `{title}` ｜ 首帖: `{first_thread}` ｜ {'首次记录' if last is None else '⚠️ 标题有变化'}\n")
        json.dump({"title": title, "time": now}, open(STATE, "w", encoding="utf-8"))
        print(f"[CHANGE] {now} title={title} thread={first_thread}")
    else:
        print(f"[OK] {now} 未变化 title={title}")

if __name__ == "__main__":
    main()
