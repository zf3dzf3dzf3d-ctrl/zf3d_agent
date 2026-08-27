#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""polish_text - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'polish_text'
SYS_PROMPT = "你是专业中文写作编辑。先给出1-3条简短的润色说明，然后输出润色后的完整文本。保持原文核心内容不变，优化表达、逻辑和文风。"
TEMPERATURE = 0.5

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n目标文风："+(a.get("style","更清晰"))+"\n目标长度："+(a.get("target_length","保持"))+"\n润色重点："+(a.get("focus","整体表达"))+"\n约束："+("必须严格保持原意" if a.get("preserve_meaning",True)!=False else "可以适度改写")

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
