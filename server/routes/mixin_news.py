# -*- coding: utf-8 -*-
"""Mixin: i新闻 API（M2 真数据）
GET  /api/news/list?kw=&cat=   -> 新闻列表（读 public/data/news.json，kw/cat 过滤）
POST /api/news/list            -> 不支持，仅 GET
数据文件：public/data/news.json（数组，字段 id/cat/title/time/src/summary/url）
安全：只读；json 解析失败返回 500 带错误说明；过滤在内存完成，无注入面。
"""
import json
import os

from routes.mixin_base import MixinBase

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_NEWS_FILE = os.path.normpath(os.path.join(_BASE, 'public', 'data', 'news.json'))


class MixinNews(MixinBase):

    def _news_load(self):
        try:
            with open(_NEWS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data if isinstance(data, list) else []
        except FileNotFoundError:
            return []
        except Exception as e:
            raise RuntimeError(f'news.json 解析失败: {e}')

    def _handle_news_list(self, qs):
        try:
            items = self._news_load()
        except RuntimeError as e:
            self._send_json({'ok': False, 'error': str(e)}); return
        kw = (qs.get('kw', [''])[0] or '').strip().lower()
        cat = (qs.get('cat', [''])[0] or '').strip()
        if cat and cat != '全部':
            items = [x for x in items if x.get('cat') == cat]
        if kw:
            items = [x for x in items if kw in json.dumps(x, ensure_ascii=False).lower()]
        self._send_json({'ok': True, 'items': items, 'total': len(items)})
