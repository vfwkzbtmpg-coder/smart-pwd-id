# ============================================================
#  Smart PWD ID - register the HTTPS gateway as a Windows startup task
#                 and open the firewall for it
#
#  MUST be run in an ADMINISTRATOR PowerShell window:
#
#     Start menu -> type "PowerShell" -> right-click -> Run as administrator
#     cd "C:\Users\RYAN ANTHONY ANE\Downloads\smart_pwd_id_web_mobile_settings-20260830T164150Z-1-001\smart_pwd_id_web_mobile_settings"
#     powershell -ExecutionPolicy Bypass -File deploy\server\register-gateway-task.ps1
#
#  What it does:
#     1. Windows Firewall - inbound allow rules for TCP 80 and TCP 443,
#        limited to the Node.js program, so nothing else is opened up
#     2. Task SmartPWDID-HTTPS       - the gateway itself, at every boot
#     3. Task SmartPWDID-CertRenew   - Let's Encrypt renewal, every Sunday
#     4. Starts the gateway now and checks that port 80 answers
#
#  Run register-server-task.ps1 first - the gateway has nothing to forward
#  to until the website task exists.
#
#  To uninstall:
#     Unregister-ScheduledTask -TaskName 'SmartPWDID-HTTPS' -Confirm:$false
#     Unregister-ScheduledTask -TaskName 'SmartPWDID-CertRenew' -Confirm:$false
#     Remove-NetFirewallRule -DisplayName 'SmartPWDID HTTP (TCP 80)'
#     Remove-NetFirewallRule -DisplayName 'SmartPWDID HTTPS (TCP 443)'
# ============================================================
[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [string]$TaskName = 'SmartPWDID-HTTPS',
    [string]$RenewTaskName = 'SmartPWDID-CertRenew',
    [switch]$SkipStart
)

$ErrorActionPreference = 'Stop'

$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ProjectRoot) { $ProjectRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path }
$startScript = Join-Path $scriptDir 'start-https-gateway.ps1'

# --------------------------- preflight ---------------------------
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'This script must run as Administrator.' -ForegroundColor Red
    Write-Host 'Open the Start menu, type PowerShell, right-click it and choose' -ForegroundColor Yellow
    Write-Host '"Run as administrator", then run the command again.' -ForegroundColor Yellow
    exit 1
}

foreach ($required in @($startScript, (Join-Path $ProjectRoot 'server\https-gateway.js'))) {
    if (-not (Test-Path -LiteralPath $required)) {
        Write-Host ("Missing required file: {0}" -f $required) -ForegroundColor Red
        exit 1
    }
}

# Node is needed twice: to run the gateway, and to name it in the firewall rule.
$nodeExe = $null
$onPath = Get-Command node.exe -ErrorAction SilentlyContinue
if ($onPath) {
    $nodeExe = $onPath.Source
} else {
    foreach ($candidate in @(
        'C:\Program Files\nodejs\node.exe',
        'C:\Program Files (x86)\nodejs\node.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )) {
        if (Test-Path -LiteralPath $candidate) { $nodeExe = $candidate; break }
    }
}
if (-not $nodeExe) {
    Write-Host 'Node.js was not found. Install it from https://nodejs.org and try again.' -ForegroundColor Red
    exit 1
}

Write-Host ("Project root : {0}" -f $ProjectRoot)
Write-Host ("Launcher     : {0}" -f $startScript)
Write-Host ("Node.js      : {0}" -f $nodeExe)

# ------------------------- 1. Windows Firewall -------------------------
# Windows blocks incoming connections by default. These two rules let the
# website in - and because each rule names the Node.js program, no other
# application on this PC is opened up at the same time.
Write-Host ''
Write-Host 'Opening Windows Firewall for TCP 80 and 443...' -ForegroundColor Cyan

$logDir = 'C:\ProgramData\SmartPWDID\logs'
$rules = @(
    @{ Name = 'SmartPWDID HTTP (TCP 80)';  Port = 80;  Why = "Let's Encrypt certificate checks and the redirect to https" },
    @{ Name = 'SmartPWDID HTTPS (TCP 443)'; Port = 443; Why = 'the website itself over https' }
)

foreach ($rule in $rules) {
    if (Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue) {
        Remove-NetFirewallRule -DisplayName $rule.Name
    }
    New-NetFirewallRule `
        -DisplayName $rule.Name `
        -Description ('Smart PWD ID: ' + $rule.Why) `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $rule.Port `
        -Program $nodeExe `
        -Profile Any `
        -Enabled True | Out-Null
    Write-Host ("   allowed TCP {0}" -f $rule.Port) -ForegroundColor Green
}

# --------------------------- 2. the task ----------------------------
# 45 seconds after boot rather than 30, so the website task registered by
# register-server-task.ps1 has already taken port 3000. The gateway copes
# either way - it shows a "starting up" page - but this keeps the logs clean.
$arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" -ProjectRoot "{1}"' -f `
    $startScript, $ProjectRoot

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument $arguments `
    -WorkingDirectory $ProjectRoot

$triggerBoot = New-ScheduledTaskTrigger -AtStartup
$triggerBoot.Delay = 'PT45S'

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)   # 0 = never time out; a web server runs forever

$runAs = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host ''
    Write-Host ("An existing {0} task was found - replacing it." -f $TaskName) -ForegroundColor Yellow
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $triggerBoot -Settings $settings -Principal $runAs `
    -Description 'Smart PWD ID HTTPS gateway - TLS on 443, redirect and ACME challenges on 80. Starts at Windows boot.' | Out-Null

Write-Host ("Task registered: {0}" -f $TaskName) -ForegroundColor Green

# --------------------- 3. certificate renewal task -------------------
# Let's Encrypt certificates last 90 days. This runs every Sunday and does
# nothing at all unless fewer than 30 days are left, so it is safe to leave
# running forever. The check happens inside server/issue-cert.js.
$renewLog = Join-Path $logDir 'cert-renewal.log'
$renewCommand = '$ErrorActionPreference=''Continue''; Set-Location -LiteralPath ''{0}''; & ''{1}'' ''server/issue-cert.js'' *>&1 | Tee-Object -Append -FilePath ''{2}''' -f `
    $ProjectRoot, $nodeExe, $renewLog
$renewArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "{0}"' -f $renewCommand

$renewAction = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument $renewArguments `
    -WorkingDirectory $ProjectRoot

$renewTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 3am

# A renewal only needs a few minutes; cap it so a stuck run cannot sit there
# holding the port 80 challenge folder forever.
$renewSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

if (Get-ScheduledTask -TaskName $RenewTaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $RenewTaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $RenewTaskName `
    -Action $renewAction -Trigger $renewTrigger -Settings $renewSettings -Principal $runAs `
    -Description "Smart PWD ID - weekly Let's Encrypt certificate renewal (only acts when under 30 days remain)." | Out-Null

Write-Host ("Task registered: {0}  (Sundays 03:00)" -f $RenewTaskName) -ForegroundColor Green

# ------------------------- prove it works -------------------------
if ($SkipStart) {
    Write-Host ''
    Write-Host 'Skipped starting the gateway (-SkipStart). It will start at the next reboot.' -ForegroundColor Yellow
    exit 0
}

$busy = @()
foreach ($p in 80, 443) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' }
    if ($listener) {
        $owners = ($listener | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
        $busy += ("port {0} is already in use by process id {1}" -f $p, $owners)
    }
}
if ($busy.Count -gt 0) {
    Write-Host ''
    Write-Host ($busy -join '; ') -ForegroundColor Yellow
    Write-Host 'Close whatever is using it, then run:' -ForegroundColor Yellow
    Write-Host ("   Stop-ScheduledTask -TaskName '{0}'; Start-ScheduledTask -TaskName '{0}'" -f $TaskName) -ForegroundColor Yellow
    exit 0
}

Write-Host ''
Write-Host 'Starting the gateway and checking that it answers...' -ForegroundColor Cyan
Start-ScheduledTask -TaskName $TaskName

$answering = $false
for ($i = 1; $i -le 15; $i++) {
    Start-Sleep -Seconds 2
    $listening = Get-NetTCPConnection -State Listen -LocalPort 80 -ErrorAction SilentlyContinue
    if ($listening) { $answering = $true; break }
}

Write-Host ''
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host ("Task state       : {0}" -f (Get-ScheduledTask -TaskName $TaskName).State)
Write-Host ("LastTaskResult   : {0}" -f $info.LastTaskResult)
Write-Host ("Log file         : {0}" -f (Join-Path $logDir 'https-gateway.log'))

if (-not $answering) {
    Write-Host ''
    Write-Host 'Port 80 never came up. Read the log for the reason:' -ForegroundColor Red
    Write-Host ("   Get-Content '{0}' -Tail 30" -f (Join-Path $logDir 'https-gateway.log')) -ForegroundColor Yellow
    exit 1
}

Write-Host ''
Write-Host 'Gateway is listening on port 80.' -ForegroundColor Green
Write-Host 'It redirects everything to https, so https only works once a' -ForegroundColor Gray
Write-Host 'certificate exists. Issue it with:' -ForegroundColor Gray
Write-Host '   node server\issue-cert.js' -ForegroundColor Gray
