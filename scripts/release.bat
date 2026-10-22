@echo off
REM Release Builder Launcher for Abe
REM Run this from x64 Native Tools Command Prompt
REM Usage: release.bat [-Bump patch|minor|major] [-Password pw] [-SkipBuild] [-NoSign]

cd /d "%~dp0.."
powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1 %*
