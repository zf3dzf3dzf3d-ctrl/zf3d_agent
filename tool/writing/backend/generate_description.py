#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""generate_description - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'generate_description'
SYS_PROMPT = "你是介绍描述生成专家。根据内容生成简洁有力的介绍或描述文案。"
TEMPERATURE = 0.5

def build_prompt(a, t):
    return "内容：\n"+t+"\n\n类型："+(a.get("desc_type","简介"))+"\n字数："+(a.get("word_count","100-200字"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
