[CmdletBinding()]
param(
  [string]$RepoPath = "",
  [string]$BackupRoot = "",
  [string]$OffsitePath = "",
  [int]$KeepLocal = 30,
  [int]$KeepOffsite = 30,
  [switch]$SkipDocker,
  [switch]$AutoCheckpoint,
  [switch]$PushRemote
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-DefaultRepoPath {
  $candidate = Join-Path $PSScriptRoot "..\.."
  return (Resolve-Path $candidate).Path
}

function Write-Log {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  $line | Tee-Object -FilePath $script:LogFile -Append | Out-Null
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Action
  )

  Write-Log ("START: {0}" -f $Name)
  try {
    & $Action
    Write-Log ("DONE: {0}" -f $Name)
  } catch {
    $script:HadErrors = $true
    Write-Log ("ERROR: {0} -> {1}" -f $Name, $_.Exception.Message)
  }
}

function Prune-BackupSet {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath,
    [Parameter(Mandatory = $true)]
    [int]$KeepCount
  )

  if ($KeepCount -lt 1) {
    return
  }
  if (-not (Test-Path $RootPath)) {
    return
  }

  $dirs = @(
    Get-ChildItem -Path $RootPath -Directory |
      Where-Object { $_.Name -match "^\d{8}-\d{6}$" } |
      Sort-Object Name -Descending
  )

  if ($dirs.Count -le $KeepCount) {
    return
  }

  $toRemove = $dirs | Select-Object -Skip $KeepCount
  foreach ($dir in $toRemove) {
    Remove-Item -Path $dir.FullName -Recurse -Force
    Write-Log ("Pruned old backup: {0}" -f $dir.FullName)
  }
}

if ([string]::IsNullOrWhiteSpace($RepoPath)) {
  $RepoPath = Resolve-DefaultRepoPath
}
$RepoPath = (Resolve-Path $RepoPath).Path

if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
  $BackupRoot = Join-Path $RepoPath "backups"
}

if ([string]::IsNullOrWhiteSpace($OffsitePath)) {
  $oneDrive = Join-Path $env:USERPROFILE "OneDrive"
  if (Test-Path $oneDrive) {
    $OffsitePath = Join-Path $oneDrive "LNZ-Backups"
  }
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$targetDir = Join-Path $BackupRoot $timestamp
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
$script:LogFile = Join-Path $targetDir "backup.log"
$script:HadErrors = $false

Write-Log ("Backup started. RepoPath={0}" -f $RepoPath)
Write-Log ("Backup target: {0}" -f $targetDir)

Set-Location $RepoPath

Invoke-Step -Name "Git capture" -Action {
  $branch = (git branch --show-current)
  if ($LASTEXITCODE -ne 0) { throw "git branch --show-current failed." }
  $head = (git rev-parse HEAD)
  if ($LASTEXITCODE -ne 0) { throw "git rev-parse HEAD failed." }

  $status = git status --short --branch
  if ($LASTEXITCODE -ne 0) { throw "git status failed." }
  $status | Out-File -FilePath (Join-Path $targetDir "git_status.txt") -Encoding utf8

  $branch | Out-File -FilePath (Join-Path $targetDir "git_branch.txt") -Encoding ascii
  $head | Out-File -FilePath (Join-Path $targetDir "git_head.txt") -Encoding ascii

  git log -20 --oneline | Out-File -FilePath (Join-Path $targetDir "git_recent_commits.txt") -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "git log failed." }

  $bundlePath = Join-Path $targetDir ("lnz_{0}.bundle" -f $timestamp)
  git bundle create $bundlePath --all
  if ($LASTEXITCODE -ne 0) { throw "git bundle create failed." }

  cmd /c "git diff > ""$targetDir\working_tree.patch"""
  if ($LASTEXITCODE -ne 0) { throw "git diff failed." }

  cmd /c "git diff --staged > ""$targetDir\staged.patch"""
  if ($LASTEXITCODE -ne 0) { throw "git diff --staged failed." }

  $untrackedRaw = git ls-files --others --exclude-standard
  if ($LASTEXITCODE -ne 0) { throw "git ls-files for untracked files failed." }
  $untracked = @($untrackedRaw) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  $untracked | Out-File -FilePath (Join-Path $targetDir "untracked_files.txt") -Encoding utf8

  if ($untracked.Count -gt 0) {
    $untrackedPaths = @()
    foreach ($relativePath in $untracked) {
      $fullPath = Join-Path $RepoPath $relativePath
      if (Test-Path $fullPath) {
        $untrackedPaths += $fullPath
      }
    }
    if ($untrackedPaths.Count -gt 0) {
      Compress-Archive -LiteralPath $untrackedPaths -DestinationPath (Join-Path $targetDir "untracked_files.zip") -Force
    }
  }

  if ($AutoCheckpoint) {
    git add -A
    if ($LASTEXITCODE -ne 0) { throw "git add -A failed." }
    $msg = "backup checkpoint {0}" -f $timestamp
    git commit -m $msg | Out-File -FilePath (Join-Path $targetDir "git_checkpoint_output.txt") -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
      Write-Log "AutoCheckpoint: no new commit created (likely no staged changes)."
    } else {
      Write-Log ("AutoCheckpoint: created commit '{0}'." -f $msg)
    }
  }

  if ($PushRemote) {
    git push origin $branch | Out-File -FilePath (Join-Path $targetDir "git_push_output.txt") -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw "git push failed." }
  }
}

Invoke-Step -Name "Environment snapshot" -Action {
  $envPath = Join-Path $RepoPath ".env"
  if (Test-Path $envPath) {
    Copy-Item -Path $envPath -Destination (Join-Path $targetDir ".env.backup") -Force
    Write-Log "Copied .env to backup set."
  } else {
    Write-Log ".env not found; skipped environment snapshot."
  }
}

Invoke-Step -Name "Database and uploads snapshot" -Action {
  if ($SkipDocker) {
    Write-Log "SkipDocker specified; skipped docker snapshots."
    return
  }

  docker compose ps *> $null
  if ($LASTEXITCODE -ne 0) { throw "docker compose is unavailable in this directory." }

  $dbDumpPath = Join-Path $targetDir ("lnz_db_{0}.sql" -f $timestamp)
  docker compose exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' |
    Out-File -FilePath $dbDumpPath -Encoding utf8
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed." }

  $volumeCandidates = docker volume ls --format "{{.Name}}"
  if ($LASTEXITCODE -ne 0) { throw "docker volume ls failed." }
  $uploadsVolume = @($volumeCandidates) | Where-Object { $_ -match "_uploads_data$" } | Select-Object -First 1
  if ([string]::IsNullOrWhiteSpace($uploadsVolume)) {
    throw "Unable to locate uploads volume (*_uploads_data)."
  }

  $uploadsArchive = "uploads_{0}.tar.gz" -f $timestamp
  docker run --rm -v "${uploadsVolume}:/data" -v "${targetDir}:/backup" alpine sh -lc "cd /data && tar czf /backup/${uploadsArchive} ."
  if ($LASTEXITCODE -ne 0) { throw "Uploads volume archive failed." }
}

Invoke-Step -Name "Checksums + summary" -Action {
  $hashLines = @()
  $files = Get-ChildItem -Path $targetDir -File -Recurse | Sort-Object FullName
  foreach ($file in $files) {
    $hash = Get-FileHash -Path $file.FullName -Algorithm SHA256
    $relative = $file.FullName.Substring($targetDir.Length + 1)
    $hashLines += "{0}  {1}" -f $hash.Hash, $relative
  }
  $hashLines | Out-File -FilePath (Join-Path $targetDir "sha256sums.txt") -Encoding ascii
}

if (-not [string]::IsNullOrWhiteSpace($OffsitePath)) {
  Invoke-Step -Name "Offsite mirror" -Action {
    New-Item -ItemType Directory -Path $OffsitePath -Force | Out-Null
    $offsiteTarget = Join-Path $OffsitePath $timestamp
    Copy-Item -Path $targetDir -Destination $offsiteTarget -Recurse -Force
    Write-Log ("Mirrored backup to offsite path: {0}" -f $offsiteTarget)
  }
}

Invoke-Step -Name "Retention pruning" -Action {
  Prune-BackupSet -RootPath $BackupRoot -KeepCount $KeepLocal
  if (-not [string]::IsNullOrWhiteSpace($OffsitePath)) {
    Prune-BackupSet -RootPath $OffsitePath -KeepCount $KeepOffsite
  }
}

$summary = [ordered]@{
  timestamp = $timestamp
  repo_path = $RepoPath
  backup_path = $targetDir
  offsite_path = $OffsitePath
  keep_local = $KeepLocal
  keep_offsite = $KeepOffsite
  skip_docker = [bool]$SkipDocker
  auto_checkpoint = [bool]$AutoCheckpoint
  push_remote = [bool]$PushRemote
  had_errors = [bool]$script:HadErrors
  finished_at = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
}
$summary | ConvertTo-Json -Depth 4 | Out-File -FilePath (Join-Path $targetDir "summary.json") -Encoding utf8
$targetDir | Out-File -FilePath (Join-Path $BackupRoot "latest_backup_path.txt") -Encoding ascii

if ($script:HadErrors) {
  Write-Log "Backup completed with errors."
  exit 1
}

Write-Log "Backup completed successfully."
exit 0
