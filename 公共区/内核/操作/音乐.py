"""
音乐搜索与播放 — 基于B站音频流
搜索：B站搜索API（search/all/v2）
播放：下载B站音频→ffmpeg转MP3→本地文件播放（稳定可靠）
"""
from .基类 import 操作结果, 操作基类
from pathlib import Path
import json
import os
import ssl
import re
import subprocess
import urllib.request
import urllib.parse
import http.cookiejar

_项目根 = Path(__file__).parent.parent.parent.parent
_音乐库路径 = _项目根 / "音乐" / "音乐库.json"
_音乐目录 = _项目根 / "音乐"
import shutil as _shutil
_ffmpeg = _shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE

_opener = None


def _获取opener():
    global _opener
    if _opener is not None:
        return _opener
    cj = http.cookiejar.CookieJar()
    _opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj),
        urllib.request.HTTPSHandler(context=_ctx)
    )
    _opener.addheaders = [
        ("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"),
        ("Referer", "https://www.bilibili.com"),
        ("Accept", "application/json, text/plain, */*"),
    ]
    try:
        _opener.open("https://www.bilibili.com", timeout=10)
    except Exception:
        pass
    return _opener


def _搜索B站(关键词, 数量=5):
    opener = _获取opener()
    url = "https://api.bilibili.com/x/web-interface/search/all/v2?" + urllib.parse.urlencode({"keyword": 关键词})
    resp = opener.open(url, timeout=15)
    data = json.loads(resp.read().decode("utf-8"))
    resp.close()

    歌曲列表 = []
    for r in data.get("data", {}).get("result", []):
        if r.get("result_type") != "video":
            continue
        for v in r.get("data", []):
            bvid = v.get("bvid", "")
            title = re.sub(r'<[^>]+>', '', v.get("title", ""))
            歌曲列表.append({
                "歌名": title[:50],
                "bvid": bvid,
            })
            if len(歌曲列表) >= 数量:
                break
    return 歌曲列表


def _下载并转换(bvid, 保存文件名):
    """下载B站音频并转成MP3，返回本地文件路径"""
    opener = _获取opener()

    # 1. 获取cid
    info_url = f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
    info = json.loads(opener.open(info_url, timeout=10).read().decode("utf-8"))
    if info.get("code") != 0:
        return None
    cid = info["data"]["cid"]
    title = info["data"].get("title", "")[:30]

    # 2. 获取音频流
    play_url = f"https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&fnval=16&qn=0"
    play = json.loads(opener.open(play_url, timeout=10).read().decode("utf-8"))
    audio_list = play.get("data", {}).get("dash", {}).get("audio", [])
    if not audio_list:
        return None
    audio_url = audio_list[0].get("baseUrl") or audio_list[0].get("base_url", "")

    # 3. 下载
    _音乐目录.mkdir(parents=True, exist_ok=True)
    临时文件 = _音乐目录 / f".{保存文件名}.m4s"
    最终文件 = _音乐目录 / f"{保存文件名}.mp3"

    req = urllib.request.Request(audio_url, headers={
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.bilibili.com",
    })
    resp = opener.open(req, timeout=60)
    with open(临时文件, "wb") as f:
        f.write(resp.read())
    resp.close()

    # 4. ffmpeg转MP3
    if os.path.exists(_ffmpeg):
        cmd = [_ffmpeg, "-y", "-i", str(临时文件), "-codec:a", "libmp3lame", "-b:a", "128k", str(最终文件)]
        subprocess.run(cmd, capture_output=True, timeout=30, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        临时文件.unlink(missing_ok=True)
    else:
        # 没有ffmpeg，直接重命名（部分浏览器能播m4s）
        临时文件.rename(最终文件)

    return str(最终文件), title, info["data"].get("duration", 0)


def _加载音乐库():
    """加载音乐库，返回字典"""
    try:
        from 存储引擎 import 获取存储引擎
        引擎 = 获取存储引擎()
        if 引擎:
            return 引擎.读取KV_JSON("音乐库", {"歌曲列表": [], "数量": 0})
    except Exception:
        pass
    return {"歌曲列表": [], "数量": 0}


def _保存音乐库(库):
    """保存音乐库到存储引擎"""
    库["数量"] = len(库.get("歌曲列表", []))
    try:
        from 存储引擎 import 获取存储引擎
        引擎 = 获取存储引擎()
        if 引擎:
            引擎.写入KV_JSON("音乐库", 库)
    except Exception:
        pass


def _添加到音乐库(文件路径, 歌名, 歌手, bvid, 时长秒=0):
    """添加歌曲到音乐库（去重：同路径不重复添加）"""
    库 = _加载音乐库()
    列表 = 库.get("歌曲列表", [])
    # 去重：同文件路径或同BV号不重复
    for s in 列表:
        if s.get("路径") == 文件路径 or (bvid and s.get("bvid") == bvid):
            return  # 已存在
    大小MB = 0
    try:
        大小MB = round(os.path.getsize(文件路径) / 1024 / 1024, 1)
    except OSError:
        pass
    列表.append({
        "文件名": os.path.basename(文件路径),
        "路径": 文件路径,
        "歌名": 歌名,
        "歌手": 歌手,
        "大小MB": 大小MB,
        "时长秒": 时长秒,
        "bvid": bvid,
        "来源": "B站",
    })
    库["歌曲列表"] = 列表
    _保存音乐库(库)


class 播放音乐(操作基类):
    名称 = "播放音乐"
    描述 = "搜索B站并播放音乐。自动搜索→下载→转MP3→本地播放。用户说'听歌'/'放首歌'/'我想听XX'时调用"
    参数结构 = {
        "关键词": {"类型": "字符串", "必填": True, "说明": "歌曲名或歌手名，如'周杰伦 晴天'或'张学友'"},
        "数量": {"类型": "整数", "必填": False, "说明": "播放几首，默认3（下载需要时间，不宜太多）"},
    }

    def 执行(self, 参数: dict) -> 操作结果:
        关键词 = 参数.get("关键词", "").strip()
        if not 关键词:
            return 操作结果.失败("关键词为空")

        数量 = min(参数.get("数量", 3), 5)  # 最多5首

        try:
            # 0. 先查本地音乐库（已下载的不再重复下载）
            库 = _加载音乐库()
            本地匹配 = [s for s in 库.get("歌曲列表", [])
                       if 关键词.lower() in s.get("歌名", "").lower()
                       or 关键词.lower() in s.get("歌手", "").lower()]

            if 本地匹配:
                # 本地有，直接播放
                播放列表 = 本地匹配[:数量]
                first = 播放列表[0]
                if self.进度回调:
                    self.进度回调("播放音乐", {
                        "文件路径": first["路径"],
                        "播放URL": "",
                        "歌名": first["歌名"],
                        "歌手": first.get("歌手", ""),
                        "封面": "",
                        "来源": first.get("来源", "本地"),
                        "添加到列表": False,
                        "bvid": "",
                    })
                for song in 播放列表[1:]:
                    if self.进度回调:
                        self.进度回调("播放音乐", {
                            "文件路径": song["路径"],
                            "播放URL": "",
                            "歌名": song["歌名"],
                            "歌手": song.get("歌手", ""),
                            "封面": "",
                            "来源": song.get("来源", "本地"),
                            "添加到列表": True,
                            "bvid": "",
                        })
                歌曲列表文本 = "\n".join(f"  {i+1}. {s['歌名']} - {s.get('歌手','')}" for i, s in enumerate(播放列表))
                return 操作结果.成功(
                    f"🎵 正在播放(本地): {first['歌名']} - {first.get('歌手','')}\n"
                    f"📋 播放列表({len(播放列表)}首):\n{歌曲列表文本}",
                    元数据={"操作类型": "播放音乐", "歌曲列表": 播放列表}
                )

            # 1. 本地没有，搜索B站
            if self.进度回调:
                self.进度回调("音乐搜索", {"状态": "搜索中", "关键词": 关键词})

            搜索结果 = _搜索B站(关键词, 数量=数量)
            if not 搜索结果:
                return 操作结果.失败(f"未在B站找到'{关键词}'相关视频")

            # 2. 只下载第1首，其余加入待下载列表
            if self.进度回调:
                self.进度回调("音乐搜索", {
                    "状态": "下载中",
                    "歌名": 搜索结果[0]["歌名"][:20],
                    "进度": "1/1"
                })

            干净名 = re.sub(r'[<>:"/\\|?*]', '', 搜索结果[0]["歌名"][:30])
            结果 = _下载并转换(搜索结果[0]["bvid"], 干净名)

            if not 结果:
                return 操作结果.失败(f"下载失败: {搜索结果[0]['歌名']}")

            文件路径, 原始标题, 时长秒 = 结果
            _添加到音乐库(文件路径, 搜索结果[0]["歌名"], "B站", 搜索结果[0]["bvid"], 时长秒)

            # 3. 推送第1首播放
            if self.进度回调:
                self.进度回调("播放音乐", {
                    "文件路径": 文件路径,
                    "播放URL": "",
                    "歌名": 搜索结果[0]["歌名"],
                    "歌手": "B站",
                    "封面": "",
                    "来源": "B站",
                    "添加到列表": False,
                    "bvid": "",
                })

            # 4. 其余歌曲加入播放列表（带bvid，前端按需下载）
            for video in 搜索结果[1:]:
                if self.进度回调:
                    self.进度回调("播放音乐", {
                        "文件路径": "",
                        "播放URL": "",
                        "歌名": video["歌名"],
                        "歌手": "B站",
                        "封面": "",
                        "来源": "B站待下载",
                        "添加到列表": True,
                        "bvid": video["bvid"],
                    })

            歌曲列表文本 = "\n".join(f"  {i+1}. {v['歌名']}" for i, v in enumerate(搜索结果))
            return 操作结果.成功(
                f"🎵 正在播放: {搜索结果[0]['歌名']}\n"
                f"📋 播放列表({len(搜索结果)}首，其余按需下载):\n{歌曲列表文本}",
                元数据={"操作类型": "播放音乐", "歌曲列表": 搜索结果}
            )
        except Exception as e:
            return 操作结果.失败(f"播放失败: {e}")


class 搜索音乐(操作基类):
    名称 = "搜索音乐"
    描述 = "搜索音乐库（本地已下载的歌曲），返回匹配的歌曲列表。用户想查找已有音乐时调用"
    参数结构 = {"关键词": {"类型": "字符串", "必填": True, "说明": "歌曲名或歌手名"}}

    def 执行(self, 参数: dict) -> 操作结果:
        关键词 = 参数.get("关键词", "").strip().lower()
        if not 关键词:
            return 操作结果.失败("关键词为空")
        try:
            库 = _加载音乐库()
            列表 = 库.get("歌曲列表", [])
            匹配 = [s for s in 列表 if 关键词 in s.get("歌名", "").lower() or 关键词 in s.get("歌手", "").lower()]
            if not 匹配:
                return 操作结果.失败(f"音乐库中未找到'{关键词}'，共{len(列表)}首歌曲。可说'播放音乐'从B站下载")
            lines = [f"音乐库中找到 {len(匹配)} 首匹配歌曲：\n"]
            for i, s in enumerate(匹配, 1):
                时长 = f"{s.get('时长秒',0)//60}:{s.get('时长秒',0)%60:02d}" if s.get("时长秒") else ""
                lines.append(f"{i}. {s['歌名']} - {s.get('歌手','')} ({s.get('大小MB',0)}MB) [{s.get('来源','')}]")
            return 操作结果.成功("\n".join(lines), 元数据={"操作类型": "搜索音乐", "歌曲列表": 匹配})
        except Exception as e:
            return 操作结果.失败(f"搜索失败: {e}")


class 同步音乐库(操作基类):
    名称 = "同步音乐库"
    描述 = "扫描本地音乐文件夹并合并已有音乐库记录，生成最新JSON音乐库。用户说'同步音乐库'或'扫描音乐'时调用"
    参数结构 = {}

    def 执行(self, 参数: dict) -> 操作结果:
        音频后缀 = {'.mp3', '.flac', '.ape', '.ogg', '.m4a', '.wav', '.wma'}
        # 加载已有库（保留B站下载的元数据）
        旧库 = _加载音乐库()
        旧记录 = {s["路径"]: s for s in 旧库.get("歌曲列表", []) if "路径" in s}

        所有歌曲 = []
        if _音乐目录.exists():
            for f in _音乐目录.iterdir():
                if not f.is_file() or f.suffix.lower() not in 音频后缀 or f.stat().st_size < 10000:
                    continue
                路径 = str(f)
                if 路径 in 旧记录:
                    # 保留旧记录的元数据（歌名、歌手、bvid等）
                    s = 旧记录[路径].copy()
                    s["大小MB"] = round(f.stat().st_size / 1024 / 1024, 1)
                    所有歌曲.append(s)
                else:
                    # 新文件，从文件名解析
                    名无后缀 = f.stem
                    歌名 = 名无后缀
                    歌手 = "未知"
                    if " - " in 名无后缀:
                        parts = 名无后缀.split(" - ", 1)
                        歌手 = parts[0].strip()
                        歌名 = parts[1].strip()
                    所有歌曲.append({
                        "文件名": f.name, "路径": 路径, "歌名": 歌名, "歌手": 歌手,
                        "大小MB": round(f.stat().st_size / 1024 / 1024, 1),
                        "来源": "本地", "bvid": "", "时长秒": 0,
                    })

        # 写入JSON
        _保存音乐库({"歌曲列表": 所有歌曲})

        # 按歌手分组统计
        歌手统计 = {}
        for s in 所有歌曲:
            歌手统计[s.get("歌手", "未知")] = 歌手统计.get(s.get("歌手", "未知"), 0) + 1
        歌手列表 = sorted(歌手统计.items(), key=lambda x: -x[1])
        摘要 = "\n".join(f"  {歌手}: {数}首" for 歌手, 数 in 歌手列表[:10])

        return 操作结果.成功(
            f"🎵 音乐库同步完成\n共 {len(所有歌曲)} 首歌曲\n\n按歌手统计:\n{摘要}\n\n音乐库路径: {_音乐库路径}",
            元数据={"操作类型": "同步音乐库", "数量": len(所有歌曲), "歌曲列表": 所有歌曲[:20], "保存路径": str(_音乐库路径)}
        )
