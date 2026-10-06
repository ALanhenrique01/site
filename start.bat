@echo off
echo ========================================================
echo   ANA CAROLINA BEAUTY - Sistema de Agendamento
echo ========================================================
echo.
if "%PORT%"=="" set PORT=8000
echo Servidor na porta %PORT%
echo.
python -m uvicorn server:app --host 0.0.0.0 --port %PORT% --proxy-headers
pause
