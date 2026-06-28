"""
网络操作模块 - 网页抓取/网络搜索/网页分析/图片分析
v2.2: Tavily API优先，无密钥时回退Bing爬虫
"""
import json
import re as re_mod
import base64
from pathlib import Path
from .基类 import 操作结果, 操作基类


def _获取Tavily密钥(操作实例) -> str:
    """从模型直连器的密钥配置中读取Tavily API Key"""
    if not 操作实例.模型直连器:
        return ""
    密钥配置 = 操作实例.模型直连器.密钥配置 or {}
    密钥列表 = 密钥配置.get("密钥列表", {})
    tavily配置 = 密钥列表.get("TAVILY", {})
    if isinstance(tavily配置, dict):
        return tavily配置.get("API密钥", "")
    return ""


def _Tavily搜索(关键词: str, 数量: int, api_key: str) -> dict:
    """调用Tavily Search API，返回结构化结果"""
    请求体 = json.dumps({
        "api_key": api_key,
        "query": 关键词,
        "max_results": min(数量, 10),
        "search_depth": "basic",
        "include_answer": True
    }).encode("utf-8")
    请求 = urllib.request.Request(
        "https://api.tavily.com/search",
        data=请求体,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    响应 = urllib.request.urlopen(请求, timeout=15)
    return json.loads(响应.read().decode("utf-8"))


def _Tavily抓取(网址: str, api_key: str) -> dict:
    """调用Tavily Extract API，返回网页正文"""
    请求体 = json.dumps({
        "api_key": api_key,
        "urls": 网址
    }).encode("utf-8")
    请求 = urllib.request.Request(
        "https://api.tavily.com/extract",
        data=请求体,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    响应 = urllib.request.urlopen(请求, timeout=15)
    return json.loads(响应.read().decode("utf-8"))


class 网页抓取(操作基类):
    名称 = "网页抓取"
    描述 = "获取网页正文内容（Tavily优先，回退urllib）"
    参数结构 = {
        "网址": {"类型": "字符串", "必填": True, "说明": "URL地址"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        网址 = 参数.get("网址", "")
        if not 网址:
            return 操作结果.失败("网址为空")

        # 优先使用Tavily Extract API
        api_key = _获取Tavily密钥(self)
        if api_key:
            try:
                import urllib.request
                数据 = _Tavily抓取(网址, api_key)
                结果列表 = 数据.get("results", [])
                if 结果列表:
                    内容 = 结果列表[0].get("raw_content", "") or 结果列表[0].get("content", "")
                    if 内容:
                        return 操作结果.成功(内容[:5000], {"操作类型": "网页抓取", "引擎": "Tavily"})
                # Tavily返回空结果，回退
                错误 = 数据.get("failed_results", [{}])
                if 错误:
                    return 操作结果.失败(f"Tavily抓取失败: {错误[0].get('error', '未知错误')}")
            except Exception as e:
                # Tavily失败，回退到urllib
                pass

        # 回退：urllib + 正则清洗
        try:
            import urllib.request
            请求 = urllib.request.Request(网址, headers={"User-Agent": "Mozilla/5.0"})
            响应 = urllib.request.urlopen(请求, timeout=15)
            内容 = 响应.read().decode("utf-8", errors="replace")
            文本 = re_mod.sub(r'<[^>]+>', '', 内容)
            文本 = re_mod.sub(r'\s+', ' ', 文本).strip()
            return 操作结果.成功(文本[:5000], {"操作类型": "网页抓取", "引擎": "urllib"})
        except Exception as e:
            return 操作结果.失败(f"抓取失败: {e}")


class 网络搜索(操作基类):
    名称 = "网络搜索"
    描述 = "搜索互联网信息（Tavily优先，返回结构化结果含正文摘要；无密钥回退Bing）"
    参数结构 = {
        "关键词": {"类型": "字符串", "必填": True, "说明": "搜索关键词"},
        "页码": {"类型": "整数", "必填": False, "说明": "搜索结果页码，默认1（Bing回退时有效）"},
        "数量": {"类型": "整数", "必填": False, "说明": "返回结果数量，默认5"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        关键词 = 参数.get("关键词", "")
        页码 = 参数.get("页码", 1)
        数量 = 参数.get("数量", 5)
        if not 关键词:
            return 操作结果.失败("关键词为空")

        # 优先使用Tavily Search API
        api_key = _获取Tavily密钥(self)
        if api_key:
            try:
                import urllib.request
                数据 = _Tavily搜索(关键词, 数量, api_key)
                回答 = 数据.get("answer", "")
                结果列表 = 数据.get("results", [])
                if 结果列表:
                    输出 = []
                    if 回答:
                        输出.append(f"💡 {回答}\n")
                    输出.append(f"搜索「{关键词}」，找到{len(结果列表)}条结果:\n")
                    for i, 条目 in enumerate(结果列表, 1):
                        标题 = 条目.get("title", "")
                        url = 条目.get("url", "")
                        内容 = 条目.get("content", "")
                        评分 = 条目.get("score", 0)
                        条 = f"📄 [{i}] {标题}"
                        if url:
                            条 += f"\n   🔗 {url}"
                        if 内容:
                            条 += f"\n   {内容[:300]}"
                        if 评分:
                            条 += f"\n   📊 相关度: {评分:.0%}"
                        输出.append(条)
                    return 操作结果.成功("\n\n".join(输出), {"操作类型": "网络搜索", "引擎": "Tavily", "结果数": len(结果列表)})
                else:
                    return 操作结果.成功(f"未找到「{关键词}」的搜索结果", {"操作类型": "网络搜索", "引擎": "Tavily"})
            except Exception:
                # Tavily失败，回退到Bing
                pass

        # 回退：Bing爬虫
        try:
            import urllib.request
            import urllib.parse

            查询 = urllib.parse.quote(关键词)
            起始 = (页码 - 1) * 10
            网址 = f"https://www.bing.com/search?q={查询}&first={起始+1}"
            请求 = urllib.request.Request(网址, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            响应 = urllib.request.urlopen(请求, timeout=15)
            内容 = 响应.read().decode("utf-8", errors="replace")

            结果块列表 = re_mod.findall(r'<li class="b_algo">(.*?)</li>', 内容, re_mod.DOTALL)
            if not 结果块列表:
                标题列表 = re_mod.findall(r'<h2[^>]*>(?:<a[^>]*>)?(.*?)(?:</a>)?</h2>', 内容, re_mod.DOTALL)
                结果列表 = []
                for 标题 in 标题列表[:数量]:
                    干净标题 = re_mod.sub(r'<[^>]+>', '', 标题).strip()
                    if 干净标题:
                        结果列表.append(f"• {干净标题}")
                return 操作结果.成功("\n".join(结果列表) if 结果列表 else "未找到结果",
                                     {"操作类型": "网络搜索", "引擎": "Bing"})

            结果列表 = []
            for 块 in 结果块列表[:数量]:
                标题匹配 = re_mod.search(r'<h2[^>]*><a[^>]*>(.*?)</a></h2>', 块, re_mod.DOTALL)
                标题 = re_mod.sub(r'<[^>]+>', '', 标题匹配.group(1)).strip() if 标题匹配 else ""
                url匹配 = re_mod.search(r'<a[^>]*href="(http[^"]*)"', 块)
                url = url匹配.group(1) if url匹配 else ""
                摘要匹配 = re_mod.search(r'<p[^>]*>(.*?)</p>', 块, re_mod.DOTALL)
                摘要 = re_mod.sub(r'<[^>]+>', '', 摘要匹配.group(1)).strip() if 摘要匹配 else ""
                if 标题:
                    条目 = f"📄 {标题}"
                    if url:
                        条目 += f"\n   🔗 {url}"
                    if 摘要:
                        条目 += f"\n   {摘要[:200]}"
                    结果列表.append(条目)

            if 结果列表:
                汇总 = f"搜索「{关键词}」第{页码}页，找到{len(结果列表)}条结果:\n"
                return 操作结果.成功(汇总 + "\n\n".join(结果列表),
                                     {"操作类型": "网络搜索", "引擎": "Bing", "结果数": len(结果列表)})
            else:
                return 操作结果.成功(f"未找到「{关键词}」的搜索结果",
                                     {"操作类型": "网络搜索", "引擎": "Bing"})
        except Exception as e:
            return 操作结果.失败(f"搜索失败: {e}")


class 网页分析(操作基类):
    名称 = "网页分析"
    描述 = "抓取网页内容并用大模型分析，返回对网页内容的回答"
    参数结构 = {
        "网址": {"类型": "字符串", "必填": True, "说明": "要分析的网页URL"},
        "问题": {"类型": "字符串", "必填": True, "说明": "要从网页中提取或分析的问题"},
        "最大长度": {"类型": "整数", "必填": False, "说明": "发送给LLM的最大网页内容字符数，默认5000"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        网址 = 参数.get("网址", "")
        问题 = 参数.get("问题", "")
        最大长度 = 参数.get("最大长度", 5000)
        if not 网址:
            return 操作结果.失败("网址为空")
        if not 问题:
            return 操作结果.失败("问题为空")

        # 优先使用Tavily Extract获取干净正文
        api_key = _获取Tavily密钥(self)
        内容 = ""
        引擎 = "urllib"
        if api_key:
            try:
                数据 = _Tavily抓取(网址, api_key)
                结果列表 = 数据.get("results", [])
                if 结果列表:
                    内容 = 结果列表[0].get("raw_content", "") or 结果列表[0].get("content", "")
                    引擎 = "Tavily"
                if not 内容:
                    错误列表 = 数据.get("failed_results", [{}])
                    if 错误列表:
                        # Tavily明确失败，回退urllib
                        pass
            except Exception:
                pass

        # 回退：urllib + 正则清洗
        if not 内容:
            try:
                import urllib.request
                import re as re_mod

                请求 = urllib.request.Request(网址, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                })
                响应 = urllib.request.urlopen(请求, timeout=15)
                原始内容 = 响应.read().decode("utf-8", errors="replace")

                内容 = re_mod.sub(r'<script[^>]*>.*?</script>', '', 原始内容, flags=re_mod.DOTALL | re_mod.IGNORECASE)
                内容 = re_mod.sub(r'<style[^>]*>.*?</style>', '', 内容, flags=re_mod.DOTALL | re_mod.IGNORECASE)
                内容 = re_mod.sub(r'<[^>]+>', '', 内容)
                内容 = re_mod.sub(r'&nbsp;', ' ', 内容)
                内容 = re_mod.sub(r'&amp;', '&', 内容)
                内容 = re_mod.sub(r'&lt;', '<', 内容)
                内容 = re_mod.sub(r'&gt;', '>', 内容)
                内容 = re_mod.sub(r'&quot;', '"', 内容)
                内容 = re_mod.sub(r'\n\s*\n', '\n\n', 内容).strip()
            except Exception as e:
                return 操作结果.失败(f"网页分析失败: {e}")

        if not 内容:
            return 操作结果.失败(f"无法获取网页内容: {网址}")

        截断内容 = 内容[:最大长度]
        if len(内容) > 最大长度:
            截断内容 += f"\n...(已截断，总长度{len(内容)}字符)"

        if not self.模型直连器:
            return 操作结果.失败("模型直连器未注入，无法分析网页")

        分析提示 = f"请根据以下网页内容回答问题。\n\n问题: {问题}\n\n网页URL: {网址}\n网页内容:\n{截断内容}"
        消息列表 = [{"role": "user", "content": 分析提示}]
        结果 = self.模型直连器.发送消息(消息列表, "你是一个网页内容分析专家。根据用户提供的网页内容回答问题。")

        if 结果.get("成功"):
            回复 = 结果.get("回复内容", "")
            return 操作结果.成功(f"🌐 网页分析结果 ({网址}, 抓取{len(内容)}字符, {引擎}):\n{回复}",
                                 {"操作类型": "网页分析", "引擎": 引擎})
        else:
            return 操作结果.失败(f"LLM分析失败: {结果.get('错误', '未知错误')}")


class 图片分析(操作基类):
    名称 = "图片分析"
    描述 = "读取本地图片文件并用大模型分析（支持png/jpg/gif/webp/bmp），通过vision API发送"
    参数结构 = {
        "图片路径": {"类型": "字符串", "必填": True, "说明": "图片文件路径"},
        "问题": {"类型": "字符串", "必填": True, "说明": "对图片的问题或分析需求"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        图片路径 = 参数.get("图片路径", "")
        问题 = 参数.get("问题", "")
        if not 图片路径:
            return 操作结果.失败("图片路径为空")
        if not 问题:
            return 操作结果.失败("问题为空")

        文件路径 = self.文件管理器._解析路径(图片路径) if self.文件管理器 else Path(图片路径)
        if not 文件路径.exists():
            return 操作结果.失败(f"图片不存在: {图片路径}")

        后缀 = 文件路径.suffix.lower()
        mime映射 = {
            ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp"
        }
        mime类型 = mime映射.get(后缀)
        if not mime类型:
            return 操作结果.失败(f"不支持的图片格式: {后缀}，支持: png/jpg/gif/webp/bmp")

        try:
            with open(文件路径, "rb") as f:
                图片字节 = f.read()

            if len(图片字节) > 10 * 1024 * 1024:
                return 操作结果.失败("图片超过10MB限制")

            base64数据 = base64.b64encode(图片字节).decode("utf-8")
            data_url = f"data:{mime类型};base64,{base64数据}"

            multimodal内容 = [
                {"type": "text", "text": 问题},
                {"type": "image_url", "image_url": {"url": data_url}}
            ]

            if not self.模型直连器:
                return 操作结果.失败("模型直连器未注入，无法分析图片")

            消息列表 = [{"role": "user", "content": multimodal内容}]
            结果 = self.模型直连器.发送消息(消息列表, "你是一个图像分析专家。请根据用户的问题分析图片内容。")

            if 结果.get("成功"):
                回复 = 结果.get("回复内容", "")
                return 操作结果.成功(f"📷 图片分析结果 ({len(图片字节)//1024}KB, {mime类型}):\n{回复}")
            else:
                return 操作结果.失败(f"LLM分析失败: {结果.get('错误', '未知错误')}")
        except Exception as e:
            return 操作结果.失败(f"图片分析失败: {e}")
