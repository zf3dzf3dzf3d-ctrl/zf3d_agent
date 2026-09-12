# -*- coding: utf-8 -*-
"""
浏览器浏览记忆（随包分发，存于 browser_data/memory/memory.json）
- 每次 /open 自动存一条页面记忆：URL、标题、正文摘要、时间
- /memory?keyword=xx 按关键词检索历史记忆（搜 URL + 标题 + 正文）
- /memory/clear 清空
"""
import os, json, time, threading, re

BASE = os.path.dirname(os.path.abspath(__file__))
MEM_DIR = os.path.join(BASE, "browser_data", "memory")
MEM_FILE = os.path.join(MEM_DIR, "memory.json")
MAX_RECORDS = 2000
_lock = threading.Lock()


def _load():
    if not os.path.exists(MEM_FILE):
        return []
    try:
        with open(MEM_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save(records):
    os.makedirs(MEM_DIR, exist_ok=True)
    with open(MEM_FILE, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False)


def remember(url, title, text, summary_len=500):
    """存一条页面记忆，返回记忆 id"""
    rec = {
        "id": int(time.time() * 1000),
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "url": url,
        "title": title,
        "summary": re.sub(r"\s+", " ", text or "")[:summary_len],
    }
    with _lock:
        records = _load()
        # 同 URL 覆盖旧记录（保留最新快照）
        records = [r for r in records if r["url"] != url]
        records.append(rec)
        if len(records) > MAX_RECORDS:
            records = records[-MAX_RECORDS:]
        _save(records)
    return rec["id"]


def search(keyword="", limit=20):
    """按关键词检索记忆；keyword 为空返回最近的"""
    records = _load()
    records.reverse()  # 最新的在前
    if not keyword:
        return records[:limit]
    kw = keyword.lower()
    hits = [r for r in records if kw in (r["url"] + r["title"] + r["summary"]).lower()]
    return hits[:limit]


def get(mem_id):
    for r in _load():
        if r["id"] == mem_id:
            return r
    return None


def clear():
    with _lock:
        _save([])
    return True
