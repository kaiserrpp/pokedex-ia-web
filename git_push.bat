@echo off
echo 🚀 Preparando la subida a GitHub...
git add .
git commit -m "%~1"
git push
echo ✅ ¡Subida completada! Vercel ya está trabajando en las sombras.