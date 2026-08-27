#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""adapt_audience - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'adapt_audience'
SYS_PROMPT = "你是内容适配专家。把文章改写成适合指定目标读者阅读的版本：调整词汇难度、句式复杂度、举例方式，保留原文核心信息不改变主旨。直接输出改写后的完整文章。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "目标读者："+(a.get("audience","大众读者"))+"\n\n原文：\n"+t

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
