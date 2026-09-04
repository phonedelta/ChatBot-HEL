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
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("chatbot-hel-stage-{0}" -f [guid]::NewGuid().ToString("N"))

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

try {
    Write-Host "Preparing ChatBot-HEL deployment archive..."

    # Stage a clean whatsapp/ tree so we can keep .env.example while dropping every
    # other .env* secret (e.g. .env.hostinger) without fragile tar --exclude globs.
    $stageWhatsapp = Join-Path $stageRoot "whatsapp"
    New-Item -ItemType Directory -Force -Path $stageRoot | Out-Null
    & robocopy.exe $whatsappRoot $stageWhatsapp /E /NFL /NDL /NJH /NJS /NC /NS /NP `
        /XD node_modules storage .wwebjs_cache .git logs coverage .cache .npm dist `
        /XF *.sqlite *.sqlite-shm *.sqlite-wal *.sqlite-journal *.log *.session *.pem *.key
    $robocopyCode = $LASTEXITCODE
    if ($robocopyCode -ge 8) {
        throw "robocopy failed while staging deployment files (exit $robocopyCode)."
    }

    Get-ChildItem -LiteralPath $stageWhatsapp -Force -Filter ".env*" |
        Where-Object { $_.Name -ne ".env.example" } |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

    $dashDist = Join-Path $stageWhatsapp "src\dashboard\dist"
    if (Test-Path -LiteralPath $dashDist) {
        Remove-Item -LiteralPath $dashDist -Recurse -Force
    }

    if (-not (Test-Path -LiteralPath (Join-Path $stageWhatsapp ".env.example") -PathType Leaf)) {
        throw "Staged tree is missing whatsapp/.env.example."
    }

    Push-Location $stageRoot
    try {
        Invoke-Tar -TarArguments @("--format=ustar", "-cf", $archive, "whatsapp")
    }
    finally {
        Pop-Location
    }

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

    $archiveSize = (Get-Item -LiteralPath $archive).Length
    if ($archiveSize -le 0 -or $archiveSize -gt 150MB) {
        throw "Deployment archive must be between 1 byte and 150 MiB."
    }

    Write-Host ("Uploading {0:N1} MiB to {1}..." -f ($archiveSize / 1MB), $server)
    Write-Host "Pinned server fingerprint: $hostFingerprint"

    $outLog = Join-Path ([System.IO.Path]::GetTempPath()) ("chatbot-hel-deploy-out-{0}.txt" -f [guid]::NewGuid().ToString("N"))
    $errLog = Join-Path ([System.IO.Path]::GetTempPath()) ("chatbot-hel-deploy-err-{0}.txt" -f [guid]::NewGuid().ToString("N"))
    try {
        $sshArgumentList = @(
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
        $process = Start-Process -FilePath $sshCommand.Source -ArgumentList $sshArgumentList `
            -RedirectStandardInput $archive `
            -RedirectStandardOutput $outLog `
            -RedirectStandardError $errLog `
            -NoNewWindow -Wait -PassThru

        $stdout = if (Test-Path -LiteralPath $outLog) { Get-Content -LiteralPath $outLog -Raw -ErrorAction SilentlyContinue } else { "" }
        $stderr = if (Test-Path -LiteralPath $errLog) { Get-Content -LiteralPath $errLog -Raw -ErrorAction SilentlyContinue } else { "" }
        if ($stdout) { Write-Host $stdout.TrimEnd() }
        if ($stderr) { Write-Host $stderr.TrimEnd() }

        if ($process.ExitCode -ne 0) {
            throw "Deployment failed with SSH exit code $($process.ExitCode). If activation had started, the server attempted a code rollback; verify production status."
        }

        Write-Host "Deployment finished successfully."
    }
    finally {
        Remove-Item -LiteralPath $outLog, $errLog -Force -ErrorAction SilentlyContinue
    }
}
finally {
    if (Test-Path -LiteralPath $archive) {
        Remove-Item -LiteralPath $archive -Force
    }
    if (Test-Path -LiteralPath $stageRoot) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force
    }
}
