#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""role_brainstorm - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'role_brainstorm'
TEMPERATURE = 0.7

def build_prompt(a, t):
    return "主题："+t+"\n角色设定："+(a.get("roles","产品经理、用户、开发者、投资人、批评家"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
