@echo off
chcp 65001 >nul
echo === MiniMax H3 修复脚本（管理员权限执行全部修复）===
echo.

echo [1/3] 修改启动 bat，加 --disable-comfy-compiler 参数...
powershell -NoProfile -Command "foreach($f in 'D:\ComfyUI-H3\ComfyUI_windows_portable\启动ComfyUI.bat','D:\ComfyUI-H3\ComfyUI_windows_portable\一键启动.bat'){ if(Test-Path $f){ $c=[IO.File]::ReadAllText($f); if($c -notmatch 'disable-comfy-compiler'){ $c=$c -replace 'ComfyUI\\main\.py','ComfyUI\main.py --disable-comfy-compiler'; [IO.File]::WriteAllText($f,$c); 'PATCHED: '+$f } else { 'ALREADY: '+$f } } else { 'SKIP(不存在): '+$f } }"

echo.
echo [2/3] 给 model_prefetch.py 打判空补丁...
powershell -NoProfile -Command "$f='D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\comfy\model_prefetch.py'; $c=[IO.File]::ReadAllText($f); $old='        graph._comfy_cuda_graph_modules = weakref.WeakSet()'; if($c -notmatch 'record\(\) returned None'){ $new=\"        if graph is None:`n            import logging`n            logging.warning('Comfy model compiler: malloc_graph.record() returned None, disabling for this run.')`n            return`n\" + $old; $c=$c.Replace($old,$new); Copy-Item $f ($f+'.bak'); [IO.File]::WriteAllText($f,$c); 'PATCHED model_prefetch.py' } else { 'ALREADY patched' }"

echo.
echo [3/3] 验证补丁...
findstr /c:"returned None" "D:\ComfyUI-H3\ComfyUI_windows_portable\ComfyUI\comfy\model_prefetch.py" && findstr /c:"disable-comfy-compiler" "D:\ComfyUI-H3\ComfyUI_windows_portable\启动ComfyUI.bat"
echo.
echo === 全部完成！请回到智能体对话点确认，我会帮你重启 ComfyUI 并验证。===
pause
