@echo off
title Kru Pug Server
echo ==============================================
echo        Starting Kru Pug Hub Server...
echo ==============================================
echo Please ensure XAMPP MySQL is running!
cd %~dp0
node server.js
pause
