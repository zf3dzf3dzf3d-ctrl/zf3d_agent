# -*- coding: utf-8 -*-
"""本地文件夹漫画源适配器
约定目录：public/canvas/漫画柜/本地库/<漫画名>/*.jpg|png|webp
        或 public/canvas/漫画柜/本地库/<漫画名>/<章节名>/*.jpg（二级章节目录）
文件名排序即页序。
"""
import os
from . import ComicsSourceBase, register_source

_IMG_EXT = ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp')
_LIB_ROOT = os.path.normpath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'public', 'canvas', '漫画柜', '本地库'))


class LocalSource(ComicsSourceBase):
    id = 'local'
    name = '本地库'
    builtin = True

    def _entries(self):
        if not os.path.isdir(_LIB_ROOT):
            return []
        out = []
        try:
            for name in os.listdir(_LIB_ROOT):
                d = os.path.join(_LIB_ROOT, name)
                if os.path.isdir(d):
                    out.append(name)
        except Exception:
            pass
        out.sort()
        return out

    def _chapters(self, manga_id):
        """返回 [(chapter_id, 标题, 子路径)]；无二级目录时回退单章节'全部'。"""
        root = os.path.normpath(os.path.join(_LIB_ROOT, manga_id))
        if not root.startswith(_LIB_ROOT) or not os.path.isdir(root):
            return []
        subs = []
        try:
            for name in os.listdir(root):
                d = os.path.join(root, name)
                if os.path.isdir(d):
                    fs = [f for f in os.listdir(d) if f.lower().endswith(_IMG_EXT)]
                    if fs:
                        subs.append((name, name, name))  # (id, title, subpath)
        except Exception:
            pass
        subs.sort(key=lambda x: x[0])
        if subs:
            return subs
        # 根目录直接放图 -> 单章节
        if self._root_pages(manga_id):
            return [('ch1', '全部', '')]
        return []

    def _root_pages(self, manga_id):
        d = os.path.normpath(os.path.join(_LIB_ROOT, manga_id))
        if not d.startswith(_LIB_ROOT) or not os.path.isdir(d):
            return []
        try:
            return sorted(f for f in os.listdir(d) if f.lower().endswith(_IMG_EXT))
        except Exception:
            return []

    def _pages(self, manga_id, subpath=''):
        if subpath:
            d = os.path.normpath(os.path.join(_LIB_ROOT, manga_id, subpath))
            if not d.startswith(_LIB_ROOT) or not os.path.isdir(d):
                return []
            try:
                return sorted(f for f in os.listdir(d) if f.lower().endswith(_IMG_EXT))
            except Exception:
                return []
        return self._root_pages(manga_id)

    def search(self, keyword):
        kw = (keyword or '').lower()
        return [{'id': n, 'title': n, 'source': self.id}
                for n in self._entries() if kw in n.lower()]

    def list(self):
        return [{'id': n, 'title': n, 'source': self.id} for n in self._entries()]

    def chapters(self, manga_id):
        return [{'id': cid, 'title': title} for cid, title, _ in self._chapters(manga_id)]

    def pages(self, manga_id, chapter_id):
        for cid, _, sub in self._chapters(manga_id):
            if cid == chapter_id:
                return ['api/comics/img?src=local&f=%s/%s/%s' % (manga_id, sub, f) if sub
                        else 'api/comics/img?src=local&f=%s/%s' % (manga_id, f)
                        for f in self._pages(manga_id, sub)]
        return []

    def cover(self, manga_id):
        chs = self._chapters(manga_id)
        if not chs:
            return ''
        cid, _, sub = chs[0]
        fs = self._pages(manga_id, sub)
        if not fs:
            return ''
        f = fs[0]
        rel = '%s/%s/%s' % (manga_id, sub, f) if sub else '%s/%s' % (manga_id, f)
        return 'api/comics/img?src=local&f=%s' % rel


register_source(LocalSource())
