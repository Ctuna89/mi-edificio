@echo off
rem Inicia Mi Edificio en este computador (Windows). Requiere Node.js 20 o superior.
cd /d "%~dp0"
if not exist node_modules call npm install --omit=dev
node server.mjs %*
pause
