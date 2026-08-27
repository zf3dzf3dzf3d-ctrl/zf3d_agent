#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""analyze_text_metrics - 文本统计"""
import os
import re
from tool.coding.backend.base import ToolContext

TOOL_NAME = 'analyze_text_metrics'


def handle(body, ctx):
    text = body.get('text', '')
    if not text and body.get('path'):
        try:
            with open(body['path'], 'r', encoding='utf-8', errors='replace') as f:
                text = f.read(100000)
        except Exception as e:
            ctx.send_json({'ok': False, 'error': '读取文件失败: ' + str(e), 'tool': 'analyze_text_metrics'})
            return

    if not text or len(text) < 1:
        ctx.send_json({'ok': False, 'error': '未提供文本', 'tool': 'analyze_text_metrics'})
        return

    total = len(text)
    non_space = len(text.replace(' ', '').replace('\t', '').replace('\n', '').replace('\r', ''))
    chinese = len(re.findall(r'[\u4e00-\u9fa5]', text))
    english_words = len(re.findall(r'[a-zA-Z]+', text))
    punct = len(re.findall(r'[，。！？；：、,.!?;:""''（）()【】《》—…\-]', text))
    paragraphs = len([p for p in text.split('\n\s*\n') if p.strip()])
    sentences = len(re.findall(r'[。！？.!?]+', text))
    long_sentences = sum(1 for s in text.split('[。！？.!?]+') if len(s) > 60)
    read_min = max(1, (chinese + 400 - 1) // 400) if chinese > 0 else max(1, english_words // 200)

    metrics = {
        'total': total, 'non_space': non_space, 'chinese': chinese,
        'english_words': english_words, 'punct': punct,
        'paragraphs': paragraphs, 'sentences': sentences,
        'long_sentences': long_sentences, 'read_minutes': read_min
    }

    lines = ['📊 文本统计\n', '总字符数：%d' % total, '非空白字符：%d' % non_space,
             '中文字符：%d' % chinese, '英文单词：%d' % english_words,
             '标点符号：%d' % punct, '段落数：%d' % paragraphs,
             '句子数：%d' % sentences, '长句数（>60字）：%d' % long_sentences,
             '估算阅读时间：%d 分钟' % read_min]

    ctx.send_json({'ok': True, 'metrics': metrics, 'message': '\n'.join(lines), 'tool': 'analyze_text_metrics'})
