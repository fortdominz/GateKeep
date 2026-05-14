@echo off
echo Starting GateKeep frontend on port 5173...
cd /d "%~dp0\frontend"
node node_modules/vite/bin/vite.js
