# ============================================================
#  Smart PWD ID - register the DuckDNS updater in Task Scheduler
#
#  Run this ONCE in PowerShell **as Administrator**:
#
#     powershell -ExecutionPolicy Bypass -File deploy\duckdns\register-duckdns-task.ps1
#
#  What it does:
#    - creates the task  SmartPWDID-DuckDNS
#    - runs every 5 minutes, forever, and again after every Windows restart
#    - runs as SYSTEM in the background, so nobody has to be logged in
#    - proves it works by starting the task immediately and printing the result
#
#  Remove it again with:
#     Unregister-ScheduledTask -TaskName SmartPWDID-DuckDNS -Confirm:$false
# ============================================================
[CmdletBinding()]
param(
    [string]$TaskName,
    [int]$IntervalMinutes = 5,
    [string]$ConfigPath,
    [string]$UpdateScript
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 does not fill $PSScriptRoot inside the param block,
# so the default paths are resolved here instead.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $TaskName)     { $TaskName     = 'SmartPWDID-DuckDNS' }
if (-not $ConfigPath)   { $ConfigPath   = Join-Path $scriptDir 'duckdns.config.json' }
if (-not $UpdateScript) { $UpdateScript = Join-Path $scriptDir 'update-duckdns.ps1' }

function Assert-Administrator {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host ''
        Write-Host 'This script must run as Administrator.' -ForegroundColor Red
        Write-Host 'Close this window, right-click PowerShell, choose "Run as administrator", then run it again.' -ForegroundColor Yellow
        Write-Host ''
        exit 1
    }
}

Assert-Administrator

if (-not (Test-Path -LiteralPath $UpdateScript)) {
    Write-Host "Cannot find $UpdateScript" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Host ''
    Write-Host "Cannot find $ConfigPath" -ForegroundColor Red
    Write-Host 'Copy duckdns.config.example.json to duckdns.config.json and paste your DuckDNS token first.' -ForegroundColor Yellow
    Write-Host ''
    exit 1
}

Write-Host "Update script : $UpdateScript"
Write-Host "Config file   : $ConfigPath"
Write-Host "Task name     : $TaskName"
Write-Host "Interval      : every $IntervalMinutes minutes"
Write-Host ''

# PowerShell itself is the action; -NonInteractive keeps it from ever waiting
# on a prompt in the background, -WindowStyle Hidden hides the console flash.
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -ConfigPath "{1}"' -f $UpdateScript, $ConfigPath
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments

# Two triggers: one at boot, one starting now and repeating forever. The
# repeating one is what keeps a dynamic IP address in sync during the day.
$triggerBoot = New-ScheduledTaskTrigger -AtStartup
$triggerNow  = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration ([TimeSpan]::MaxValue)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

# SYSTEM + highest privileges: the task starts at boot whether or not a user
# logs in, and needs no stored password.
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host "Task '$TaskName' already exists - replacing it." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $triggerBoot, $triggerNow `
    -Settings $settings -Principal $principal `
    -Description 'Keeps smartpwdgov.duckdns.org pointed at this PC public IP address.' | Out-Null

Write-Host "Task '$TaskName' registered." -ForegroundColor Green
Write-Host 'Starting it once now to check it works...'
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 12

$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ''
Write-Host ("Last run time   : {0}" -f $info.LastRunTime)
Write-Host ("Last result     : {0}" -f $info.LastTaskResult)
if ($info.LastTaskResult -eq 0) {
    Write-Host 'Result 0 means the updater ran successfully.' -ForegroundColor Green
} else {
    Write-Host 'Result is not 0 - open the log file named in duckdns.config.json to see why.' -ForegroundColor Yellow
}
Write-Host ''
Write-Host 'Check the log with:'
Write-Host '  Get-Content (Get-Content deploy\duckdns\duckdns.config.json | ConvertFrom-Json).logFile -Tail 20'
