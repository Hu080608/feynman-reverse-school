@echo off
chcp 65001 >nul
cd /d %~dp0
echo 正在打包 GUI 为 EXE...
python -m PyInstaller --noconfirm --clean --onefile --windowed --name 激活码生成器 ^
  --icon "%~dp0assets\icon.ico" ^
  --add-data "%~dp0assets;assets" ^
  --collect-all customtkinter ^
  --distpath "%~dp0dist" ^
  --workpath "%~dp0build" ^
  --specpath "%~dp0build" ^
  generate_codes_gui.py
echo.
echo 打包完成，EXE 在 dist 目录。
pause
