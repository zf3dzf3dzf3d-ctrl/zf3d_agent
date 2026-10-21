#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""translate_text - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'translate_text'
SYS_PROMPT = "你是专业翻译。准确翻译文本，保持原文的语气和风格。只输出译文，不添加解释。"
TEMPERATURE = 0.3

def build_prompt(a, t):
    return "目标语言："+(a.get("target_lang","英语"))+"\n\n原文：\n"+t

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
