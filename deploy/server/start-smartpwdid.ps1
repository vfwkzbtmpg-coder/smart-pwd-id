# ============================================================
#  Smart PWD ID - production web server launcher
#
#  This is what the "SmartPWDID-WebServer" scheduled task runs at
#  Windows startup. You can also run it by hand to test:
#
#     powershell -ExecutionPolicy Bypass -File deploy\server\start-smartpwdid.ps1
#
#  It starts the project's own Express server, which serves the
#  public/ folder (the website) and the /api/ routes (Supabase).
#  No Apache, no XAMPP, no PHP.
#
#  Node is kept as a child of this script on purpose: the scheduled
#  task then owns the whole lifetime, so stopping the task stops the
#  website and starting it starts the website.
#
#  Exit codes:  0 = server ran and stopped cleanly
#               1 = a required file or Node.js is missing
#               3 = the port is already taken by another process
# ============================================================
[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 leaves $PSScriptRoot empty inside the param block,
# so the default paths are resolved here.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ProjectRoot) { $ProjectRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path }

$logDir  = 'C:\ProgramData\SmartPWDID\logs'
$logFile = Join-Path $logDir 'webserver.log'
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
Write-Log ("launcher starting (port {0}, root {1})" -f $Port, $ProjectRoot)

# ---------------------------- preflight ----------------------------
$entryPoint = Join-Path $ProjectRoot 'server\server.js'
$envFile    = Join-Path $ProjectRoot '.env'

if (-not (Test-Path -LiteralPath $entryPoint)) {
    Write-Log ("server entry point not found: {0}" -f $entryPoint) 'ERROR'
    exit 1
}
if (-not (Test-Path -LiteralPath $envFile)) {
    Write-Log ("environment file not found: {0}" -f $envFile) 'ERROR'
    Write-Log 'the server needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env' 'ERROR'
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
# Starting a second copy would only fail with EADDRINUSE, so detect it
# first and say so in plain English instead of looping.
# Only wildcard listeners (0.0.0.0 / ::) actually collide with the server's
# own bind. A listener on 127.0.0.1 alone — which is what the IDE's port
# preview creates — sits beside it happily and must be ignored here.
$inUse = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::' }
if ($inUse) {
    $owners = ($inUse | Select-Object -ExpandProperty OwningProcess -Unique) -join ', '
    Write-Log ("port {0} is already in use by process id {1} - not starting a second copy" -f $Port, $owners) 'WARN'
    Write-Log 'stop that process (or stop the SmartPWDID-WebServer task) and run this again' 'WARN'
    exit 3
}

# ------------------------------ run -------------------------------
# The working directory matters: the server resolves public/ relative to
# its own file, but .env is loaded from the project root.
Set-Location -LiteralPath $ProjectRoot

# server.js reads its port from process.env.PORT (defaulting to 3000), so the
# -Port argument has to be handed over as an environment variable - passing it
# on the command line alone would be ignored.
$env:PORT = [string]$Port

Write-Log ("public site will be served at http://localhost:{0}/" -f $Port)
Write-Log 'starting: node --env-file=.env server/server.js'

# Node writes its startup banner and every console.error to stderr. With
# $ErrorActionPreference = 'Stop' PowerShell 5.1 turns merged stderr into a
# terminating error and swallows the useful message, so relax it here and log
# the text as-is instead.
$ErrorActionPreference = 'Continue'

& $nodeExe "--env-file=$envFile" 'server/server.js' 2>&1 |
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

Write-Log ("server stopped with exit code {0}" -f $code) 'WARN'
exit $code
