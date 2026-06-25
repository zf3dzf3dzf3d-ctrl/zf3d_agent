"""查Bug管理器 — 读取所有JSON日志，生成综合Bug报告
数据来源：
  1. 隐私区/我的日志/运行诊断.json     — 系统异常（错误+警告）
  2. 隐私区/我的日志/LLM调用日志.jsonl  — LLM原始请求/响应
  3. 隐私区/对话记录/*.json            — 对话内容+推理日志
  4. 隐私区/对话记录/_索引.json         — 对话索引

用法:
  py 查bug管理器.py              # 全量报告
  py 查bug管理器.py 今天          # 只看今天的
  py 查bug管理器.py 2026-06-22   # 指定日期
  py 查bug管理器.py 错误          # 只看错误统计
  py 查bug管理器.py 对话          # 只看对话中的问题
  py 查bug管理器.py LLM           # 只看LLM调用日志
"""
import json
import sys
import os
from pathlib import Path
from datetime import datetime
from collections import Counter, defaultdict

# Windows控制台UTF-8
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

项目根 = Path(__file__).parent
日志目录 = 项目根 / "隐私区" / "我的日志"
对话目录 = 项目根 / "隐私区" / "对话记录"


def 加载运行诊断() -> dict:
    """加载运行诊断.json"""
    路径 = 日志目录 / "运行诊断.json"
    if not 路径.exists():
        return {"错误列表": [], "警告列表": [], "统计": {}}
    try:
        with open(路径, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        return {"错误列表": [], "警告列表": [], "统计": {}, "加载错误": str(e)}


def 加载LLM调用日志(日期过滤: str = "") -> list:
    """加载LLM调用日志.jsonl，每行一条JSON"""
    路径 = 日志目录 / "LLM调用日志.jsonl"
    if not 路径.exists():
        return []
    记录列表 = []
    try:
        with open(路径, "r", encoding="utf-8") as f:
            for 行号, 行 in enumerate(f, 1):
                行 = 行.strip()
                if not 行:
                    continue
                try:
                    记录 = json.loads(行)
                    记录["_行号"] = 行号
                    if 日期过滤:
                        时间 = 记录.get("时间", "")
                        if 日期过滤 not in 时间:
                            continue
                    记录列表.append(记录)
                except json.JSONDecodeError:
                    记录列表.append({"_行号": 行号, "_解析错误": "JSON格式错误", "原始内容": 行[:200]})
    except Exception as e:
        print(f"  ⚠️ 加载LLM调用日志失败: {e}")
    return 记录列表


def 加载对话记录(日期过滤: str = "") -> list:
    """加载所有对话记录文件"""
    结果 = []
    if not 对话目录.exists():
        return 结果
    for 文件 in sorted(对话目录.glob("*.json")):
        if 文件.name.startswith("_"):
            continue
        try:
            with open(文件, "r", encoding="utf-8") as f:
                数据 = json.load(f)
            对话ID = 数据.get("id", 文件.stem)
            历史 = 数据.get("历史", [])
            推理日志 = 数据.get("推理日志", [])
            # 日期过滤
            if 日期过滤:
                匹配 = False
                for 消息 in 历史:
                    if 日期过滤 in 消息.get("时间", ""):
                        匹配 = True
                        break
                if not 匹配 and not 推理日志:
                    continue
            结果.append({
                "文件名": 文件.name,
                "对话ID": 对话ID,
                "历史": 历史,
                "推理日志": 推理日志,
                "消息总数": 数据.get("消息总数", len(历史)),
                "最后消息时间": 数据.get("最后消息时间", ""),
                "保存时间": 数据.get("保存时间", "")
            })
        except Exception as e:
            结果.append({"文件名": 文件.name, "加载错误": str(e)})
    return 结果


def 报告_错误统计(诊断: dict, 日期过滤: str = ""):
    """错误统计报告"""
    错误列表 = 诊断.get("错误列表", [])
    if 日期过滤:
        错误列表 = [e for e in 错误列表 if 日期过滤 in e.get("时间", "")]

    print("=" * 70)
    print("📊 错误统计报告" + (f"（筛选: {日期过滤}）" if 日期过滤 else "（全部）"))
    print("=" * 70)

    if not 错误列表:
        print("  ✅ 没有错误记录")
        return

    # 按异常类型统计
    类型统计 = Counter(e.get("异常类型", "未知") for e in 错误列表)
    print(f"\n总错误数: {len(错误列表)}")
    print(f"未解决: {sum(1 for e in 错误列表 if not e.get('已解决', False))}")
    print(f"已解决: {sum(1 for e in 错误列表 if e.get('已解决', False))}")

    print("\n📋 按异常类型分组:")
    for 类型, 数量 in 类型统计.most_common():
        已解决数 = sum(1 for e in 错误列表 if e.get("异常类型") == 类型 and e.get("已解决"))
        print(f"  {类型}: {数量}次 (未解决{数量-已解决数})")

    # 按来源统计
    来源统计 = Counter(e.get("来源", "未知") for e in 错误列表)
    print("\n📋 按来源分组:")
    for 来源, 数量 in 来源统计.most_common():
        print(f"  {来源}: {数量}次")

    # 时间线（最近20条）
    print("\n📋 最近错误时间线 (最多20条):")
    排序后 = sorted(错误列表, key=lambda e: e.get("时间", ""), reverse=True)
    for 错误 in 排序后[:20]:
        状态 = "✅" if 错误.get("已解决") else "❌"
        类型 = 错误.get("异常类型", "?")
        信息 = 错误.get("异常信息", "")[:80]
        时间 = 错误.get("时间", "?")
        来源 = 错误.get("来源", "?")
        print(f"  {状态} [{时间}] {来源} | {类型}: {信息}")

    # 重复错误检测
    print("\n📋 重复错误检测 (同一异常出现≥3次):")
    重复 = {k: v for k, v in 类型统计.items() if v >= 3}
    if not 重复:
        print("  ✅ 没有高频重复错误")
    else:
        for 类型, 数量 in sorted(重复.items(), key=lambda x: -x[1]):
            示例 = next((e for e in 错误列表 if e.get("异常类型") == 类型), None)
            信息 = 示例.get("异常信息", "")[:100] if 示例 else ""
            来源 = 示例.get("来源", "") if 示例 else ""
            print(f"  ⚠️ {类型} ({数量}次) 来源:{来源}")
            print(f"     示例: {信息}")


def 报告_LLM调用日志(日期过滤: str = ""):
    """LLM调用日志报告"""
    记录列表 = 加载LLM调用日志(日期过滤)

    print("=" * 70)
    print("🤖 LLM调用日志报告" + (f"（筛选: {日期过滤}）" if 日期过滤 else "（全部）"))
    print("=" * 70)

    if not 记录列表:
        print("  📭 没有LLM调用日志（可能尚未启用或无调用）")
        return

    总数 = len(记录列表)
    成功数 = sum(1 for r in 记录列表 if r.get("成功"))
    失败数 = 总数 - 成功数
    解析错误数 = sum(1 for r in 记录列表 if r.get("_解析错误"))

    print(f"\n总调用次数: {总数}")
    print(f"成功: {成功数} | 失败: {失败数} | 解析错误: {解析错误数}")

    # 耗时统计
    耗时列表 = [r.get("耗时毫秒", 0) for r in 记录列表 if r.get("耗时毫秒")]
    if 耗时列表:
        平均耗时 = sum(耗时列表) / len(耗时列表)
        最大耗时 = max(耗时列表)
        最小耗时 = min(耗时列表)
        print(f"耗时: 平均{平均耗时:.0f}ms | 最大{最大耗时}ms | 最小{最小耗时}ms")

    # 慢调用检测
    慢调用 = [r for r in 记录列表 if r.get("耗时毫秒", 0) > 10000]
    if 慢调用:
        print(f"\n⚠️ 慢调用 (>10秒): {len(慢调用)}次")
        for r in 慢调用[-5:]:
            print(f"  [{r.get('时间', '?')}] {r.get('耗时毫秒')}ms | 消息数:{r.get('消息数量', '?')}")

    # 失败调用详情
    if 失败数:
        print(f"\n❌ 失败调用 ({失败数}次):")
        for r in 记录列表:
            if not r.get("成功") and not r.get("_解析错误"):
                错误信息 = r.get("错误", "")[:150]
                print(f"  [{r.get('时间', '?')}] {错误信息}")

    # 模型分布
    模型统计 = Counter(r.get("模型", "未知") for r in 记录列表)
    print(f"\n📋 模型分布:")
    for 模型, 数量 in 模型统计.most_common():
        成功 = sum(1 for r in 记录列表 if r.get("模型") == 模型 and r.get("成功"))
        print(f"  {模型}: {数量}次 (成功{成功})")


def 报告_对话问题(日期过滤: str = ""):
    """对话记录中的问题分析"""
    对话列表 = 加载对话记录(日期过滤)

    print("=" * 70)
    print("💬 对话记录问题分析" + (f"（筛选: {日期过滤}）" if 日期过滤 else "（全部）"))
    print("=" * 70)

    if not 对话列表:
        print("  📭 没有对话记录")
        return

    总对话 = len(对话列表)
    有推理日志 = sum(1 for d in 对话列表 if d.get("推理日志"))
    无推理日志 = sum(1 for d in 对话列表 if not d.get("推理日志"))

    print(f"\n对话总数: {总对话}")
    print(f"有推理日志: {有推理日志} | 无推理日志: {无推理日志}")

    # 检测对话中的异常模式
    问题对话 = []
    for 对话 in 对话列表:
        if 对话.get("加载错误"):
            问题对话.append(("加载错误", 对话))
            continue
        历史 = 对话.get("历史", [])
        推理日志 = 对话.get("推理日志", [])

        # 1. 检测AI重复操作（同一操作连续失败）
        for 日志 in 推理日志:
            推理过程 = 日志.get("推理过程", [])
            失败步骤 = [s for s in 推理过程 if s.get("类型") == "操作" and not s.get("成功", True)]
            if 失败步骤:
                问题对话.append(("操作失败", 对话, 日志, 失败步骤))

        # 2. 检测AI循环（用户反复说同一个意思）
        用户消息 = [m for m in 历史 if m.get("角色") == "用户"]
        if len(用户消息) >= 3:
            简化 = [m.get("内容", "")[-20:] for m in 用户消息]
            重复 = Counter(简化)
            for 文本, 次数 in 重复.items():
                if 次数 >= 3:
                    问题对话.append(("用户重复", 对话, None, f"'{文本}' 重复{次数}次"))

        # 3. 检测推理日志中的错误标记
        for 日志 in 推理日志:
            if 日志.get("错误") or not 日志.get("成功", True):
                问题对话.append(("推理错误", 对话, 日志, 日志.get("错误", "")))

    if 问题对话:
        print(f"\n⚠️ 发现 {len(问题对话)} 个问题:")
        seen = set()
        for 问题类型, 对话, 日志, 详情 in 问题对话:
            对话ID = 对话.get("对话ID", 对话.get("文件名", "?"))
            key = f"{对话ID}_{问题类型}"
            if key in seen:
                continue
            seen.add(key)
            if 问题类型 == "操作失败":
                print(f"\n  🔴 [操作失败] 对话 {对话ID}")
                if isinstance(详情, list):
                    for 步骤 in 详情[:3]:
                        操作 = 步骤.get("操作", "?")
                        结果 = 步骤.get("结果", "")[:100]
                        print(f"     步骤{步骤.get('步骤', '?')}: {操作} → ❌ {结果}")
            elif 问题类型 == "用户重复":
                print(f"\n  🟡 [用户重复] 对话 {对话ID}: {详情}")
            elif 问题类型 == "推理错误":
                print(f"\n  🔴 [推理错误] 对话 {对话ID}: {详情[:100]}")
            elif 问题类型 == "加载错误":
                print(f"\n  🔴 [加载错误] {对话.get('文件名', '?')}: {对话.get('加载错误', '')}")
    else:
        print("\n✅ 对话记录中未发现明显问题")


def 报告_完整时间线(日期过滤: str = ""):
    """将错误、LLM调用、对话事件合并为统一时间线"""
    print("=" * 70)
    print("📅 完整时间线" + (f"（筛选: {日期过滤}）" if 日期过滤 else "（全部）"))
    print("=" * 70)

    事件列表 = []

    # 1. 系统错误
    诊断 = 加载运行诊断()
    for 错误 in 诊断.get("错误列表", []):
        if 日期过滤 and 日期过滤 not in 错误.get("时间", ""):
            continue
        事件列表.append({
            "时间": 错误.get("时间", ""),
            "类型": "🔴错误",
            "来源": 错误.get("来源", ""),
            "详情": f"{错误.get('异常类型', '')}: {错误.get('异常信息', '')[:80]}"
        })

    # 2. LLM调用失败
    llm日志 = 加载LLM调用日志(日期过滤)
    for 记录 in llm日志:
        if not 记录.get("成功") and not 记录.get("_解析错误"):
            事件列表.append({
                "时间": 记录.get("时间", ""),
                "类型": "🟠LLM失败",
                "来源": 记录.get("模型", ""),
                "详情": 记录.get("错误", "")[:80]
            })

    # 3. 对话中的操作失败
    对话列表 = 加载对话记录(日期过滤)
    for 对话 in 对话列表:
        for 日志 in 对话.get("推理日志", []):
            用户消息 = 日志.get("用户消息", "")[:30]
            时间 = 日志.get("用户消息时间", "")
            if 日期过滤 and 日期过滤 not in 时间:
                continue
            if not 日志.get("成功", True):
                事件列表.append({
                    "时间": 时间,
                    "类型": "🟡对话异常",
                    "来源": 对话.get("对话ID", ""),
                    "详情": f"用户:{用户消息} | 错误:{日志.get('错误', '')[:60]}"
                })

    # 按时间排序
    事件列表.sort(key=lambda e: e.get("时间", ""))

    if not 事件列表:
        print("  ✅ 时间线上没有异常事件")
        return

    print(f"\n共 {len(事件列表)} 个事件:\n")
    for 事件 in 事件列表[-50:]:  # 最多显示50条
        时间 = 事件.get("时间", "?")[:19]
        类型 = 事件.get("类型", "?")
        来源 = 事件.get("来源", "")[:20]
        详情 = 事件.get("详情", "")[:80]
        print(f"  [{时间}] {类型} {来源} | {详情}")


def 主函数():
    参数 = sys.argv[1] if len(sys.argv) > 1 else ""

    # 判断是否是日期
    是日期 = False
    if 参数 == "今天":
        参数 = datetime.now().strftime("%Y-%m-%d")
        是日期 = True
    elif 参数 and len(参数) == 10 and 参数[4] == "-":
        是日期 = True

    if 参数 == "" or 是日期:
        # 全量报告
        诊断 = 加载运行诊断()
        报告_错误统计(诊断, 参数)
        print()
        报告_LLM调用日志(参数)
        print()
        报告_对话问题(参数)
        print()
        报告_完整时间线(参数)
    elif 参数 == "错误":
        诊断 = 加载运行诊断()
        报告_错误统计(诊断)
    elif 参数 == "LLM" or 参数 == "llm":
        报告_LLM调用日志()
    elif 参数 == "对话":
        报告_对话问题()
    elif 参数 == "时间线":
        报告_完整时间线()
    else:
        print("用法:")
        print("  py 查bug管理器.py              # 全量报告")
        print("  py 查bug管理器.py 今天          # 只看今天的")
        print("  py 查bug管理器.py 2026-06-22   # 指定日期")
        print("  py 查bug管理器.py 错误          # 只看错误统计")
        print("  py 查bug管理器.py 对话          # 只看对话中的问题")
        print("  py 查bug管理器.py LLM           # 只看LLM调用日志")
        print("  py 查bug管理器.py 时间线        # 完整时间线")


if __name__ == "__main__":
    主函数()
