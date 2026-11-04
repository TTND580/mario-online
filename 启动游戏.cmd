@echo off
chcp 65001 >nul
title 超级跳跃工坊 · 服务器
cd /d "%~dp0"

echo ============================================
echo   超级跳跃工坊 - 正在启动
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没找到 node，请先安装 Node.js
  pause
  exit /b 1
)

start "" http://localhost:8787
echo 手机请访问下面打印出的「局域网」地址
echo 关闭本窗口即停止服务器
echo.
node server.mjs
pause
