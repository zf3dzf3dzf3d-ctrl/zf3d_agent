# -*- coding: utf-8 -*-
"""
超长任务（mega）上下文模式 —— 独立子系统

设计原则（对应三项用户决策）：
1. 独立线路：与现有 truncate/minimal/full 三档零共享代码路径，
   dual_protocol.py 只留一处早退分支，删掉该分支 + 本目录即可完整剥离。
2. 手动启用：默认不开启，仅当用户在设置里显式选择 ctx_mode=mega 才生效。
3. 独立存储：归档落在 server/private/mega_archive/<会话id>/，
   private 目录 HTTP 不可直读，避免对话原文与代码片段被网页抓取。

核心语义：
- 落盘：原文一字不删（turns.jsonl append-only，读回 sha256 校验）。
- 发送：按前缀缓存分层组装，token 不随轮次线性膨胀；
  细节通过 archive_search / archive_load 两个工具按需翻页取回。
"""

__all__ = ['config', 'router']
__version__ = '5.2.5-mega-1'
