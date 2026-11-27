# -*- coding: utf-8 -*-
"""i新闻 RSS 采集脚本：抓取主流新闻源头条 → 调用 news_collect.py 入库
用法：python news_fetch_rss.py
源：新浪/网易/澎湃/知乎日报 等公开 RSS（可按需增删 SOURCES）
行为：
  - 逐源抓 XML，正则解析 <item>/<entry>（标准库，无第三方依赖）
  - 取 title/link/pubDate/description，每源限前 8 条
  - 时间统一格式化为 YYYY-MM-DD HH:MM（无时间戳则用今天日期）
  - cat 按 source 分组为"时事/科技/财经"三类（按源分类表）
  - 组装条目数组写入临时 json 后调用 news_collect.py（复用去重/自增/原子写）
退出码：0=成功
"""
import json
import os
import re
import ssl
import sys
import tempfile
import urllib.request
from datetime import datetime
from util_log import get_logger

log = get_logger('news_fetch_rss')

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_BASE, 'server', 'tools'))

# RSS 源清单：name=来源名, cat=分类, url=RSS 地址
SOURCES = [
    # —— 中文源 ——
    {'name': '澎湃·时事',  'cat': '中国', 'url': 'https://rsshubapp.psjd.cc/thepaper/newsDetail/25'},
    {'name': '少数派',     'cat': '科技', 'url': 'https://sspai.com/feed'},
    {'name': 'solidot',    'cat': '科技', 'url': 'https://www.solidot.org/index.rss'},
    {'name': 'V2EX',       'cat': '科技', 'url': 'https://www.v2ex.com/index.xml'},
    {'name': '阮一峰周刊', 'cat': '科技', 'url': 'https://www.ruanyifeng.com/blog/atom.xml'},
    {'name': '爱范儿',     'cat': '科技', 'url': 'https://www.ifanr.com/feed'},
    # —— 国际源（英文，标题经 AI 翻译成中文）——
    {'name': 'BBC World',  'cat': '世界', 'url': 'http://feeds.bbci.co.uk/news/world/rss.xml'},
    {'name': 'Guardian',   'cat': '世界', 'url': 'https://www.theguardian.com/world/rss'},
    {'name': 'CNBC',       'cat': '财经', 'url': 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114'},
    {'name': 'DW News',    'cat': '世界', 'url': 'https://rss.dw.com/rdf/rss-en-world'},
    {'name': 'Al Jazeera', 'cat': '世界', 'url': 'https://www.aljazeera.com/xml/rss/all.xml'},
    # —— Google News 兜底（聚合世界头条，中文，几乎永不挂）——
    {'name': 'Google新闻·世界', 'cat': '世界', 'url': 'https://news.google.com/rss/search?q=%E4%B8%96%E7%95%8C&hl=zh-CN&gl=CN&ceid=CN:zh-Hans'},
]
PER_SOURCE_LIMIT = 8
# 【安全修复】默认校验证书（原全局 CERT_NONE 已移除）：
# main() 逐源 try，个别源证书失败只记录并跳过该源，不再全局关闭校验。
SSL_CTX = ssl.create_default_context()

ITEM_RE = re.compile(
    r'<(?:item|entry)[^>]*>(.*?)</(?:item|entry)>', re.S)
TAG_RES = {
    'title': re.compile(r'<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>', re.S),
    'link':  re.compile(r'<link[^>]*href="([^"]+)"|<link[^>]*>(.*?)</link>', re.S),
    'pub':   re.compile(r'<(?:pubDate|published|updated|dc:date)[^>]*>(.*?)</', re.S),
    'desc':  re.compile(r'<(?:description|summary|content)[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</', re.S),
}


def _clean(s):
    s = re.sub(r'<[^>]+>', '', s or '')
    s = s.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'").replace('&nbsp;', ' ')
    return re.sub(r'\s+', ' ', s).strip()


def _fmt_time(raw):
    raw = (raw or '').strip()
    if not raw:
        return datetime.now().strftime('%Y-%m-%d')
    try:
        from email.utils import parsedate_to_datetime
        return parsedate_to_datetime(raw).strftime('%Y-%m-%d %H:%M')
    except Exception:
        pass
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})', raw)
    if m:
        return '%s-%s-%s %s:%s' % m.groups()
    return datetime.now().strftime('%Y-%m-%d')


def fetch_source(src):
    req = urllib.request.Request(src['url'], headers={'User-Agent': 'Mozilla/5.0 (compatible; zfnews/1.0)'})
    with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as r:
        xml = r.read().decode('utf-8', 'ignore')
    items = []
    for body in ITEM_RE.findall(xml)[:PER_SOURCE_LIMIT]:
        tm = TAG_RES['title'].search(body)
        if not tm:
            continue
        title = _clean(tm.group(1))
        if not title:
            continue
        lm = TAG_RES['link'].search(body)
        link = ''
        if lm:
            link = (lm.group(1) or lm.group(2) or '').strip()
        pm = TAG_RES['pub'].search(body)
        dm = TAG_RES['desc'].search(body)
        desc = _clean(dm.group(1))[:120] if dm else title[:120]
        items.append({
            'cat': src['cat'], 'src': src['name'],
            'title': title, 'time': _fmt_time(pm.group(1) if pm else ''),
            'summary': desc, 'url': link,
        })
    return items


def main():
    # 【kill_switch 总闸】紧急停止一切出网：开闸时不拉取任何源、不翻译、不入库，
    # 直接退出（exit 0，调度方视为"本轮无新数据"而非故障）。
    try:
        sys.path.insert(0, os.path.join(_BASE, 'server'))
        import kill_switch
        if kill_switch.is_on():
            log.info('kill_switch 已开启: 紧急停止一切出网，本轮跳过全部 RSS 源抓取与入库')
            return 0
    except Exception:
        pass
    all_items, errs = [], []
    for src in SOURCES:
        try:
            got = fetch_source(src)
            all_items.extend(got)
            log.info(f"[OK] {src['name']}: {len(got)} 条")
        except Exception as e:
            errs.append(src['name'])
            log.info(f"[FAIL] {src['name']}: {e}")
    if not all_items:
        log.error('所有源均失败，未入库')
    # 英文标题批量 AI 翻译成中文（title_zh，失败不影响入库）——必须在写 tmp 之前
    try:
        from news_translate import translate_titles
        translate_titles(all_items)
    except Exception as e:
        log.info('[translate] 跳过: %r' % e)
    tmp = os.path.join(tempfile.gettempdir(), 'zf_news_rss_items.json')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(all_items, f, ensure_ascii=False)
    # 复用入库脚本（去重/自增/原子写）
    import subprocess
    py = sys.executable
    r = subprocess.run([py, os.path.join(_BASE, 'server', 'tools', 'news_collect.py'), tmp],
                       capture_output=True, text=True)
    log.info(r.stdout.strip())
    if r.returncode != 0:
        log.info(r.stderr.strip()); return 1
    if errs:
        log.error('失败源：' + ', '.join(errs))
    return 0


if __name__ == '__main__':
    sys.exit(main())
