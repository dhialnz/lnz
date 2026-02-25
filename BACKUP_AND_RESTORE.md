# Backup and Restore

## What is backed up
- Git history bundle (`lnz_*.bundle`)
- Working tree patch (`working_tree.patch`) and staged patch (`staged.patch`)
- Untracked files archive (`untracked_files.zip`)
- Postgres dump (`lnz_db_*.sql`)
- Docker uploads volume archive (`uploads_*.tar.gz`)
- Environment file copy (`.env.backup`)
- SHA-256 checksums (`sha256sums.txt`)
- Run log and summary (`backup.log`, `summary.json`)

## Run backup now (manual)
```powershell
cd c:\Users\dhiaa\programs\lnz
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops\backup_lnz.ps1
```

## Install daily scheduled backup
```powershell
cd c:\Users\dhiaa\programs\lnz
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\ops\install_daily_backup_task.ps1 -DailyAt 21:00
```

## Verify task
```powershell
schtasks /Query /TN "LNZ-Daily-Backup" /V /FO LIST
```

## Run task immediately (test)
```powershell
schtasks /Run /TN "LNZ-Daily-Backup"
```

## Restore on a new machine
1. Clone repo.
2. Restore `.env` from backup set (`.env.backup`).
3. Restore git history from bundle:
```powershell
git clone lnz_YYYYMMDD-HHMMSS.bundle lnz-restored
```
4. Restore uncommitted changes (if needed):
```powershell
git apply staged.patch
git apply working_tree.patch
```
5. Restore DB:
```powershell
docker compose up -d postgres
Get-Content .\lnz_db_YYYYMMDD-HHMMSS.sql | docker compose exec -T postgres psql -U lnz -d lnz_db
```
6. Restore uploads volume:
```powershell
docker run --rm -v lnz_uploads_data:/data -v ${PWD}:/backup alpine sh -lc "cd /data && tar xzf /backup/uploads_YYYYMMDD-HHMMSS.tar.gz"
```
7. Start app:
```powershell
docker compose up -d --build
```
