[CmdletBinding()]
param(
    [string]$IdentityFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$server = "46.224.49.33"
$remoteUser = "deploy-chatbot"
$hostPublicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAII5azs/ffoyqTHQuw5h/nNB4yPWhtduIM6XqD47sIDnh"
$hostFingerprint = "SHA256:aPDFavHjpXiVUlUyLbRn391IDWy+MmaPsWGFKeuSOW8"

if ([string]::IsNullOrWhiteSpace($IdentityFile)) {
    $IdentityFile = Join-Path $env:USERPROFILE ".ssh\chatbot_hel_deploy"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$whatsappRoot = Join-Path $repoRoot "whatsapp"
$envExample = Join-Path $whatsappRoot ".env.example"
$sshDirectory = Join-Path $env:USERPROFILE ".ssh"
$knownHostsFile = Join-Path $sshDirectory "chatbot_hel_deploy_known_hosts"
$archive = Join-Path ([System.IO.Path]::GetTempPath()) ("chatbot-hel-{0}.tar" -f [guid]::NewGuid().ToString("N"))

if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
    throw "Deployment identity not found: $IdentityFile"
}
if (-not (Test-Path -LiteralPath $envExample -PathType Leaf)) {
    throw "Run this script from a complete ChatBot-HEL checkout. whatsapp/.env.example is missing."
}

$tarCommand = Get-Command tar.exe -ErrorAction Stop
$sshCommand = Get-Command ssh.exe -ErrorAction Stop
New-Item -ItemType Directory -Force -Path $sshDirectory | Out-Null

$knownHostLines = @(
    "$server $hostPublicKey",
    "[$server]:22 $hostPublicKey"
)
[System.IO.File]::WriteAllText(
    $knownHostsFile,
    (($knownHostLines -join [Environment]::NewLine) + [Environment]::NewLine),
    [System.Text.Encoding]::ASCII
)

function Invoke-Tar {
    param([string[]]$TarArguments)

    & $tarCommand.Source @TarArguments
    if ($LASTEXITCODE -ne 0) {
        throw "tar.exe failed with exit code $LASTEXITCODE."
    }
}

function Quote-NativeArgument {
    param([string]$Value)

    if ($Value -notmatch '[\s"]') {
        return $Value
    }
    return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

try {
    Write-Host "Preparing ChatBot-HEL deployment archive..."
    Push-Location $repoRoot
    try {
        $createArguments = @(
            "-cf", $archive,
            "--exclude=whatsapp/.env*",
            "--exclude=*/.env*",
            "--exclude=whatsapp/storage",
            "--exclude=whatsapp/storage/*",
            "--exclude=whatsapp/.wwebjs_cache",
            "--exclude=whatsapp/.wwebjs_cache/*",
            "--exclude=whatsapp/src/dashboard/dist",
            "--exclude=whatsapp/src/dashboard/dist/*",
            "--exclude=*/node_modules",
            "--exclude=*/node_modules/*",
            "--exclude=*/.git",
            "--exclude=*/.git/*",
            "--exclude=*/logs",
            "--exclude=*/logs/*",
            "--exclude=*/coverage",
            "--exclude=*/coverage/*",
            "--exclude=*/.cache",
            "--exclude=*/.cache/*",
            "--exclude=*/.npm",
            "--exclude=*/.npm/*",
            "--exclude=*.sqlite",
            "--exclude=*.sqlite-*",
            "--exclude=*.log",
            "--exclude=*.session",
            "--exclude=*.pem",
            "--exclude=*.key",
            "--exclude=qr-*.png",
            "whatsapp"
        )
        Invoke-Tar -TarArguments $createArguments
        Invoke-Tar -TarArguments @("-rf", $archive, "whatsapp/.env.example")

        $entries = @(& $tarCommand.Source -tf $archive)
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to inspect the deployment archive."
        }

        $normalizedEntries = @($entries | ForEach-Object { $_.Replace('\', '/').TrimEnd('/') })
        if ($normalizedEntries -notcontains "whatsapp/.env.example") {
            throw "The deployment archive does not contain whatsapp/.env.example."
        }

        foreach ($entry in $normalizedEntries) {
            if ($entry -match '(^|/)(\.git|\.ssh|\.wwebjs_cache|node_modules|storage|logs|coverage|\.cache|\.npm)(/|$)') {
                throw "Forbidden runtime or secret path found in archive: $entry"
            }
            if ($entry -match '(^|/)\.env' -and $entry -ne "whatsapp/.env.example") {
                throw "Forbidden environment file found in archive: $entry"
            }
            if ($entry -match '(?i)(\.sqlite(?:-(?:shm|wal|journal))?|\.log|\.session|\.pem|\.key)$') {
                throw "Forbidden runtime or secret file found in archive: $entry"
            }
        }
    }
    finally {
        Pop-Location
    }

    $archiveSize = (Get-Item -LiteralPath $archive).Length
    if ($archiveSize -le 0 -or $archiveSize -gt 150MB) {
        throw "Deployment archive must be between 1 byte and 150 MiB."
    }

    Write-Host ("Uploading {0:N1} MiB to {1}..." -f ($archiveSize / 1MB), $server)
    Write-Host "Pinned server fingerprint: $hostFingerprint"

    $sshArguments = @(
        "-T",
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-o", "StrictHostKeyChecking=yes",
        "-o", "ConnectTimeout=15",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=8",
        "-o", "UserKnownHostsFile=$knownHostsFile",
        "-i", $IdentityFile,
        "$remoteUser@$server"
    )
    $argumentLine = ($sshArguments | ForEach-Object { Quote-NativeArgument $_ }) -join " "
    $startProcessParameters = @{
        FilePath = $sshCommand.Source
        ArgumentList = $argumentLine
        RedirectStandardInput = $archive
        NoNewWindow = $true
        Wait = $true
        PassThru = $true
    }
    $process = Start-Process @startProcessParameters

    if ($process.ExitCode -ne 0) {
        throw "Deployment failed with SSH exit code $($process.ExitCode). If activation had started, the server attempted a code rollback; verify production status."
    }

    Write-Host "Deployment finished successfully."
}
finally {
    if (Test-Path -LiteralPath $archive) {
        Remove-Item -LiteralPath $archive -Force
    }
}
