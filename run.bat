@echo off
cd /d "%~dp0"
echo Installing Flask (this may take a moment the first time)...
python -m pip install -r requirements.txt
echo.
echo Starting the server. Your browser will open automatically.
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:5000"
python app.py
pause
