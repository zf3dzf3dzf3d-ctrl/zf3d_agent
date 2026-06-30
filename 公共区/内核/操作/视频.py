"""
视频搜索与播放 — 搜索下载本地播放
搜索：在线搜索视频
播放：下载视频流→ffmpeg转MP4→推送本地文件给前端播放
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
_视频库路径 = _项目根 / "视频" / "视频库.json"
_视频目录 = _项目根 / "视频"
_ffmpeg = r"C:\ffmpeg\bin\ffmpeg.exe"

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


def _搜索视频(关键词, 数量=5):
    """搜索视频，返回列表"""
    opener = _获取opener()
    url = "https://api.bilibili.com/x/web-interface/search/all/v2?" + urllib.parse.urlencode({"keyword": 关键词})
    resp = opener.open(url, timeout=15)
    data = json.loads(resp.read().decode("utf-8"))
    resp.close()

    视频列表 = []
    for r in data.get("data", {}).get("result", []):
        if r.get("result_type") != "video":
            continue
        for v in r.get("data", []):
            bvid = v.get("bvid", "")
            title = re.sub(r'<[^>]+>', '', v.get("title", ""))
            视频列表.append({
                "标题": title[:50],
                "bvid": bvid,
            })
            if len(视频列表) >= 数量:
                break
    return 视频列表


def _下载视频(bvid, 保存文件名):
    """下载B站视频并转成MP4，返回本地文件路径"""
    opener = _获取opener()

    # 1. 获取cid
    info_url = f"https://api.bilibili.com/x/web-interface/view?bvid={bvid}"
    info = json.loads(opener.open(info_url, timeout=10).read().decode("utf-8"))
    if info.get("code") != 0:
        return None
    cid = info["data"]["cid"]
    title = info["data"].get("title", "")[:30]
    时长秒 = info["data"].get("duration", 0)

    # 2. 获取视频流（DASH格式：视频和音频分离），qn=80为1080P
    play_url = f"https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&fnval=16&qn=80"
    play = json.loads(opener.open(play_url, timeout=10).read().decode("utf-8"))
    dash = play.get("data", {}).get("dash", {})
    video_list = dash.get("video", [])
    audio_list = dash.get("audio", [])

    if not video_list:
        return None

    # 选最高清晰度（第一个是最高）
    video_url = video_list[0].get("baseUrl") or video_list[0].get("base_url", "")
    audio_url = audio_list[0].get("baseUrl") or audio_list[0].get("base_url", "") if audio_list else ""

    _视频目录.mkdir(parents=True, exist_ok=True)
    视频临时 = _视频目录 / f".{保存文件名}_video.m4s"
    音频临时 = _视频目录 / f".{保存文件名}_audio.m4s"
    最终文件 = _视频目录 / f"{保存文件名}.mp4"

    # 3. 下载视频流
    for url, 临时路径 in [(video_url, 视频临时), (audio_url, 音频临时)]:
        if not url:
            continue
        req = urllib.request.Request(url, headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://www.bilibili.com",
        })
        resp = opener.open(req, timeout=120)
        with open(临时路径, "wb") as f:
            while True:
                块 = resp.read(65536)
                if not 块:
                    break
                f.write(块)
        resp.close()

    # 4. ffmpeg合并视频+音频为MP4
    if os.path.exists(_ffmpeg):
        if 音频临时.exists():
            cmd = [_ffmpeg, "-y", "-i", str(视频临时), "-i", str(音频临时),
                   "-c:v", "copy", "-c:a", "aac", "-shortest", str(最终文件)]
        else:
            cmd = [_ffmpeg, "-y", "-i", str(视频临时), "-c:v", "copy", "-c:a", "aac", str(最终文件)]
        subprocess.run(cmd, capture_output=True, timeout=120,
                      creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        视频临时.unlink(missing_ok=True)
        音频临时.unlink(missing_ok=True)
    else:
        视频临时.rename(最终文件)
        音频临时.unlink(missing_ok=True)

    return str(最终文件), title, 时长秒


class 播放视频(操作基类):
    名称 = "播放视频"
    描述 = "搜索并播放视频。自动搜索→下载→转MP4→中间区域播放。用户说'看视频'/'播放视频'/'我想看XX'时调用"
    参数结构 = {
        "关键词": {"类型": "字符串", "必填": True, "说明": "视频名或关键词，如'周杰伦演唱会'或'朱峰社区教程'"},
    }

    def 执行(self, 参数: dict) -> 操作结果:
        关键词 = 参数.get("关键词", "").strip()
        if not 关键词:
            return 操作结果.失败("关键词为空")

        try:
            # 1. 搜索
            if self.进度回调:
                self.进度回调("视频搜索", {"状态": "搜索中", "关键词": 关键词})

            搜索结果 = _搜索视频(关键词, 数量=3)
            if not 搜索结果:
                return 操作结果.失败(f"未找到'{关键词}'相关视频")

            # 2. 下载第一个视频
            if self.进度回调:
                self.进度回调("视频搜索", {"状态": "下载中", "歌名": 搜索结果[0]["标题"][:20]})

            干净名 = re.sub(r'[<>:"/\\|?*]', '', 搜索结果[0]["标题"][:30])
            结果 = _下载视频(搜索结果[0]["bvid"], 干净名)

            if not 结果:
                return 操作结果.失败(f"下载失败: {搜索结果[0]['标题']}")

            文件路径, 标题, 时长秒 = 结果

            # 3. 推送播放事件（前端用本地文件播放）
            if self.进度回调:
                self.进度回调("播放视频", {
                    "文件路径": 文件路径,
                    "标题": 标题,
                    "关键词": 关键词,
                    "搜索结果": 搜索结果,
                })

            列表文本 = "\n".join(f"  {i+1}. {v['标题']}" for i, v in enumerate(搜索结果))
            return 操作结果.成功(
                f"🎬 正在播放: {标题}\n"
                f"📋 搜索结果({len(搜索结果)}个):\n{列表文本}",
                元数据={"操作类型": "播放视频", "视频列表": 搜索结果, "文件路径": 文件路径}
            )
        except Exception as e:
            return 操作结果.失败(f"播放失败: {e}")


class 搜索视频(操作基类):
    名称 = "搜索视频"
    描述 = "搜索视频，返回视频列表"
    参数结构 = {"关键词": {"类型": "字符串", "必填": True, "说明": "视频名或关键词"}}

    def 执行(self, 参数: dict) -> 操作结果:
        关键词 = 参数.get("关键词", "").strip()
        if not 关键词:
            return 操作结果.失败("关键词为空")
        try:
            搜索结果 = _搜索视频(关键词, 数量=5)
            if not 搜索结果:
                return 操作结果.失败(f"未找到'{关键词}'相关视频")
            lines = [f"共找到 {len(搜索结果)} 个视频：\n"]
            for i, v in enumerate(搜索结果, 1):
                lines.append(f"{i}. {v['标题']}")
            return 操作结果.成功("\n".join(lines), 元数据={"操作类型": "搜索视频", "视频列表": 搜索结果})
        except Exception as e:
            return 操作结果.失败(f"搜索失败: {e}")
