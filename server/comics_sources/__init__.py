# -*- coding: utf-8 -*-
"""漫画柜·源适配器框架（v3 策划案 M1）
统一接口：search(keyword) / list() / chapters(manga_id) / pages(manga_id, chapter_id) / cover(manga_id)
适配器通过 register_source 注册，前端 /api/comics/sources 列出可用源。
合规：仅本地文件夹源 + MangaDex 公开 API（可插拔），不内置盗版站。
"""
import os, threading

_LOCK = threading.Lock()
_SOURCES = {}


def register_source(src):
    """注册一个源适配器实例（需实现 id/name/search/list/chapters/pages）。"""
    with _LOCK:
        _SOURCES[src.id] = src
    return src


def get_source(sid):
    with _LOCK:
        return _SOURCES.get(sid)


def list_sources():
    with _LOCK:
        return [
            {'id': s.id, 'name': s.name, 'builtin': getattr(s, 'builtin', True)}
            for s in _SOURCES.values()
        ]


class ComicsSourceBase:
    """源适配器基类：子类实现 search/list/chapters/pages。"""
    id = 'base'
    name = 'base'

    def search(self, keyword):
        raise NotImplementedError

    def list(self):
        raise NotImplementedError

    def chapters(self, manga_id):
        raise NotImplementedError

    def pages(self, manga_id, chapter_id):
        raise NotImplementedError

    # 默认封面返回空（本地源用第一页图兜底）
    def cover(self, manga_id):
        return ''
