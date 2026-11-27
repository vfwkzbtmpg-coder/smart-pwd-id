# ============================================================
#  Smart PWD ID - HTTPS gateway launcher
#
#  This is what the "SmartPWDID-HTTPS" scheduled task runs at
#  Windows startup. You can also run it by hand to test - but it
#  needs an Administrator window, because ports 80 and 443 are
#  privileged:
#
#     powershell -ExecutionPolicy Bypass -File deploy\server\start-https-gateway.ps1
#
#  It starts server/https-gateway.js, which
#     - answers Let's Encrypt's challenge and redirects on port 80
#     - terminates HTTPS on port 443
#     - forwards everything to the Express website on port 3000
#
#  Start the web server first: this gateway has nothing to forward to
#  otherwise. It will still run, and show a friendly "starting up"
#  page, so the order does not matter much in practice.
#
#  Exit codes:  0 = gateway ran and stopped cleanly
#               1 = a required file or Node.js is missing
#               3 = port 80 or 443 is already taken by another process
# ============================================================
[CmdletBinding()]
param(
    [string]$ProjectRoot
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 leaves $PSScriptRoot empty inside the param block,
# so the default paths are resolved here.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ProjectRoot) { $ProjectRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path }

$logDir  = 'C:\ProgramData\SmartPWDID\logs'
$logFile = Join-Path $logDir 'https-gateway.log'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

function Write-Log {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
    )
    $line = '{0}  {1,-5} {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    try {
        Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
        # Keep the log readable: once it passes 5 MB, keep only the last 1000 lines.
        if ((Get-Item -LiteralPath $logFile).Length -gt 5MB) {
            $tail = Get-Content -LiteralPath $logFile -Tail 1000
            Set-Content -LiteralPath $logFile -Value $tail -Encoding UTF8
        }
    } catch { }
}

Write-Log '------------------------------------------------------------'
Write-Log ("gateway launcher starting (root {0})" -f $ProjectRoot)

# ---------------------------- preflight ----------------------------
$entryPoint = Join-Path $ProjectRoot 'server\https-gateway.js'
if (-not (Test-Path -LiteralPath $entryPoint)) {
    Write-Log ("gateway entry point not found: {0}" -f $entryPoint) 'ERROR'
    exit 1
}

# Node is installed machine-wide at C:\Program Files\nodejs, but a different
# install location is fine as long as it is on PATH. Look in both places.
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
    Write-Log 'Node.js was not found. Install it from https://nodejs.org and try again.' 'ERROR'
    exit 1
}
Write-Log ("using node: {0}" -f $nodeExe)

# ------------------------ port availability ------------------------
# Only wildcard listeners (0.0.0.0 / ::) collide with the gateway's own bind,
# and a second copy would only fail with EADDRINUSE. Detect it first and say
# so in plain English instead.
$taken = @()
foreach ($p in 80, 443) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' }
    if ($listener) {
        $owners = ($listener | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
        $taken += ("port {0} is held by process id {1}" -f $p, $owners)
    }
}
if ($taken.Count -gt 0) {
    Write-Log ($taken -join '; ') 'WARN'
    Write-Log 'another web server (IIS, or a second copy of this gateway) is using the port' 'WARN'
    Write-Log 'stop it - or stop the SmartPWDID-HTTPS task - and run this again' 'WARN'
    exit 3
}

# Let the user know where the certificate stands, because a missing one is
# the single most likely reason for "https does not work yet".
$certFile = Join-Path 'C:\ProgramData\SmartPWDID\certs' 'fullchain.pem'
if (Test-Path -LiteralPath $certFile) {
    Write-Log ("certificate found: {0}" -f $certFile)
} else {
    Write-Log ("no certificate yet at {0}" -f $certFile) 'WARN'
    Write-Log 'the gateway will run http-only until one is issued by:' 'WARN'
    Write-Log '  node server\issue-cert.js' 'WARN'
}

# ------------------------------ run -------------------------------
Set-Location -LiteralPath $ProjectRoot

# --env-file is optional here: the gateway has working defaults, but loading
# .env lets HTTPS_DOMAIN and ACME_EMAIL be changed without editing code.
$envFile = Join-Path $ProjectRoot '.env'
$nodeArgs = @()
if (Test-Path -LiteralPath $envFile) { $nodeArgs += "--env-file=$envFile" }
$nodeArgs += 'server/https-gateway.js'

Write-Log ("starting: node {0}" -f ($nodeArgs -join ' '))

# The gateway writes its startup banner to stderr. With
# $ErrorActionPreference = 'Stop' PowerShell 5.1 turns merged stderr into a
# terminating error and swallows the useful message, so relax it here and log
# the text as-is instead.
$ErrorActionPreference = 'Continue'

& $nodeExe @nodeArgs 2>&1 |
    ForEach-Object {
        $text = if ($_ -is [System.Management.Automation.ErrorRecord]) {
            $_.Exception.Message
        } else {
            [string]$_
        }
        Write-Log $text
    }
$code = $LASTEXITCODE

if ($null -eq $code) { $code = 0 }

Write-Log ("gateway stopped with exit code {0}" -f $code) 'WARN'
exit $code
