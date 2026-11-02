#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pick_folder - 弹出 Windows 原生"浏览文件夹"对话框，返回用户选择的路径

实现方式：subprocess 调 PowerShell 的 System.Windows.Forms.FolderBrowserDialog
（项目自带 Python 无 tkinter，故用 PowerShell 方案）。
用户取消返回 {ok: True, cancelled: True}。
"""
import subprocess
from tools.coding.backend.base import ToolContext

TOOL_NAME = 'pick_folder'

_PS_SCRIPT = (
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null; "
    "$dlg = New-Object System.Windows.Forms.FolderBrowserDialog; "
    "$dlg.Description = 'Select folder'; "
    "$dlg.ShowNewFolderButton = $false; "
    "if ($dlg.ShowDialog((New-Object System.Windows.Forms.Form -Property @{TopMost=$true})) -eq [System.Windows.Forms.DialogResult]::OK) "
    "{ [Console]::Out.Write($dlg.SelectedPath) } "
    "else { [Console]::Out.Write('__CANCELLED__') }"
)

# 与 PowerShell 输出约定的取消标记
_CANCEL_MARKER = '__CANCELLED__'


def handle(body, ctx):
    try:
        # -STA 必须：FolderBrowserDialog 在 MTA 下行为异常
        # 超时 110s：须短于前端 120s，保证后端先收尾，避免双选择界面/结果被丢弃
        proc = subprocess.run(
            ['powershell', '-NoProfile', '-STA', '-NonInteractive', '-Command', _PS_SCRIPT],
            capture_output=True, timeout=110,
        )
        out = proc.stdout.decode('gbk', errors='replace').strip()
        if not out:
            ctx.send_json({'ok': False, 'error': (proc.stderr.decode('gbk', errors='replace').strip() or 'no output')})
            return
        if out == _CANCEL_MARKER:
            ctx.send_json({'ok': True, 'cancelled': True})
            return
        ctx.send_json({'ok': True, 'path': out})
    except subprocess.TimeoutExpired:
        ctx.send_json({'ok': False, 'error': 'timeout'})
    except Exception as e:
        ctx.send_json({'ok': False, 'error': str(e)})
