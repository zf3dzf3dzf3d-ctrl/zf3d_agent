@echo off
chcp 65001 >nul
title ComfyUI MiniMax-H3 (no cuda graph)
cd /d D:\ComfyUI-H3\ComfyUI_windows_portable
start "" http://127.0.0.1:8188
.\python_embeded\python.exe -s ComfyUI\main.py --windows-standalone-build --auto-launch --disable-comfy-compiler
pause
