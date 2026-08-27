#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""shorten_text - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'shorten_text'
SYS_PROMPT = "你是专业内容精简专家。在保持原文核心信息和逻辑完整的前提下，删减冗余、压缩表达，使内容更加简洁有力。只输出精简后的完整文本。"
TEMPERATURE = 0.4

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n目标长度："+(a.get("target_length","缩短一半"))+"\n要求：保留核心信息，删减冗余。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
