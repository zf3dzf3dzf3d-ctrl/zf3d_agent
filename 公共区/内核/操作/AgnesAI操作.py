"""
AgnesAI操作 — 调用AgnesAI的生图和生视频API
文本对话通过模型直连器（OpenAI兼容），这里只处理生图和生视频
依赖: urllib（标准库，零外部依赖）
"""
import json
import time
import urllib.request
from pathlib import Path
from .基类 import 操作结果, 操作基类


def _获取AgnesAI配置(操作注册中心):
    """从模型规则.json读取AgnesAI的生图/生视频配置"""
    配置加载器 = getattr(操作注册中心, '_配置加载器', None)
    if not 配置加载器:
        return {}
    模型规则 = 配置加载器.配置缓存.get("模型规则", {})
    for m in 模型规则.get("模型配置列表", []):
        if "AgnesAI" in m.get("名称", ""):
            # 读取API密钥
            模型直连器 = getattr(操作注册中心, '_模型直连器', None)
            api_key = ""
            if 模型直连器:
                密钥列表 = 模型直连器.密钥配置.get("密钥列表", {})
                模型密钥 = 密钥列表.get(m["名称"], {})
                api_key = 模型密钥.get("API密钥", "")
            return {
                "api_key": api_key,
                "生图地址": m.get("生图", {}).get("接口地址", "https://apihub.agnes-ai.com/v1/images/generations"),
                "生图模型": m.get("生图", {}).get("模型名称", "agnes-image-2.1-flash"),
                "生视频地址": m.get("生视频", {}).get("接口地址", "https://apihub.agnes-ai.com/v1/videos"),
                "生视频模型": m.get("生视频", {}).get("模型名称", "agnes-video-v2.0"),
                "轮询地址": m.get("生视频", {}).get("轮询地址", "https://apihub.agnes-ai.com/agnesapi?video_id="),
            }
    return {}


class AgnesAI生图(操作基类):
    名称 = "AgnesAI生图"
    描述 = "调用AgnesAI生成图片。输入文字描述即可生成高质量图片，免费额度充足。参数：描述（必填，图片内容描述），尺寸（可选，默认1024x1024）"
    参数结构 = {
        "描述": {"类型": "字符串", "必填": True, "说明": "图片内容描述，如：一只在雨中撑伞的猫"},
        "尺寸": {"类型": "字符串", "必填": False, "说明": "图片尺寸，如1024x1024、1792x1024，默认1024x1024"},
    }

    def 执行(self, 参数, 上下文=None):
        描述 = 参数.get("描述", "").strip()
        if not 描述:
            return 操作结果.失败("描述不能为空")
        尺寸 = 参数.get("尺寸", "1024x1024").strip() or "1024x1024"
        配置 = _获取AgnesAI配置(self._操作注册中心()) if hasattr(self, "_操作注册中心") else {}
        if not 配置 or not 配置.get("api_key"):
            return 操作结果.失败("AgnesAI未配置API密钥，请在设置→模型中选择AgnesAI并填写API密钥")
        try:
            请求体 = json.dumps({
                "model": 配置["生图模型"],
                "prompt": 描述,
                "n": 1,
                "size": 尺寸,
            }).encode("utf-8")
            请求 = urllib.request.Request(
                配置["生图地址"],
                data=请求体,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {配置['api_key']}",
                },
                method="POST"
            )
            with urllib.request.urlopen(请求, timeout=60) as resp:
                结果 = json.loads(resp.read().decode("utf-8"))
            # 解析图片URL
            图片url = ""
            if "data" in 结果 and len(结果["data"]) > 0:
                图片url = 结果["data"][0].get("url", "") or 结果["data"][0].get("b64_json", "")
            if not 图片url:
                return 操作结果.失败(f"生图返回异常: {json.dumps(结果, ensure_ascii=False)[:300]}")
            # 下载图片到保存目录
            工作目录 = getattr(操作注册中心类, '_实例引用', None)
            if 工作目录 and 工作目录.当前工作目录:
                保存路径 = Path(工作目录.当前工作目录) / f"AgnesAI_{int(time.time())}.png"
                if 图片url.startswith("http"):
                    urllib.request.urlretrieve(图片url, str(保存路径))
                    return 操作结果.成功(
                        f"图片已生成并保存: {保存路径.name}\n描述: {描述}\n尺寸: {尺寸}",
                        元数据={"操作类型": "AgnesAI生图", "保存路径": str(保存路径), "图片URL": 图片url}
                    )
                elif 图片url.startswith("data:"):
                    import base64
                    图片数据 = base64.b64decode(图片url.split(",")[-1])
                    保存路径.write_bytes(图片数据)
                    return 操作结果.成功(
                        f"图片已生成并保存: {保存路径.name}\n描述: {描述}\n尺寸: {尺寸}",
                        元数据={"操作类型": "AgnesAI生图", "保存路径": str(保存路径)}
                    )
            return 操作结果.成功(
                f"图片已生成\nURL: {图片url}\n描述: {描述}",
                元数据={"操作类型": "AgnesAI生图", "图片URL": 图片url}
            )
        except Exception as e:
            return 操作结果.失败(f"AgnesAI生图失败: {e}")


class AgnesAI生视频(操作基类):
    名称 = "AgnesAI生视频"
    描述 = "调用AgnesAI生成视频。输入文字描述或图片URL即可生成带音频的视频，异步生成需要等待。参数：描述（必填），图片URL（可选，图生视频时填写）"
    参数结构 = {
        "描述": {"类型": "字符串", "必填": True, "说明": "视频内容描述，如：一只猫在草地上奔跑"},
        "图片URL": {"类型": "字符串", "必填": False, "说明": "图生视频时提供图片URL"},
    }

    def 执行(self, 参数, 上下文=None):
        描述 = 参数.get("描述", "").strip()
        if not 描述:
            return 操作结果.失败("描述不能为空")
        图片url = 参数.get("图片URL", "").strip()
        配置 = _获取AgnesAI配置(self._操作注册中心()) if hasattr(self, "_操作注册中心") else {}
        if not 配置 or not 配置.get("api_key"):
            return 操作结果.失败("AgnesAI未配置API密钥，请在设置→模型中选择AgnesAI并填写API密钥")
        try:
            请求体 = {
                "model": 配置["生视频模型"],
                "prompt": 描述,
            }
            if 图片url:
                请求体["image_url"] = 图片url
            请求 = urllib.request.Request(
                配置["生视频地址"],
                data=json.dumps(请求体).encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {配置['api_key']}",
                },
                method="POST"
            )
            with urllib.request.urlopen(请求, timeout=60) as resp:
                结果 = json.loads(resp.read().decode("utf-8"))
            # 获取video_id用于轮询
            video_id = 结果.get("video_id", "") or 结果.get("id", "")
            if not video_id:
                return 操作结果.失败(f"生视频请求返回异常: {json.dumps(结果, ensure_ascii=False)[:300]}")
            # 轮询等待视频生成
            self._安全推送进度("视频生成", {"状态": "排队中", "video_id": video_id})
            最大等待 = 300  # 5分钟
            开始时间 = time.time()
            while time.time() - 开始时间 < 最大等待:
                time.sleep(10)
                轮询请求 = urllib.request.Request(
                    f"{配置['轮询地址']}{video_id}",
                    headers={"Authorization": f"Bearer {配置['api_key']}"},
                    method="GET"
                )
                try:
                    with urllib.request.urlopen(轮询请求, timeout=30) as resp:
                        轮询结果 = json.loads(resp.read().decode("utf-8"))
                except Exception:
                    continue
                状态 = 轮询结果.get("status", "") or 轮询结果.get("state", "")
                视频url = 轮询结果.get("video_url", "") or 轮询结果.get("url", "")
                if 视频url:
                    # 下载视频
                    工作目录 = 操作注册中心类._实例引用
                    if 工作目录 and 工作目录.当前工作目录:
                        保存路径 = Path(工作目录.当前工作目录) / f"AgnesAI_{int(time.time())}.mp4"
                        urllib.request.urlretrieve(视频url, str(保存路径))
                        return 操作结果.成功(
                            f"视频已生成并保存: {保存路径.name}\n描述: {描述}",
                            元数据={"操作类型": "AgnesAI生视频", "保存路径": str(保存路径), "视频URL": 视频url}
                        )
                    return 操作结果.成功(
                        f"视频已生成\nURL: {视频url}\n描述: {描述}",
                        元数据={"操作类型": "AgnesAI生视频", "视频URL": 视频url}
                    )
                if 状态 in ("failed", "error", "cancelled"):
                    return 操作结果.失败(f"视频生成失败: {状态}")
                已用时 = int(time.time() - 开始时间)
                self._安全推送进度("视频生成", {"状态": f"生成中... {已用时}秒", "video_id": video_id})
            return 操作结果.失败(f"视频生成超时（等待{最大等待}秒），video_id={video_id}，请稍后用此ID查询")
        except Exception as e:
            return 操作结果.失败(f"AgnesAI生视频失败: {e}")
