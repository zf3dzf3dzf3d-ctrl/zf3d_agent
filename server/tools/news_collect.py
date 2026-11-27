# -*- coding: utf-8 -*-
"""i新闻 M3：采集入库脚本（内容自产路线）
用法：
  python news_collect.py items.json
  items.json 为待入库条目数组，每条字段：cat/title/time/src/summary/url(可选)
行为：
  - 读 public/data/news.json，按 title 精确去重（重复项跳过并计数）
  - id 取现有最大 id+1 自增；新条目插到数组头部（前端列表最新在前）
  - 原子写回（先写 .tmp 再 os.replace），保留 UTF-8 无 BOM
  - 上限保护：数组最多保留 200 条，超出截尾
退出码：0=成功(含部分跳过)，1=参数/文件错误
"""
import json
import os
import sys

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # server/tools -> 项目根
NEWS_FILE = os.path.normpath(os.path.join(_BASE, 'public', 'data', 'news.json'))
MAX_ITEMS = 200
_FIELDS = ('cat', 'title', 'title_zh', 'time', 'src', 'summary', 'url')


def load_news():
    with open(NEWS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def main(argv):
    if len(argv) < 2:
        print('用法: python news_collect.py items.json'); return 1
    src = argv[1]
    if not os.path.isfile(src):
        print(f'输入文件不存在: {src}'); return 1
    with open(src, 'r', encoding='utf-8') as f:
        incoming = json.load(f)
    if not isinstance(incoming, list) or not incoming:
        print('输入必须是 [{"cat","title","time","src","summary"}, ...] 非空数组'); return 1

    news = load_news()
    seen = {x.get('title') for x in news}
    next_id = max([x.get('id', 0) for x in news] or [0]) + 1
    added, skipped = [], 0
    for it in incoming:
        title = (it.get('title') or '').strip()
        if not title or title in seen:
            skipped += 1
            continue
        item = {'id': next_id}
        for k in _FIELDS:
            item[k] = (it.get(k) or '').strip()
        if it.get('url'):
            item['url'] = it['url'].strip()
        seen.add(title)
        added.append(item)
        next_id += 1

    if added:
        news = added + news          # 最新在前
        news = news[:MAX_ITEMS]      # 上限截尾
        tmp = NEWS_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(news, f, ensure_ascii=False, indent=2)
        os.replace(tmp, NEWS_FILE)

    print(f'入库 {len(added)} 条，跳过重复 {skipped} 条，当前总数 {len(news)}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
