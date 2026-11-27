# -*- coding: utf-8 -*-
"""mixin_games.py —— i游戏 API（策划案 v2.2 D1-D2）
GET /api/games/featured  -> Steam 特色榜单 + CheapShark 折扣精选（代理，磁盘 JSON 缓存 30 分钟）
GET /api/games/search?kw=xxx -> Steam 商店搜索（代理，缓存 10 分钟）
GET /api/games/detail?appid=123 -> Steam appdetails（代理，缓存 6 小时）
GET /api/games/list      -> 我的游戏列表 {ok, list:[...]}
POST /api/games/list     -> {action:'add'|'remove'|'status', appid, status} 我的列表（want/playing/played）
存储：server/data/games_mylist.json；缓存：server/data/games_cache/*.json
红线：只做官方 API 聚合展示 + 官方商店导流，不抓非公开资源、不提供下载。
"""
import json
import os
import threading
import time
import urllib.parse
import urllib.request

_games_lock = threading.Lock()
_ua = {'User-Agent': 'ZF-Agent-iGame/1.0'}


class MixinGames:

    # ---------- 存储路径 ----------
    def _games_data_dir(self):
        here = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.normpath(os.path.join(here, '..', 'data'))
        os.makedirs(data_dir, exist_ok=True)
        return data_dir

    def _mylist_path(self):
        return os.path.join(self._games_data_dir(), 'games_mylist.json')

    def _cache_dir(self):
        d = os.path.join(self._games_data_dir(), 'games_cache')
        os.makedirs(d, exist_ok=True)
        return d

    # ---------- 缓存 ----------
    def _cache_get(self, key, ttl, stale=False):
        """stale=True 时 TTL 过期也返回旧数据（上游超时兜底，宁旧勿错）"""
        path = os.path.join(self._cache_dir(), key + '.json')
        try:
            if os.path.isfile(path):
                if stale or time.time() - os.path.getmtime(path) < ttl:
                    with open(path, 'r', encoding='utf-8') as f:
                        return json.load(f)
        except Exception:
            pass
        return None

    def _cache_put(self, key, data):
        try:
            path = os.path.join(self._cache_dir(), key + '.json')
            tmp = path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False)
            os.replace(tmp, path)
        except Exception:
            pass

    def _fetch_json(self, url, timeout=10, retries=2):
        """带重试的上游拉取：Steam/Epic 偶发超时是常态，重试 2 次显著提高成功率"""
        last = None
        for i in range(retries + 1):
            try:
                req = urllib.request.Request(url, headers=_ua)
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return json.loads(r.read().decode('utf-8', 'replace'))
            except Exception as e:
                last = e
                if i < retries:
                    time.sleep(1)
        raise last

    # ---------- Steam ----------
    def _steam_featured(self):
        cached = self._cache_get('featured', 1800, stale=True)
        if cached is not None:
            return cached
        data = self._fetch_json(
            'https://store.steampowered.com/api/featuredcategories?l=schinese&cc=cn')
        out = []
        for sec in ('top_sellers', 'specials', 'new_releases'):
            for it in (data.get(sec) or {}).get('items', [])[:12]:
                # 价格：仅当 API 明确给出 price.final 时才计价；否则置 None（前端显示"价格以商店为准"而非误标免费）
                p = it.get('price') or {}
                final = p.get('final')
                price = final / 100.0 if final else None
                # 图片：优先用官方返回的 header_image（旧版硬拼 CDN 路径对新游戏会 404）
                header = (it.get('header_image')
                          or 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/%s/header.jpg' % it.get('id'))
                out.append({
                    'appid': it.get('id'),
                    'name': it.get('name'),
                    'price': price,
                    'discount': p.get('discount_percent') or 0,
                    'header': header,
                    'section': sec,
                })
        self._cache_put('featured', out)
        return out

    def _steam_search(self, kw):
        key = 'search_' + urllib.parse.quote(kw.encode('utf-8'))
        cached = self._cache_get(key, 600, stale=True)
        if cached is not None:
            return cached
        data = self._fetch_json(
            'https://store.steampowered.com/api/storesearch/?term=%s&l=schinese&cc=cn'
            % urllib.parse.quote(kw.encode('utf-8')))
        out = []
        for it in (data.get('items') or [])[:20]:
            price = it.get('price')
            out.append({
                'appid': it.get('id'),
                'name': it.get('name'),
                'price': (price or {}).get('final', 0) / 100.0,
                'discount': 0,
                'header': it.get('tiny_image'),
            })
        self._cache_put(key, out)
        return out

    def _steam_detail(self, appid):
        key = 'detail_%s' % appid
        cached = self._cache_get(key, 21600)
        if cached is not None:
            return cached
        data = self._fetch_json(
            'https://store.steampowered.com/api/appdetails?appids=%s&l=schinese' % appid)
        node = (data.get(str(appid)) or {})
        if not node.get('success'):
            return None
        d = node.get('data') or {}
        out = {
            'appid': appid,
            'name': d.get('name'),
            'short': d.get('short_description'),
            'header': d.get('header_image'),
            'price': ((d.get('price_overview') or {}).get('final') or 0) / 100.0,
            'discount': (d.get('price_overview') or {}).get('discount_percent') or 0,
            'store_url': 'https://store.steampowered.com/app/%s' % appid,
            'screenshots': [s.get('path') for s in (d.get('screenshots') or [])[:4]],
            'release': d.get('release_date', {}).get('date'),
            'developers': d.get('developers') or [],
        }
        self._cache_put(key, out)
        return out

    # ---------- 免费/喜加一 ----------
    def _steam_free_games(self):
        """Steam 常驻免费游戏（官方公开 API：price_overview 缺失 = 免费）
        注意：Steam appdetails 不支持多 appid 逗号合并（实测 400），必须逐个请求"""
        cached = self._cache_get('free_steam', 3600, stale=True)
        if cached is not None:
            return cached
        ids = ['570', '730', '1085660', '1938090', '2073850', '2246340',
               '1172470', '578080', '359550', '230410']
        out = []
        got = 0
        for appid in ids:
            try:
                data = self._fetch_json(
                    'https://store.steampowered.com/api/appdetails?appids=%s&l=schinese&cc=cn'
                    % appid, timeout=10, retries=1)
            except Exception:
                continue
            node = data.get(appid) or {}
            d = node.get('data') or {}
            if not node.get('success') or not d:
                continue
            got += 1
            if d.get('is_free') or not d.get('price_overview'):
                out.append({
                    'appid': appid,
                    'name': d.get('name'),
                    'header': d.get('header_image'),
                    'short': d.get('short_description'),
                    'src': 'steam',
                    'free': True,
                })
        if got == 0:
            raise RuntimeError('steam appdetails all failed')
        self._cache_put('free_steam', out)
        return out

    def _epic_free(self):
        """Epic 喜加一（官方公开 GraphQL 接口，当前免费 + 近期免费）"""
        cached = self._cache_get('free_epic', 1800, stale=True)
        if cached is not None:
            return cached
        url = ('https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions'
               '?locale=zh-CN&country=CN&allowCountries=CN')
        data = self._fetch_json(url)
        out = []
        now = time.time()
        catalog = ((data.get('data') or {}).get('Catalog') or {})
        for gm in (catalog.get('searchStore') or {}).get('elements', []):
            promo = ((gm.get('promotions') or {}).get('promotionalOffers') or [])
            slots = []
            for p in promo:
                slots += (p.get('promotionalOffers') or [])
            ok = any(
                s.get('startDate') and s.get('endDate') and
                self._iso2ts(s['startDate']) <= now < self._iso2ts(s['endDate'])
                for s in slots)
            if not ok:
                continue
            price = (gm.get('price') or {}).get('totalPrice') or {}
            out.append({
                'appid': gm.get('id') or gm.get('slug') or gm.get('title'),
                'slug': gm.get('slug'),
                'name': gm.get('title'),
                'header': (gm.get('keyImages') or [{}])[0].get('url'),
                'short': gm.get('description'),
                'orig': (price.get('initialPrice') or 0) / 100.0,
                'src': 'epic',
                'free': True,
            })
        self._cache_put('free_epic', out)
        return out

    @staticmethod
    def _iso2ts(iso):
        """Epic 返回 ISO8601 如 2026-11-11T15:00:00.000Z -> epoch 秒"""
        try:
            s = str(iso).replace('Z', '+00:00')
            import datetime
            return datetime.datetime.fromisoformat(s).timestamp()
        except Exception:
            return 0

    def _games_free(self):
        """Steam/Epic 两个来源独立容错：一个挂了不影响另一个，全挂才抛错走缓存兜底"""
        steam, epic, errs = [], [], []
        try:
            steam = self._steam_free_games()
        except Exception as e:
            errs.append('steam: %s' % e)
        try:
            epic = self._epic_free()
        except Exception as e:
            errs.append('epic: %s' % e)
        if errs and not steam and not epic:
            # 全挂：用过期缓存兜底，宁旧勿错
            steam = self._cache_get('free_steam', 3600, stale=True) or []
            epic = self._cache_get('free_epic', 1800, stale=True) or []
            if not steam and not epic:
                raise RuntimeError('; '.join(errs))
            return {'steam': steam, 'epic': epic, 'degraded': True}
        out = {'steam': steam, 'epic': epic}
        if errs:
            out['degraded'] = True
            out['err'] = '; '.join(errs)
        return out

    # ---------- CheapShark 折扣精选 ----------
    def _cheapshark_deals(self):
        cached = self._cache_get('deals', 1800, stale=True)
        if cached is not None:
            return cached
        # 不带 storeID 参数（实测带 storeID=1,6,13 会被 400 拒绝）， sortBy=Savings 取最大折扣
        data = self._fetch_json(
            'https://www.cheapshark.com/api/1.0/deals?sortBy=Savings&pageSize=12', timeout=10)
        out = []
        for it in data:
            # 只展示在 Steam 有官方商店页的游戏，导流官方
            out.append({
                'title': it.get('title'),
                'steam_appid': it.get('steamAppID'),
                'price': it.get('salePrice'),
                'orig': it.get('normalPrice'),
                'savings': it.get('savings'),
                'thumb': it.get('thumb'),
            })
        self._cache_put('deals', out)
        return out

    # ---------- 我的列表 ----------
    def _mylist_load(self):
        try:
            with open(self._mylist_path(), 'r', encoding='utf-8') as f:
                d = json.load(f)
                return d if isinstance(d, list) else []
        except Exception:
            return []

    def _mylist_save(self, lst):
        path = self._mylist_path()
        try:
            if os.path.isfile(path):
                with open(path, 'r', encoding='utf-8') as f:
                    old = f.read()
                with open(path + '.bak', 'w', encoding='utf-8') as f:
                    f.write(old)
        except Exception:
            pass
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(lst, f, ensure_ascii=False, indent=1)

    def _handle_games_get(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        path = parsed.path
        try:
            if path == '/api/games/featured':
                # 两个上游并行拉取，任一失败降级为空列表（提速 + 防一个超时拖死整页）
                box = {}
                def _pull(k, fn):
                    try:
                        box[k] = fn()
                    except Exception:
                        box[k] = []
                th1 = threading.Thread(target=_pull, args=('featured', self._steam_featured))
                th2 = threading.Thread(target=_pull, args=('deals', self._cheapshark_deals))
                th1.start(); th2.start()
                th1.join(25); th2.join(25)
                return self._send_json({'ok': True,
                                        'featured': box.get('featured') or [],
                                        'deals': box.get('deals') or []})
            if path == '/api/games/search':
                kw = (qs.get('kw') or [''])[0].strip()
                if not kw:
                    return self._send_json({'ok': False, 'err': 'kw required'}, 400)
                return self._send_json({'ok': True, 'items': self._steam_search(kw)})
            if path == '/api/games/detail':
                appid = (qs.get('appid') or [''])[0].strip()
                if not appid.isdigit():
                    return self._send_json({'ok': False, 'err': 'appid required'}, 400)
                d = self._steam_detail(appid)
                if d is None:
                    return self._send_json({'ok': False, 'err': 'not found'}, 404)
                return self._send_json({'ok': True, 'game': d})
            if path == '/api/games/free':
                return self._send_json({'ok': True, **self._games_free()})
            if path == '/api/games/list':
                with _games_lock:
                    lst = self._mylist_load()
                return self._send_json({'ok': True, 'list': lst})
            return self._send_json({'ok': False, 'err': 'unknown path'}, 404)
        except Exception as e:
            # 上游超时兜底：把所有可用的过期缓存吐给前端，宁旧勿错
            fallback = {}
            for name, key, ttl in (('featured', 'featured', 1800), ('deals', 'deals', 1800),
                                   ('steam_free', 'free_steam', 3600), ('epic_free', 'free_epic', 1800)):
                c = self._cache_get(key, ttl, stale=True)
                if c is not None:
                    fallback[name] = True
            if fallback:
                return self._send_json({'ok': True, 'degraded': True,
                                        'err': '上游超时，已用缓存数据（%s）' % ','.join(fallback),
                                        **self._stale_bundle(fallback)})
            return self._send_json({'ok': False, 'err': 'upstream failed: %s' % e}, 502)

    def _stale_bundle(self, fallback):
        """超时兜底：把命中的过期缓存打包成 featured/free 接口形态"""
        out = {}
        if fallback.get('featured'):
            c = self._cache_get('featured', 1800, stale=True) or {}
            out['featured'] = c.get('featured') or []
            out['deals'] = c.get('deals') or []
        elif fallback.get('deals'):
            out['deals'] = self._cache_get('deals', 1800, stale=True) or []
        out['steam'] = (self._cache_get('free_steam', 3600, stale=True) or []) if fallback.get('steam_free') else []
        out['epic'] = (self._cache_get('free_epic', 1800, stale=True) or []) if fallback.get('epic_free') else []
        return out

    def _handle_games_post(self, body):
        if not isinstance(body, dict):
            return self._send_json({'ok': False, 'err': 'bad body'}, 400)
        action = str(body.get('action') or '')
        appid = str(body.get('appid') or '').strip()
        status = str(body.get('status') or '').strip()
        if status not in ('', 'want', 'playing', 'played'):
            return self._send_json({'ok': False, 'err': 'bad status'}, 400)
        now = int(time.time() * 1000)
        with _games_lock:
            lst = self._mylist_load()
            if action == 'remove':
                lst = [g for g in lst if g.get('appid') != appid]
            elif action == 'status' and status:
                hit = None
                for g in lst:
                    if g.get('appid') == appid:
                        hit = g
                        break
                if hit:
                    hit['status'] = status
                    hit['updatedAt'] = now
                else:
                    lst.append({'appid': appid, 'name': str(body.get('name') or '未命名'),
                                'status': status, 'createdAt': now, 'updatedAt': now})
            else:
                return self._send_json({'ok': False, 'err': 'bad action'}, 400)
            try:
                self._mylist_save(lst)
            except Exception as e:
                return self._send_json({'ok': False, 'err': 'save failed: %s' % e}, 500)
        return self._send_json({'ok': True, 'count': len(lst)})
