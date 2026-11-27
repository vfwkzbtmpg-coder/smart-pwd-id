# ============================================================
#  Smart PWD ID - public access readiness check
#
#  Run in a normal PowerShell window (no admin needed):
#
#     powershell -ExecutionPolicy Bypass -File deploy\check-public-access.ps1
#
#  It answers the three questions that decide whether this PC can be
#  reached from the internet at  https://smartpwdgov.duckdns.org
#
#     1. What is my public IP, and is it a real one or a shared (CGNAT) one?
#     2. Is my DuckDNS name resolving to that same IP?
#     3. Is anything listening on 80 / 443 / 3000 on this PC?
#
#  Nothing is changed by this script - it only reads and reports.
# ============================================================
[CmdletBinding()]
param(
    [string]$Domain = 'smartpwdgov.duckdns.org'
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Head([string]$Text) {
    Write-Host ''
    Write-Host ('=' * 62) -ForegroundColor DarkGray
    Write-Host " $Text" -ForegroundColor Cyan
    Write-Host ('=' * 62) -ForegroundColor DarkGray
}

# ---------------------------------------------------------------- 1. public IP
Write-Head '1. Public IP address'

# IPv4 endpoints are asked first on purpose: DuckDNS's "A" record - the one
# router port forwarding uses - is IPv4. A plain https://api.ipify.org call
# answers over IPv6 on connections that have it, which tells us nothing about
# IPv4 reachability.
#
# The first entry is reached by raw IP literal (1.1.1.1), so it needs no DNS
# lookup at all. On connections with IPv6-only / NAT64 DNS the name-based
# services below it simply time out, while this one still answers.
$publicIp = $null
foreach ($url in @('https://1.1.1.1/cdn-cgi/trace', 'https://cloudflare.com/cdn-cgi/trace', 'https://ipv4.icanhazip.com', 'https://api.ipify.org', 'https://ipv4.ident.me')) {
    try {
        $body = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10).Content
        if ($url -like '*cdn-cgi/trace*') {
            $match = [regex]::Match($body, '(?m)^ip=([0-9a-fA-F\.:]+)\s*$')
            $answer = if ($match.Success) { $match.Groups[1].Value.Trim() } else { '' }
        } else {
            $answer = $body.Trim()
        }
        if ($answer -match '^([0-9]{1,3}\.){3}[0-9]{1,3}$') {
            $publicIp = $answer
            Write-Host "Public IPv4 : $publicIp   (via $url)"
            break
        }
    } catch { }
}

if (-not $publicIp) {
    Write-Host 'No public IPv4 address could be detected.' -ForegroundColor Red
    Write-Host 'Your connection may be IPv6-only, or it may be behind CGNAT.' -ForegroundColor Red
    Write-Host 'Check the WAN / Internet IPv4 address on your router status page next.' -ForegroundColor Yellow
} else {
    $octets = $publicIp.Split('.')
    $first  = [int]$octets[0]
    $second = [int]$octets[1]

    $isCgnat   = ($first -eq 100 -and $second -ge 64 -and $second -le 127)
    $isPrivate = ($first -eq 10) -or
                 ($first -eq 172 -and $second -ge 16 -and $second -le 31) -or
                 ($first -eq 192 -and $second -eq 168)

    if ($isCgnat) {
        Write-Host ''
        Write-Host 'VERDICT: CGNAT - your ISP shares one public IP among many customers.' -ForegroundColor Red
        Write-Host 'Port forwarding will NOT work from the internet, no matter how the' -ForegroundColor Red
        Write-Host 'router is configured. See the alternatives in the chat instructions' -ForegroundColor Red
        Write-Host '(Tailscale Funnel or a free tunnel service) before continuing.' -ForegroundColor Red
    } elseif ($isPrivate) {
        Write-Host ''
        Write-Host 'VERDICT: the address looks private, which means a carrier-grade NAT' -ForegroundColor Red
        Write-Host 'or a transparent proxy is in front of you. Port forwarding will not work.' -ForegroundColor Red
    } else {
        Write-Host ''
        Write-Host 'VERDICT: this looks like a real public IPv4 address.' -ForegroundColor Green
        Write-Host 'Port forwarding can work. Continue with the router and firewall stage.' -ForegroundColor Green
        Write-Host ''
        Write-Host 'Next: compare this with the WAN/Internet IP shown in your router page.' -ForegroundColor Yellow
        Write-Host 'They must be IDENTICAL. If the router shows a different (often 100.x)' -ForegroundColor Yellow
        Write-Host 'address, you are behind CGNAT.' -ForegroundColor Yellow
    }
}

# ------------------------------------------------------------- 2. dns lookup
Write-Head "2. Does $Domain resolve?"

try {
    $records = Resolve-DnsName -Name $Domain -Type A -ErrorAction Stop |
        Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress -Unique
    if ($records) {
        foreach ($record in $records) { Write-Host "  $Domain -> $record" }
        if ($publicIp -and ($records -contains $publicIp)) {
            Write-Host 'MATCH: DuckDNS points at this connection.' -ForegroundColor Green
        } elseif ($publicIp) {
            Write-Host 'MISMATCH: DuckDNS is not pointing at your public IP yet.' -ForegroundColor Yellow
            Write-Host 'Run the DuckDNS updater (and allow a few minutes for DNS caching).' -ForegroundColor Yellow
        }
    } else {
        Write-Host 'No A record returned yet.' -ForegroundColor Yellow
    }
} catch {
    Write-Host "Lookup failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

# -------------------------------------------------------- 3. local listeners
Write-Head '3. Local listeners (is the website running?)'

foreach ($port in @(80, 443, 3000)) {
    $listening = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    if ($listening) {
        $pid0  = ($listening | Select-Object -First 1).OwningProcess
        $name  = (Get-Process -Id $pid0 -ErrorAction SilentlyContinue).ProcessName
        Write-Host ("  port {0,-4} LISTENING  (process {1}, pid {2})" -f $port, $name, $pid0) -ForegroundColor Green
    } else {
        Write-Host ("  port {0,-4} closed" -f $port) -ForegroundColor DarkGray
    }
}

Write-Host ''
Write-Host 'Ports 80 and 443 must be free for HTTPS to be issued automatically.'
Write-Host 'Port 3000 is where the Smart PWD ID Node server listens.'
Write-Host ''
