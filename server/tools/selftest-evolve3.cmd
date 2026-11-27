@echo off
REM i进化·肉鸽三抽 一键自测探针（重启 server 后运行本脚本复测五端点）
REM 用法：双击或在 server 目录下运行 tools\selftest-evolve3.cmd
REM 预期：skills=200；keep/skill_op=200；draw/summary 为 POST 接口，GET 探测 404/405 亦属正常（脚本只报状态码）
cd /d "%~dp0.."
echo === [1/5] GET /api/evolve/skills ===
curl -s -o NUL -w "http_code=%%{http_code}\n" "http://127.0.0.1:8620/api/evolve/skills"
echo === [2/5] POST /api/evolve/draw ===
curl -s -o NUL -w "http_code=%%{http_code}\n" -H "Content-Type: application/json" -d "{\"intent\":\"探针测试\"}" "http://127.0.0.1:8620/api/evolve/draw"
echo === [3/5] POST /api/evolve/keep ===
curl -s -o NUL -w "http_code=%%{http_code}\n" -H "Content-Type: application/json" -d "{\"card\":{\"name\":\"探针技能\",\"desc\":\"自测\"}}" "http://127.0.0.1:8620/api/evolve/keep"
echo === [4/5] POST /api/evolve/skill_op ===
curl -s -o NUL -w "http_code=%%{http_code}\n" -H "Content-Type: application/json" -d "{\"op\":\"list\"}" "http://127.0.0.1:8620/api/evolve/skill_op"
echo === [5/5] POST /api/evolve/summary ===
curl -s -o NUL -w "http_code=%%{http_code}\n" -H "Content-Type: application/json" -d "{}" "http://127.0.0.1:8620/api/evolve/summary"
echo === 判读：[1] 200=路由生效；[2] 200=LLM发卡通；[3][4] 200=沉淀/操作通；[5] 200/400=汇总接口可达 ===
pause
