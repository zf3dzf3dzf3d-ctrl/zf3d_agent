#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""role_brainstorm - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'role_brainstorm'
TEMPERATURE = 0.7
SYS_PROMPT = ("你是多角色头脑风暴主持。按用户给定的角色设定让各角色轮流发言，"
              "每个发言坚守自身立场与专业视角，互相碰撞又互相补位，"
              "最后汇总创意清单并给出推荐方向。")

def build_prompt(a, t):
    return "主题："+t+"\n角色设定："+(a.get("roles","产品经理、用户、开发者、投资人、批评家"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
