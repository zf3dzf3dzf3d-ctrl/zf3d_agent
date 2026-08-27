#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""role_brainstorm - 写作工具"""
from tool.writing.backend._base import handle_writing

TOOL_NAME = 'role_brainstorm'
SYS_PROMPT = "你是多角色发散思维专家。从不同角色/视角对主题进行发散性思考，每个角色给出独特见解。"
TEMPERATURE = 0.7

def build_prompt(a, t):
    return "主题："+t+"\n角色设定："+(a.get("roles","产品经理、用户、开发者、投资人、批评家"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
