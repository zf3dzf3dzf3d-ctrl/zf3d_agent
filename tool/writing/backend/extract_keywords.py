#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""extract_keywords - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'extract_keywords'
SYS_PROMPT = "你是关键词提取专家。提取最能代表文本核心内容的词语，按重要性排序；只输出关键词，不添加解释。"
TEMPERATURE = 0.3

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n数量："+str(int(a.get("count",10) or 10))+"\n格式："+(a.get("format","列表"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
