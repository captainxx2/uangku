@echo off
REM ============================================================
REM  Push UANGKU ke GitHub — jalankan SETELAH repo dibuat di github.com
REM  Pakai:  push-ke-github.bat https://github.com/USERNAME/NAMA-REPO.git
REM ============================================================
setlocal
cd /d "%~dp0"

if "%~1"=="" (
  echo.
  echo   URL repo belum diberikan.
  echo.
  echo   Langkah:
  echo     1. Buka https://github.com/new
  echo     2. Repository name: uangku     (Public)
  echo     3. JANGAN centang "Add a README" / .gitignore / license
  echo     4. Create repository, lalu salin URL yang muncul
  echo     5. Jalankan:  push-ke-github.bat ^<URL-yang-disalin^>
  echo.
  exit /b 1
)

echo.
echo   [1/4] Mengarahkan remote ke %~1
git remote set-url origin "%~1" || git remote add origin "%~1"

echo   [2/4] Memastikan branch main
git branch -M main

echo   [3/4] Push ke GitHub
git push -u origin main
if errorlevel 1 (
  echo.
  echo   Push gagal. Kalau diminta login, pilih browser/sign-in GitHub.
  echo   Kalau repo di GitHub sudah berisi commit, jalankan:
  echo       git pull --rebase origin main
  echo   lalu ulangi skrip ini.
  exit /b 1
)

echo   [4/4] Selesai.
echo.
echo   Aktifkan GitHub Pages:
echo     Settings -^> Pages -^> Source: Deploy from a branch
echo     Branch: main   Folder: / (root)   -^> Save
echo.
echo   Dashboard akan tersedia di:
echo     https://USERNAME.github.io/NAMA-REPO/
echo.
endlocal
