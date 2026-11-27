# -*- coding: utf-8 -*-
"""Mixin: i视频 影视聚合播放 API（M1）
GET  /api/ivideo/search?wd=xx   -> 聚合搜索各资源站
GET  /api/ivideo/detail?id=xx&site=xx -> 单片详情（含剧集列表）
GET  /api/ivideo/proxy?url=xx   -> m3u8 中转代理（解决 CORS/防盗链，仅代理 m3u8/ts）
GET  /api/ivideo/sites          -> 站点清单
安全：proxy 仅允许 http(s) 外链；搜索词做长度限制。
"""
import os, json, ssl, socket, urllib.request, urllib.parse
from routes._shared import *
from routes.mixin_base import MixinBase
import logging

from util_log import get_logger

log = get_logger('video')
def _sites_path():
    """白名单路径实时解析（2026-11-11 同构修复，对齐 mixin_webmarks._sites_path）：
    消除 import 期锁死——进程活得比配置久时也能自愈切换 private/ ↔ example 兜底。"""
    p = os.path.normpath(os.path.join(BASE_DIR, 'private', 'i-video-sites.json'))
    if not os.path.exists(p):
        # 分发版兜底：private/ 不随 MIT 分发时，回退到脱敏模板 server/config/i-video-sites.example.json
        p = os.path.normpath(os.path.join(BASE_DIR, 'server', 'config', 'i-video-sites.example.json'))
    return p
# 出站 SSL 校验豁免说明：公开资源站证书普遍不正规（自签/过期/域名不符），
# 单机自用场景下对 _iv_fetch 出站请求关闭校验是已知妥协；进站请求不受影响。
# 若未来接入正规站点，可改为默认校验 + 白名单豁免（见进化建议 20261110）。
_IV_CTX = ssl.create_default_context()
_IV_CTX.check_hostname = False
_IV_CTX.verify_mode = ssl.CERT_NONE
_IV_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'
_IV_MAX_BYTES = 32 * 1024 * 1024  # 单次代理响应上限 32MB（ts 分片/播放列表足够）


def _iv_is_private_host(hostname):
    """拦截内网/回环/链路本地地址，防止 proxy 被用于 SSRF 读取内网或本机 API"""
    import ipaddress
    try:
        infos = socket.getaddrinfo(hostname, None)
    except Exception:
        return True  # 解析失败的域名一律拒绝
    # 优先按 IPv4 判定：部分资源站 DNS 会返回 2001::/23(Teredo 保留段)的 IPv6，
    # 该段在 Python3.13 中 is_private=True，会误杀公网站点（20261110 实测 bfzy）；
    # 实际连接优先走 IPv4，故只要存在任一 IPv4 地址即以 IPv4 判定，忽略 IPv6。
    has_v4 = False
    v4_bad = False
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            return True
        if ip.version == 4:
            has_v4 = True
            if (ip.is_private or ip.is_loopback or ip.is_link_local
                    or ip.is_multicast):
                v4_bad = True
    if has_v4:
        return v4_bad
    # 纯 IPv6 域名才按 IPv6 判定
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast):
            return True
    return False


def _iv_fetch(url, timeout=12):
    """出站统一走 util_net_guard：代理优先+直连兜底重试链（2026-11-18 修复
    服务进程代理出口失效后全部资源站搜空的问题），并复用其代理策略/UA。
    SSRF 防护沿用本文件 _iv_is_private_host（先行拦截）。"""
    host = urllib.parse.urlsplit(url).hostname
    if not host or _iv_is_private_host(host):
        raise ValueError('blocked host')
    from util_net_guard import _get_proxy
    proxy = _get_proxy()
    attempts = ([proxy] if proxy else []) + [None]
    last_err = None
    for p in attempts:
        try:
            handlers = [urllib.request.ProxyHandler({} if p is None else
                        {'http': p, 'https': p}),
                        urllib.request.HTTPSHandler(context=_IV_CTX)]
            opener = urllib.request.build_opener(*handlers)
            req = urllib.request.Request(url, headers={'User-Agent': _IV_UA})
            resp = opener.open(req, timeout=timeout)
            data = resp.read(_IV_MAX_BYTES + 1)
            if len(data) > _IV_MAX_BYTES:
                raise ValueError('response too large')
            return data
        except Exception as e:
            last_err = e
            continue
    raise last_err if last_err is not None else IOError('fetch failed')


def _iv_rewrite_m3u8(text, base):
    """把 m3u8 内的相对/绝对分片地址改写为继续走本代理（纯函数，可单测）"""
    def rewrite(u):
        return '/api/ivideo/proxy?url=' + urllib.parse.quote(u, safe='')
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith('#'):
            # 内嵌 URI=""（密钥/地图）也要代理
            if 'URI="' in line:
                pre, rest = line.split('URI="', 1)
                uri, _, post = rest.partition('"')
                if uri and not uri.startswith('#'):
                    absu = urllib.parse.urljoin(base, uri)
                    lines.append(pre + 'URI="' + rewrite(absu) + '"' + post)
                else:
                    lines.append(line)
            else:
                lines.append(line)
        else:
            lines.append(rewrite(urllib.parse.urljoin(base, line)))
    return ('\n'.join(lines) + '\n').encode('utf-8')


def _iv_load_sites():
    try:
        with open(_sites_path(), 'r', encoding='utf-8-sig') as f:
            raw = json.load(f)
        return [s for s in raw.get('sites', []) if s.get('api')]
    except Exception:
        logging.debug("swallow", exc_info=True)
        return []


def _iv_parse_episodes(play_url):
    """苹果CMS vod_play_url: '集名$url#集名$url' -> [{name,url}]"""
    eps = []
    for seg in (play_url or '').split('#'):
        seg = seg.strip()
        if not seg:
            continue
        parts = seg.split('$')
        url = parts[1] if len(parts) >= 2 else parts[0]
        # jisu 类站点给的是网页播放页，真实流地址为其加 /index.m3u8
        if url and '.m3u8' not in url and not url.endswith('.mp4'):
            url = url.rstrip('/') + '/index.m3u8'
        eps.append({'name': parts[0] if len(parts) >= 2 else '播放', 'url': url})
    return eps


class MixinVideo(MixinBase):

    def _handle_ivideo_sites(self):
        try:
            sites = [{'name': s['name'], 'label': s.get('label', s['name']), 'status': s.get('status', '')}
                     for s in _iv_load_sites()]
            self._send_json({'ok': True, 'sites': sites})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_ivideo_search(self, qs):
        try:
            wd = (qs.get('wd') or [''])[0].strip()
            try:
                pg = max(1, int((qs.get('pg') or ['1'])[0]))
            except ValueError:
                pg = 1
            if not wd or len(wd) > 60:
                self._send_json({'ok': False, 'err': 'invalid wd'}, 400)
                return
            sites = _iv_load_sites()
            results = []

            def _fetch_site(s):
                try:
                    url = s['api'] + '?ac=videolist&wd=' + urllib.parse.quote(wd) + '&pg=' + str(pg)
                    data = json.loads(_iv_fetch(url).decode('utf-8', 'ignore'))
                    out = []
                    for v in (data.get('list') or [])[:12]:
                        out.append({
                            'site': s['name'], 'siteLabel': s.get('label', s['name']),
                            'id': v.get('vod_id'), 'name': v.get('vod_name'),
                            'pic': v.get('vod_pic'), 'year': v.get('vod_year'),
                            'remark': v.get('vod_remarks'), 'type': v.get('vod_class'),
                        })
                    return out
                except Exception as e:
                    logging.warning('[ivideo/search] site %s fail: %s', s['name'], e)
                    return []

            # 并发搜索各站，避免最慢站点阻塞整体响应（单站失败降级为空）
            # 2026-11-12 修复搜索"Failed to fetch"：单站超时 12s 会拖满整体响应，
            # 主服务繁忙时浏览器侧 fetch 直接断开。改为整体截止 8s：
            # 到点即用已完成的站点结果先返回，慢站结果本轮丢弃（宁可快，不可卡死）。
            from concurrent.futures import ThreadPoolExecutor, wait
            overall_deadline = 8.0
            def _collect(deadline):
                acc = []
                with ThreadPoolExecutor(max_workers=min(8, max(1, len(sites)))) as pool:
                    futs = {pool.submit(_fetch_site, s): s for s in sites}
                    try:
                        done, not_done = wait(futs.keys(), timeout=deadline)
                    except Exception:
                        done, not_done = set(futs.keys()), set()
                    for f in done:
                        try:
                            acc.extend(f.result())
                        except Exception:
                            pass
                    if not_done:
                        logging.warning('[ivideo/search] %d slow site(s) dropped after %.0fs: %s',
                                        len(not_done), deadline,
                                        ','.join(s['name'] for s in (futs[f] for f in not_done)))
                        for f in not_done:
                            f.cancel()
                return acc

            results = _collect(overall_deadline)
            # 2026-11-18 兜底：全部站点被截止丢弃或均无结果时，自动放宽到 20s 重试一轮，
            # 避免"徐若瑄类"仅少数源收录的资源因网络抖动整页搜空（用户实测踩坑）
            if not results:
                results = _collect(20.0)
            self._send_json({'ok': True, 'wd': wd, 'total': len(results), 'list': results})
        except Exception as e:
            log.info(f'[GET /api/ivideo/search] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_ivideo_detail(self, qs):
        try:
            vid = (qs.get('id') or [''])[0]
            site = (qs.get('site') or [''])[0]
            target = None
            for s in _iv_load_sites():
                if s['name'] == site:
                    target = s
                    break
            if not target or not str(vid).isdigit():
                self._send_json({'ok': False, 'err': 'invalid site/id'}, 400)
                return
            url = target['api'] + '?ac=videolist&ids=' + urllib.parse.quote(str(vid))
            data = json.loads(_iv_fetch(url).decode('utf-8', 'ignore'))
            lst = data.get('list') or []
            if not lst:
                self._send_json({'ok': False, 'err': 'not found'}, 404)
                return
            v = lst[0]
            self._send_json({'ok': True, 'item': {
                'site': site, 'id': v.get('vod_id'), 'name': v.get('vod_name'),
                'pic': v.get('vod_pic'), 'year': v.get('vod_year'),
                'remark': v.get('vod_remarks'), 'content': (v.get('vod_content') or '')[:800],
                'episodes': _iv_parse_episodes(v.get('vod_play_url')),
            }})
        except Exception as e:
            log.info(f'[GET /api/ivideo/detail] 500: {e}')
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_ivideo_proxy(self, qs):
        """m3u8 中转代理：改写分片地址为继续走代理（个人自用，不落盘）"""
        try:
            raw = (qs.get('url') or [''])[0]
            if not raw.startswith(('http://', 'https://')):
                self._send_json({'ok': False, 'err': 'only http(s)'}, 400)
                return
            cur = raw
            # 代理链上逐层改写：m3u8 内的相对/绝对地址继续走本代理
            def rewrite(u):
                return '/api/ivideo/proxy?url=' + urllib.parse.quote(u, safe='')
            body = _iv_fetch(cur)
            ext = cur.split('?')[0].rsplit('.', 1)[-1].lower()
            if ext in ('jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'):
                # 【2026-11-21 修复】图片直链走代理时必须按图片类型回 Content-Type，
                # 之前统一回 video/mp2t 导致 <img> 拒绝渲染（缩略图不显示的根因）
                ctype = 'image/' + ('jpeg' if ext in ('jpg', 'jpeg') else ext)
                is_m3u8 = False
            else:
                ctype = 'application/vnd.apple.mpegurl'
                is_m3u8 = cur.split('?')[0].endswith('.m3u8')
            if is_m3u8:
                body = _iv_rewrite_m3u8(body.decode('utf-8', 'ignore'), cur)
            elif ctype == 'video/mp2t':
                ctype = 'video/mp2t'
            else:
                ctype = ctype
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            # [20261123 安全收敛] 移除 Access-Control-Allow-Origin: *：本端点与前端同源，无需 CORS 放行
            # ts 分片允许浏览器/代理缓存 1 小时，m3u8 不缓存（播放列表会变）——减少重复回源，明显降低卡顿
            self.send_header('Cache-Control', 'public, max-age=3600' if not is_m3u8 else 'no-store')
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            log.info(f'[GET /api/ivideo/proxy] 500: {e}')
            try:
                self._send_json({'ok': False, 'err': str(e)}, 502)
            except Exception:
                logging.debug("swallow", exc_info=True)

    # ========= 【2026-11-11 v2】健康降级 + 播放进度 + B站源 =========

    _HEALTH_FILE = os.path.join(BASE_DIR, 'server', 'data', 'ivideo_health.json')
    _PROGRESS_FILE = os.path.join(BASE_DIR, 'server', 'data', 'ivideo_progress.json')
    _IV_LOCK = threading.Lock() if 'threading' in dir() else None

    def _iv_health_read(self):
        try:
            with open(self._HEALTH_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}

    def _iv_health_mark(self, site, ok):
        """播放成功/失败时记录站点健康度；搜索结果按健康度排序（自动降级坏站）"""
        import threading
        try:
            with threading.Lock():
                try:
                    with open(self._HEALTH_FILE, 'r', encoding='utf-8') as f:
                        h = json.load(f)
                except Exception:
                    h = {}
                rec = h.get(site, {'ok': 0, 'fail': 0})
                if ok:
                    rec['ok'] += 1
                else:
                    rec['fail'] += 1
                h[site] = rec
                with open(self._HEALTH_FILE, 'w', encoding='utf-8') as f:
                    json.dump(h, f, ensure_ascii=False)
        except Exception:
            pass

    def _handle_ivideo_progress(self, qs):
        """GET: 读取播放进度 key=name; POST(经 body)写入。文件存 server/data/ivideo_progress.json"""
        import json as _json
        name = (qs.get('name') or [''])[0]
        if not name:
            self._send_json({'ok': False, 'err': 'name required'}, 400); return
        try:
            with open(self._PROGRESS_FILE, 'r', encoding='utf-8') as f:
                data = _json.load(f)
        except Exception:
            data = {}
        if (qs.get('get') or ['1'])[0] == '0':
            # 写模式：ep/pos 通过 query 传（前端用 GET 保存，简单可靠）
            try:
                data[name] = {
                    'site': (qs.get('site') or [''])[0],
                    'ep': (qs.get('ep') or [''])[0],
                    'pos': float((qs.get('pos') or ['0'])[0]),
                    'dur': float((qs.get('dur') or ['0'])[0]),
                    'ts': __import__('time').time(),
                }
                with self.__class__._IV_LOCK if self.__class__._IV_LOCK else _null_ctx():
                    with open(self._PROGRESS_FILE, 'w', encoding='utf-8') as f:
                        _json.dump(data, f, ensure_ascii=False)
                self._send_json({'ok': True}); return
            except Exception as e:
                self._send_json({'ok': False, 'err': str(e)}, 500); return
        rec = data.get(name)
        self._send_json({'ok': True, 'progress': rec})

    def _handle_ivideo_bili_search(self, qs):
        """B站视频搜索（复用 i音乐已实测的 wbi 签名链路）"""
        wd = (qs.get('wd') or [''])[0].strip()
        if not wd:
            self._send_json({'ok': False, 'err': 'wd required'}, 400); return
        try:
            from routes.domain_music import _bilibili_search
            vids = _bilibili_search(wd)
            out = [{'site': 'bilibili', 'siteLabel': 'B站', 'bvid': v['bvid'],
                    'name': v['title'], 'author': v.get('author', ''),
                    'duration': str(v.get('duration', '')), 'pic': ''} for v in vids]
            self._send_json({'ok': True, 'wd': wd, 'list': out})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 502)

    def _handle_ivideo_bili_play(self, qs):
        """B站取播放直链（platform=html5 durl mp4，前端 video 直接播）"""
        bvid = (qs.get('bvid') or [''])[0]
        if not bvid:
            self._send_json({'ok': False, 'err': 'bvid required'}, 400); return
        try:
            from routes.domain_music import _bilibili_video_url
            url = _bilibili_video_url(bvid)
            self._send_json({'ok': True, 'url': url})
        except Exception as e:
            # 尝试音频函数名兜底（不同版本函数名）
            try:
                from routes.domain_music import _bilibili_audio_url as _f
                self._send_json({'ok': True, 'url': _f(bvid), 'audio_only': True})
            except Exception as e2:
                self._send_json({'ok': False, 'err': '%s / %s' % (e, e2)}, 502)


class _null_ctx:
    def __enter__(self): pass
    def __exit__(self, *a): pass
