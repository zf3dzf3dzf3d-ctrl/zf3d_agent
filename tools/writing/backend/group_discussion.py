#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""group_discussion - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'group_discussion'
TEMPERATURE = 0.7
SYS_PROMPT = ("你是圆桌讨论主持人。组织3-5位视角不同的参与者围绕主题进行多轮讨论："
              "每轮各自陈述观点并互相质疑修正，最后收敛出共识要点与保留分歧，输出简洁纪要。")

def build_prompt(a, t):
    return "主题："+t+"\n参与角色："+(a.get("roles","3-5个不同观点的角色"))+"\n轮数："+(a.get("rounds","3-5轮"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
