# -*- coding: utf-8 -*-
"""
WebMind —— 大模型视角的网页工具
人看网页 = 视觉渲染；模型看网页 = 结构解析。
输出统一为结构化 Markdown：页面标题/正文/链接/表单，去掉脚本、导航、广告噪音。
纯 Python 标准库 + requests（如可用），零 Playwright 依赖。
"""
import json
import os
import re
import sys
import time
import hashlib
import html as html_mod
from urllib.parse import urljoin, urlparse, parse_qs

try:
    import requests
    _HAS_REQUESTS = True
except ImportError:
    _HAS_REQUESTS = False
    import urllib.request
    import http.cookiejar

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "webmind")
os.makedirs(DATA_DIR, exist_ok=True)

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) WebMind/1.0"
TIMEOUT = 15
MAX_BODY = 2 * 1024 * 1024  # 2MB
MAX_MD_LEN = 20000


# ============================================================
# fetcher：HTTP 拉取
# ============================================================
class Fetcher:
    def __init__(self, session_name="default"):
        self.session_name = session_name
        self.cookies = self._load_cookies()

    def _cookie_file(self):
        return os.path.join(DATA_DIR, "cookies_%s.json" % self.session_name)

    def _load_cookies(self):
        try:
            with open(self._cookie_file(), "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_cookies(self):
        with open(self._cookie_file(), "w", encoding="utf-8") as f:
            json.dump(self.cookies, f, ensure_ascii=False, indent=1)

    def fetch(self, url, method="GET", data=None, headers=None):
        hdrs = {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
        if headers:
            hdrs.update(headers)
        if _HAS_REQUESTS:
            s = requests.Session()
            for k, v in self.cookies.items():
                s.cookies.set(k, v)
            resp = s.request(method, url, data=data, headers=hdrs,
                             timeout=TIMEOUT, allow_redirects=True)
            for c in s.cookies:
                self.cookies[c.name] = c.value
            self._save_cookies()
            body = resp.content[:MAX_BODY]
            enc = resp.encoding or "utf-8"
            try:
                text = body.decode(enc, errors="replace")
            except Exception:
                text = body.decode("utf-8", errors="replace")
            return {"status": resp.status_code, "url": resp.url, "html": text}
        else:
            # 标准库回退
            req = urllib.request.Request(url, headers=hdrs, method=method)
            if data:
                body = json.dumps(data).encode() if isinstance(data, dict) else str(data).encode()
            else:
                body = None
            opener = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
            resp = opener.open(req, timeout=TIMEOUT)
            text = resp.read(MAX_BODY).decode("utf-8", errors="replace")
            return {"status": resp.status, "url": resp.geturl(), "html": text}


# ============================================================
# parser：HTML → 结构化 Markdown（纯标准库 HTMLParser）
# ============================================================
from html.parser import HTMLParser

NOISE_TAGS = {"script", "style", "noscript", "svg", "iframe", "template"}
BLOCK_TAGS = {"p", "div", "section", "article", "li", "tr", "h1", "h2", "h3",
              "h4", "h5", "h6", "blockquote", "pre", "br", "ul", "ol", "table",
              "header", "footer", "nav", "aside", "main", "form", "figure"}
NOISE_HINTS = ("banner", "advert", "ads", "sidebar", "cookie", "popup",
               "newsletter", "social", "share", "comment", "promo")


class PageParser(HTMLParser):
    def __init__(self, base_url):
        super().__init__(convert_charrefs=True)
        self.base = base_url
        self.title = ""
        self._in_title = False
        self._skip_depth = 0
        self._skip_tag = None
        self.texts = []          # 正文文本片段
        self.links = []          # (href, text)
        self.forms = []          # 表单描述
        self.images = []
        self._cur_link = None
        self._cur_link_text = []
        self._cur_form = None
        self._cur_input = None
        self._in_noise = False
        self._text_depth = 0
        self._meta_desc = ""
        self.h1 = ""

    def _is_noise_class(self, attrs):
        cls = " ".join(v for k, v in attrs if k in ("class", "id") and v).lower()
        return any(h in cls for h in NOISE_HINTS)

    def handle_starttag(self, tag, attrs):
        attrs_d = dict(attrs)
        if tag in NOISE_TAGS or (self._is_noise_class(attrs) and tag not in ("a",)):
            self._skip_depth += 1
            self._skip_tag = tag
            return
        if self._skip_depth:
            return
        if tag == "title":
            self._in_title = True
        elif tag == "meta" and attrs_d.get("name") == "description":
            self._meta_desc = attrs_d.get("content", "")
        elif tag == "a" and attrs_d.get("href"):
            self._cur_link = urljoin(self.base, attrs_d["href"].split("#")[0])
            self._cur_link_text = []
        elif tag == "img" and attrs_d.get("src"):
            self.images.append(urljoin(self.base, attrs_d["src"]))
        elif tag == "form":
            self._cur_form = {"action": urljoin(self.base, attrs_d.get("action", self.base)),
                              "method": attrs_d.get("method", "get").upper(),
                              "fields": []}
        elif tag in ("input", "textarea", "select") and self._cur_form is not None:
            f = {"tag": tag, "name": attrs_d.get("name", ""),
                 "type": attrs_d.get("type", "text"), "placeholder": attrs_d.get("placeholder", "")}
            self._cur_form["fields"].append(f)
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.texts.append("\n" + "#" * int(tag[1]) + " ")

    def handle_endtag(self, tag):
        if tag == self._skip_tag and self._skip_depth:
            self._skip_depth -= 1
            self._skip_tag = None if self._skip_depth == 0 else self._skip_tag
            return
        if self._skip_depth:
            return
        if tag == "title":
            self._in_title = False
        elif tag == "a" and self._cur_link:
            text = "".join(self._cur_link_text).strip()
            if text and not self._in_noise:
                self.links.append((self._cur_link, text[:120]))
            self._cur_link = None
        elif tag == "form" and self._cur_form:
            if self._cur_form["fields"]:
                self.forms.append(self._cur_form)
            self._cur_form = None
        elif tag in BLOCK_TAGS:
            self.texts.append("\n")

    def handle_data(self, data):
        if self._in_title:
            self.title += data.strip()
            return
        if self._skip_depth:
            return
        t = data.strip()
        if not t:
            return
        if self._cur_link is not None:
            self._cur_link_text.append(t)
        else:
            self.texts.append(t + " ")


def parse_page(url, html_text, max_links=50):
    p = PageParser(url)
    try:
        p.feed(html_text)
    except Exception as e:
        return "# 解析失败\n\n%s" % e

    md = []
    md.append("# %s" % (p.title or url))
    md.append("- URL: %s" % url)
    if p._meta_desc:
        md.append("- 摘要: %s" % p._meta_desc[:300])
    md.append("")

    # 链接清单（模型导航菜单，限 max_links 条）
    if p.links:
        md.append("## 页面链接")
        seen = set()
        n = 0
        for href, text in p.links:
            if href in seen or n >= max_links:
                continue
            seen.add(href)
            n += 1
            md.append("- [%s](%s)" % (text, href))
        if len(p.links) > max_links:
            md.append("- ...（另有 %d 条链接省略）" % (len(p.links) - max_links))
        md.append("")

    # 正文
    body = "".join(p.texts)
    body = re.sub(r"[ \t]+", " ", body)
    body = re.sub(r"\n\s*\n+", "\n\n", body).strip()
    if body:
        md.append("## 正文")
        md.append(body[:MAX_MD_LEN])
        md.append("")

    # 表单
    if p.forms:
        md.append("## 表单")
        for f in p.forms:
            md.append("- %s %s" % (f["method"], f["action"]))
            for fld in f["fields"]:
                md.append("  - 字段: name=%s type=%s%s" %
                          (fld["name"], fld["type"],
                           (" placeholder=%s" % fld["placeholder"]) if fld["placeholder"] else ""))
        md.append("")

    if p.images:
        md.append("## 图片 (%d)" % len(p.images))
        for img in p.images[:20]:
            md.append("- %s" % img)

    return "\n".join(md)[:MAX_MD_LEN]


# ============================================================
# 快照 / 跟踪
# ============================================================
def snapshot_save(name, url, md_text):
    fn = os.path.join(DATA_DIR, "snap_%s.json" % hashlib.md5(name.encode()).hexdigest()[:10])
    snap = {"name": name, "url": url, "time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "hash": hashlib.md5(md_text.encode()).hexdigest()}
    prev = None
    try:
        with open(fn, "r", encoding="utf-8") as f:
            prev = json.load(f)
    except Exception:
        pass
    changed = (prev is None) or (prev.get("hash") != snap["hash"])
    with open(fn, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1)
    with open(fn.replace("snap_", "md_").replace(".json", ".md"), "w", encoding="utf-8") as f:
        f.write(md_text)
    return {"changed": changed, "prev_time": prev.get("time") if prev else None,
            "saved": fn, "md_file": fn.replace("snap_", "md_").replace(".json", ".md")}


# ============================================================
# 动作接口
# ============================================================
_search_engines = {
    "bing": "https://www.bing.com/search?q=",
    "baidu": "https://www.baidu.com/s?wd=",
    "duckduckgo": "https://duckduckgo.com/html/?q=",
}


def run(action="page", url=None, name=None, query=None, engine="bing",
        data=None, method="GET", headers=None, session="default",
        focus=None, max_links=50):
    """WebMind 主入口。
    action:
      page   —— 读网页转 Markdown
      search —— 搜索引擎检索
      watch  —— 读+快照变更检测
      focus  —— 深读：只提取 focus 关键词周边的局部内容（大模型'看向'某处）
      watch_add / watch_list / watch_del / watch_check —— 跟踪器管理
    focus: 关键词（可逗号分隔多个），深读模式提取关键词所在段落/区块
    """
    """WebMind 主入口。
    action:
      page   — 抓取 url 并返回结构化 Markdown
      search — 用引擎搜索 query，返回结果页 Markdown
      form   — 提交表单到 url（method/data）
      watch  — 抓取 url 并与上次快照对比，返回变化情况
    """
    f = Fetcher(session)

    # ---------- 跟踪器管理动作（不抓网页） ----------
    if action in ("watch_add", "watch_list", "watch_del", "watch_check"):
        return _watcher(action, url=url, name=name, session=session, f=f)

    if action == "search":
        if not query:
            return "需要 query 参数"
        url = _search_engines.get(engine, _search_engines["bing"]) + \
            urllib_parse_quote(query)
    if not url:
        return "需要 url 参数"
    if action == "post":
        return post(url, data or {}, method=("POST" if (method or "GET").upper() == "GET" else method),
                    session=session, headers=headers, name=name)
    if action == "thread_check":
        return thread_check(url, title=name, session=session)
    r = f.fetch(url, method=method, data=data, headers=headers)
    md = parse_page(r["url"], r["html"], max_links=max_links)
    head = "> HTTP %s | 会话: %s\n\n" % (r["status"], session)
    if action == "watch":
        nm = name or url
        res = snapshot_save(nm, r["url"], md)
        head += "> 快照 [%s] %s | 上次: %s | **内容%s**\n\n" % (
            nm, "已保存" if res["prev_time"] is None else "已更新",
            res["prev_time"] or "无",
            "有变化 ⚡" if res["changed"] and res["prev_time"] else "无变化")
    if action == "overview":
        return overview_page(r["url"], r["html"], max_links=max_links)
    if action == "read":
        return read_section(md, section=name, keyword=query)
    if action == "focus" or focus:
        return head + focus_extract(md, focus or query)
    return head + md


# ============================================================
# v2 深读：按关键词提取局部内容
# ============================================================
def focus_extract(md_text, focus):
    """在已解析的 Markdown 中提取 focus 关键词所在段落/行块。
    模拟大模型'看向'页面的某一处，而不是通读全文。"""
    if not focus:
        return md_text
    kws = [k.strip() for k in re.split(r"[,，;；|]", focus) if k.strip()]
    lines = md_text.splitlines()
    hits, i = [], 0
    while i < len(lines):
        block = lines[i]
        if any(k.lower() in block.lower() for k in kws):
            # 向后吸收连续相关行（最多 30 行），遇到空行+新标题截断
            j, buf = i + 1, [block]
            while j < len(lines) and len(buf) < 30:
                nxt = lines[j]
                if nxt.startswith("# ") or (nxt == "" and j + 1 < len(lines)
                                            and lines[j + 1].startswith("## ")):
                    break
                buf.append(nxt)
                j += 1
            hits.append("\n".join(buf).strip())
            i = j
        else:
            i += 1
    out = ["# 深读结果 · 关键词: %s" % " / ".join(kws), ""]
    if hits:
        out.append("命中 %d 处：\n" % len(hits))
        for n, h in enumerate(hits, 1):
            out.append("--- 片段 %d ---" % n)
            out.append(h[:3000])
            out.append("")
    else:
        out.append("未命中关键词。可改用 page 动作通读全文，或换关键词。")
    return "\n".join(out)[:MAX_MD_LEN]


# ============================================================
# v2 跟踪器：watchlist 管理 + 巡检
# ============================================================
_WATCHLIST = os.path.join(DATA_DIR, "watchlist.json")
_WATCH_LOG = os.path.join(DATA_DIR, "watch_changes.log")


def _watchlist_load():
    try:
        with open(_WATCHLIST, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _watchlist_save(items):
    with open(_WATCHLIST, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)


def _watcher(action, url=None, name=None, session="default", f=None):
    items = _watchlist_load()
    if action == "watch_add":
        if not url:
            return "需要 url 参数"
        key = hashlib.md5((name or url).encode()).hexdigest()[:10]
        if any(it["key"] == key for it in items):
            return "跟踪目标已存在: %s" % (name or url)
        items.append({"key": key, "name": name or url, "url": url,
                      "session": session,
                      "added": time.strftime("%Y-%m-%d %H:%M:%S")})
        _watchlist_save(items)
        return "✅ 已加入跟踪 [%s] %s（共 %d 个目标）" % (name or url, url, len(items))
    if action == "watch_del":
        if not name and not url:
            return "需要 name 或 url 参数"
        before = len(items)
        items = [it for it in items
                 if it["name"] != (name or it["name"])
                 and it["url"] != (url or it["url"])]
        _watchlist_save(items)
        return "🗑️ 已删除 %d 个跟踪目标（剩 %d 个）" % (before - len(items), len(items))
    if action == "watch_list":
        if not items:
            return "跟踪列表为空。用 watch_add 添加目标。"
        out = ["# 跟踪列表 (%d)" % len(items), ""]
        for it in items:
            out.append("- **%s** → %s (会话: %s, 加入: %s)"
                       % (it["name"], it["url"], it.get("session", "default"),
                          it.get("added", "?")))
        return "\n".join(out)
    if action == "watch_check":
        # 批量巡检：逐个抓取、快照对比，变更落日志
        if not items:
            return "跟踪列表为空。"
        out = ["# 巡检报告 · %s" % time.strftime("%Y-%m-%d %H:%M:%S"), ""]
        changed_n = 0
        for it in items:
            try:
                r = f.fetch(it["url"])
                md = parse_page(r["url"], r["html"])
                res = snapshot_save(it["key"], it["url"], md)
                changed = changed and res["prev_time"] is not None
                if changed:
                    changed_n += 1
                    with open(_WATCH_LOG, "a", encoding="utf-8") as lf:
                        lf.write("%s | [%s] %s 内容有变化 ⚡\n"
                                 % (time.strftime("%Y-%m-%d %H:%M:%S"),
                                    it["name"], it["url"]))
                out.append("- %s：**%s**（上次: %s）"
                           % (it["name"],
                              "内容有变化 ⚡" if changed else
                              ("首次快照" if res["prev_time"] is None else "无变化"),
                              res["prev_time"] or "无"))
            except Exception as e:
                out.append("- %s：❌ 抓取失败 %s" % (it["name"], e))
        out.append("")
        out.append("共 %d 个目标，%d 个有变化。变更日志: %s"
                   % (len(items), changed_n, _WATCH_LOG))
        return "\n".join(out)
    return "未知跟踪动作: %s" % action


def urllib_parse_quote(s):
    from urllib.parse import quote
    return quote(s)




# ============================================================
# v3: 分层阅读原语 overview / read（L1概览 / L2章节精读）
# ============================================================
def _split_sections(md_text):
    """按 Markdown 标题切分章节，返回 [(级别, 标题, 正文, 起始行)]"""
    lines = md_text.split("\n")
    secs = []
    cur = [0, "(开头)", [], 0]
    for i, ln in enumerate(lines):
        m = re.match(r"^(#{1,6})\s+(.*)$", ln)
        if m:
            if cur[2] or cur[0] > 0:
                secs.append((cur[0], cur[1], "\n".join(cur[2]).strip(), cur[3]))
            cur = [len(m.group(1)), m.group(2).strip(), [], i]
        else:
            cur[2].append(ln)
    secs.append((cur[0], cur[1], "\n".join(cur[2]).strip(), cur[3]))
    return secs


def overview_page(url, html_text, max_links=40):
    """L1 概览：标题/章节结构/链接清单，几百 token，用 read(section=N) 精读"""
    p = PageParser(url)
    try:
        p.feed(html_text)
        p.close()
    except Exception:
        pass
    out = ["# 概览: %s" % (p.title or url), ""]
    if p.h1 and p.h1 != p.title:
        out.append("H1: %s" % p.h1)
    secs = _split_sections(parse_page(url, html_text, max_links=max_links))
    out.append("## 章节结构 (%d 节) — 用 read(section=N) 精读:" % len(secs))
    for i, (lv, t, body, _s) in enumerate(secs):
        out.append("  [%d] %s (%d字)" % (i, t[:60], len(body)))
    out.append("")
    out.append("## 链接 (%d 条):" % len(p.links[:max_links]))
    for href, txt in p.links[:max_links]:
        out.append("- [%s](%s)" % ((txt or href)[:50], href))
    return "\n".join(out)


def read_section(md_text, section=None, keyword=None):
    """L2 精读：按序号或关键词取章节正文"""
    secs = _split_sections(md_text)
    if keyword:
        kw = keyword.lower()
        hits = [i for i, (lv, t, b, _s) in enumerate(secs)
                if kw in t.lower() or kw in b.lower()]
        if not hits:
            return "未找到含关键词 '%s' 的章节。可用: %s" % (
                keyword, ", ".join("[%d]%s" % (i, t[:30]) for i, (l, t, b, s) in enumerate(secs)))
        section = hits[0]
    if section is None:
        return "需要 section=序号 或 keyword=关键词"
    try:
        lv, t, body, start = secs[int(section)]
    except (ValueError, IndexError):
        return "章节序号无效。可用: %s" % ", ".join(
            "[%d]%s" % (i, s[1][:30]) for i, s in enumerate(secs))
    return "## [%s] %s\n\n%s" % (section, t, body or "(空)")




# ============================================================
# v3.1: 登录态持久化 + 发帖/巡检动作原语（post / thread_check）
# ============================================================
import hashlib as _hashlib
import io as _io
import time as _time


def _save_json(obj, fn):
    import json as _json
    with _io.open(fn, "w", encoding="utf-8") as fp: _json.dump(obj, fp, ensure_ascii=False)

def _load_json(fn):
    import json as _json
    with _io.open(fn, encoding="utf-8") as fp: return _json.load(fp)

def _csum(s):
    return _hashlib.md5(s.encode("utf-8", "ignore")).hexdigest()


def post(url, data, method="POST", session="default", headers=None, name=None):
    """发帖/提交动作原语：登录态走 Fetcher cookie 持久化，返回结果页 Markdown + HTTP 状态"""
    f = Fetcher(session)
    r = f.fetch(url, method=method.upper(), data=data or {}, headers=headers)
    md = parse_page(r["url"], r["html"])
    head = "> POST %s | HTTP %s | 会话: %s\n\n" % (url, r.get("status"), session)
    return head + md


def thread_check(url, title=None, session="default", focus=None):
    """帖子跟踪巡检：抓取帖子，对比上次快照，增量写入跟踪档案（项目记录风格 md）"""
    f = Fetcher(session)
    r = f.fetch(url)
    md = parse_page(r["url"], r["html"])
    h = _csum(md)
    prev = None
    prev_fn = os.path.join(DATA_DIR, "snap_%s.json" % _csum("thread_" + url)[:10])
    if os.path.exists(prev_fn):
        try: prev = _load_json(prev_fn).get("hash")
        except Exception: prev = None
    changed = (prev != h)
    _save_json({"hash": h, "time": _time.strftime("%Y-%m-%d %H:%M")}, prev_fn)
    # 追加到跟踪档案
    fn = os.path.join(DATA_DIR, "thread_%s.md" % _csum(url)[:10])
    with _io.open(fn, "a", encoding="utf-8") as fp:
        fp.write("\n## 巡检 %s | HTTP %s | %s\n\n" % (
            _time.strftime("%Y-%m-%d %H:%M"), r.get("status"),
            "内容有变化" if changed else "无变化"))
        if changed:
            fp.write(md[:3000])
    return {"url": url, "changed": changed,
            "archive": fn, "http": r.get("status"),
            "summary": ("页面有更新，请 read 精读最新回复" if changed else "无新动态")}


if __name__ == "__main__":
    # 简单命令行自测
    if len(sys.argv) > 1:
        print(run(url=sys.argv[1]))
