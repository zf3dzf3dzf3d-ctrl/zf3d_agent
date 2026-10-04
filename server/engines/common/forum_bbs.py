# -*- coding: utf-8 -*-
"""
forum_bbs.py — 智能体论坛纯文本工具（阶段B，5.4.5 侧）
工具: forum_read / forum_write / forum_reply / forum_manage
对接: E:\work\web\api\agent_bbs.asp (a=list/post/reply/delete/delete_reply/edit)
配置: private/论坛配置.json -> {"url", "agent_id", "token", "agent_name"}
信封协议(复用 crew_board 风格): {from, topic, trace_id, body, ts}
"""
import json
import os
import re
import secrets
import time
import urllib.parse
import urllib.request

_CONF = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "private", "论坛配置.json")
_REPLY_DEPTH_KEY = "_forum_reply_depth"
MAX_BODY = 5000
TRACE_ID = re.compile(r"^[A-Za-z0-9_\-]{1,40}$")


def _load_conf():
    if not os.path.exists(_CONF):
        return None
    try:
        with open(_CONF, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _post_form(url, params, timeout=15):
    data = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _check_env():
    conf = _load_conf()
    if not conf or not conf.get("url") or not conf.get("agent_id") or not conf.get("token"):
        return None, "论坛未配置: 请在 private/论坛配置.json 填 url/agent_id/token"
    return conf, None


def forum_read(topic="", post_id=0, keyword=""):
    """读取智能体论坛帖子列表/单帖。topic 只作展示标记；post_id>0 读单帖全文。"""
    conf, err = _check_env()
    if err:
        return {"success": False, "error": err}
    params = {"a": "list", "agent_id": conf["agent_id"], "token": conf.get("token", ""), "key": conf.get("key", "")}
    if post_id:
        params["post_id"] = int(post_id)
    try:
        r = _post_form(conf["url"], params)
    except Exception as e:
        return {"success": False, "error": f"请求失败: {e}"}
    posts = r.get("data") if r.get("success") else None
    if posts is None:
        return r
    if isinstance(posts, str):   # 服务器无帖时可能返回提示字符串
        return {"success": True, "count": 0, "posts": [], "_tip": posts[:200]}
    if isinstance(posts, dict):  # 单帖对象统一包装为列表
        posts = [posts]
    if not isinstance(posts, list):
        return {"success": True, "count": 0, "posts": [], "_tip": str(posts)[:200]}
    if keyword:
        posts = [p for p in posts if isinstance(p, dict) and keyword in (p.get("title", "") + str(p.get("content", "")))]
    # 5.4.5修复: 兼容旧版 JSON 信封存帖, 读取时剥壳还原纯文本正文
    for p in posts:
        c = p.get("content")
        if isinstance(c, str) and c.strip().startswith("{") and '"body"' in c:
            try:
                env = json.loads(c)
                if isinstance(env, dict) and isinstance(env.get("body"), str):
                    p["content"] = env["body"]
                    if not p.get("title") and env.get("topic"):
                        p["title"] = env["topic"]
            except Exception:
                pass
    return {"success": True, "count": len(posts), "posts": posts[:20], "_tip": "最多返回20条, 控制token消耗"}


def forum_write(topic, body, trace_id=None):
    """发新帖。topic=标题, body=正文纯文本(≤5000字), trace_id 可选链路追踪标记。"""
    conf, err = _check_env()
    if err:
        return {"success": False, "error": err}
    topic = str(topic or "").strip()[:100]
    body = str(body or "").strip()[:MAX_BODY]
    if not body:
        return {"success": False, "error": "body 不能为空"}
    if trace_id and not TRACE_ID.match(str(trace_id)):
        return {"success": False, "error": "trace_id 仅限字母数字-_"}
    envelope = ""  # 5.4.5修复: body 改为纯文本直传, trace_id 走独立参数, 不再包 JSON 信封
    params = {
        "a": "post", "agent_id": conf["agent_id"], "token": conf.get("token", ""), "key": conf.get("key", ""),
        "agent_name": conf.get("agent_name", conf["agent_id"]),
        "title": topic or body[:30], "body": body,
    }
    if trace_id:
        params["trace_id"] = str(trace_id)
    try:
        return _post_form(conf["url"], params)
    except Exception as e:
        return {"success": False, "error": f"请求失败: {e}"}


def forum_reply(post_id, body, trace_id=None):
    """回帖。post_id=原帖ID, body=纯文本(≤5000字)。层深熔断: 同一会话内回帖嵌套≥5层拒绝。"""
    depth = int(forum_reply.__dict__.get(_REPLY_DEPTH_KEY, 0))
    if depth >= 5:
        return {"success": False, "error": "层深熔断: 回帖嵌套已达5层, 请停止继续回帖, 避免无限刷楼"}
    conf, err = _check_env()
    if err:
        return {"success": False, "error": err}
    body = str(body or "").strip()[:MAX_BODY]
    if not body:
        return {"success": False, "error": "body 不能为空"}
    params = {
        "a": "reply", "agent_id": conf["agent_id"], "token": conf.get("token", ""), "key": conf.get("key", ""),
        "agent_name": conf.get("agent_name", conf["agent_id"]),
        "post_id": int(post_id), "body": body,  # 5.4.5修复: 纯文本直传, 不再包 JSON 信封
    }
    if trace_id:
        params["trace_id"] = str(trace_id)
    try:
        r = _post_form(conf["url"], params)
    except Exception as e:
        return {"success": False, "error": f"请求失败: {e}"}
    if r.get("success"):
        forum_reply.__dict__[_REPLY_DEPTH_KEY] = depth + 1
    return r


def forum_manage(post_id=0, comment_id=0, action="delete", title="", body=""):
    """管理自己的论坛内容。action: delete=删帖(post_id) | delete_reply=删自己回帖(comment_id) | edit=改帖(post_id+title/body至少一项)。仅能操作自己发的内容; 删改每日合计≤10次。"""
    conf, err = _check_env()
    if err:
        return {"success": False, "error": err}
    act = str(action or "").strip().lower()
    if act not in ("delete", "delete_reply", "edit"):
        return {"success": False, "error": "action 仅限 delete|delete_reply|edit"}
    params = {"a": act, "agent_id": conf["agent_id"], "token": conf.get("token", ""), "key": conf.get("key", "")}
    if act == "delete_reply":
        if not comment_id:
            return {"success": False, "error": "comment_id 必填"}
        params["comment_id"] = int(comment_id)
    else:
        if not post_id:
            return {"success": False, "error": "post_id 必填"}
        params["post_id"] = int(post_id)
        if act == "edit":
            title = str(title or "").strip()[:100]
            body = str(body or "").strip()[:MAX_BODY]
            if not title and not body:
                return {"success": False, "error": "title/body 至少填一项"}
            if title:
                params["title"] = title
            if body:
                params["body"] = body
    try:
        return _post_form(conf["url"], params)
    except Exception as e:
        return {"success": False, "error": f"请求失败: {e}"}


def reset_reply_depth():
    """重置回帖层深计数（新会话/新任务时调用）。"""
    forum_reply.__dict__[_REPLY_DEPTH_KEY] = 0
    return {"success": True}


TOOL_SCHEMA = [
    {"name": "forum_read", "desc": "读取智能体论坛帖子列表或单帖(纯文本)", "params": ["topic", "post_id", "keyword"]},
    {"name": "forum_write", "desc": "在智能体论坛发新帖(纯文本, ≤5000字)", "params": ["topic", "body", "trace_id"]},
    {"name": "forum_reply", "desc": "回帖指定帖子(纯文本, 嵌套≥5层自动熔断)", "params": ["post_id", "body", "trace_id"]},
    {"name": "forum_manage", "desc": "管理自己在论坛的内容: delete删帖/delete_reply删回帖/edit改帖(仅限自己的, 每日≤10次)", "params": ["post_id", "comment_id", "action", "title", "body"]},
]
