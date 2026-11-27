# -*- coding: utf-8 -*-
"""MangaDex 公开 API 适配器（可插拔，国内不可达时优雅降级）
文档：https://api.mangadex.org/docs/
图片域走后端代理（防热链），章节页用 /at-home-server 取时效 URL。
"""
import json
import urllib.request
import urllib.parse
from . import ComicsSourceBase, register_source

_API = 'https://api.mangadex.org'
_TIMEOUT = 8
# 章节图片域白名单（仅这些域允许走 /api/comics/proxy）
_IMG_HOSTS = ('uploads.mangadex.org',)


def _get(url, params=None):
    if params:
        # 数组参数（键以 [] 结尾）按重复键展开并做 URL 编码（MangaDex API 要求）
        pairs = []
        for k, v in params.items():
            for vv in (v if isinstance(v, (list, tuple)) else [v]):
                pairs.append((k, str(vv)))
        url = url + '?' + urllib.parse.urlencode(pairs)
    req = urllib.request.Request(url, headers={'User-Agent': 'ZFComics/1.0'})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as r:
        return json.loads(r.read().decode('utf-8'))


class MangaDexSource(ComicsSourceBase):
    id = 'mangadex'
    name = 'MangaDex'
    builtin = True

    def search(self, keyword):
        try:
            d = _get(_API + '/manga', {
                'title': keyword or '', 'limit': '20',
                'includes[]': 'cover_art',
                'contentRating[]': ['safe', 'suggestive']})
        except Exception:
            return []  # 不可达时静默降级
        out = []
        for m in d.get('data', []):
            cover = ''
            for rel in m.get('relationships', []):
                if rel.get('type') == 'cover_art':
                    fn = (rel.get('attributes') or {}).get('fileName')
                    if fn:
                        cover = 'api/comics/proxy?url=https://uploads.mangadex.org/covers/%s/%s' % (m['id'], fn)
                    break
            attrs = m.get('attributes', {})
            title = (attrs.get('title') or {})
            # 标题优先级：中文别名 -> 主标题 zh -> en -> 任意 -> id（MangaDex 主标题多为日文全角/罗马字，优先中文避免“乱码感”）
            t = ''
            for alt in (attrs.get('altTitles') or []):
                if alt.get('zh'):
                    t = alt['zh']; break
            if not t:
                t = title.get('zh') or title.get('en')
            if not t:
                vals = [v for v in title.values() if v]
                t = vals[0] if vals else ''
            if not t:
                for alt in (attrs.get('altTitles') or []):
                    if alt.get('en'):
                        t = alt['en']; break
            if not t:
                t = m['id']
            out.append({'id': m['id'], 'title': t,
                        'source': self.id, 'cover': cover})
        return out

    def list(self):
        return self.search('')

    def chapters(self, manga_id):
        # 正确端点是 /chapter?manga=（/manga/{id}/chapters 不存在会 404）
        # 中文+英文都拉：桂正和作品多为英译，只拉 zh 常为 0
        # 【2026-11-12 修复】MangaDex 单次请求 limit 上限 100，旧代码只取第一页，
        # 导致长连载（桜通信 EN 共 163 话）只露出前 100 话，下载队列因此漏掉 102 话及以后。
        # 现按 offset 翻页拉全（单语言上限 1000 话兜底防死循环）。
        out = []
        for lang, tag in (('zh', '[中]'), ('en', '[EN]')):
            offset = 0
            while True:
                try:
                    d = _get(_API + '/chapter', {'manga': manga_id,
                             'translatedLanguage[]': lang, 'limit': '100',
                             'offset': str(offset), 'order[chapter]': 'asc'})
                except Exception:
                    break
                batch = d.get('data') or []
                for c in batch:
                    a = c.get('attributes', {})
                    out.append({'id': c['id'],
                                'title': '第%s话 %s%s' % (a.get('chapter') or '?', a.get('title') or '', tag)})
                if len(batch) < 100 or offset >= 1000:
                    break
                offset += 100
        return out

    def pages(self, manga_id, chapter_id):
        try:
            d = _get(_API + '/at-home/server/%s' % chapter_id, {})
        except Exception:
            return []
        host = d.get('baseUrl') or ''
        ch = d.get('chapter') or {}
        out = []
        if host and ch.get('hash'):
            for f in ch.get('data', []):
                out.append('api/comics/proxy?url=%s/%s/data/%s/%s' % (host, '/'.join(_IMG_HOSTS[:0]) or 'uploads.mangadex.org', ch['hash'], f)
                           if 'uploads.mangadex.org' in host else
                           'api/comics/proxy?url=%s/data/%s/%s' % (host, ch['hash'], f))
        return out


try:
    register_source(MangaDexSource())
except Exception:
    pass
