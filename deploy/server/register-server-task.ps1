# ============================================================
#  Smart PWD ID - register the website as a Windows startup task
#
#  MUST be run in an ADMINISTRATOR PowerShell window:
#
#     Start menu -> type "PowerShell" -> right-click -> Run as administrator
#     cd "C:\Users\RYAN ANTHONY ANE\Downloads\smart_pwd_id_web_mobile_settings-20260830T164150Z-1-001\smart_pwd_id_web_mobile_settings"
#     powershell -ExecutionPolicy Bypass -File deploy\server\register-server-task.ps1
#
#  What it creates:
#     Task name : SmartPWDID-WebServer
#     Runs as   : SYSTEM (so nobody has to be logged in)
#     Trigger   : at every Windows startup, 30 seconds after boot
#     Action    : deploy\server\start-smartpwdid.ps1
#
#  The website then comes back on its own after a reboot or a power cut.
#
#  To uninstall:
#     Unregister-ScheduledTask -TaskName 'SmartPWDID-WebServer' -Confirm:$false
# ============================================================
[CmdletBinding()]
param(
    [string]$TaskName = 'SmartPWDID-WebServer',
    [string]$ProjectRoot,
    [int]$Port = 3000,
    [switch]$SkipStart
)

$ErrorActionPreference = 'Stop'

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ProjectRoot) { $ProjectRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path }
$startScript = Join-Path $scriptDir 'start-smartpwdid.ps1'

# --------------------------- preflight ---------------------------
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'This script must run as Administrator.' -ForegroundColor Red
    Write-Host 'Open the Start menu, type PowerShell, right-click it and choose' -ForegroundColor Yellow
    Write-Host '"Run as administrator", then run the command again.' -ForegroundColor Yellow
    exit 1
}

foreach ($required in @($startScript, (Join-Path $ProjectRoot 'server\server.js'), (Join-Path $ProjectRoot '.env'))) {
    if (-not (Test-Path -LiteralPath $required)) {
        Write-Host ("Missing required file: {0}" -f $required) -ForegroundColor Red
        exit 1
    }
}

Write-Host ("Project root : {0}" -f $ProjectRoot)
Write-Host ("Launcher     : {0}" -f $startScript)
Write-Host ("Port         : {0}" -f $Port)

# --------------------------- the task ----------------------------
# -WorkingDirectory is set as well as the -ProjectRoot argument so the
# script behaves the same whether Windows or a human starts it.
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -ProjectRoot "{1}" -Port {2}' -f `
    $startScript, $ProjectRoot, $Port

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument $arguments `
    -WorkingDirectory $ProjectRoot

# 30 seconds after boot: long enough for Wi-Fi, DNS and the network stack
# to be ready, so the first Supabase request does not fail.
$triggerBoot = New-ScheduledTaskTrigger -AtStartup
$triggerBoot.Delay = 'PT30S'

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)   # 0 = never time out; a web server runs forever

$runAs = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host ''
    Write-Host 'An existing SmartPWDID-WebServer task was found - replacing it.' -ForegroundColor Yellow
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $triggerBoot -Settings $settings -Principal $runAs `
    -Description 'Smart PWD ID website - Node.js server on port 3000, starts at Windows boot.' | Out-Null

Write-Host ''
Write-Host 'Task registered.' -ForegroundColor Green

if ($SkipStart) {
    Write-Host 'Skipped starting it (-SkipStart). It will start at the next reboot.' -ForegroundColor Yellow
    exit 0
}

# ------------------------- prove it works ------------------------
# A copy of the server may already be running from a manual "npm start".
# Starting a second one only produces EADDRINUSE, so warn instead.
# Only wildcard listeners collide; a 127.0.0.1-only listener (the IDE's port
# preview) does not, so it is excluded.
$alreadyListening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' }
if ($alreadyListening) {
    $owners = ($alreadyListening | Select-Object -ExpandProperty OwningProcess -Unique)
    Write-Host ''
    Write-Host ("Port {0} is already in use by process id {1}." -f $Port, ($owners -join ', ')) -ForegroundColor Yellow
    Write-Host 'That is probably a server you started by hand. Close it first, then run:' -ForegroundColor Yellow
    Write-Host ("   Stop-ScheduledTask -TaskName '{0}'; Start-ScheduledTask -TaskName '{0}'" -f $TaskName) -ForegroundColor Yellow
    exit 0
}

Write-Host ''
Write-Host 'Starting the task and checking the website answers...' -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName

$healthy = $false
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 2
    try {
        $response = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            Write-Host ''
            Write-Host ('HEALTH OK after {0} seconds:' -f ($i * 2)) -ForegroundColor Green
            Write-Host ('   {0}' -f $response.Content) -ForegroundColor Green
            $healthy = $true
            break
        }
    } catch { }
}

Write-Host ''
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ("Task state       : {0}" -f (Get-ScheduledTask -TaskName $TaskName).State)
Write-Host ("LastTaskResult   : {0}" -f $info.LastTaskResult)
Write-Host ("Next run time    : {0}" -f $info.NextRunTime)
Write-Host ("Log file         : C:\ProgramData\SmartPWDID\logs\webserver.log")

if (-not $healthy) {
    Write-Host ''
    Write-Host 'The health check did not answer. Read the log for the reason:' -ForegroundColor Red
    Write-Host '   Get-Content C:\ProgramData\SmartPWDID\logs\webserver.log -Tail 30' -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host 'Open the website now at:  http://localhost:3000/' -ForegroundColor Green
