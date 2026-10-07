@echo off
chcp 65001 >nul
cd /d %~dp0
set NODE_EXE=node
where node >nul 2>nul || set NODE_EXE=D:\nodejs\node.exe
echo ============================================
echo   费曼反向学校 - 激活码生成工具
echo ============================================
echo.

set /p LICENSE_SECRET=请输入 LICENSE_SECRET（必须和 Cloudflare Worker 里一致）:
set /p PID=请输入商品编号，例如 trial_1h:
set /p PRODUCT=请输入商品名称，例如 体验装-1小时:
set /p TYPE=请输入类型 time 或 count:
if /i "%TYPE%"=="time" (
  set /p DURATION=请输入时长，例如 1h、1d、30m、3600s:
) else (
  set /p USES=请输入可用次数，例如 20:
)
set /p COUNT=请输入生成数量，默认 1:
if "%COUNT%"=="" set COUNT=1
set /p OUT=请输入输出 CSV 文件名，默认 codes.csv:
if "%OUT%"=="" set OUT=codes.csv

if /i "%TYPE%"=="time" (
  "%NODE_EXE%" generate-codes.mjs --pid "%PID%" --product "%PRODUCT%" --type time --duration "%DURATION%" --count %COUNT% --out "%OUT%"
) else (
  "%NODE_EXE%" generate-codes.mjs --pid "%PID%" --product "%PRODUCT%" --type count --uses %USES% --count %COUNT% --out "%OUT%"
)

echo.
echo 生成完成：%OUT%
pause
