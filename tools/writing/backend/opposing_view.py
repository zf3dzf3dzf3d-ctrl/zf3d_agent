#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""opposing_view - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'opposing_view'
SYS_PROMPT = "你是不同观点生成器。针对文章的核心观点，提出3-5个合理的不同或反对观点，每个观点附简短理由。保持客观理性。"
TEMPERATURE = 0.6

def build_prompt(a, t):
    return "原文：\n"+t+"\n\n请提出不同观点。"

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
