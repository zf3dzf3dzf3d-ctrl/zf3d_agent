#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hermes_style 技能系统工具（移植 Hermes-Agent 精髓，不引入原代码）

技能 = 目录 + SKILL.md（YAML frontmatter: name/description）+ 可选 references/
渐进披露三层：
  tier1 skill_list  -> 只返回元数据（name + description），极省 token
  tier2 skill_view  -> 加载 SKILL.md 全文
  tier3 skill_view(name, ref) -> 按需加载 references/ 内文件
自学习闭环：skill_save 可新建/更新技能，让智能体在任务中沉淀经验。

技能存放：<project_path>/hermes_skills/
"""

import os
import re
import json

ROOT_MARK = "hermes_skills"

# ---------------- 路径安全 ----------------

def _skills_root(ctx):
    proj = (ctx or {}).get("project_path") or os.getcwd()
    return os.path.join(proj, ROOT_MARK)


def _safe_skill_path(root, name, ref=None):
    """解析技能路径，禁止越出 skills 根目录。"""
    parts = [p for p in re.split(r"[\\/]", name or "") if p and p not in (".", "..")]
    if not parts:
        return None
    path = os.path.join(root, *parts)
    if ref:
        rparts = [p for p in re.split(r"[\\/]", ref) if p and p not in (".", "..")]
        if not rparts:
            return None
        path = os.path.join(path, *rparts)
    path = os.path.abspath(path)
    if not path.startswith(os.path.abspath(root) + os.sep):
        return None
    return path


# ---------------- frontmatter 解析 ----------------

_FRONT_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.S)


def _parse_frontmatter(text):
    m = _FRONT_RE.match(text or "")
    meta, body = {}, text or ""
    if m:
        body = text[m.end():]
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
    return meta, body.strip()


def _find_all_skills(root):
    """扫描所有 SKILL.md，返回 [{name, dir, meta}]。"""
    out = []
    if not os.path.isdir(root):
        return out
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        if "SKILL.md" in filenames:
            rel = os.path.relpath(dirpath, root).replace("\\", "/")
            try:
                with open(os.path.join(dirpath, "SKILL.md"), "r", encoding="utf-8", errors="replace") as f:
                    meta, _ = _parse_frontmatter(f.read())
            except OSError:
                meta = {}
            out.append({
                "name": rel,
                "title": meta.get("name", rel),
                "description": meta.get("description", ""),
            })
    return out


def _list_refs(skill_dir):
    refs = []
    for sub in ("references", "templates", "assets"):
        d = os.path.join(skill_dir, sub)
        if os.path.isdir(d):
            for fn in sorted(os.listdir(d)):
                if os.path.isfile(os.path.join(d, fn)):
                    refs.append("%s/%s" % (sub, fn))
    return refs


# ---------------- 工具定义（单模块多工具，engine 以 TOOLS 列表加载） ----------------

def _t_list(args, ctx):
    root = _skills_root(ctx)
    skills = _find_all_skills(root)
    if not skills:
        return "OK no skills yet. Use skill_save to create one, or proceed without skills."
    lines = ["OK %d skill(s):" % len(skills)]
    for s in skills:
        lines.append("- %s | %s | %s" % (s["name"], s["title"], s["description"][:200]))
    return "\n".join(lines)


_SKILL_LIST_SCHEMA = {
    "type": "function",
    "function": {
        "name": "skill_list",
        "description": "List all available skills with metadata only (name + description). Token-efficient first tier of progressive disclosure. Call skill_view to load full instructions of one skill.",
        "parameters": {"type": "object", "properties": {}},
    },
}


# ---------------- skill_view (tier2/3) ----------------

def _t_view(args, ctx):
    root = _skills_root(ctx)
    name = args.get("name", "")
    path = _safe_skill_path(root, name, args.get("ref"))
    if (path is None or not os.path.isfile(path)) and not args.get("ref"):
        path = _safe_skill_path(root, name, "SKILL.md")
    if path is None or not os.path.isfile(path):
        return "ERR skill file not found: %s%s" % (args.get("name", ""), "/" + args["ref"] if args.get("ref") else "")
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except OSError as e:
        return "ERR read failed: %s" % e
    meta, body = _parse_frontmatter(content)
    refs = _list_refs(os.path.dirname(path))
    head = "[SKILL %s] %s\n" % (args.get("name", ""), meta.get("description", ""))
    if refs and not args.get("ref"):
        head += "[linked files: %s]\n" % ", ".join(refs)
    return "OK\n%s\n%s" % (head, body if args.get("ref") else content)


_SKILL_VIEW_SCHEMA = {
    "type": "function",
    "function": {
        "name": "skill_view",
        "description": "Load a skill's full SKILL.md instructions (tier 2), or a linked reference/template file inside it (tier 3, e.g. 'references/api.md').",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "skill name (directory name, e.g. 'debugging' or 'github/pr-review')"},
                "ref": {"type": "string", "description": "optional linked file inside the skill, e.g. 'references/examples.md'"},
            },
            "required": ["name"],
        },
    },
}


# ---------------- skill_save（自学习写入） ----------------

def _t_save(args, ctx):
    name = (args.get("name") or "").strip()
    content = args.get("content") or ""
    if not name or not re.fullmatch(r"[a-z0-9][a-z0-9/_-]*", name):
        return "ERR invalid skill name (use lowercase kebab, may contain one level of category like 'github/pr-review')"
    if not content.strip():
        return "ERR empty content"
    is_main = not args.get("ref")
    root = _skills_root(ctx)
    if is_main:
        # 多段名 = 分类/技能名，SKILL.md 写在技能目录内
        d = _safe_skill_path(root, name)
        if d is None:
            return "ERR bad path"
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, "SKILL.md")
    else:
        path = _safe_skill_path(root, name, args.get("ref"))
        if path is None:
            return "ERR bad path"
    if is_main and not args.get("description"):
        return "ERR 'description' is required when saving SKILL.md (it is what skill_list shows)"
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if is_main:
            desc = args["description"].replace("\n", " ")[:1024]
            text = "---\nname: %s\ndescription: %s\n---\n\n%s\n" % (name.split("/")[-1], desc, content.strip())
        else:
            text = content
        existed = os.path.exists(path)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    except OSError as e:
        return "ERR write failed: %s" % e
    return "OK %s skill '%s' -> %s" % ("updated" if existed else "created", name, args.get("ref") or "SKILL.md")


_SKILL_SAVE_SCHEMA = {
    "type": "function",
    "function": {
        "name": "skill_save",
        "description": "Create or update a skill (self-learning loop). Writes <name>/SKILL.md with YAML frontmatter (name/description) plus body. Pass 'ref' to save a linked file (references/templates) instead. Reuse existing skills when they already solve the task.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "skill directory name, lowercase-kebab, e.g. 'pdf-extraction'"},
                "description": {"type": "string", "description": "one-line description shown in skill_list (required when creating SKILL.md)"},
                "content": {"type": "string", "description": "SKILL.md body (markdown instructions). For 'ref' saves, the file content."},
                "ref": {"type": "string", "description": "optional linked file to save instead of SKILL.md, e.g. 'references/api.md'"},
            },
            "required": ["name", "content"],
        },
    },
}


TOOLS = [
    {"name": "skill_list", "SCHEMA": _SKILL_LIST_SCHEMA, "run": _t_list},
    {"name": "skill_view", "SCHEMA": _SKILL_VIEW_SCHEMA, "run": _t_view},
    {"name": "skill_save", "SCHEMA": _SKILL_SAVE_SCHEMA, "run": _t_save},
]
