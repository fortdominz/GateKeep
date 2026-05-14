@echo off
echo Starting GateKeep backend on port 8090...
cd /d "%~dp0backend"
uvicorn api:app --host 0.0.0.0 --port 8090 --reload
