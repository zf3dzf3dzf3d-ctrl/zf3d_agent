@echo off
chcp 65001 >nul
echo ============================================
echo   刷新 Windows 图标缓存（修复图标显示异常）
echo ============================================
echo.

echo [1/3] 通知系统刷新图标关联...
powershell -NoProfile -Command "$sig = '[DllImport(\"shell32.dll\")] public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);'; Add-Type -MemberDefinition $sig -Name SH -Namespace Win32; [Win32.SH]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)"
echo     已发送 SHCNE_ASSOCCHANGED 通知。

echo [2/3] 停止资源管理器并清理图标缓存...
taskkill /f /im explorer.exe >nul 2>&1
timeout /t 1 /nobreak >nul

del /f /q "%LocalAppData%\IconCache.db" >nul 2>&1
del /f /q "%LocalAppData%\Microsoft\Windows\Explorer\iconcache_*.db" >nul 2>&1
del /f /q "%LocalAppData%\Microsoft\Windows\Explorer\thumbcache_*.db" >nul 2>&1
echo     缓存文件已清理。

echo [3/3] 重启资源管理器...
start explorer.exe

echo.
echo 完成！桌面和文件夹图标已强制重建缓存。
pause
