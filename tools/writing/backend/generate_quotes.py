#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""generate_quotes - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'generate_quotes'
SYS_PROMPT = "你是金句生成专家。从文章中提炼或改写出精炼有力的金句，适合引用和传播。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n数量："+str(int(a.get("count",5) or 5))+"\n风格："+(a.get("style","精炼有力"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
