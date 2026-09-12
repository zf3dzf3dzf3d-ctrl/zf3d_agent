#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""group_discussion - 写作工具"""
from tools.writing.backend._base import handle_writing

TOOL_NAME = 'group_discussion'
SYS_PROMPT = "你是群聊模拟器。模拟一个群聊场景，多个角色围绕主题展开讨论，各抒己见、互相回应，生成生动的群聊记录。"
TEMPERATURE = 0.7

def build_prompt(a, t):
    return "主题："+t+"\n参与角色："+(a.get("roles","3-5个不同观点的角色"))+"\n轮数："+(a.get("rounds","3-5轮"))

def handle(body, ctx):
    handle_writing(body, ctx, TOOL_NAME, SYS_PROMPT, TEMPERATURE, build_prompt)
