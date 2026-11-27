@echo off
chcp 65001 >nul
REM i托管 P1.5 自动重派 一键自检（参照 selftest-evolve3.cmd 做法）
REM 判据①: 响应含 redispatch_count = 新代码已生效（重启生效闭环）
REM 判据②: enabled=true 且简报出现「自动重派」= 端到端真触发（85%→100% 唯一通道）
echo === i托管 P1.5 自动重派自检 ===
curl -s -m 5 http://127.0.0.1:8620/api/trustee/status > "%TEMP%\trustee_status.json"
findstr /c:"redispatch_count" "%TEMP%\trustee_status.json" >nul
if %errorlevel%==0 (
  echo [PASS] redispatch_count 字段存在 = P1.5 新代码已生效
) else (
  echo [FAIL] 无 redispatch_count = 运行中为旧代码，需重启后台
)
echo.
echo [提示] 端到端验收需真实场景：开启 i托管，LLM 审批 reject 时
echo        简报流应出现「🔁 自动重派」、面板显示「已自动重派 N 次」。
echo        在此之前任务维持 85%% 不上调。
del "%TEMP%\trustee_status.json" >nul 2>&1
pause
