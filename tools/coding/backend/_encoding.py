#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""统一编码检测/读写：UTF-8 优先，失败退 GBK，彻底杜绝中文乱码。

问题根因（2026-09-11 排查）：
  read.py / replace_text.py 硬编码 encoding='utf-8', errors='replace'，
  读 GBK 中文文件时字符被替换为 U+FFFD（�），回显乱码；
  replace_text 再以 UTF-8 重写 → 原文件被永久污染。

策略：
  1. BOM 检测（utf-8-sig / utf-16）
  2. 严格 UTF-8 解码成功 → utf-8
  3. 否则按 GBK（cp936）解码，仍失败退 errors='replace' 的 utf-8
  4. 写回时用检测到的同一编码，保证 round-trip 一致
"""

BOM_ENCODINGS = ('utf-8-sig', 'utf-16', 'utf-32')


def detect_encoding(path, sample_size=64 * 1024):
    """返回 (encoding, strict)。strict=True 表示解码无替换字符。"""
    try:
        with open(path, 'rb') as f:
            head = f.read(4)
            f.seek(0)
            raw = f.read(sample_size)
    except OSError:
        return 'utf-8', True
    # BOM
    if head.startswith(b'\xef\xbb\xbf'):
        return 'utf-8-sig', True
    if head.startswith(b'\xff\xfe\x00\x00') or head.startswith(b'\x00\x00\xfe\xff'):
        return 'utf-32', True
    if head.startswith(b'\xff\xfe') or head.startswith(b'\xfe\xff'):
        return 'utf-16', True
    # 严格 UTF-8
    try:
        raw.decode('utf-8')
        return 'utf-8', True
    except UnicodeDecodeError:
        pass
    # GBK 兜底（cp936 覆盖简体中文常用区）
    try:
        raw.decode('gbk')
        return 'gbk', True
    except UnicodeDecodeError:
        return 'utf-8', False  # 彻底失败：utf-8 + replace（旧行为）


def read_text(path, max_bytes=None):
    """按检测编码读全文，返回 (text, encoding)。"""
    enc, _ = detect_encoding(path)
    with open(path, 'r', encoding=enc, errors='replace') as f:
        if max_bytes:
            text = f.read(max_bytes)
        else:
            text = f.read()
    return text, enc


def write_text(path, text, encoding=None):
    """按指定/检测编码写。encoding=None 时对二进制头探测一次。"""
    if encoding is None:
        try:
            encoding, _ = detect_encoding(path)
        except Exception:
            encoding = 'utf-8'
    with open(path, 'w', encoding=encoding, newline='') as f:
        f.write(text)
    return encoding
