# Connect the local StudyAI MCP to an existing OpenAI Secure MCP Tunnel.
# Start from the StudyAI app directory: .\scripts\Start-StudyAI-Tunnel.ps1
# This launcher uses a separate studyai-local profile; it does not modify other profiles.
[CmdletBinding()]
param(
    [string]$TunnelId = '',
    [string]$TunnelClientPath = ''
)

$ErrorActionPreference = 'Stop'
$profileName = 'studyai-local'
$apiPort = 4174
$appRoot = Split-Path -Parent $PSScriptRoot
$apiProcess = $null
$hadRuntimeKey = [bool]$env:CONTROL_PLANE_API_KEY

try {
    # Ask for the tunnel ID unless one was explicitly supplied.
    if (-not $TunnelId) {
        Write-Host 'Enter your existing StudyAI tunnel ID (from OpenAI Platform > Tunnels).' -ForegroundColor Cyan
        $TunnelId = Read-Host 'Tunnel ID'
    }
    $TunnelId = $TunnelId.Trim().Trim('"').Trim("'")
    if ($TunnelId -notmatch '^tunnel_[A-Za-z0-9_-]+$' -or $TunnelId -eq 'tunnel_YOUR_ID') {
        throw 'That is not a real tunnel ID. Copy the full tunnel_... value from OpenAI Platform.'
    }

    # Use tunnel-client on PATH, otherwise prompt for the installed executable.
    if (-not $TunnelClientPath) {
        $found = Get-Command tunnel-client.exe, tunnel-client -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($found) { $TunnelClientPath = $found.Source }
    }
    if (-not $TunnelClientPath -or -not (Test-Path -LiteralPath $TunnelClientPath -PathType Leaf)) {
        Write-Host 'Tunnel client was not found on PATH.' -ForegroundColor Yellow
        $TunnelClientPath = Read-Host 'Paste full path to tunnel-client.exe'
    }
    $TunnelClientPath = $TunnelClientPath.Trim().Trim('"').Trim("'")
    if (-not (Test-Path -LiteralPath $TunnelClientPath -PathType Leaf)) {
        throw "Cannot find tunnel-client executable: $TunnelClientPath"
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Node.js was not found on PATH.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $appRoot 'node_modules\@modelcontextprotocol\sdk'))) {
        throw "StudyAI dependencies are missing. Run npm install in: $appRoot"
    }
    # Select the local port after checking any existing dedicated tunnel profile.
    # Never stop or take over a process that is already using a port.

    # Read the existing runtime key in this PowerShell process only.
    if (-not $env:CONTROL_PLANE_API_KEY) {
        $secret = Read-Host 'Enter existing tunnel runtime API key (hidden input)' -AsSecureString
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try {
            $env:CONTROL_PLANE_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        }
        if (-not $env:CONTROL_PLANE_API_KEY) { throw 'Tunnel runtime API key is required.' }
    }

    # Local MCP bearer token: generated anew on each launch, not persisted in profiles.
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $env:STUDYAI_MCP_TOKEN = [BitConverter]::ToString($bytes).Replace('-', '')
    $env:STUDYAI_MCP_AUTH_HEADER = 'Bearer ' + $env:STUDYAI_MCP_TOKEN
    $env:STUDYAI_MCP_WRITES = '0'
    $env:MCP_EXTRA_HEADERS = 'Authorization: env:STUDYAI_MCP_AUTH_HEADER'
    $env:MCP_DISCOVERY_EXTRA_HEADERS = 'Authorization: env:STUDYAI_MCP_AUTH_HEADER'

    # Follow tunnel-client's profile-directory precedence.
    if ($env:TUNNEL_CLIENT_PROFILE_DIR) {
        $profileDir = $env:TUNNEL_CLIENT_PROFILE_DIR
    } elseif ($env:XDG_CONFIG_HOME) {
        $profileDir = Join-Path $env:XDG_CONFIG_HOME 'tunnel-client'
    } else {
        $profileDir = Join-Path $env:USERPROFILE '.config\tunnel-client'
    }
    $profileFile = Join-Path $profileDir ($profileName + '.yaml')

    if (Test-Path -LiteralPath $profileFile) {
        $profileText = Get-Content -LiteralPath $profileFile -Raw
        if (-not $profileText.Contains($TunnelId)) {
            throw "Profile $profileName exists with a different tunnel ID. Inspect $profileFile before changing it."
        }
        if ($profileText -notmatch 'http://(?:127\.0\.0\.1|localhost):(\d+)/mcp') {
            throw "Existing StudyAI profile has an unexpected MCP URL. Inspect $profileFile."
        }
        $apiPort = [int]$Matches[1]
        Write-Host "Reusing StudyAI tunnel profile on local port $apiPort." -ForegroundColor Cyan
        if (Get-NetTCPConnection -LocalPort $apiPort -State Listen -ErrorAction SilentlyContinue) {
            throw "Existing StudyAI tunnel profile uses port $apiPort, which is occupied. Stop the prior StudyAI tunnel process before retrying."
        }
    } else {
        $availablePort = $null
        foreach ($candidate in 4174..4190) {
            if (-not (Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue)) {
                $availablePort = $candidate
                break
            }
        }
        if ($null -eq $availablePort) { throw 'No free port found from 4174 through 4190.' }
        $apiPort = $availablePort
        if ($apiPort -ne 4174) {
            Write-Host "Port 4174 is in use. Starting an independent StudyAI MCP on port $apiPort; your existing server stays running." -ForegroundColor Yellow
        }
        Write-Host 'Creating a dedicated StudyAI tunnel profile...' -ForegroundColor Cyan
        & $TunnelClientPath init --sample sample_mcp_remote_no_auth --profile $profileName --tunnel-id $TunnelId --mcp-server-url "http://127.0.0.1:$apiPort/mcp"
        if ($LASTEXITCODE -ne 0) { throw 'tunnel-client init failed.' }
    }

    # The new Node process inherits this port; do not disturb any existing StudyAI server.
    $env:STUDYAI_API_PORT = [string]$apiPort
    Write-Host "Starting the StudyAI MCP API on port $apiPort..." -ForegroundColor Cyan
    $node = (Get-Command node).Source
    $apiProcess = Start-Process -FilePath $node -ArgumentList @('server/index.mjs') -WorkingDirectory $appRoot -NoNewWindow -PassThru

    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
        if ($apiProcess.HasExited) { throw 'StudyAI API exited. Check the error output above.' }
        try {
            $null = Invoke-RestMethod -Uri "http://127.0.0.1:$apiPort/api/health" -TimeoutSec 2
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 300
        }
    }
    if (-not $ready) { throw 'StudyAI API did not become healthy.' }

    Write-Host 'Checking tunnel configuration...' -ForegroundColor Cyan
    & $TunnelClientPath doctor --profile $profileName --explain
    if ($LASTEXITCODE -ne 0) { throw 'Tunnel doctor failed; see diagnostic output above.' }

    Write-Host ''
    Write-Host "StudyAI MCP is running locally on port $apiPort." -ForegroundColor Green
    Write-Host "Tunnel ID: $TunnelId" -ForegroundColor Green
    Write-Host 'Keep this PowerShell window open while testing the ChatGPT connection.' -ForegroundColor Green
    Write-Host ''

    & $TunnelClientPath run --profile $profileName --health.listen-addr '127.0.0.1:0'
    if ($LASTEXITCODE -ne 0) { throw "Tunnel client stopped with exit code $LASTEXITCODE." }
}
finally {
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Stop-Process -Id $apiProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item Env:STUDYAI_API_PORT,Env:STUDYAI_MCP_TOKEN,Env:STUDYAI_MCP_AUTH_HEADER,Env:STUDYAI_MCP_WRITES,Env:MCP_EXTRA_HEADERS,Env:MCP_DISCOVERY_EXTRA_HEADERS -ErrorAction SilentlyContinue
    if (-not $hadRuntimeKey) {
        Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
    }
}
