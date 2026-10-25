   @echo off
   cd /d C:\Users\vj\Documents\SIA\Activity2\NotifEye
   docker compose up -d
   start "NotifEye backend" cmd /k npm.cmd run dev:backend
   start "NotifEye dashboard" cmd /k npm.cmd run dev -w dashboard