# -*- coding: utf-8 -*-
"""
check_prompt_sync.py — 提示词单源同步护栏

校验 public/prompts/模式1_直接聊天/用户问候.txt 中【重要例外】段落列出的素材包前缀
与 server/engines/common/material_pack_prefixes.py 的 PACK_PREFIXES 是否一致（忽略
旧版质检员兼容前缀与 PLAN_DISPLAY_PREFIX）。不一致退出码 1，防止"两处一起改"漏改。

用法：python tools/check_prompt_sync.py
"""
import io
import json
import os
import re
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "server"))

from engines.common.material_pack_prefixes import PACK_PREFIXES, PLAN_DISPLAY_PREFIX

TXT_PATH = os.path.join(ROOT, "public", "prompts", "模式1_直接聊天", "用户问候.txt")
# 旧版兼容前缀与陈列标记不要求出现在提示词文本中
OPTIONAL_IN_TEXT = {"（质检员素材包", "【质检员任务】", PLAN_DISPLAY_PREFIX, "（策划方案·陈列"}

def main():
    if not os.path.isfile(TXT_PATH):
        print(f"[check_prompt_sync] 未找到提示词文件: {TXT_PATH}")
        return 1
    text = open(TXT_PATH, encoding="utf-8", errors="replace").read()
    i = text.find("【重要例外】")
    if i < 0:
        print("[check_prompt_sync] 提示词缺少【重要例外】段落")
        return 1
    seg = text[i:i + 1200]
    # 提取「XXX…」引号内前缀
    found = set(re.findall(r"[「`]([^「」`』]{3,20}?)…?[」`]", seg))
    missing = [p for p in PACK_PREFIXES if p not in found and p not in OPTIONAL_IN_TEXT]
    if missing:
        print("[check_prompt_sync] 同步失败：以下前缀在 material_pack_prefixes.py 中存在，")
        print("  但未出现在 用户问候.txt 的【重要例外】段落（两处必须一起改）：")
        for p in missing:
            print(f"    - {p}")
        return 1
    print(f"[check_prompt_sync] OK：{len(PACK_PREFIXES)} 个前缀单源一致。")
    return 0

if __name__ == "__main__":
    sys.exit(main())
