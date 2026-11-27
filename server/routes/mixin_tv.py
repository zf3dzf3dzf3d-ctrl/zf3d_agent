# -*- coding: utf-8 -*-
"""mixin_tv.py —— i电视 v2 频道源保新鲜 + 死链巡检（S1/S2）

- GET /api/tv/status  -> {ok, status:{url:1|0}} 死链灰显用
- GET /api/tv/refresh -> 立即触发一次在线拉取更新
后台线程：启动即拉 iptv-org cn.m3u 更新镜像（成功才覆盖，写前 .bak），
每小时拉一次；每 30 分钟抽样探测频道直链存活（HEAD/GET 首字节），
结果落 public/data/tv-status.json（前端 fetch 灰显死链；2026-11-22 双副本消灭后唯一真源）。
安全：仅更新本地镜像文件；拉取失败自动放弃保留旧镜像（本地兜底）。
"""
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

_UA = "VLC/3.0.20"
_SRC_URL = "https://iptv-org.github.io/iptv/countries/cn.m3u"
_REFRESH_SEC = 3600
_PROBE_SEC = 1800
_PROBE_N = 40          # 每轮抽样探测条数
_tv_lock = threading.Lock()
_here = os.path.dirname(os.path.abspath(__file__))
public_data = os.path.normpath(os.path.join(_here, '..', 'public', 'data'))
M3U_PATH = os.path.join(public_data, 'iptv-cn.m3u')
STATUS_PATH = os.path.join(public_data, 'tv-status.json')
_started = False


def _parse_urls(text):
    out = []
    for ln in text.splitlines():
        ln = ln.strip()
        if ln and not ln.startswith('#'):
            out.append(ln)
    return out


def _fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def refresh_once():
    """拉在线源，频道数不少于当前镜像的 50% 才覆盖（防拉到坏源清空频道）"""
    try:
        data = _fetch(_SRC_URL)
        text = data.decode('utf-8', 'replace')
        if '#EXTINF' not in text:
            return False, 'no EXTINF'
        new_n = len(_parse_urls(text))
        old_n = 0
        try:
            with open(M3U_PATH, 'r', encoding='utf-8') as f:
                old_n = len(_parse_urls(f.read()))
        except Exception:
            pass
        if old_n > 0 and new_n < old_n * 0.5:
            return False, 'new source too small (%d < %d/2)' % (new_n, old_n)
        try:
            if os.path.isfile(M3U_PATH):
                with open(M3U_PATH, 'rb') as s, open(M3U_PATH + '.bak', 'wb') as d:
                    d.write(s.read())
        except Exception:
            pass
        tmp = M3U_PATH + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(text)
        os.replace(tmp, M3U_PATH)
        return True, 'ok new=%d old=%d' % (new_n, old_n)
    except Exception as e:
        return False, str(e)[:150]


def _probe_alive(url):
    """探测直链：GET 首段 4KB 判活（部分 IPTV 源不支持 HEAD，故不用 HEAD）"""
    pu = urllib.parse.urlparse(url)
    req = urllib.request.Request(url, headers={"User-Agent": _UA,
                                               "Referer": pu.scheme + "://" + pu.netloc + "/"})
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            r.read(4096)
            return r.status == 200
    except Exception:
        return False


def probe_once():
    try:
        with open(M3U_PATH, 'r', encoding='utf-8') as f:
            urls = _parse_urls(f.read())
    except Exception:
        return {}
    sample = urls[::max(1, len(urls) // _PROBE_N)][:_PROBE_N]
    status = {}
    try:
        with open(STATUS_PATH, 'r', encoding='utf-8') as f:
            status = json.load(f) or {}
    except Exception:
        status = {}
    # v2.1 裁剪：只保留当前镜像中仍存在的 URL（防失效频道历史条目无界增长），_ts 保留
    cur_set = set(urls)
    status = {k: v for k, v in status.items() if k == '_ts' or k in cur_set}
    # v2.1 并行探测：8 线程，40 条最坏耗时从串行 4 分钟降至 ~30 秒
    with ThreadPoolExecutor(max_workers=8) as ex:
        for u, alive in zip(sample, ex.map(_probe_alive, sample)):
            status[u] = 1 if alive else 0
    status['_ts'] = time.time()
    tmp = STATUS_PATH + '.tmp'
    try:
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(status, f, ensure_ascii=False)
        os.replace(tmp, STATUS_PATH)
    except Exception:
        pass
    return {k: v for k, v in status.items() if k != '_ts'}


def _bg_loop():
    time.sleep(3)
    refresh_once()
    next_refresh_at = time.time() + _REFRESH_SEC  # v2.1：时间戳定时，替代取模（防 probe 耗时漂移跳刷/连刷）
    while True:
        probe_once()
        now = time.time()
        if now >= next_refresh_at:
            refresh_once()
            next_refresh_at = time.time() + _REFRESH_SEC
        time.sleep(_PROBE_SEC)


def start_bg():
    global _started
    with _tv_lock:
        if _started:
            return
        _started = True
        threading.Thread(target=_bg_loop, name='zf-tv-bg', daemon=True).start()


class MixinTv:
    def _handle_tv_status(self):
        start_bg()
        data = {}
        try:
            with open(STATUS_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f) or {}
        except Exception:
            pass
        ts = data.pop('_ts', 0)
        return self._send_json({'ok': True, 'status': data, 'ts': ts})

    def _handle_tv_refresh(self):
        ok, msg = refresh_once()
        return self._send_json({'ok': ok, 'msg': msg})
