#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""change_tone - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'change_tone'
SYS_PROMPT = "你是语气改写专家。将文本转换为指定语气，保持核心内容不变。直接输出改写后的文本。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "目标语气："+(a.get("tone","正式"))+"\n\n原文：\n"+t

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
