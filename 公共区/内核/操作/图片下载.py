"""
图片下载操作模块 - 从网页提取并下载图片到本地文件夹
按网页标题创建子文件夹，智能筛选正文图片
支持百度图片搜索等动态加载页面
"""
import os
import re
import time
import json
import urllib.request
import urllib.parse
from pathlib import Path
from .基类 import 操作结果, 操作基类


class 下载网页图片(操作基类):
    名称 = "下载网页图片"
    描述 = "访问指定网址，提取页面正文图片并下载到目标文件夹。自动按网页标题创建子文件夹分类存放，智能过滤广告、图标等小图。支持百度图片搜索等动态页面"
    参数结构 = {
        "网址": {"类型": "字符串", "必填": True, "说明": "要提取图片的网页URL"},
        "保存目录": {"类型": "字符串", "必填": True, "说明": "图片下载的目标文件夹路径"},
        "最小宽度": {"类型": "整数", "必填": False, "说明": "图片最小宽度像素，默认100，小于此值的图片视为图标/广告跳过"},
        "最大数量": {"类型": "整数", "必填": False, "说明": "最多下载图片数量，默认50"}
    }

    # 通用请求头
    _请求头 = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive",
    }

    def 执行(self, 参数: dict) -> 操作结果:
        网址 = 参数.get("网址", "")
        保存目录 = 参数.get("保存目录", "")
        最小宽度 = 参数.get("最小宽度", 100)
        最大数量 = 参数.get("最大数量", 50)

        if not 网址:
            return 操作结果.失败("网址为空")
        if not 保存目录:
            return 操作结果.失败("保存目录为空")

        try:
            # 检测特殊页面类型
            if "image.baidu.com" in 网址:
                return self._下载百度图片(网址, 保存目录, 最大数量)
            if "bing.com/images" in 网址 or "images.search.yahoo" in 网址:
                return self._下载百度图片(网址, 保存目录, 最大数量)  # 通用搜索引擎处理

            # 通用网页图片提取
            return self._下载通用网页图片(网址, 保存目录, 最小宽度, 最大数量)
        except Exception as e:
            return 操作结果.失败(f"下载网页图片失败: {e}")

    def _下载通用网页图片(self, 网址, 保存目录, 最小宽度, 最大数量):
        """通用网页图片提取"""
        # 1. 抓取网页HTML
        请求 = urllib.request.Request(网址, headers=self._请求头)
        响应 = urllib.request.urlopen(请求, timeout=20)
        编码 = 响应.headers.get_content_charset() or "utf-8"
        html = 响应.read().decode(编码, errors="replace")

        # 2. 提取网页标题
        标题匹配 = re.search(r'<title[^>]*>(.*?)</title>', html, re.DOTALL | re.IGNORECASE)
        标题 = 标题匹配.group(1).strip() if 标题匹配 else "未命名网页"
        标题 = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', 标题).strip()[:80] or "未命名网页"

        # 3. 创建子文件夹
        子目录 = Path(保存目录) / 标题
        子目录.mkdir(parents=True, exist_ok=True)

        # 4. 提取所有img标签
        img模式 = re.compile(
            r'<img[^>]+src=["\']([^"\']+)["\']'
            r'[^>]*(?:width=["\'](\d+)["\'])?[^>]*>',
            re.IGNORECASE
        )
        img模式2 = re.compile(
            r'<img[^>]+data-src=["\']([^"\']+)["\']'
            r'[^>]*(?:width=["\'](\d+)["\'])?[^>]*>',
            re.IGNORECASE
        )

        所有图片 = []
        for 匹配 in img模式.finditer(html):
            src = 匹配.group(1)
            width = int(匹配.group(2)) if 匹配.group(2) else None
            所有图片.append((src, width))
        for 匹配 in img模式2.finditer(html):
            src = 匹配.group(1)
            width = int(匹配.group(2)) if 匹配.group(2) else None
            if not any(s == src for s, _ in 所有图片):
                所有图片.append((src, width))

        # 5. 过滤
        排除关键词 = [
            "icon", "logo", "sprite", "tracker", "pixel", "blank",
            "loading", "placeholder", "avatar", "favicon", "badge",
            "button", "arrow", "close", "search", "menu", "star",
            "1x1", "spacer.gif", "transparent"
        ]
        正文图片 = []
        for src, width in 所有图片:
            src_lower = src.lower()
            if src_lower.startswith("data:"):
                continue
            if any(kw in src_lower for kw in 排除关键词):
                continue
            if width and width < 最小宽度:
                continue
            正文图片.append((src, width))

        if not 正文图片:
            return 操作结果.成功(
                f"网页「{标题}」中未找到正文图片",
                {"操作类型": "下载网页图片", "标题": 标题, "下载数": 0}
            )

        # 6. 下载图片
        return self._批量下载(正文图片, 子目录, 网址, 标题, 最大数量)

    def _下载百度图片(self, 网址, 保存目录, 最大数量):
        """百度图片搜索专用：调用JSON API获取图片URL"""
        # 从URL提取搜索关键词
        解析 = urllib.parse.urlparse(网址)
        参数 = urllib.parse.parse_qs(解析.query)
        关键词 = 参数.get("word", 参数.get("query", 参数.get("q", [""])))[0]

        if not 关键词:
            # 尝试从word参数中提取
            word匹配 = re.search(r'[?&]word=([^&]+)', 网址)
            if word匹配:
                关键词 = urllib.parse.unquote(word匹配.group(1))

        if not 关键词:
            return 操作结果.失败("无法从百度图片URL中提取搜索关键词")

        标题 = f"百度图片_{关键词}"
        子目录 = Path(保存目录) / 标题
        子目录.mkdir(parents=True, exist_ok=True)

        # 调用百度图片搜索JSON API
        # 每页30张，翻页获取
        已下载 = 0
        已失败 = 0
        结果列表 = []
        页码 = 0
        文件名计数 = {}

        while 已下载 < 最大数量:
            每页数量 = min(30, 最大数量 - 已下载 + 已失败 + 10)
            api_url = (
                f"https://image.baidu.com/search/acjson"
                f"?tn=resultjson_com&word={urllib.parse.quote(关键词)}"
                f"&pn={页码 * 30}&rn={每页数量}"
                f"&ie=utf-8&ct=201326592&z=0&lm=-1&hd=&latest=&copyright="
                f"&se=&tab=&width=&height=&face=0&istype=2&qc=0"
            )

            try:
                请求 = urllib.request.Request(api_url, headers={
                    **self._请求头,
                    "Referer": "https://image.baidu.com/",
                    "X-Requested-With": "XMLHttpRequest",
                })
                响应 = urllib.request.urlopen(请求, timeout=15)
                编码 = 响应.headers.get_content_charset() or "utf-8"
                json文本 = 响应.read().decode(编码, errors="replace")
                数据 = json.loads(json文本)
            except Exception as e:
                if 页码 == 0:
                    return 操作结果.失败(f"百度图片API请求失败: {e}")
                break

            图片列表 = 数据.get("data", [])
            if not 图片列表:
                break

            for item in 图片列表:
                if 已下载 >= 最大数量:
                    break
                if not item:
                    continue

                # 优先使用thumbURL（缩略图，更稳定），其次middleURL，最后objURL
                img_url = item.get("thumbURL") or item.get("middleURL") or item.get("objURL") or ""
                if not img_url:
                    continue

                try:
                    # 从URL提取文件名
                    解析url = urllib.parse.urlparse(img_url)
                    文件名 = os.path.basename(解析url.path)
                    if not 文件名 or "." not in 文件名:
                        文件名 = f"{关键词}_{已下载 + 1}.jpg"
                    文件名 = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', 文件名)

                    # 重名处理
                    if 文件名 in 文件名计数:
                        文件名计数[文件名] += 1
                        名称, 扩展名 = os.path.splitext(文件名)
                        文件名 = f"{名称}_{文件名计数[文件名] - 1}{扩展名}"
                    else:
                        文件名计数[文件名] = 1

                    保存路径 = 子目录 / 文件名

                    img请求 = urllib.request.Request(img_url, headers={
                        **self._请求头,
                        "Referer": "https://image.baidu.com/",
                    })
                    img响应 = urllib.request.urlopen(img请求, timeout=20)
                    img数据 = img响应.read()

                    # 验证是否为图片
                    if not self._是否为图片(img数据):
                        已失败 += 1
                        continue

                    # 检查图片大小（小于2KB的可能是占位图）
                    if len(img数据) < 2048:
                        已失败 += 1
                        continue

                    with open(保存路径, "wb") as f:
                        f.write(img数据)

                    已下载 += 1
                    大小kb = len(img数据) // 1024
                    结果列表.append(f"  ✅ {文件名} ({大小kb}KB)")

                except Exception as e:
                    已失败 += 1
                    结果列表.append(f"  ❌ {img_url[:60]} - {e}")

            页码 += 1
            # 最多翻3页
            if 页码 >= 3:
                break

            # 避免请求过快
            time.sleep(0.3)

        if 已下载 == 0:
            return 操作结果.失败(
                f"百度图片搜索「{关键词}」未能下载任何图片（失败{已失败}张）。"
                f"可能原因：百度反爬限制或网络问题"
            )

        汇总 = f"百度图片搜索「{关键词}」下载完成:\n"
        汇总 += f"  📁 保存到: {子目录}\n"
        汇总 += f"  🖼️ 成功下载{已下载}张"
        if 已失败:
            汇总 += f", 失败{已失败}张"
        汇总 += "\n" + "\n".join(结果列表[:20])
        if len(结果列表) > 20:
            汇总 += f"\n  ...还有{len(结果列表) - 20}条"

        return 操作结果.成功(汇总, {
            "操作类型": "下载网页图片",
            "标题": 标题,
            "关键词": 关键词,
            "下载数": 已下载,
            "失败数": 已失败,
            "保存路径": str(子目录)
        })

    def _批量下载(self, 图片列表, 子目录, base_url, 标题, 最大数量):
        """批量下载图片到指定目录"""
        下载成功 = 0
        下载失败 = 0
        结果列表 = []
        文件名计数 = {}

        for src, _ in 图片列表[:最大数量]:
            try:
                完整url = urllib.parse.urljoin(base_url, src)
                解析url = urllib.parse.urlparse(完整url)
                文件名 = os.path.basename(解析url.path)
                if not 文件名 or "." not in 文件名:
                    文件名 = f"img_{int(time.time()*1000)}.jpg"
                文件名 = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', 文件名)

                if 文件名 in 文件名计数:
                    文件名计数[文件名] += 1
                    名称, 扩展名 = os.path.splitext(文件名)
                    文件名 = f"{名称}_{文件名计数[文件名] - 1}{扩展名}"
                else:
                    文件名计数[文件名] = 1

                保存路径 = 子目录 / 文件名

                img请求 = urllib.request.Request(完整url, headers={
                    **self._请求头,
                    "Referer": base_url
                })
                img响应 = urllib.request.urlopen(img请求, timeout=20)
                img数据 = img响应.read()

                if not self._是否为图片(img数据):
                    下载失败 += 1
                    continue

                if len(img数据) < 1024:
                    下载失败 += 1
                    continue

                with open(保存路径, "wb") as f:
                    f.write(img数据)

                下载成功 += 1
                大小kb = len(img数据) // 1024
                结果列表.append(f"  ✅ {文件名} ({大小kb}KB)")

            except Exception as e:
                下载失败 += 1
                结果列表.append(f"  ❌ {src[:60]} - {e}")

        汇总 = f"网页「{标题}」提取完成:\n"
        汇总 += f"  📁 保存到: {子目录}\n"
        汇总 += f"  🖼️ 找到{len(图片列表)}张正文图片, 成功下载{下载成功}张"
        if 下载失败:
            汇总 += f", 失败{下载失败}张"
        汇总 += "\n" + "\n".join(结果列表[:20])
        if len(结果列表) > 20:
            汇总 += f"\n  ...还有{len(结果列表) - 20}条"

        return 操作结果.成功(汇总, {
            "操作类型": "下载网页图片",
            "标题": 标题,
            "找到数": len(图片列表),
            "下载数": 下载成功,
            "失败数": 下载失败,
            "保存路径": str(子目录)
        })

    def _是否为图片(self, 数据: bytes) -> bool:
        """检查字节流是否为图片格式"""
        if len(数据) < 4:
            return False
        if 数据[:2] == b'\xff\xd8':
            return True
        if 数据[:4] == b'\x89PNG':
            return True
        if 数据[:4] == b'GIF8':
            return True
        if 数据[:4] == b'RIFF' and 数据[8:12] == b'WEBP':
            return True
        if 数据[:2] == b'BM':
            return True
        if 数据[:4] in (b'<svg', b'<?xm'):
            return True
        return False
