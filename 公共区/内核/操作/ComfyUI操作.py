"""
ComfyUI操作模块 - 通过API控制ComfyUI生成图片/视频/反推

ComfyUI默认运行在 http://127.0.0.1:8188
所有操作都通过HTTP API实现，不依赖GUI自动化

核心能力：
- 提交工作流生图
- 查询生成进度
- 获取/下载生成的图片
- 列出可用模型
- 中断/清空队列
- 一键文生图（内置常用工作流模板）
- 上传图片（用于图生图等）
- 图片修改（单图/多图编辑、放大）
- 视频生成（文生视频、图生视频）
- 图片视频反推（AI分析图片视频生成文字描述）
"""
import json
import os
import time
import uuid
import pathlib
import urllib.request
import urllib.error
import urllib.parse
from .基类 import 操作结果, 操作基类


def _获取ComfyUI地址() -> str:
    """从系统配置读取ComfyUI地址"""
    try:
        from 操作注册中心 import 操作注册中心类
        实例 = 操作注册中心类._实例引用
        if 实例 and 实例._配置加载器:
            系统配置 = 实例._配置加载器.配置缓存.get("系统配置", {})
            地址 = 系统配置.get("ComfyUI地址", "127.0.0.1:8188")
            if 地址:
                return 地址
    except Exception:
        pass
    return "127.0.0.1:8188"


def _获取工作流目录() -> str:
    """从系统配置读取ComfyUI工作流目录，支持相对路径和自动探测"""
    try:
        from 操作注册中心 import 操作注册中心类
        实例 = 操作注册中心类._实例引用
        if 实例 and 实例._配置加载器:
            系统配置 = 实例._配置加载器.配置缓存.get("系统配置", {})
            目录 = 系统配置.get("ComfyUI工作流目录", "")
            if 目录:
                # 相对路径：基于项目根目录解析
                if not os.path.isabs(目录):
                    try:
                        项目根 = pathlib.Path(__file__).parent.parent.parent.parent
                        目录 = str(项目根 / 目录)
                    except Exception:
                        pass
                if os.path.isdir(目录):
                    return 目录
    except Exception:
        pass

    # 自动探测常见安装路径
    home = os.path.expanduser("~")
    候选路径 = [
        # ComfyUI Desktop（用户目录下）
        os.path.join(home, "Documents", "ComfyUI", "user", "default", "workflows"),
        # ComfyUI Desktop（AppData）
        os.path.join(home, "AppData", "Local", "ComfyUI", "user", "default", "workflows"),
        # 独立安装（常见盘符）
        r"C:\ComfyUI\user\default\workflows",
        r"D:\ComfyUI\user\default\workflows",
        r"D:\AI\ComfyUI\user\default\workflows",
        # macOS / Linux
        os.path.join(home, "ComfyUI", "user", "default", "workflows"),
    ]
    for 路径 in 候选路径:
        if os.path.isdir(路径):
            return 路径

    return os.path.join(home, "Documents", "ComfyUI", "user", "default", "workflows")


# 模块级工作流路径缓存：关键词 → 完整路径，搜索过一次就记住
_工作流路径缓存 = {}


def _是否API格式(文件路径: str) -> bool:
    """快速判断JSON文件是否为ComfyUI API格式"""
    try:
        with open(文件路径, "r", encoding="utf-8") as f:
            数据 = json.load(f)
        if not isinstance(数据, dict):
            return False
        return any(isinstance(v, dict) and "class_type" in v for v in 数据.values())
    except Exception:
        return False


def _查找工作流文件(关键词: str) -> str:
    """模糊匹配工作流文件名，优先返回API格式，命中缓存直接返回"""
    关键词 = 关键词.strip().lower()

    # 1. 精确匹配缓存
    if 关键词 in _工作流路径缓存:
        缓存路径 = _工作流路径缓存[关键词]
        if os.path.exists(缓存路径):
            return 缓存路径
        else:
            del _工作流路径缓存[关键词]

    # 2. 模糊匹配缓存（关键词是某缓存键的子串）
    for 缓存键, 缓存路径 in _工作流路径缓存.items():
        if 关键词 in 缓存键 and os.path.exists(缓存路径):
            _工作流路径缓存[关键词] = 缓存路径
            return 缓存路径

    # 3. 递归搜索，收集所有匹配项
    工作流目录 = _获取工作流目录()
    if not os.path.exists(工作流目录):
        return None

    匹配列表 = []
    for 根, _, 文件列表 in os.walk(工作流目录):
        for f in 文件列表:
            if f.endswith(".json") and 关键词 in f.lower():
                匹配列表.append(os.path.join(根, f))

    if not 匹配列表:
        return None

    # 4. 优先返回API格式文件
    for 路径 in 匹配列表:
        if "_api" in os.path.basename(路径).lower() or _是否API格式(路径):
            _工作流路径缓存[关键词] = 路径
            return 路径

    # 5. 没有API格式，返回第一个
    _工作流路径缓存[关键词] = 匹配列表[0]
    return 匹配列表[0]


def _API请求(地址: str, 路径: str, 方法: str = "GET", 数据: dict = None) -> tuple:
    """
    通用ComfyUI API请求

    Returns:
        (成功, 响应数据或错误信息)
    """
    url = f"http://{地址}{路径}"
    try:
        if 方法 == "GET":
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=15) as resp:
                return True, json.loads(resp.read().decode("utf-8"))
        elif 方法 == "POST":
            body = json.dumps(数据 or {}).encode("utf-8")
            req = urllib.request.Request(url, data=body, method="POST",
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                return True, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            错误体 = e.read().decode("utf-8")
            return False, f"HTTP {e.code}: {错误体[:300]}"
        except Exception:
            return False, f"HTTP {e.code}"
    except urllib.error.URLError:
        return False, f"无法连接ComfyUI（{地址}），请确保ComfyUI已启动"
    except Exception as e:
        return False, str(e)


# ============ 共享辅助函数 ============

def _上传图片到ComfyUI(图片路径: str, 地址: str) -> str:
    """上传单张图片/视频到ComfyUI input目录，返回文件名"""
    文件名 = os.path.basename(图片路径)
    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex[:16]}"

    with open(图片路径, "rb") as f:
        数据 = f.read()

    body = f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="image"; filename="{文件名}"\r\n'.encode()
    body += b"Content-Type: application/octet-stream\r\n\r\n"
    body += 数据
    body += f"\r\n--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="type"\r\n\r\ninput\r\n'
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'
    body += f"--{boundary}--\r\n".encode()

    url = f"http://{地址}/upload/image"
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        结果 = json.loads(resp.read().decode("utf-8"))

    return 结果.get("name", 文件名)


def _注入提示词通用(工作流: dict, 提示词: str, 负面提示词: str = None) -> bool:
    """统一提示词注入，支持KSampler/KSamplerAdvanced/SamplerCustomAdvanced/无采样器(反推)"""
    采样器类型 = ("KSampler", "KSamplerAdvanced", "SamplerCustomAdvanced")
    正面id, 负面id = None, None

    for nid, node in 工作流.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        inputs = node.get("inputs", {})

        if ct in ("KSampler", "KSamplerAdvanced"):
            pos = inputs.get("positive", [])
            neg = inputs.get("negative", [])
            if isinstance(pos, list) and pos:
                正面id = str(pos[0])
            if isinstance(neg, list) and neg:
                负面id = str(neg[0])
        elif ct == "SamplerCustomAdvanced":
            guider = inputs.get("guider", [])
            if isinstance(guider, list) and guider:
                guider_id = str(guider[0])
                if guider_id in 工作流 and isinstance(工作流[guider_id], dict):
                    g_inputs = 工作流[guider_id].get("inputs", {})
                    cond = g_inputs.get("cond", [])
                    uncond = g_inputs.get("uncond", [])
                    if isinstance(cond, list) and cond:
                        正面id = str(cond[0])
                    if isinstance(uncond, list) and uncond:
                        负面id = str(uncond[0])

    def _注入到条件节点(节点id, 文本):
        if not 节点id or 节点id not in 工作流:
            return False
        node = 工作流[节点id]
        if not isinstance(node, dict):
            return False
        ct = node.get("class_type", "")
        if ct not in ("CLIPTextEncode", "TextEncodeQwenImageEditPlus"):
            return False
        text_input = node.get("inputs", {}).get("text", "")
        if isinstance(text_input, list) and len(text_input) >= 2:
            源id = str(text_input[0])
            if 源id in 工作流:
                源node = 工作流[源id]
                if isinstance(源node, dict):
                    源ct = 源node.get("class_type", "")
                    if 源ct == "PrimitiveStringMultiline":
                        源node["inputs"]["value"] = 文本
                        return True
                    if 源ct in ("Text Multiline", "PrimitiveString"):
                        源node["inputs"]["text"] = 文本
                        return True
        node["inputs"]["text"] = 文本
        return True

    injected = False
    if 正面id:
        injected = _注入到条件节点(正面id, 提示词)
    if not injected:
        for nid, node in 工作流.items():
            if isinstance(node, dict) and node.get("class_type") in ("CLIPTextEncode", "TextEncodeQwenImageEditPlus"):
                if _注入到条件节点(nid, 提示词):
                    injected = True
                    break

    if 负面提示词 and 负面id:
        _注入到条件节点(负面id, 负面提示词)

    # 无采样器的工作流（反推）：注入到第一个空的文本节点
    if not injected and not 正面id:
        for nid, node in 工作流.items():
            if not isinstance(node, dict):
                continue
            ct = node.get("class_type", "")
            if ct == "PrimitiveStringMultiline":
                val = node.get("inputs", {}).get("value", "")
                if not val or (isinstance(val, str) and not val.strip()):
                    node["inputs"]["value"] = 提示词
                    injected = True
                    break
            elif ct == "Text Multiline":
                txt = node.get("inputs", {}).get("text", "")
                if not txt or (isinstance(txt, str) and not txt.strip()):
                    node["inputs"]["text"] = 提示词
                    injected = True
                    break

    return injected


def _注入种子(工作流: dict, 种子: int):
    """注入随机种子到所有采样器节点"""
    种子字段 = {"KSampler": "seed", "KSamplerAdvanced": "noise_seed"}

    for nid, node in 工作流.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        inputs = node.get("inputs", {})

        if ct in 种子字段:
            field = 种子字段[ct]
            val = inputs.get(field)
            if isinstance(val, list) and val:
                源id = str(val[0])
                if 源id in 工作流 and isinstance(工作流[源id], dict):
                    if "value" in 工作流[源id].get("inputs", {}):
                        工作流[源id]["inputs"]["value"] = 种子
            else:
                inputs[field] = 种子
        elif ct == "SamplerCustomAdvanced":
            noise = inputs.get("noise", [])
            if isinstance(noise, list) and noise:
                noise_id = str(noise[0])
                if noise_id in 工作流 and isinstance(工作流[noise_id], dict):
                    工作流[noise_id]["inputs"]["noise_seed"] = 种子


def _上传并注入图片(工作流: dict, 图片路径列表: list, 地址: str) -> list:
    """上传图片到ComfyUI并注入LoadImage节点，返回(上传/引用)成功的文件名列表

    支持两种输入：
    - 本地文件路径（自动上传到ComfyUI）
    - ComfyUI上已有的文件名（直接引用，不重复上传）
    """
    上传成功 = []

    for 图片路径 in 图片路径列表:
        图片路径 = 图片路径.strip()
        if not 图片路径:
            continue
        if os.path.exists(图片路径):
            # 本地文件：上传到ComfyUI
            try:
                文件名 = _上传图片到ComfyUI(图片路径, 地址)
                上传成功.append(文件名)
            except Exception:
                pass
        else:
            # 非本地路径：视为已上传到ComfyUI的文件名，直接引用
            # 去掉可能的 input/ 前缀，LoadImage 只需裸文件名
            引用名 = 图片路径
            if 引用名.startswith("input/"):
                引用名 = 引用名[6:]
            上传成功.append(引用名)

    if not 上传成功:
        return []

    # 按顺序设置LoadImage/LoadVideo节点的文件名
    img_idx = 0
    for nid, node in 工作流.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        if ct in ("LoadImage", "LoadImageMask"):
            if img_idx < len(上传成功):
                node["inputs"]["image"] = 上传成功[img_idx]
                img_idx += 1
        elif ct == "LoadVideo" or "LoadVideo" in ct:
            if img_idx < len(上传成功):
                node["inputs"]["video"] = 上传成功[img_idx]
                img_idx += 1

    return 上传成功


def _提取所有输出(历史条目: dict, 保存目录: str, 地址: str) -> dict:
    """提取所有输出（图片/视频/文本），下载到本地，返回结构化结果"""
    结果 = {"图片": [], "视频": [], "文本": ""}
    outputs = 历史条目.get("outputs", {})
    文本列表 = []

    for 节点id, 输出 in outputs.items():
        # 图片
        for img in 输出.get("images", []):
            文件名 = img.get("filename", "")
            if not 文件名:
                continue
            参数 = {"filename": 文件名, "type": img.get("type", "output")}
            if img.get("subfolder"):
                参数["subfolder"] = img["subfolder"]
            url = f"http://{地址}/view?{urllib.parse.urlencode(参数)}"
            保存路径 = os.path.join(保存目录, 文件名)
            try:
                urllib.request.urlretrieve(url, 保存路径)
                结果["图片"].append(保存路径)
            except Exception:
                pass

        # 视频（VHS SaveVideo 输出 gifs 字段）
        for vid in 输出.get("gifs", []):
            文件名 = vid.get("filename", "")
            if not 文件名:
                continue
            参数 = {"filename": 文件名, "type": vid.get("type", "output")}
            if vid.get("subfolder"):
                参数["subfolder"] = vid["subfolder"]
            url = f"http://{地址}/view?{urllib.parse.urlencode(参数)}"
            保存路径 = os.path.join(保存目录, 文件名)
            try:
                urllib.request.urlretrieve(url, 保存路径)
                结果["视频"].append(保存路径)
            except Exception:
                pass

        # 文本（ShowText|pysssss 输出）
        for text in 输出.get("text", []):
            if isinstance(text, str) and text.strip():
                文本列表.append(text.strip())

    if 文本列表:
        结果["文本"] = "\n".join(文本列表)

    return 结果


def _等待完成(地址: str, prompt_id: str, 超时: int, 进度回调, 操作名: str, 提示词: str = "", 取消检查=None) -> tuple:
    """等待ComfyUI生成完成，返回 (成功, 历史条目或错误信息)
    取消检查: 可选的无参数函数，返回True表示用户已取消
    """
    开始 = time.time()
    while time.time() - 开始 < 超时:
        time.sleep(3)

        # 用户取消检查
        if 取消检查 and 取消检查():
            # 中断ComfyUI当前生成
            _API请求(地址, "/interrupt", "POST")
            return False, "用户已取消生成"

        耗时 = int(time.time() - 开始)

        if 进度回调:
            进度回调("生成进度", {
                "prompt_id": prompt_id, "已耗时秒": 耗时,
                "状态": "生成中...", "提示词": 提示词[:50]
            })

        成功, 历史 = _API请求(地址, f"/history/{prompt_id}")
        if 成功 and prompt_id in 历史:
            条目 = 历史[prompt_id]
            状态 = 条目.get("status", {})
            if isinstance(状态, dict) and 状态.get("status_str") == "error":
                return False, f"生成出错: {str(状态.get('messages', ''))[:200]}"
            return True, 条目

    return False, f"生成超时（{超时}秒），prompt_id: {prompt_id}"


def _加载工作流文件(工作流名: str) -> tuple:
    """模糊匹配并加载工作流，返回 (成功, 工作流dict或错误信息, 文件路径)"""
    匹配文件 = _查找工作流文件(工作流名)
    if not 匹配文件:
        return False, f"未找到匹配的工作流: {工作流名}（请用「ComfyUI列出工作流」查看可用列表）", None

    try:
        with open(匹配文件, "r", encoding="utf-8") as f:
            工作流 = json.load(f)
    except Exception as e:
        return False, f"读取工作流失败: {e}", None

    if not isinstance(工作流, dict) or not any(
        isinstance(v, dict) and "class_type" in v for v in 工作流.values()
    ):
        return False, (
            f"工作流 {os.path.basename(匹配文件)} 不是API格式，无法提交。"
            f"请在ComfyUI中点菜单→保存API格式，重新导出后覆盖此文件"
        ), None

    # 检查是否有节点缺少class_type（组节点未展开的常见问题）
    无类型节点 = []
    for nid, node in 工作流.items():
        if isinstance(node, dict) and "class_type" not in node:
            无类型节点.append(str(nid))
    if 无类型节点:
        return False, (
            f"工作流 {os.path.basename(匹配文件)} 中有节点缺少class_type: {', '.join(无类型节点)}。\n"
            f"这些可能是组节点(group node)，在导出API格式时未正确展开。\n"
            f"请在ComfyUI中右键组节点→ Ungroup，然后重新保存API格式导出。"
        ), None

    return True, 工作流, 匹配文件


def _提取模型名(工作流: dict) -> str:
    """从工作流中提取模型名（用于结果展示）"""
    for nid, node in 工作流.items():
        if not isinstance(node, dict):
            continue
        ct = node.get("class_type", "")
        if ct == "CheckpointLoaderSimple":
            return node.get("inputs", {}).get("ckpt_name", "")
        if ct == "UNETLoader":
            return node.get("inputs", {}).get("unet_name", "")
    return ""


class ComfyUI提交工作流(操作基类):
    """向ComfyUI提交工作流进行图片生成"""
    名称 = "ComfyUI提交工作流"
    描述 = "向ComfyUI提交工作流JSON执行图片生成，返回prompt_id用于追踪进度"
    参数结构 = {
        "工作流": {"类型": "字符串", "必填": True, "说明": "ComfyUI工作流JSON（必须是API格式），或工作流文件路径"},
        "等待完成": {"类型": "字符串", "必填": False, "说明": "是否等待生成完成：是 或 否，默认否（仅提交）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        工作流文本 = 参数.get("工作流", "")
        等待完成 = 参数.get("等待完成", "否") == "是"

        if not 工作流文本:
            return 操作结果.失败("未提供工作流")

        try:
            if os.path.exists(工作流文本):
                with open(工作流文本, "r", encoding="utf-8") as f:
                    工作流 = json.load(f)
            else:
                工作流 = json.loads(工作流文本)
        except json.JSONDecodeError as e:
            return 操作结果.失败(f"工作流JSON格式错误: {e}")

        地址 = _获取ComfyUI地址()
        client_id = str(uuid.uuid4())

        payload = {"prompt": 工作流, "client_id": client_id}
        成功, 结果 = _API请求(地址, "/prompt", "POST", payload)

        if not 成功:
            return 操作结果.失败(f"提交工作流失败: {结果}")

        prompt_id = 结果.get("prompt_id", "")
        node_errors = 结果.get("node_errors", {})

        if node_errors:
            错误摘要 = []
            for 节点id, 错误 in node_errors.items():
                类名 = 错误.get("class_type", "")
                错误列表 = 错误.get("errors", [])
                for e in 错误列表[:3]:
                    错误摘要.append(f"节点{节点id}({类名}): {e.get('message', '')}")
            return 操作结果.失败(f"工作流验证失败:\n" + "\n".join(错误摘要[:5]))

        if not prompt_id:
            return 操作结果.失败(
                f"ComfyUI返回了空的prompt_id，工作流可能未正确启动。\n"
                f"建议改用「ComfyUI一键生图」操作（传入工作流关键词+提示词），不要手动提交工作流JSON。\n"
                f"API返回: {str(结果)[:300]}"
            )

        if not 等待完成:
            return 操作结果.成功(
                f"✅ 工作流已提交！\nprompt_id: {prompt_id}\n用「ComfyUI查询进度」查看进度",
                元数据={"操作类型": "ComfyUI提交工作流", "prompt_id": prompt_id}
            )

        # 等待完成（复用共享轮询函数，支持取消检查）
        成功, 条目 = _等待完成(地址, prompt_id, 300, self.进度回调, "ComfyUI提交工作流", "", 取消检查=self.取消检查)
        if not 成功:
            return 操作结果.失败(条目)

        图片列表 = self._提取输出图片(条目)
        if 图片列表:
            return 操作结果.成功(
                f"✅ 生成完成！prompt_id: {prompt_id}\n"
                f"生成 {len(图片列表)} 张图片:\n" +
                "\n".join(f"  {i+1}. {p['文件名']} ({p.get('子目录','')})" for i, p in enumerate(图片列表)),
                元数据={"操作类型": "ComfyUI提交工作流", "prompt_id": prompt_id, "图片数": len(图片列表)}
            )
        return 操作结果.成功(f"✅ 执行完成（无图片输出），prompt_id: {prompt_id}",
            元数据={"操作类型": "ComfyUI提交工作流", "prompt_id": prompt_id})

    def _提取输出图片(self, 历史条目: dict) -> list:
        图片列表 = []
        outputs = 历史条目.get("outputs", {})
        for 节点id, 输出 in outputs.items():
            for img in 输出.get("images", []):
                图片列表.append({
                    "文件名": img.get("filename", ""),
                    "子目录": img.get("subfolder", ""),
                    "类型": img.get("type", "output")
                })
        return 图片列表


class ComfyUI启动(操作基类):
    """启动ComfyUI服务"""
    名称 = "ComfyUI启动"
    描述 = "启动ComfyUI服务并等待就绪。从系统配置读取安装路径，后台启动后自动检测连接"
    参数结构 = {
        "等待就绪": {"类型": "字符串", "必填": False, "说明": "是否等待ComfyUI启动完成：是 或 否，默认是（等待最多60秒）"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        地址 = _获取ComfyUI地址()
        等待 = 参数.get("等待就绪", "是") == "是"

        # 先检查是否已经在运行
        成功, _ = _API请求(地址, "/system_stats")
        if 成功:
            return 操作结果.成功(f"✅ ComfyUI已在运行（{地址}）",
                元数据={"操作类型": "ComfyUI启动", "地址": 地址, "已在运行": True})

        # 从系统配置读取安装路径
        安装路径 = ""
        try:
            from 操作注册中心 import 操作注册中心类
            实例 = 操作注册中心类._实例引用
            if 实例 and 实例._配置加载器:
                系统配置 = 实例._配置加载器.配置缓存.get("系统配置", {})
                安装路径 = 系统配置.get("ComfyUI安装路径", "")
        except Exception:
            pass

        if not 安装路径 or not os.path.exists(安装路径):
            return 操作结果.失败(
                f"ComfyUI安装路径未配置或不存在: {安装路径}\n"
                f"请在 系统配置.json 中设置 ComfyUI安装路径"
            )

        import subprocess
        import threading

        # 查找启动方式：优先 .venv/python.exe + main.py，其次 启动.bat
        venv_python = os.path.join(安装路径, ".venv", "python.exe")
        main_py = os.path.join(安装路径, "ComfyUI", "main.py")
        if not os.path.exists(main_py):
            main_py = os.path.join(安装路径, "main.py")
        bat_path = os.path.join(安装路径, "启动.bat")

        启动命令 = None
        工作目录 = 安装路径

        if os.path.exists(venv_python) and os.path.exists(main_py):
            启动命令 = [venv_python, main_py]
            工作目录 = os.path.dirname(main_py)
        elif os.path.exists(bat_path):
            启动命令 = ["cmd", "/c", bat_path]
        else:
            return 操作结果.失败(f"在 {安装路径} 中未找到ComfyUI启动文件")

        # 后台启动（不等待进程结束）
        try:
            proc = subprocess.Popen(
                启动命令,
                cwd=工作目录,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=0x00000008  # DETACHED_PROCESS
            )
        except Exception as e:
            return 操作结果.失败(f"启动ComfyUI失败: {e}")

        if not 等待:
            return 操作结果.成功(
                f"🚀 ComfyUI启动命令已执行（PID: {proc.pid}）\n等待几秒后可用「ComfyUI查询进度」检查状态",
                元数据={"操作类型": "ComfyUI启动", "地址": 地址, "PID": proc.pid}
            )

        # 等待就绪（最多60秒）
        超时 = 60
        开始 = time.time()
        while time.time() - 开始 < 超时:
            time.sleep(3)
            耗时 = int(time.time() - 开始)
            if self.进度回调:
                self.进度回调("启动进度", {"已耗时秒": 耗时, "状态": "等待ComfyUI启动..."})

            成功, _ = _API请求(地址, "/system_stats")
            if 成功:
                耗时 = int(time.time() - 开始)
                return 操作结果.成功(
                    f"✅ ComfyUI已启动！耗时 {耗时} 秒\n地址: http://{地址}\nPID: {proc.pid}",
                    元数据={"操作类型": "ComfyUI启动", "地址": 地址, "PID": proc.pid, "耗时秒": 耗时}
                )

        return 操作结果.失败(f"ComfyUI启动超时（{超时}秒），可能还在加载模型中。PID: {proc.pid}")


class ComfyUI查询进度(操作基类):
    """查询ComfyUI生成进度"""
    名称 = "ComfyUI查询进度"
    描述 = "查询ComfyUI当前生成进度，查看队列状态和最近生成历史"
    参数结构 = {
        "prompt_id": {"类型": "字符串", "必填": False, "说明": "要查询的任务ID，不填则查看整体队列状态"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        prompt_id = 参数.get("prompt_id", "")
        地址 = _获取ComfyUI地址()

        if prompt_id:
            成功, 历史 = _API请求(地址, f"/history/{prompt_id}")
            if not 成功:
                return 操作结果.失败(f"查询失败: {历史}")

            if not 历史 or prompt_id not in 历史:
                成功2, 队列 = _API请求(地址, "/queue")
                if 成功2:
                    运行中 = [q for q in 队列.get("queue_running", []) if len(q) > 1 and q[1] == prompt_id]
                    等待中 = [q for q in 队列.get("queue_pending", []) if len(q) > 1 and q[1] == prompt_id]
                    if 运行中:
                        return 操作结果.成功(f"🔄 任务 {prompt_id} 正在执行中...")
                    if 等待中:
                        位置 = 等待中.index(等待中[0]) + 1
                        return 操作结果.成功(f"⏳ 任务 {prompt_id} 等待中（队列第{位置}位）")
                return 操作结果.失败(f"未找到任务 {prompt_id}")

            条目 = 历史[prompt_id]
            状态 = 条目.get("status", {})
            状态文本 = 状态.get("status_str", "未知") if isinstance(状态, dict) else str(状态)

            图片列表 = []
            for 节点id, 输出 in 条目.get("outputs", {}).items():
                for img in 输出.get("images", []):
                    图片列表.append(img.get("filename", ""))

            结果文本 = f"📊 任务 {prompt_id}\n状态: {状态文本}\n"
            if 图片列表:
                结果文本 += f"输出图片: {', '.join(图片列表)}"
            return 操作结果.成功(结果文本, 元数据={"操作类型": "ComfyUI查询进度", "prompt_id": prompt_id, "状态": 状态文本})
        else:
            成功, 队列 = _API请求(地址, "/queue")
            if not 成功:
                return 操作结果.失败(f"查询失败: {队列}")

            运行中 = 队列.get("queue_running", [])
            等待中 = 队列.get("queue_pending", [])

            结果 = "📊 ComfyUI 队列状态\n"
            结果 += "━━━━━━━━━━━━━━━\n"
            结果 += f"🔄 正在执行: {len(运行中)} 个\n"
            for q in 运行中[:5]:
                pid = q[1] if len(q) > 1 else "?"
                结果 += f"  - {pid}\n"
            结果 += f"⏳ 等待中: {len(等待中)} 个\n"
            for q in 等待中[:5]:
                pid = q[1] if len(q) > 1 else "?"
                结果 += f"  - {pid}\n"

            return 操作结果.成功(结果, 元数据={"操作类型": "ComfyUI查询进度", "运行中": len(运行中), "等待中": len(等待中)})


class ComfyUI获取图片(操作基类):
    """获取ComfyUI生成的图片并保存到本地"""
    名称 = "ComfyUI获取图片"
    描述 = "从ComfyUI获取指定任务生成的图片并保存到本地"
    参数结构 = {
        "prompt_id": {"类型": "字符串", "必填": True, "说明": "生成任务的ID"},
        "保存目录": {"类型": "字符串", "必填": False, "说明": "图片保存目录，不填则保存到当前打开的文件夹"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        prompt_id = 参数.get("prompt_id", "")
        保存目录 = 参数.get("保存目录", "")

        if not prompt_id:
            return 操作结果.失败("未指定prompt_id")

        地址 = _获取ComfyUI地址()

        成功, 历史 = _API请求(地址, f"/history/{prompt_id}")
        if not 成功:
            return 操作结果.失败(f"获取历史失败: {历史}")

        if prompt_id not in 历史:
            return 操作结果.失败(f"未找到任务 {prompt_id}，可能还在执行中")

        图片列表 = []
        条目 = 历史[prompt_id]
        for 节点id, 输出 in 条目.get("outputs", {}).items():
            for img in 输出.get("images", []):
                图片列表.append(img)

        if not 图片列表:
            return 操作结果.失败(f"任务 {prompt_id} 没有生成图片")

        if not 保存目录:
            保存目录 = getattr(self, '当前工作目录', None) or os.path.join(os.path.expanduser("~"), "Desktop")
        os.makedirs(保存目录, exist_ok=True)

        下载成功 = []
        for img in 图片列表:
            文件名 = img.get("filename", "")
            子目录 = img.get("subfolder", "")
            类型 = img.get("type", "output")
            if not 文件名:
                continue

            参数字典 = {"filename": 文件名, "type": 类型}
            if 子目录:
                参数字典["subfolder"] = 子目录

            url = f"http://{地址}/view?{urllib.parse.urlencode(参数字典)}"
            try:
                保存路径 = os.path.join(保存目录, 文件名)
                urllib.request.urlretrieve(url, 保存路径)
                下载成功.append(保存路径)
            except Exception:
                pass

        if not 下载成功:
            return 操作结果.失败("下载图片失败")

        结果 = f"✅ 已下载 {len(下载成功)} 张图片到: {保存目录}\n"
        结果 += "\n".join(f"  {i+1}. {os.path.basename(p)}" for i, p in enumerate(下载成功))
        return 操作结果.成功(结果, 元数据={
            "操作类型": "ComfyUI获取图片", "prompt_id": prompt_id,
            "图片数": len(下载成功), "保存目录": 保存目录
        })


class ComfyUI列出模型(操作基类):
    """列出ComfyUI中可用的模型"""
    名称 = "ComfyUI列出模型"
    描述 = "列出ComfyUI中可用的模型（checkpoint、lora、vae等）"
    参数结构 = {
        "类型": {"类型": "字符串", "必填": False, "说明": "模型类型：checkpoints(大模型)、loras、vae、controlnet、clip、embeddings、upscale_models，不填则列出所有类型"},
        "搜索": {"类型": "字符串", "必填": False, "说明": "按名称筛选关键词"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        模型类型 = 参数.get("类型", "")
        搜索关键词 = 参数.get("搜索", "").lower()
        地址 = _获取ComfyUI地址()

        if 模型类型:
            成功, 数据 = _API请求(地址, "/object_info")
            if not 成功:
                return 操作结果.失败(f"查询失败: {数据}")

            类型映射 = {
                "checkpoints": ["CheckpointLoaderSimple", "CheckpointLoader"],
                "loras": ["LoraLoader", "LoraLoaderOnly"],
                "vae": ["VAELoader"],
                "controlnet": ["ControlNetLoader"],
                "clip": ["CLIPLoader", "DualCLIPLoader"],
                "embeddings": [],
                "upscale_models": ["UpscaleModelLoader"],
            }

            节点名列表 = 类型映射.get(模型类型, [])
            if not 节点名列表:
                成功2, 模型列表 = _API请求(地址, f"/models/{模型类型}")
                if 成功2:
                    return self._格式化模型列表(模型类型, 模型列表, 搜索关键词)
                return 操作结果.失败(f"不支持的模型类型: {模型类型}\n可用: checkpoints, loras, vae, controlnet, clip, upscale_models")

            所有模型 = []
            for 节点名 in 节点名列表:
                if 节点名 in 数据:
                    节点信息 = 数据[节点名]
                    for 输入名, 输入定义 in 节点信息.get("input", {}).get("required", {}).items():
                        if isinstance(输入定义, list) and len(输入定义) > 0 and isinstance(输入定义[0], list):
                            所有模型.extend(输入定义[0])

            所有模型 = sorted(set(所有模型))
            if 搜索关键词:
                所有模型 = [m for m in 所有模型 if 搜索关键词 in m.lower()]

            return self._格式化模型列表(模型类型, 所有模型, 搜索关键词)
        else:
            成功, 数据 = _API请求(地址, "/object_info")
            if not 成功:
                return 操作结果.失败(f"查询失败: {数据}")

            结果 = "📋 ComfyUI 可用节点/模型概览\n"
            结果 += "━━━━━━━━━━━━━━━\n"
            结果 += f"已注册节点类: {len(数据)} 个\n\n"

            类型概览 = {
                "模型加载": ["CheckpointLoaderSimple", "LoraLoader", "VAELoader", "ControlNetLoader"],
                "采样器": ["KSampler", "KSamplerAdvanced"],
                "提示词": ["CLIPTextEncode", "CLIPSetLastLayer"],
                "图片保存": ["SaveImage", "PreviewImage"],
                "图片加载": ["LoadImage", "LoadImageMask"],
                "潜空间": ["EmptyLatentImage", "VAEDecode", "VAEEncode"],
            }

            for 分类, 节点列表 in 类型概览.items():
                可用 = [n for n in 节点列表 if n in 数据]
                if 可用:
                    结果 += f"  {分类}: {', '.join(可用)}\n"

            return 操作结果.成功(结果, 元数据={"操作类型": "ComfyUI列出模型", "节点数": len(数据)})

    def _格式化模型列表(self, 类型: str, 模型列表: list, 搜索: str) -> 操作结果:
        if not 模型列表:
            return 操作结果.成功(f"没有找到{类型}模型" + (f"（搜索: {搜索}）" if 搜索 else ""))

        结果 = f"📦 ComfyUI {类型}模型（{len(模型列表)}个）\n"
        结果 += "━━━━━━━━━━━━━━━\n"
        for i, m in enumerate(模型列表[:30]):
            结果 += f"  {i+1}. {m}\n"
        if len(模型列表) > 30:
            结果 += f"  ... 还有 {len(模型列表) - 30} 个\n"

        return 操作结果.成功(结果, 元数据={"操作类型": "ComfyUI列出模型", "类型": 类型, "数量": len(模型列表)})


class ComfyUI队列控制(操作基类):
    """控制ComfyUI队列：中断、清空"""
    名称 = "ComfyUI队列控制"
    描述 = "中断当前生成任务或清空等待队列"
    参数结构 = {
        "操作": {"类型": "字符串", "必填": True, "说明": "操作类型：中断(停止当前生成)、清空队列(清空等待列表)、清空历史(清除生成历史)"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        操作 = 参数.get("操作", "")
        地址 = _获取ComfyUI地址()

        if 操作 == "中断":
            成功, 结果 = _API请求(地址, "/interrupt", "POST")
            if 成功:
                return 操作结果.成功("✅ 已发送中断信号，当前生成将被停止",
                    元数据={"操作类型": "ComfyUI队列控制", "操作": "中断"})
            return 操作结果.失败(f"中断失败: {结果}")

        elif 操作 == "清空队列":
            成功, 结果 = _API请求(地址, "/queue", "POST", {"delete": {"clear": True}})
            if 成功:
                return 操作结果.成功("✅ 等待队列已清空",
                    元数据={"操作类型": "ComfyUI队列控制", "操作": "清空队列"})
            return 操作结果.失败(f"清空队列失败: {结果}")

        elif 操作 == "清空历史":
            成功, 结果 = _API请求(地址, "/history", "POST", {"clear": True})
            if 成功:
                return 操作结果.成功("✅ 生成历史已清空",
                    元数据={"操作类型": "ComfyUI队列控制", "操作": "清空历史"})
            return 操作结果.失败(f"清空历史失败: {结果}")

        else:
            return 操作结果.失败(f"不支持的操作: {操作}，请使用：中断、清空队列、清空历史")


class ComfyUI一键生图(操作基类):
    """一键文生图，可指定工作流或使用内置模板"""
    名称 = "ComfyUI一键生图"
    描述 = "一键文生图。指定工作流时自动注入提示词并提交；不指定则使用内置标准模板。建议先用「ComfyUI列出工作流」查看可用工作流"
    参数结构 = {
        "提示词": {"类型": "字符串", "必填": True, "说明": "正面提示词，描述你想生成的画面"},
        "工作流": {"类型": "字符串", "必填": False, "说明": "工作流文件名关键词（支持模糊匹配，如'qwen2512文生图'），需为API格式。不填则使用内置标准文生图模板"},
        "负面提示词": {"类型": "字符串", "必填": False, "说明": "负面提示词，描述不想出现的内容，默认: low quality, bad anatomy"},
        "模型": {"类型": "字符串", "必填": False, "说明": "大模型名称（checkpoint），不填则自动使用第一个可用模型（仅内置模板生效）"},
        "宽度": {"类型": "整数", "必填": False, "说明": "图片宽度，默认512（仅内置模板生效）"},
        "高度": {"类型": "整数", "必填": False, "说明": "图片高度，默认512（仅内置模板生效）"},
        "步数": {"类型": "整数", "必填": False, "说明": "采样步数，默认20（仅内置模板生效）"},
        "CFG": {"类型": "数字", "必填": False, "说明": "CFG引导强度，默认7.0（仅内置模板生效）"},
        "种子": {"类型": "整数", "必填": False, "说明": "随机种子，-1为随机，默认随机"},
        "保存目录": {"类型": "字符串", "必填": False, "说明": "图片保存目录，不填则保存到当前打开的文件夹"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        提示词 = 参数.get("提示词", "")
        工作流名 = 参数.get("工作流", "").strip()
        负面提示词 = 参数.get("负面提示词", "low quality, bad anatomy, ugly, blurry")
        模型 = 参数.get("模型", "")
        宽度 = int(参数.get("宽度", 512))
        高度 = int(参数.get("高度", 512))
        步数 = int(参数.get("步数", 20))
        cfg = float(参数.get("CFG", 7.0))
        种子 = 参数.get("种子", -1)
        保存目录 = 参数.get("保存目录", "")

        if not 提示词:
            return 操作结果.失败("请输入提示词")

        地址 = _获取ComfyUI地址()

        import random
        if 种子 == -1:
            种子 = random.randint(0, 2**32 - 1)

        if 工作流名:
            # === 使用指定工作流（带缓存） ===
            成功, 结果, 匹配文件 = _加载工作流文件(工作流名)
            if not 成功:
                return 操作结果.失败(结果)
            工作流 = 结果

            # 注入种子
            _注入种子(工作流, 种子)

            # 注入提示词
            _注入提示词通用(工作流, 提示词, 负面提示词)

            # 从工作流中提取模型名（用于结果展示）
            模型 = _提取模型名(工作流) or 模型

        else:
            # === 使用内置标准文生图模板 ===
            # 如果没指定模型，自动获取第一个可用模型
            if not 模型:
                成功, 数据 = _API请求(地址, "/object_info")
                if 成功 and "CheckpointLoaderSimple" in 数据:
                    模型列表 = 数据["CheckpointLoaderSimple"].get("input", {}).get("required", {})
                    for 键, 值 in 模型列表.items():
                        if isinstance(值, list) and len(值) > 0 and isinstance(值[0], list) and 值[0]:
                            模型 = 值[0][0]
                            break
                if not 模型:
                    return 操作结果.失败("未指定模型且无法自动获取，请用「ComfyUI列出模型」查看可用模型")

            # 构建标准文生图工作流
            工作流 = {
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": 种子, "steps": 步数, "cfg": cfg,
                    "sampler_name": "euler", "scheduler": "normal", "denoise": 1.0,
                    "model": ["4", 0], "positive": ["6", 0],
                    "negative": ["7", 0], "latent_image": ["5", 0]
                }
            },
            "4": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {"ckpt_name": 模型}
            },
            "5": {
                "class_type": "EmptyLatentImage",
                "inputs": {"width": 宽度, "height": 高度, "batch_size": 1}
            },
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": 提示词, "clip": ["4", 1]}
            },
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {"text": 负面提示词, "clip": ["4", 1]}
            },
            "8": {
                "class_type": "VAEDecode",
                "inputs": {"samples": ["3", 0], "vae": ["4", 2]}
            },
            "9": {
                "class_type": "SaveImage",
                "inputs": {"filename_prefix": "zf3d", "images": ["8", 0]}
            }
        }

        client_id = str(uuid.uuid4())
        payload = {"prompt": 工作流, "client_id": client_id}

        成功, 结果 = _API请求(地址, "/prompt", "POST", payload)
        if not 成功:
            return 操作结果.失败(f"提交失败: {结果}")

        prompt_id = 结果.get("prompt_id", "")
        node_errors = 结果.get("node_errors", {})

        if node_errors:
            错误摘要 = []
            for nid, err in node_errors.items():
                for e in err.get("errors", [])[:2]:
                    错误摘要.append(f"节点{nid}: {e.get('message', '')}")
            return 操作结果.失败(f"工作流验证失败:\n" + "\n".join(错误摘要))

        if not prompt_id:
            return 操作结果.失败(f"ComfyUI返回了空的prompt_id，工作流可能未正确启动。API返回: {str(结果)[:300]}")

        # 等待完成
        开始 = time.time()
        成功, 条目 = _等待完成(地址, prompt_id, 300, self.进度回调, "ComfyUI一键生图", 提示词, 取消检查=self.取消检查)
        if not 成功:
            return 操作结果.失败(条目)

        耗时 = int(time.time() - 开始)

        # 下载图片
        if not 保存目录:
            保存目录 = getattr(self, '当前工作目录', None) or os.path.join(os.path.expanduser("~"), "Desktop")
        os.makedirs(保存目录, exist_ok=True)

        输出 = _提取所有输出(条目, 保存目录, 地址)

        if not 输出["图片"] and not 输出["视频"]:
            return 操作结果.成功(f"✅ 生成完成（无图片输出），prompt_id: {prompt_id}",
                元数据={"操作类型": "ComfyUI一键生图", "prompt_id": prompt_id})

        结果文本 = (
            f"✅ 生成完成！耗时 {耗时} 秒\n"
            f"种子: {种子} | 模型: {模型}\n"
            f"提示词: {提示词[:60]}{'...' if len(提示词) > 60 else ''}\n"
        )
        if 输出["图片"]:
            结果文本 += f"保存 {len(输出['图片'])} 张图片到: {保存目录}\n"
            for i, p in enumerate(输出["图片"]):
                结果文本 += f"  {i+1}. {os.path.basename(p)}\n"
        if 输出["视频"]:
            结果文本 += f"保存 {len(输出['视频'])} 个视频到: {保存目录}\n"
            for i, p in enumerate(输出["视频"]):
                结果文本 += f"  {i+1}. {os.path.basename(p)}\n"

        return 操作结果.成功(结果文本, 元数据={
            "操作类型": "ComfyUI一键生图", "prompt_id": prompt_id,
            "种子": 种子, "模型": 模型, "耗时秒": 耗时,
            "图片数": len(输出["图片"]), "保存目录": 保存目录
        })


class ComfyUI图片修改(操作基类):
    """图片修改/图生图/多图编辑/图片放大"""
    名称 = "ComfyUI图片修改"
    描述 = "图片修改/图生图/多图编辑/图片放大。上传图片+注入提示词，支持单图/多图工作流。常用工作流: qwen2511单图、qwen2511双图、flux2_单图、2k_upscaler、qwen2512_控制"
    参数结构 = {
        "工作流": {"类型": "字符串", "必填": True, "说明": "工作流关键词，如'qwen2511单图'/'qwen2511双图'/'flux2_单图'/'2k_upscaler'/'qwen2512_控制'"},
        "提示词": {"类型": "字符串", "必填": False, "说明": "修改指令，如'把背景换成海边'。图片放大工作流可不填"},
        "图片路径": {"类型": "字符串", "必填": True, "说明": "要修改的图片路径。多图用逗号分隔，如'a.png,b.jpg'"},
        "种子": {"类型": "整数", "必填": False, "说明": "随机种子，-1为随机，默认随机"},
        "保存目录": {"类型": "字符串", "必填": False, "说明": "结果保存目录，不填则保存到当前打开的文件夹"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        工作流名 = 参数.get("工作流", "").strip()
        提示词 = 参数.get("提示词", "")
        图片路径文本 = 参数.get("图片路径", "")
        种子 = 参数.get("种子", -1)
        保存目录 = 参数.get("保存目录", "")

        if not 工作流名:
            return 操作结果.失败("请指定工作流")
        if not 图片路径文本:
            return 操作结果.失败("请提供图片路径")

        图片路径列表 = [p.strip() for p in 图片路径文本.split(",") if p.strip()]
        # 尝试相对于当前工作目录解析路径
        工作目录 = getattr(self, '当前工作目录', None)
        if 工作目录:
            for i, p in enumerate(图片路径列表):
                if not os.path.exists(p) and not os.path.isabs(p):
                    候选 = os.path.join(工作目录, p)
                    if os.path.exists(候选):
                        图片路径列表[i] = 候选
        # 不存在本地的路径视为已上传到ComfyUI的文件名，由_上传并注入图片处理

        地址 = _获取ComfyUI地址()

        import random
        if 种子 == -1:
            种子 = random.randint(0, 2**32 - 1)

        # 加载工作流
        成功, 结果, 匹配文件 = _加载工作流文件(工作流名)
        if not 成功:
            return 操作结果.失败(结果)
        工作流 = 结果

        # 上传图片并注入LoadImage节点
        上传列表 = _上传并注入图片(工作流, 图片路径列表, 地址)
        if not 上传列表:
            return 操作结果.失败("图片上传失败，请检查ComfyUI是否运行")

        # 注入种子
        _注入种子(工作流, 种子)

        # 注入提示词（放大工作流可能没有提示词输入，不强制）
        if 提示词:
            _注入提示词通用(工作流, 提示词)

        模型名 = _提取模型名(工作流)

        # 提交
        client_id = str(uuid.uuid4())
        payload = {"prompt": 工作流, "client_id": client_id}
        成功, 结果 = _API请求(地址, "/prompt", "POST", payload)
        if not 成功:
            return 操作结果.失败(f"提交失败: {结果}")

        prompt_id = 结果.get("prompt_id", "")
        node_errors = 结果.get("node_errors", {})
        if node_errors:
            错误摘要 = []
            for nid, err in node_errors.items():
                for e in err.get("errors", [])[:2]:
                    错误摘要.append(f"节点{nid}: {e.get('message', '')}")
            return 操作结果.失败(f"工作流验证失败:\n" + "\n".join(错误摘要))

        if not prompt_id:
            return 操作结果.失败(f"ComfyUI返回了空的prompt_id，工作流可能未正确启动。API返回: {str(结果)[:300]}")

        # 等待完成
        开始 = time.time()
        成功, 条目 = _等待完成(地址, prompt_id, 300, self.进度回调, "ComfyUI图片修改", 提示词, 取消检查=self.取消检查)
        if not 成功:
            return 操作结果.失败(条目)

        耗时 = int(time.time() - 开始)

        if not 保存目录:
            保存目录 = getattr(self, '当前工作目录', None) or os.path.join(os.path.expanduser("~"), "Desktop")
        os.makedirs(保存目录, exist_ok=True)

        输出 = _提取所有输出(条目, 保存目录, 地址)

        if not 输出["图片"]:
            return 操作结果.成功(f"✅ 执行完成（无图片输出），prompt_id: {prompt_id}",
                元数据={"操作类型": "ComfyUI图片修改", "prompt_id": prompt_id})

        结果文本 = f"✅ 图片修改完成！耗时 {耗时} 秒\n"
        if 提示词:
            结果文本 += f"指令: {提示词[:60]}{'...' if len(提示词) > 60 else ''}\n"
        if 模型名:
            结果文本 += f"模型: {模型名}\n"
        结果文本 += f"上传图片: {len(上传列表)} 张 | 种子: {种子}\n"
        结果文本 += f"保存 {len(输出['图片'])} 张图片到: {保存目录}\n"
        for i, p in enumerate(输出["图片"]):
            结果文本 += f"  {i+1}. {os.path.basename(p)}\n"

        return 操作结果.成功(结果文本, 元数据={
            "操作类型": "ComfyUI图片修改", "prompt_id": prompt_id,
            "种子": 种子, "耗时秒": 耗时,
            "图片数": len(输出["图片"]), "保存目录": 保存目录
        })


class ComfyUI视频生成(操作基类):
    """文生视频/图生视频"""
    名称 = "ComfyUI视频生成"
    描述 = "文生视频或图生视频。指定工作流自动注入提示词和图片。常用工作流: wan2.2文生视频、wan2.2图生视频、ltx2.3_图生视频"
    参数结构 = {
        "提示词": {"类型": "字符串", "必填": True, "说明": "视频内容描述提示词"},
        "工作流": {"类型": "字符串", "必填": True, "说明": "工作流关键词，如'wan2.2文生视频'/'wan2.2图生视频'/'ltx2.3_图生视频'"},
        "图片路径": {"类型": "字符串", "必填": False, "说明": "图生视频时提供参考图片路径。文生视频不填"},
        "种子": {"类型": "整数", "必填": False, "说明": "随机种子，-1为随机，默认随机"},
        "保存目录": {"类型": "字符串", "必填": False, "说明": "视频保存目录，不填则保存到当前打开的文件夹"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        提示词 = 参数.get("提示词", "")
        工作流名 = 参数.get("工作流", "").strip()
        图片路径 = 参数.get("图片路径", "").strip()
        种子 = 参数.get("种子", -1)
        保存目录 = 参数.get("保存目录", "")

        if not 提示词:
            return 操作结果.失败("请输入提示词")
        if not 工作流名:
            return 操作结果.失败("请指定工作流")

        地址 = _获取ComfyUI地址()

        import random
        if 种子 == -1:
            种子 = random.randint(0, 2**32 - 1)

        # 加载工作流
        成功, 结果, 匹配文件 = _加载工作流文件(工作流名)
        if not 成功:
            return 操作结果.失败(结果)
        工作流 = 结果

        # 图生视频：上传并注入图片
        if 图片路径:
            # 尝试相对于当前工作目录解析路径
            if not os.path.exists(图片路径) and not os.path.isabs(图片路径):
                工作目录 = getattr(self, '当前工作目录', None)
                if 工作目录:
                    候选路径 = os.path.join(工作目录, 图片路径)
                    if os.path.exists(候选路径):
                        图片路径 = 候选路径
            # 不存在本地则视为已上传到ComfyUI的文件名
            上传列表 = _上传并注入图片(工作流, [图片路径], 地址)
            if not 上传列表:
                return 操作结果.失败("图片上传或引用失败")

        # 注入种子
        _注入种子(工作流, 种子)

        # 注入提示词
        _注入提示词通用(工作流, 提示词)

        模型名 = _提取模型名(工作流)

        # 提交
        client_id = str(uuid.uuid4())
        payload = {"prompt": 工作流, "client_id": client_id}
        成功, 结果 = _API请求(地址, "/prompt", "POST", payload)
        if not 成功:
            return 操作结果.失败(f"提交失败: {结果}")

        prompt_id = 结果.get("prompt_id", "")
        node_errors = 结果.get("node_errors", {})
        if node_errors:
            错误摘要 = []
            for nid, err in node_errors.items():
                for e in err.get("errors", [])[:2]:
                    错误摘要.append(f"节点{nid}: {e.get('message', '')}")
            return 操作结果.失败(f"工作流验证失败:\n" + "\n".join(错误摘要))

        if not prompt_id:
            return 操作结果.失败(f"ComfyUI返回了空的prompt_id，工作流可能未正确启动。API返回: {str(结果)[:300]}")

        # 等待完成（视频生成更慢，超时600秒）
        开始 = time.time()
        成功, 条目 = _等待完成(地址, prompt_id, 600, self.进度回调, "ComfyUI视频生成", 提示词, 取消检查=self.取消检查)
        if not 成功:
            return 操作结果.失败(条目)

        耗时 = int(time.time() - 开始)

        if not 保存目录:
            保存目录 = getattr(self, '当前工作目录', None) or os.path.join(os.path.expanduser("~"), "Desktop")
        os.makedirs(保存目录, exist_ok=True)

        输出 = _提取所有输出(条目, 保存目录, 地址)

        if not 输出["视频"] and not 输出["图片"]:
            return 操作结果.成功(f"✅ 执行完成（无视频输出），prompt_id: {prompt_id}",
                元数据={"操作类型": "ComfyUI视频生成", "prompt_id": prompt_id})

        结果文本 = f"✅ 视频生成完成！耗时 {耗时} 秒\n"
        结果文本 += f"提示词: {提示词[:60]}{'...' if len(提示词) > 60 else ''}\n"
        if 图片路径:
            结果文本 += f"参考图: {os.path.basename(图片路径)}\n"
        if 模型名:
            结果文本 += f"模型: {模型名}\n"
        结果文本 += f"种子: {种子}\n"
        if 输出["视频"]:
            结果文本 += f"保存 {len(输出['视频'])} 个视频到: {保存目录}\n"
            for i, p in enumerate(输出["视频"]):
                结果文本 += f"  {i+1}. {os.path.basename(p)}\n"
        if 输出["图片"]:
            结果文本 += f"额外输出 {len(输出['图片'])} 张图片\n"

        return 操作结果.成功(结果文本, 元数据={
            "操作类型": "ComfyUI视频生成", "prompt_id": prompt_id,
            "种子": 种子, "耗时秒": 耗时,
            "视频数": len(输出["视频"]), "保存目录": 保存目录
        })


class ComfyUI反推(操作基类):
    """图片/视频反推提示词"""
    名称 = "ComfyUI反推"
    描述 = "图片/视频反推提示词。上传图片或视频，AI分析后返回文字描述。默认使用'图片视频反推'工作流"
    参数结构 = {
        "文件路径": {"类型": "字符串", "必填": True, "说明": "要反推的图片或视频路径"},
        "工作流": {"类型": "字符串", "必填": False, "说明": "工作流关键词，默认'图片视频反推'"},
    }

    def 执行(self, 参数: dict) -> 操作结果:
        文件路径 = 参数.get("文件路径", "").strip()
        工作流名 = 参数.get("工作流", "图片视频反推").strip()

        if not 文件路径:
            return 操作结果.失败("请提供文件路径")
        # 尝试相对于当前工作目录解析路径
        if not os.path.exists(文件路径) and not os.path.isabs(文件路径):
            工作目录 = getattr(self, '当前工作目录', None)
            if 工作目录:
                候选路径 = os.path.join(工作目录, 文件路径)
                if os.path.exists(候选路径):
                    文件路径 = 候选路径
        # 不存在本地则视为已上传到ComfyUI的文件名，由_上传并注入图片处理

        地址 = _获取ComfyUI地址()

        # 加载工作流
        成功, 结果, 匹配文件 = _加载工作流文件(工作流名)
        if not 成功:
            return 操作结果.失败(结果)
        工作流 = 结果

        # 上传文件并注入LoadImage/LoadVideo节点
        上传列表 = _上传并注入图片(工作流, [文件路径], 地址)
        if not 上传列表:
            return 操作结果.失败("文件上传失败，请检查ComfyUI是否运行")

        # 提交
        client_id = str(uuid.uuid4())
        payload = {"prompt": 工作流, "client_id": client_id}
        成功, 结果 = _API请求(地址, "/prompt", "POST", payload)
        if not 成功:
            return 操作结果.失败(f"提交失败: {结果}")

        prompt_id = 结果.get("prompt_id", "")
        node_errors = 结果.get("node_errors", {})
        if node_errors:
            错误摘要 = []
            for nid, err in node_errors.items():
                for e in err.get("errors", [])[:2]:
                    错误摘要.append(f"节点{nid}: {e.get('message', '')}")
            return 操作结果.失败(f"工作流验证失败:\n" + "\n".join(错误摘要))

        if not prompt_id:
            return 操作结果.失败(f"ComfyUI返回了空的prompt_id，工作流可能未正确启动。API返回: {str(结果)[:300]}")

        # 等待完成
        开始 = time.time()
        成功, 条目 = _等待完成(地址, prompt_id, 300, self.进度回调, "ComfyUI反推", "", 取消检查=self.取消检查)
        if not 成功:
            return 操作结果.失败(条目)

        耗时 = int(time.time() - 开始)

        # 提取文本输出
        输出 = _提取所有输出(条目, "", 地址)

        if 输出["文本"]:
            return 操作结果.成功(
                f"✅ 反推完成！耗时 {耗时} 秒\n\n{输出['文本']}",
                元数据={"操作类型": "ComfyUI反推", "prompt_id": prompt_id, "耗时秒": 耗时}
            )

        # 没有文本输出，可能有图片输出（部分反推工作流会输出标注图）
        if 输出["图片"]:
            保存目录 = getattr(self, '当前工作目录', None) or os.path.join(os.path.expanduser("~"), "Desktop")
            return 操作结果.成功(
                f"✅ 反推完成（输出了 {len(输出['图片'])} 张图片），但未获取到文本描述\n耗时 {耗时} 秒",
                元数据={"操作类型": "ComfyUI反推", "prompt_id": prompt_id, "耗时秒": 耗时, "图片数": len(输出["图片"])}
            )

        return 操作结果.成功(f"✅ 执行完成（无文本输出），prompt_id: {prompt_id}",
            元数据={"操作类型": "ComfyUI反推", "prompt_id": prompt_id, "耗时秒": 耗时})


class ComfyUI上传图片(操作基类):
    """上传图片到ComfyUI的input目录"""
    名称 = "ComfyUI上传图片"
    描述 = "上传本地图片到ComfyUI的input目录，用于图生图等需要输入图片的工作流"
    参数结构 = {
        "图片路径": {"类型": "字符串", "必填": True, "说明": "要上传的图片文件路径"},
        "子目录": {"类型": "字符串", "必填": False, "说明": "上传到的子目录（可选）"},
        "覆盖": {"类型": "字符串", "必填": False, "说明": "是否覆盖同名文件：是 或 否，默认否"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        图片路径 = 参数.get("图片路径", "")
        子目录 = 参数.get("子目录", "")
        覆盖 = 参数.get("覆盖", "否") == "是"

        if not 图片路径:
            return 操作结果.失败("未指定图片路径")

        if not os.path.exists(图片路径):
            return 操作结果.失败(f"图片文件不存在: {图片路径}")

        地址 = _获取ComfyUI地址()

        try:
            文件名 = os.path.basename(图片路径)
            boundary = f"----WebKitFormBoundary{uuid.uuid4().hex[:16]}"

            with open(图片路径, "rb") as f:
                图片数据 = f.read()

            body = f"--{boundary}\r\n".encode()
            body += f'Content-Disposition: form-data; name="image"; filename="{文件名}"\r\n'.encode()
            body += b"Content-Type: application/octet-stream\r\n\r\n"
            body += 图片数据
            body += f"\r\n--{boundary}\r\n".encode()
            body += b'Content-Disposition: form-data; name="type"\r\n\r\ninput\r\n'
            body += f"--{boundary}\r\n".encode()
            body += f'Content-Disposition: form-data; name="overwrite"\r\n\r\n{"true" if 覆盖 else "false"}\r\n'.encode()
            if 子目录:
                body += f"--{boundary}\r\n".encode()
                body += f'Content-Disposition: form-data; name="subfolder"\r\n\r\n{子目录}\r\n'.encode()
            body += f"--{boundary}--\r\n".encode()

            url = f"http://{地址}/upload/image"
            req = urllib.request.Request(url, data=body, method="POST",
                                         headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})

            with urllib.request.urlopen(req, timeout=30) as resp:
                结果 = json.loads(resp.read().decode("utf-8"))

            上传名 = 结果.get("name", 文件名)
            上传子目录 = 结果.get("subfolder", 子目录)
            引用名 = f"{上传子目录}/{上传名}" if 上传子目录 else 上传名

            return 操作结果.成功(
                f"✅ 图片已上传！\n文件名: {上传名}\n子目录: {上传子目录}\n工作流中引用: \"{引用名}\"",
                元数据={"操作类型": "ComfyUI上传图片", "文件名": 上传名, "引用名": 引用名}
            )

        except Exception as e:
            return 操作结果.失败(f"上传图片失败: {e}")


class ComfyUI列出工作流(操作基类):
    """列出ComfyUI保存的工作流模板"""
    名称 = "ComfyUI列出工作流"
    描述 = "列出ComfyUI保存的工作流模板（含子目录分类），可选按关键词搜索"
    参数结构 = {
        "分类": {"类型": "字符串", "必填": False, "说明": "只列出指定分类（如：01常用、03视频），不填则列出所有"},
        "搜索": {"类型": "字符串", "必填": False, "说明": "按名称筛选关键词"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        分类筛选 = 参数.get("分类", "").strip()
        搜索关键词 = 参数.get("搜索", "").strip().lower()

        工作流目录 = _获取工作流目录()
        if not os.path.exists(工作流目录):
            return 操作结果.失败(f"工作流目录不存在: {工作流目录}")

        结果列表 = []
        # 递归扫描所有子目录
        for 根, _, 文件列表 in os.walk(工作流目录):
            # 计算相对分类名
            相对路径 = os.path.relpath(根, 工作流目录)
            if 相对路径 == ".":
                分类 = "(根目录)"
            else:
                分类 = 相对路径.replace(os.sep, "/")

            # 分类筛选
            if 分类筛选 and 分类筛选 not in 分类:
                continue

            for 文件名 in sorted(文件列表):
                if not 文件名.endswith(".json"):
                    continue
                if 搜索关键词 and 搜索关键词 not in 文件名.lower():
                    continue
                结果列表.append({
                    "分类": 分类,
                    "文件名": 文件名,
                    "路径": os.path.join(根, 文件名)
                })

        if not 结果列表:
            return 操作结果.成功("没有找到匹配的工作流" + (f"（搜索: {搜索关键词}）" if 搜索关键词 else ""))

        # 预热路径缓存：只缓存API格式文件，避免UI格式文件干扰匹配
        for item in 结果列表:
            路径 = item["路径"]
            if not _是否API格式(路径):
                continue
            文件名小写 = item["文件名"].lower()
            # 用完整文件名（去后缀）作为缓存key
            缓存键 = os.path.splitext(文件名小写)[0]
            if 缓存键 not in _工作流路径缓存:
                _工作流路径缓存[缓存键] = 路径
            # 同时缓存去掉 _api 后缀的短名（如 "常用_图片z_image文生图" → api文件）
            if "_api" in 缓存键:
                短键 = 缓存键.replace("_api", "")
                if 短键 not in _工作流路径缓存:
                    _工作流路径缓存[短键] = 路径

        # 按分类分组输出，标记API格式
        api数 = sum(1 for i in 结果列表 if _是否API格式(i["路径"]))
        结果 = f"📋 ComfyUI 工作流列表（{len(结果列表)}个，其中{api数}个API格式可用）\n"
        结果 += "━━━━━━━━━━━━━━━\n"
        结果 += "✅=API格式可直接生图  ⚠️=UI格式不可用\n\n"

        当前分类 = ""
        for item in 结果列表:
            if item["分类"] != 当前分类:
                当前分类 = item["分类"]
                结果 += f"📁 {当前分类}\n"
            标记 = "✅" if _是否API格式(item["路径"]) else "⚠️"
            结果 += f"  {标记} {item['文件名']}\n"

        return 操作结果.成功(结果, 元数据={
            "操作类型": "ComfyUI列出工作流",
            "工作流数": len(结果列表),
            "工作流列表": [{"分类": i["分类"], "文件名": i["文件名"], "路径": i["路径"]} for i in 结果列表]
        })


# ============ 诊断与修复 ============

def _获取ComfyUI安装路径() -> str:
    """从系统配置读取ComfyUI安装路径"""
    try:
        from 操作注册中心 import 操作注册中心类
        实例 = 操作注册中心类._实例引用
        if 实例 and 实例._配置加载器:
            系统配置 = 实例._配置加载器.配置缓存.get("系统配置", {})
            安装路径 = 系统配置.get("ComfyUI安装路径", "")
            if 安装路径 and os.path.exists(安装路径):
                return 安装路径
    except Exception:
        pass
    return ""


def _保存ComfyUI安装路径(路径: str):
    """将ComfyUI安装路径保存到系统配置，下次自动读取"""
    try:
        from 操作注册中心 import 操作注册中心类
        实例 = 操作注册中心类._实例引用
        if 实例 and 实例._配置加载器:
            系统配置 = 实例._配置加载器.配置缓存.get("系统配置", {})
            系统配置["ComfyUI安装路径"] = 路径
            实例._配置加载器.保存配置("系统配置", 系统配置, 区域="公共区")
    except Exception:
        pass


def _探测ComfyUI安装路径() -> str:
    """自动探测ComfyUI安装路径（配置为空时调用）"""
    home = os.path.expanduser("~")
    候选路径 = [
        os.path.join(home, "Documents", "ComfyUI"),
        os.path.join(home, "AppData", "Local", "ComfyUI"),
        r"C:\ComfyUI",
        r"D:\ComfyUI",
        r"D:\AI\ComfyUI",
    ]
    for 路径 in 候选路径:
        if os.path.isdir(路径) and os.path.exists(os.path.join(路径, "main.py")):
            # 找到了，自动保存
            _保存ComfyUI安装路径(路径)
            return 路径

    # 尝试从运行中的进程获取
    try:
        import subprocess
        结果 = subprocess.run(
            ["wmic", "process", "where",
             "name='python.exe' and CommandLine like '%ComfyUI%main.py%'",
             "get", "CommandLine", "/format:value"],
            capture_output=True, text=True, timeout=10, encoding='utf-8', errors='replace'
        )
        for line in 结果.stdout.split("\n"):
            if "CommandLine=" in line and "main.py" in line:
                # 提取 --base-directory 参数
                if "--base-directory" in line:
                    parts = line.split("--base-directory")
                    if len(parts) > 1:
                        路径 = parts[1].strip().split("--")[0].strip().strip('"')
                        if os.path.isdir(路径):
                            _保存ComfyUI安装路径(路径)
                            return 路径
                # 从 main.py 路径反推
                if "main.py" in line:
                    idx = line.find("ComfyUI")
                    if idx > 0:
                        路径 = line[:idx + 7].strip().strip('"')
                        if os.path.isdir(路径):
                            _保存ComfyUI安装路径(路径)
                            return 路径
    except Exception:
        pass

    return ""


def _运行子进程(命令列表: list, 工作目录: str = "", 超时秒: int = 15) -> tuple:
    """运行子进程，返回(成功, stdout+stderr合并文本)"""
    import subprocess
    try:
        结果 = subprocess.run(
            命令列表, capture_output=True, text=True,
            timeout=超时秒, encoding='utf-8', errors='replace',
            cwd=工作目录 if 工作目录 else None
        )
        输出 = (结果.stdout or "") + (结果.stderr or "")
        return 结果.returncode == 0, 输出.strip()
    except subprocess.TimeoutExpired:
        return False, f"命令超时({超时秒}秒)"
    except FileNotFoundError:
        return False, f"命令未找到: {命令列表[0]}"
    except Exception as e:
        return False, str(e)


class ComfyUI诊断(操作基类):
    """ComfyUI全面诊断"""
    名称 = "ComfyUI诊断"
    描述 = "全面诊断ComfyUI状态：连通性、Python环境、自定义节点、GPU、模型完整性、启动日志。返回一目了然的诊断报告"
    参数结构 = {
        "安装路径": {"类型": "字符串", "必填": False, "说明": "ComfyUI安装路径，不填则从系统配置读取"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        安装路径 = 参数.get("安装路径", "") or _获取ComfyUI安装路径()
        # 配置为空时自动探测并保存
        if not 安装路径:
            安装路径 = _探测ComfyUI安装路径()
        # 用户通过参数提供了路径，自动保存到配置
        if 安装路径 and 参数.get("安装路径") and not _获取ComfyUI安装路径():
            _保存ComfyUI安装路径(安装路径)
        地址 = _获取ComfyUI地址()
        报告行 = []
        问题列表 = []

        报告行.append("🔍 ComfyUI 全面诊断报告")
        报告行.append("=" * 50)

        # 1. 连通性检查
        成功, 数据 = _API请求(地址, "/system_stats")
        if 成功:
            报告行.append(f"\n✅ 连通性: ComfyUI运行中（{地址}）")
            sys_info = 数据.get("system", {}) if isinstance(数据, dict) else {}
            if sys_info:
                报告行.append(f"   OS: {sys_info.get('os', '?')} | RAM: {sys_info.get('ram_total', 0) // (1024**3):.1f}GB | "
                             f"VRAM: {sys_info.get('gpus', [{}])[0].get('vram_total', 0) // (1024**2):.0f}MB"
                             if sys_info.get('gpus') else "VRAM: 无GPU")
            设备列表 = sys_info.get('gpus', [])
            for i, gpu in enumerate(设备列表):
                报告行.append(f"   GPU{i}: {gpu.get('name', '?')} | VRAM: {gpu.get('vram_total', 0) // (1024**2):.0f}MB")
        else:
            报告行.append(f"\n❌ 连通性: 无法连接ComfyUI（{地址}）— {数据}")
            问题列表.append("ComfyUI未运行或无法连接，可能需要启动")

        # 2. 安装路径检查
        if 安装路径:
            if os.path.exists(安装路径):
                报告行.append(f"\n✅ 安装路径存在: {安装路径}")
            else:
                报告行.append(f"\n❌ 安装路径不存在: {安装路径}")
                问题列表.append(f"安装路径不存在: {安装路径}")
        else:
            报告行.append("\n⚠️ 未配置ComfyUI安装路径（系统配置.json中ComfyUI安装路径为空）")
            问题列表.append("未配置ComfyUI安装路径")

        # 3. Python环境检查
        if 安装路径 and os.path.exists(安装路径):
            venv_python = os.path.join(安装路径, ".venv", "python.exe")
            py_exe = venv_python if os.path.exists(venv_python) else "py"

            报告行.append(f"\n🐍 Python环境:")
            报告行.append(f"   解释器: {py_exe}")

            # Python版本
            成功, 输出 = _运行子进程([py_exe, "--version"], 安装路径)
            报告行.append(f"   版本: {输出}" if 成功 else f"   ❌ 获取版本失败: {输出}")

            # torch + CUDA
            成功, 输出 = _运行子进程(
                [py_exe, "-c", "import torch; print(f'torch={torch.__version__} cuda={torch.cuda.is_available()} gpu={torch.cuda.get_device_name(0) if torch.cuda.is_available() else None}')"],
                安装路径, 超时秒=30
            )
            if 成功 and "torch=" in 输出:
                报告行.append(f"   ✅ {输出}")
                if "cuda=False" in 输出 or "cuda=None" in 输出:
                    问题列表.append("torch未检测到CUDA，GPU加速不可用（可能安装了CPU版torch）")
            else:
                报告行.append(f"   ❌ torch导入失败: {输出[:200]}")
                问题列表.append("torch导入失败，需重新安装: pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121")

            # 4. 自定义节点扫描
            custom_nodes_dir = os.path.join(安装路径, "custom_nodes")
            if not os.path.isdir(custom_nodes_dir):
                # 尝试 ComfyUI子目录
                custom_nodes_dir = os.path.join(安装路径, "ComfyUI", "custom_nodes")

            报告行.append(f"\n📦 自定义节点:")
            if os.path.isdir(custom_nodes_dir):
                节点列表 = []
                for 名称 in sorted(os.listdir(custom_nodes_dir)):
                    节点路径 = os.path.join(custom_nodes_dir, 名称)
                    if not os.path.isdir(节点路径):
                        continue
                    if 名称.endswith(".disabled"):
                        报告行.append(f"   ⏸️ {名称}（已禁用）")
                        continue

                    init_file = os.path.join(节点路径, "__init__.py")
                    if not os.path.exists(init_file):
                        报告行.append(f"   ⚠️ {名称}（无__init__.py）")
                        问题列表.append(f"节点 {名称} 缺少__init__.py")
                        continue

                    # 尝试导入检测
                    成功, 导入输出 = _运行子进程(
                        [py_exe, "-c", f"import sys; sys.path.insert(0, r'{节点路径}'); import importlib; importlib.import_module('__init__')"],
                        安装路径, 超时秒=10
                    )
                    if 成功:
                        节点列表.append(名称)
                    else:
                        报告行.append(f"   ❌ {名称}（导入失败）")
                        错误简述 = 导入输出[:200].replace('\n', ' ')
                        问题列表.append(f"节点 {名称} 导入失败: {错误简述}")
                        # 检查是否有requirements.txt
                        req_file = os.path.join(节点路径, "requirements.txt")
                        if os.path.exists(req_file):
                            报告行.append(f"      📋 有requirements.txt，尝试: pip install -r requirements.txt")

                报告行.append(f"   ✅ 正常节点: {len(节点列表)}个")
                for n in 节点列表:
                    报告行.append(f"      - {n}")
            else:
                报告行.append("   ⚠️ 未找到custom_nodes目录")
                问题列表.append("未找到custom_nodes目录")

            # 5. 模型目录检查
            报告行.append(f"\n📁 模型目录:")
            models_dir = os.path.join(安装路径, "models")
            if not os.path.isdir(models_dir):
                models_dir = os.path.join(安装路径, "ComfyUI", "models")
            if os.path.isdir(models_dir):
                for 子目录 in sorted(os.listdir(models_dir)):
                    子路径 = os.path.join(models_dir, 子目录)
                    if os.path.isdir(子路径):
                        文件数 = sum(1 for f in os.listdir(子路径) if os.path.isfile(os.path.join(子路径, f)))
                        状态 = "✅" if 文件数 > 0 else "⚠️ 空"
                        报告行.append(f"   {状态} {子目录}/ ({文件数}个文件)")
                        if 文件数 == 0:
                            问题列表.append(f"模型目录 {子目录}/ 为空")
            else:
                报告行.append("   ⚠️ 未找到models目录")

            # 6. 启动日志检查（自动搜索多个位置）
            报告行.append(f"\n📄 启动日志:")
            日志路径列表 = []
            # 安装目录及子目录
            for 根 in [安装路径, os.path.join(安装路径, "ComfyUI")]:
                if os.path.isdir(根):
                    for f in os.listdir(根):
                        if f.endswith(".log"):
                            日志路径列表.append(os.path.join(根, f))
            # ComfyUI Desktop 日志目录
            home = os.path.expanduser("~")
            候选日志目录 = [
                os.path.join(home, "AppData", "Local", "comfyui-electron", "logs"),
                os.path.join(home, "AppData", "Roaming", "comfyui-electron", "logs"),
                os.path.join(home, "AppData", "Local", "ComfyUI", "logs"),
                os.path.join(home, ".comfyui", "logs"),
                os.path.join(home, "Documents", "ComfyUI", "logs"),
            ]
            for 目录 in 候选日志目录:
                if os.path.isdir(目录):
                    for f in os.listdir(目录):
                        if f.endswith(".log"):
                            日志路径列表.append(os.path.join(目录, f))
            # 去重
            日志路径列表 = list(dict.fromkeys(日志路径列表))

            找到日志 = False
            for 日志路径 in 日志路径列表:
                if not os.path.exists(日志路径) or os.path.getsize(日志路径) == 0:
                    continue
                找到日志 = True
                try:
                    with open(日志路径, "r", encoding="utf-8", errors="replace") as f:
                        日志内容 = f.read()
                    行列表 = 日志内容.strip().split("\n")
                    报告行.append(f"   📝 {os.path.basename(日志路径)}（{len(行列表)}行，最后30行）:")
                    报告行.append(f"   路径: {日志路径}")
                    for line in 行列表[-30:]:
                        报告行.append(f"      {line}")
                    # 检测常见错误模式
                    日志错误 = []
                    if "ImportError" in 日志内容 or "ModuleNotFoundError" in 日志内容:
                        # 提取具体缺失模块
                        for line in 行列表:
                            if "ModuleNotFoundError" in line or "ImportError" in line:
                                日志错误.append(f"导入错误: {line.strip()[:150]}")
                                break
                    if "CUDA" in 日志内容 and "out of memory" in 日志内容.lower():
                        日志错误.append("GPU显存不足(OOM)，建议降低图片尺寸或关闭其他占显存程序")
                    if "FileNotFoundError" in 日志内容:
                        for line in 行列表:
                            if "FileNotFoundError" in line:
                                日志错误.append(f"文件未找到: {line.strip()[:150]}")
                                break
                    if "RuntimeError" in 日志内容:
                        for line in 行列表:
                            if "RuntimeError" in line:
                                日志错误.append(f"运行时错误: {line.strip()[:150]}")
                                break
                    if "Traceback" in 日志内容:
                        # 提取最后一个Traceback块
                        tb_start = 日志内容.rfind("Traceback")
                        if tb_start >= 0:
                            tb_block = 日志内容[tb_start:tb_start+500]
                            日志错误.append(f"异常堆栈: {tb_block[:300].replace(chr(10), ' | ')}")
                    for err in 日志错误:
                        问题列表.append(err)
                        报告行.append(f"   ⚠️ {err}")
                except Exception as e:
                    报告行.append(f"   ❌ 读取日志失败: {e}")
                break  # 只读第一个有效日志
            if not 找到日志:
                报告行.append("   ℹ️ 未找到日志文件")
                报告行.append("   💡 ComfyUI Desktop日志通常在: %AppData%\\comfyui-electron\\logs\\")
                报告行.append("   💡 独立安装日志通常在ComfyUI目录下的 .log 文件")
                # 尝试通过运行中的ComfyUI进程获取工作目录
                成功2, 进程输出 = _运行子进程(["wmic", "process", "where", "name='python.exe'", "get", "CommandLine,ProcessId", "/format:csv"], 超时秒=10)
                if 成功2 and "main.py" in 进程输出:
                    报告行.append("   🔍 检测到ComfyUI进程正在运行（日志在终端输出中，无文件）")

        # 7. GPU状态
        报告行.append(f"\n🖥️ GPU状态:")
        成功, 输出 = _运行子进程(["nvidia-smi", "--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu", "--format=csv,noheader"])
        if 成功 and 输出:
            for line in 输出.split("\n"):
                报告行.append(f"   ✅ {line.strip()}")
        else:
            报告行.append("   ⚠️ 无法运行nvidia-smi（可能无NVIDIA GPU或驱动未安装）")

        # 8. 总结
        报告行.append("\n" + "=" * 50)
        if 问题列表:
            报告行.append(f"⚠️ 发现 {len(问题列表)} 个问题:")
            for i, p in enumerate(问题列表, 1):
                报告行.append(f"   {i}. {p}")
        else:
            报告行.append("✅ 所有检查项通过，ComfyUI状态正常！")

        报告 = "\n".join(报告行)
        return 操作结果.成功(报告, 元数据={
            "操作类型": "ComfyUI诊断",
            "问题数": len(问题列表),
            "问题列表": 问题列表,
            "ComfyUI运行中": 成功
        })


class ComfyUI修复自定义节点(操作基类):
    """ComfyUI自定义节点修复"""
    名称 = "ComfyUI修复自定义节点"
    描述 = "修复ComfyUI自定义节点问题：扫描问题节点、安装缺失依赖、禁用/启用节点、重启ComfyUI"
    参数结构 = {
        "操作": {"类型": "字符串", "必填": True, "说明": "修复操作：扫描问题节点(检测哪些节点有导入错误)、安装依赖(为指定节点安装pip依赖)、禁用节点(临时禁用问题节点)、启用节点(重新启用被禁用的节点)、重启ComfyUI(停止并重新启动)"},
        "节点名称": {"类型": "字符串", "必填": False, "说明": "操作目标节点名（安装依赖/禁用/启用时需要）"},
        "安装路径": {"类型": "字符串", "必填": False, "说明": "ComfyUI安装路径，不填则从系统配置读取"}
    }

    def 执行(self, 参数: dict) -> 操作结果:
        操作类型 = 参数.get("操作", "")
        节点名称 = 参数.get("节点名称", "")
        安装路径 = 参数.get("安装路径", "") or _获取ComfyUI安装路径()
        # 配置为空时自动探测并保存
        if not 安装路径:
            安装路径 = _探测ComfyUI安装路径()
        # 用户通过参数提供了路径，自动保存到配置
        if 安装路径 and 参数.get("安装路径") and not _获取ComfyUI安装路径():
            _保存ComfyUI安装路径(安装路径)

        if not 安装路径 or not os.path.exists(安装路径):
            return 操作结果.失败(
                "ComfyUI安装路径未配置或不存在。请告诉我你的ComfyUI安装路径（如 C:\\Users\\Administrator\\Documents\\ComfyUI），我会自动保存，下次不用再提供"
            )

        # 定位custom_nodes目录
        custom_nodes_dir = os.path.join(安装路径, "custom_nodes")
        if not os.path.isdir(custom_nodes_dir):
            custom_nodes_dir = os.path.join(安装路径, "ComfyUI", "custom_nodes")
        if not os.path.isdir(custom_nodes_dir):
            return 操作结果.失败(f"未找到custom_nodes目录: {custom_nodes_dir}")

        venv_python = os.path.join(安装路径, ".venv", "python.exe")
        py_exe = venv_python if os.path.exists(venv_python) else "py"

        if 操作类型 == "扫描问题节点":
            return self._扫描问题节点(custom_nodes_dir, py_exe, 安装路径)

        elif 操作类型 == "安装依赖":
            if not 节点名称:
                return 操作结果.失败("请提供节点名称")
            节点路径 = os.path.join(custom_nodes_dir, 节点名称)
            if not os.path.isdir(节点路径):
                # 尝试 .disabled 版本
                节点路径 = os.path.join(custom_nodes_dir, 节点名称 + ".disabled")
                if not os.path.isdir(节点路径):
                    return 操作结果.失败(f"节点目录不存在: {节点名称}")

            req_file = os.path.join(节点路径, "requirements.txt")
            if not os.path.exists(req_file):
                return 操作结果.成功(f"节点 {节点名称} 没有requirements.txt，无需安装依赖")

            成功, 输出 = _运行子进程([py_exe, "-m", "pip", "install", "-r", "requirements.txt"], 节点路径, 超时秒=120)
            if 成功:
                return 操作结果.成功(f"✅ 已为节点 {节点名称} 安装依赖:\n{输出[-500:]}")
            return 操作结果.失败(f"❌ 安装依赖失败:\n{输出[-500:]}")

        elif 操作类型 == "禁用节点":
            if not 节点名称:
                return 操作结果.失败("请提供节点名称")
            节点路径 = os.path.join(custom_nodes_dir, 节点名称)
            if not os.path.isdir(节点路径):
                return 操作结果.失败(f"节点目录不存在: {节点名称}")
            禁用路径 = 节点路径 + ".disabled"
            try:
                os.rename(节点路径, 禁用路径)
                return 操作结果.成功(f"✅ 已禁用节点: {节点名称}（重命名为 {节点名称}.disabled）\n重启ComfyUI后生效")
            except Exception as e:
                return 操作结果.失败(f"禁用失败: {e}")

        elif 操作类型 == "启用节点":
            if not 节点名称:
                return 操作结果.失败("请提供节点名称")
            禁用路径 = os.path.join(custom_nodes_dir, 节点名称 + ".disabled")
            if not os.path.isdir(禁用路径):
                return 操作结果.失败(f"未找到被禁用的节点: {节点名称}.disabled")
            启用路径 = os.path.join(custom_nodes_dir, 节点名称)
            try:
                os.rename(禁用路径, 启用路径)
                return 操作结果.成功(f"✅ 已启用节点: {节点名称}\n重启ComfyUI后生效")
            except Exception as e:
                return 操作结果.失败(f"启用失败: {e}")

        elif 操作类型 == "重启ComfyUI":
            return self._重启ComfyUI(安装路径)

        else:
            return 操作结果.失败(
                f"不支持的操作: {操作类型}\n可用操作: 扫描问题节点、安装依赖、禁用节点、启用节点、重启ComfyUI"
            )

    def _扫描问题节点(self, custom_nodes_dir: str, py_exe: str, 安装路径: str) -> 操作结果:
        """扫描所有自定义节点，检测导入错误"""
        报告行 = ["🔍 自定义节点问题扫描", "=" * 40]
        问题节点 = []
        正常节点 = []

        for 名称 in sorted(os.listdir(custom_nodes_dir)):
            节点路径 = os.path.join(custom_nodes_dir, 名称)
            if not os.path.isdir(节点路径):
                continue
            if 名称.endswith(".disabled"):
                报告行.append(f"⏸️ {名称}（已禁用，跳过）")
                continue

            init_file = os.path.join(节点路径, "__init__.py")
            if not os.path.exists(init_file):
                报告行.append(f"⚠️ {名称}（无__init__.py，非标准节点）")
                continue

            成功, 输出 = _运行子进程(
                [py_exe, "-c", f"import sys; sys.path.insert(0, r'{节点路径}'); import importlib; importlib.import_module('__init__')"],
                安装路径, 超时秒=10
            )
            if 成功:
                正常节点.append(名称)
            else:
                问题节点.append((名称, 输出[:300]))
                报告行.append(f"❌ {名称}")
                报告行.append(f"   错误: {输出[:200].replace(chr(10), ' ')}")
                req_file = os.path.join(节点路径, "requirements.txt")
                if os.path.exists(req_file):
                    报告行.append(f"   💡 可尝试: 安装依赖({名称})")

        报告行.append("=" * 40)
        报告行.append(f"✅ 正常: {len(正常节点)}个 | ❌ 问题: {len(问题节点)}个")
        if 问题节点:
            报告行.append("\n💡 修复建议:")
            for 名称, 错误 in 问题节点:
                if "ModuleNotFoundError" in 错误 or "ImportError" in 错误:
                    报告行.append(f"   - {名称}: 缺少依赖 → 用「安装依赖」操作安装")
                else:
                    报告行.append(f"   - {名称}: 其他错误 → 可先「禁用节点」再排查")

        return 操作结果.成功("\n".join(报告行), 元数据={
            "操作类型": "ComfyUI修复自定义节点",
            "修复操作": "扫描问题节点",
            "问题节点数": len(问题节点),
            "正常节点数": len(正常节点)
        })

    def _重启ComfyUI(self, 安装路径: str) -> 操作结果:
        """停止并重新启动ComfyUI（只杀ComfyUI进程，不影响智能体自身）"""
        import subprocess

        # 精准终止ComfyUI进程：通过命令行特征匹配（main.py + ComfyUI）
        # 不能用 taskkill /IM python.exe — 那会杀掉智能体自己！
        try:
            # wmic查找含"ComfyUI"和"main.py"的python进程
            查询结果 = subprocess.run(
                ["wmic", "process", "where",
                 "name='python.exe' and CommandLine like '%main.py%' and CommandLine like '%ComfyUI%'",
                 "get", "ProcessId", "/format:value"],
                capture_output=True, text=True, timeout=10, encoding='utf-8', errors='replace'
            )
            # 提取PID
            pids = []
            for line in 查询结果.stdout.strip().split("\n"):
                line = line.strip()
                if line.startswith("ProcessId="):
                    pid = line.split("=", 1)[1].strip()
                    if pid.isdigit():
                        pids.append(pid)

            # 也检查 .venv 下的 python.exe
            查询结果2 = subprocess.run(
                ["wmic", "process", "where",
                 "name='python.exe' and CommandLine like '%ComfyUI%'",
                 "get", "ProcessId", "/format:value"],
                capture_output=True, text=True, timeout=10, encoding='utf-8', errors='replace'
            )
            for line in 查询结果2.stdout.strip().split("\n"):
                line = line.strip()
                if line.startswith("ProcessId="):
                    pid = line.split("=", 1)[1].strip()
                    if pid.isdigit() and pid not in pids:
                        pids.append(pid)

            # 逐个终止（排除自身进程）
            当前pid = str(os.getpid())
            for pid in pids:
                if pid != 当前pid:
                    subprocess.run(["taskkill", "/F", "/PID", pid, "/T"],
                                 capture_output=True, timeout=10)
        except Exception:
            pass

        # 等待2秒让进程完全退出
        time.sleep(2)

        # 使用ComfyUI启动操作
        启动器 = ComfyUI启动()
        启动器.文件管理器 = self.文件管理器
        启动器.进度回调 = self.进度回调
        启动器.取消检查 = self.取消检查
        结果 = 启动器.执行({"等待就绪": "是"})

        if 结果.成功:
            return 操作结果.成功(
                f"✅ ComfyUI已重启\n{结果.消息}",
                元数据={"操作类型": "ComfyUI修复自定义节点", "修复操作": "重启ComfyUI"}
            )
        return 结果
