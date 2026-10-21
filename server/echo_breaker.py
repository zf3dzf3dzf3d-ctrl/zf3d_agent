# -*- coding: utf-8 -*-
"""重复占位调用熔断器（防 Agent 刷无意义 echo/心跳式调用）。

规则：对 run_code 的 code 参数做 hash，滑动窗口内连续相同/高度相似的
占位命令达到阈值即拦截，返回明确指引让 AI 停止空转。
- 占位命令判定：极短（<40 字符）且不含文件/项目相关关键词的 echo/type/dir 单命令。
- 相似判定：同形态（去掉数字后相同），如 `echo ok50` 与 `echo ok51` 视为同形态。
"""
import re
import time
import threading

_LOCK = threading.Lock()
_HISTORY = {}          # form_key -> [timestamps]
WINDOW_SEC = 600       # 10 分钟窗口
THRESHOLD = 5          # 窗口内同形态占位命令达到 5 次即熔断

# 占位嫌疑命令形态：echo/printf + 无实际内容的短语
_PLACEHOLDER_RE = re.compile(
    r'^\s*(?:echo|printf|type\s+nul|cd|cls)\b[^|;&>]{0,60}$', re.I)
_STRIP_NUM_RE = re.compile(r'\d+')
# 含以下关键词视为有业务含义，直接放行
_MEANINGFUL_RE = re.compile(
    r'(\.py|\.js|\.html|\.css|\.json|\.bat|\.md|\.bak|\.apk|python|node|git|'
    r'findstr|dir\s+/|gradle|java|curl|pip|npm|fc\b|robocopy|xcopy|copy\b|move\b|del\b|'
    r'[A-Za-z]:\\|\.\./|\.exe)', re.I)


def _form_key(code):
    """提取命令形态 key（去数字归一化，便于把 echo ok50/ok51 归为同形态）。"""
    s = code.strip().lower()
    s = _STRIP_NUM_RE.sub('#', s)
    return s


def check_echo_loop(code):
    """返回 None 表示放行；返回字符串表示拦截原因（直接回给 AI）。"""
    try:
        c = str(code or '').strip()
        if not c or _MEANINGFUL_RE.search(c):
            return None
        # 多段命令（&& / 换行 / 管道）视为复杂命令，放行
        if any(sep in c for sep in ('&&', '\n', '|', ';')):
            return None
        if len(c) > 60 or not _PLACEHOLDER_RE.match(c):
            return None
        key = _form_key(c)
        now = time.time()
        with _LOCK:
            lst = [t for t in _HISTORY.get(key, []) if now - t < WINDOW_SEC]
            lst.append(now)
            _HISTORY[key] = lst[-64:]
            if len(lst) >= THRESHOLD:
                return ('⛔ 熔断：检测到重复占位调用（近 %d 分钟内相似命令「%s」已出现 %d 次）。'
                        '这类无业务含义的命令不会产生任何结果，已停止执行。'
                        '请立即停止空转：若有真实任务请直接执行有意义的操作；若任务已完成请给出最终答复。'
                        % (WINDOW_SEC // 60, c, len(lst)))
    except Exception:
        pass
    return None
