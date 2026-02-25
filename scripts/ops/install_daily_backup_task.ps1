[CmdletBinding()]
param(
  [string]$RepoPath = "",
  [string]$BackupRoot = "",
  [string]$OffsitePath = "",
  [string]$DailyAt = "21:00",
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

$backupScript = Join-Path $RepoPath "scripts\ops\backup_lnz.ps1"
if (-not (Test-Path $backupScript)) {
  throw "Backup script not found: $backupScript"
}

$time = [datetime]::ParseExact($DailyAt, "HH:mm", [System.Globalization.CultureInfo]::InvariantCulture)

$argumentParts = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$backupScript`"",
  "-RepoPath", "`"$RepoPath`"",
  "-BackupRoot", "`"$BackupRoot`"",
  "-KeepLocal", "$KeepLocal",
  "-KeepOffsite", "$KeepOffsite"
)

if (-not [string]::IsNullOrWhiteSpace($OffsitePath)) {
  $argumentParts += @("-OffsitePath", "`"$OffsitePath`"")
}
if ($SkipDocker) { $argumentParts += "-SkipDocker" }
if ($AutoCheckpoint) { $argumentParts += "-AutoCheckpoint" }
if ($PushRemote) { $argumentParts += "-PushRemote" }

$arguments = ($argumentParts -join " ")

$taskName = "LNZ-Daily-Backup"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3)
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "LNZ daily backup: git, DB, uploads, env, optional offsite mirror." `
  -Force | Out-Null

Write-Host "Installed task '$taskName'."
Write-Host "Schedule: Daily at $DailyAt"
Write-Host "RepoPath: $RepoPath"
Write-Host "BackupRoot: $BackupRoot"
if (-not [string]::IsNullOrWhiteSpace($OffsitePath)) {
  Write-Host "OffsitePath: $OffsitePath"
} else {
  Write-Host "OffsitePath: (disabled)"
}
Write-Host "Task action: powershell.exe $arguments"
