# ============================================================
#  Smart PWD ID - DuckDNS updater
#
#  Keeps  smartpwdgov.duckdns.org  pointed at this PC's addresses.
#  Task Scheduler runs it every 5 minutes; you can also run it by hand:
#
#     powershell -ExecutionPolicy Bypass -File deploy\duckdns\update-duckdns.ps1
#
#  Two records are published, and either can be switched off in the config:
#
#     AAAA record  (ipv6=)  - the one that matters here. This PC sits behind
#                             the ISP's CGNAT, so inbound IPv4 is impossible
#                             and only IPv6 can be reached from the internet.
#     A record     (ip=)    - kept up to date as well, harmless, but it
#                             points at the ISP's shared address.
#
#  Exit codes:  0 = domain already correct, or updated successfully
#               1 = update failed after 3 attempts (see the log)
#               2 = config file missing / token not filled in
# ============================================================
[CmdletBinding()]
param(
    [string]$ConfigPath
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 does not fill $PSScriptRoot inside the param block,
# so the default paths are resolved here instead.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $ConfigPath) { $ConfigPath = Join-Path $scriptDir 'duckdns.config.json' }

# duckdns.org and the IP lookup services need TLS 1.2+; PowerShell 5.1
# still defaults to older protocols unless we say so.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:LogFile = $null

function Write-Log {
    param(
        [Parameter(Mandatory = $true)][string]$Message,
        [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
    )
    $line = '{0}  {1,-5} {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Host $line
    if (-not $script:LogFile) { return }
    try {
        $dir = Split-Path -Parent $script:LogFile
        if ($dir -and -not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
        # Keep the log readable: once it passes 1 MB, keep only the last 400 lines.
        if ((Get-Item -LiteralPath $script:LogFile).Length -gt 1MB) {
            $tail = Get-Content -LiteralPath $script:LogFile -Tail 400
            Set-Content -LiteralPath $script:LogFile -Value $tail -Encoding UTF8
        }
    } catch {
        Write-Host ("  WARN  could not write to log file: {0}" -f $_.Exception.Message)
    }
}

# ---------------------------- config ----------------------------
if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Log ("config file not found: {0}" -f $ConfigPath) 'ERROR'
    Write-Log "copy duckdns.config.example.json to duckdns.config.json and paste your token" 'ERROR'
    exit 2
}

try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
} catch {
    Write-Log ("config file is not valid JSON: {0}" -f $_.Exception.Message) 'ERROR'
    exit 2
}

$domain = ([string]$config.domain).Trim()
$token  = ([string]$config.token).Trim()
if ($config.logFile) { $script:LogFile = [string]$config.logFile }

if (-not $domain) {
    Write-Log "config.domain is empty" 'ERROR'
    exit 2
}
if (-not $token -or $token -match 'PASTE-YOUR') {
    Write-Log "config.token is empty - paste the DuckDNS token from https://www.duckdns.org" 'ERROR'
    exit 2
}

# Both records are published unless the config says otherwise. A missing key
# means "yes", so an older config file keeps working unchanged.
$publishIpv6 = -not ($config.PSObject.Properties.Name -contains 'publishIpv6') -or [bool]$config.publishIpv6
$publishIpv4 = -not ($config.PSObject.Properties.Name -contains 'publishIpv4') -or [bool]$config.publishIpv4

if (-not $publishIpv6 -and -not $publishIpv4) {
    Write-Log "config has publishIpv4 and publishIpv6 both false - nothing to do" 'ERROR'
    exit 2
}

$stateFile = Join-Path (Split-Path -Parent $ConfigPath) 'last-ip.txt'

# ---------------------------- http helper -------------------------------
# Every outbound request goes through here, pinned to IPv4 where it can be.
#
# This connection's DNS hands out NAT64 addresses (64:ff9b::/96) for ordinary
# IPv4-only sites, and the NAT64 route to duckdns.org does not work - the
# request hangs until it times out, while the very same request over IPv4 is
# answered in about a second. PowerShell's own web client prefers IPv6 and
# cannot be told otherwise, so curl.exe (which ships with Windows) does the
# work instead, with its -4 switch.
function Invoke-HttpText {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [int]$TimeoutSec = 20,
        [switch]$ForceIpv4
    )

    $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
    if (Test-Path -LiteralPath $curl) {
        $curlArgs = @('-s')
        if ($ForceIpv4) { $curlArgs += '-4' }
        $curlArgs += @('--max-time', [string]$TimeoutSec, $Url)

        # Native stderr must not become a terminating error, or the real
        # message is lost - see the note in start-smartpwdid.ps1.
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $output = & $curl @curlArgs 2>&1
        $exit   = $LASTEXITCODE
        $ErrorActionPreference = $previous

        $text = ($output | ForEach-Object {
            if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.Exception.Message } else { [string]$_ }
        }) -join "`n"

        if ($exit -ne 0) { throw ("curl exited with {0}: {1}" -f $exit, $text.Trim()) }
        return $text.Trim()
    }

    # Last resort on a machine without curl.exe. Slower, and it may choose
    # IPv6 - but it is better than failing outright.
    return (Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec).Content.Trim()
}

# ------------ this PC's own IPv6 address (checked first) -------------
# DuckDNS holds one AAAA record per name, so it has to be the address that
# stays put. Windows gives an interface two global IPv6 addresses:
#
#   SuffixOrigin = Link     the stable one - the router's firewall rule is
#                           pointed at this address
#   SuffixOrigin = Random   a "privacy" address Windows quietly replaces
#                           every day or so
#
# Publishing the privacy address would appear to work and then break by
# itself, so those are skipped.
function Get-StableLocalIpv6 {
    $metrics = @{}
    $candidates = @()
    try {
        Get-NetIPInterface -AddressFamily IPv6 -ErrorAction SilentlyContinue | ForEach-Object {
            $metrics[[int]$_.ifIndex] = [int]$_.InterfaceMetric
        }
        $candidates = @(Get-NetIPAddress -AddressFamily IPv6 -ErrorAction Stop | Where-Object {
            $_.AddressState  -eq 'Preferred' -and
            $_.SuffixOrigin  -ne 'Random'    -and
            $_.PrefixOrigin  -ne 'WellKnown' -and
            -not $_.SkipAsSource -and
            $_.IPAddress -notlike 'fe80*' -and
            $_.IPAddress -notlike 'fd*'   -and
            $_.IPAddress -notlike 'fc*'   -and
            $_.IPAddress -ne '::1'
        })
    } catch {
        Write-Log ("could not read this PC's IPv6 addresses: {0}" -f $_.Exception.Message) 'WARN'
        return $null
    }

    foreach ($candidate in $candidates) {
        $metric = if ($metrics.ContainsKey([int]$candidate.InterfaceIndex)) {
            $metrics[[int]$candidate.InterfaceIndex]
        } else { 9999 }
        Write-Log ("IPv6 address on this PC: {0} ({1}, metric {2})" -f `
            $candidate.IPAddress, $candidate.InterfaceAlias, $metric)
    }

    if ($candidates.Count -eq 0) { return $null }

    # Lowest interface metric wins - that is the adapter with the default route.
    $usable = $candidates | Sort-Object -Property @{
        Expression = {
            if ($metrics.ContainsKey([int]$_.InterfaceIndex)) { $metrics[[int]$_.InterfaceIndex] } else { 9999 }
        }
    }
    if ($usable.Count -gt 1 -and $usable[0].IPAddress -ne $candidates[0].IPAddress) {
        Write-Log ("more than one stable IPv6 address found - using {0}" -f $usable[0].IPAddress) 'WARN'
    }
    return $usable[0].IPAddress
}

# ------------------------ public address lookup -------------------------
# Only asked for what the config actually publishes, and only when this PC
# could not answer for itself.
#
# Several providers are tried because any single one can be down or blocked by
# the ISP. Two entries are addressed by raw IP literal (1.1.1.1 and
# 2606:4700:4700::1111) rather than by name, so they need no DNS lookup at
# all - which matters on connections whose DNS is IPv6-only / NAT64, where
# name-based services such as api.ipify.org simply time out.
function Get-PublicAddress {
    param(
        [bool]$WantIpv4,
        [bool]$WantIpv6
    )

    $result = @{ IPv4 = $null; IPv6 = $null }
    if (-not $WantIpv4 -and -not $WantIpv6) { return $result }

    $sources = @(
        @{ Url = 'https://1.1.1.1/cdn-cgi/trace';        Family = 'IPv4'; Format = 'trace' },
        @{ Url = 'https://cloudflare.com/cdn-cgi/trace'; Family = 'IPv4'; Format = 'trace' },
        @{ Url = 'https://ipv4.icanhazip.com';           Family = 'IPv4'; Format = 'plain' },
        @{ Url = 'https://api.ipify.org';                Family = 'IPv4'; Format = 'plain' },
        @{ Url = 'https://checkip.amazonaws.com';        Family = 'IPv4'; Format = 'plain' },
        @{ Url = 'https://ipv4.ident.me';                Family = 'IPv4'; Format = 'plain' },
        @{ Url = 'https://[2606:4700:4700::1111]/cdn-cgi/trace'; Family = 'IPv6'; Format = 'trace' },
        @{ Url = 'https://ipv6.icanhazip.com';           Family = 'IPv6'; Format = 'plain' },
        @{ Url = 'https://api64.ipify.org';              Family = 'IPv6'; Format = 'plain' }
    )

    foreach ($source in $sources) {
        $wanted = if ($source.Family -eq 'IPv4') { $WantIpv4 } else { $WantIpv6 }
        if (-not $wanted) { continue }
        if ($result[$source.Family]) { continue }

        # The raw-IPv6 source (https://[2606:...]/...) can only be reached over
        # IPv6, so it is the one request that is not pinned to IPv4.
        $pinIpv4 = $source.Url -notmatch '^https?://\['

        try {
            $body = Invoke-HttpText -Url $source.Url -TimeoutSec 10 -ForceIpv4:$pinIpv4
        } catch {
            Write-Log ("address lookup failed on {0}: {1}" -f $source.Url, $_.Exception.Message) 'WARN'
            continue
        }

        if ($source.Format -eq 'trace') {
            # Cloudflare answers with "key=value" lines; the one we want is "ip=".
            $match = [regex]::Match($body, '(?m)^ip=([0-9a-fA-F\.:]+)\s*$')
            if (-not $match.Success) {
                Write-Log ("no ip= line in the answer from {0}" -f $source.Url) 'WARN'
                continue
            }
            $answer = $match.Groups[1].Value.Trim()
        } else {
            $answer = $body.Trim()
        }

        if ($source.Family -eq 'IPv4' -and $answer -match '^([0-9]{1,3}\.){3}[0-9]{1,3}$') {
            $result.IPv4 = $answer
            Write-Log ("public IPv4 detected via {0}: {1}" -f $source.Url, $answer)
        } elseif ($source.Family -eq 'IPv6' -and $answer -match '^[0-9a-fA-F:]{6,45}$' -and $answer.Contains(':')) {
            $result.IPv6 = $answer
            Write-Log ("public IPv6 detected via {0}: {1}" -f $source.Url, $answer)
        }
    }

    return $result
}

$localIpv6 = $null
if ($publishIpv6) { $localIpv6 = Get-StableLocalIpv6 }

$addresses = Get-PublicAddress -WantIpv4 $publishIpv4 -WantIpv6 ($publishIpv6 -and -not $localIpv6)

$ipv4 = $addresses.IPv4
$ipv6 = if ($localIpv6) { $localIpv6 } else { $addresses.IPv6 }

if ($publishIpv6 -and -not $ipv6) {
    Write-Log "no IPv6 address could be found - the AAAA record cannot be updated" 'WARN'
    Write-Log "that means the website will not be reachable from the internet" 'WARN'
}

# ---------------------------- build the request -------------------------
# DuckDNS reads "ip" as IPv4 and "ipv6" as IPv6. Sending an IPv6 address in
# "ip" is answered with KO, so the two are kept strictly apart. A family that
# is switched off, or whose address could not be found, is simply left out of
# the URL so DuckDNS keeps whatever it already has.
$parts = @()
if ($publishIpv4 -and $ipv4) { $parts += ('ip={0}' -f [uri]::EscapeDataString($ipv4)) }
if ($publishIpv6 -and $ipv6) { $parts += ('ipv6={0}' -f [uri]::EscapeDataString($ipv6)) }

$updateUrl = 'https://www.duckdns.org/update?domains={0}&token={1}' -f `
    [uri]::EscapeDataString($domain), [uri]::EscapeDataString($token)

if ($parts.Count -gt 0) {
    $updateUrl += '&' + ($parts -join '&')
} else {
    Write-Log "no address could be detected - asking DuckDNS to use the sender address instead" 'WARN'
}


# ---------------------------- update ----------------------------
# DuckDNS answers "OK" when it changed a record, and a plain-English note
# such as
#    ip address for smartpwdgov.duckdns.org was already 1.2.3.4 not updated
# when the record already held that value. Both mean the request was
# accepted, so neither is a failure - only "KO" is, and that means the
# token is wrong or the sub-domain does not exist.
$answer = $null
for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
        $answer = Invoke-HttpText -Url $updateUrl -TimeoutSec 20 -ForceIpv4
    } catch {
        $answer = $null
        Write-Log ("attempt {0}/3 failed: {1}" -f $attempt, $_.Exception.Message) 'WARN'
    }

    if ($answer -and $answer -notmatch '^\s*KO\b') {
        Write-Log ("DuckDNS answered: {0}" -f $answer)
        break
    }

    if ($answer) { Write-Log ("attempt {0}/3: DuckDNS refused the update: {1}" -f $attempt, $answer) 'WARN' }
    if ($attempt -lt 3) { Start-Sleep -Seconds 15 }
}

if (-not $answer -or $answer -match '^\s*KO\b') {
    Write-Log ("update FAILED - last answer: {0}" -f ($(if ($answer) { $answer } else { '(no answer)' }))) 'ERROR'
    Write-Log "check that the token is correct and that this PC can reach https://www.duckdns.org" 'ERROR'
    exit 1
}

# ------------------------ change reporting ----------------------
# The state file records what was last published, so a change is only
# reported when something really moved.
$published = @()
if ($publishIpv4 -and $ipv4) { $published += ('A={0}' -f $ipv4) }
if ($publishIpv6 -and $ipv6) { $published += ('AAAA={0}' -f $ipv6) }
$current = $published -join '  '

$previous = $null
if (Test-Path -LiteralPath $stateFile) {
    $previous = (Get-Content -LiteralPath $stateFile -Raw).Trim()
}

if ($published.Count -eq 0) {
    Write-Log "DuckDNS accepted the update; the current address is unknown (IP lookup services unreachable)" 'WARN'
} else {
    Set-Content -LiteralPath $stateFile -Value $current -Encoding UTF8
    if (-not $previous) {
        Write-Log ("first run recorded - {0}.duckdns.org -> {1}" -f $domain, $current)
    } elseif ($previous -eq $current) {
        Write-Log ("no change - {0}.duckdns.org -> {1}" -f $domain, $current)
    } else {
        Write-Log ("address CHANGED from '{0}' to '{1}' - {2}.duckdns.org now points at the new address" -f $previous, $current, $domain) 'WARN'
    }
}

exit 0
