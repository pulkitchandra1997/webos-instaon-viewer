param([switch]$ReadSettingsFromStdin)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-NoReparsePoint([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Simulator paths must not contain symlinks or junctions.'
            }
        }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function Test-Within([string]$Parent, [string]$Candidate) {
    $prefix = $Parent.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    return $Candidate.Equals($Parent, [StringComparison]::OrdinalIgnoreCase) -or $Candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-LocalPath([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:[\\/]' -or $Path -match '[\x00-\x1f"]') {
        throw 'Only absolute local Windows filesystem paths are supported.'
    }
    Assert-NoReparsePoint $Path
}

try {
    if (!$ReadSettingsFromStdin) { throw 'Run this launcher through npm run simulator; settings come from config.local.json.' }
    $settings = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
    if (!$projectRoot.Equals([IO.Path]::GetFullPath($settings.projectRoot), [StringComparison]::OrdinalIgnoreCase)) { throw 'Simulator project root mismatch.' }
    $appPath = Join-Path $projectRoot 'build\direct\app'
    $servicePath = Join-Path $projectRoot 'build\direct\service'
    $serviceDirectory = [IO.Path]::GetFullPath($settings.serviceDirectory)
    $simulatorExe = [IO.Path]::GetFullPath($settings.simulatorExecutable)
    foreach ($localPath in @($projectRoot, $appPath, $servicePath, $serviceDirectory, $simulatorExe)) { Assert-LocalPath $localPath }
    $profileRoot = [Environment]::GetFolderPath('UserProfile')
    if ((Test-Within $projectRoot $serviceDirectory) -or (Test-Within $serviceDirectory $projectRoot) -or $serviceDirectory -eq [IO.Path]::GetPathRoot($serviceDirectory) -or $serviceDirectory -eq $profileRoot) {
        throw 'Use a dedicated simulator service directory outside the repository.'
    }
    if ([IO.Path]::GetExtension($simulatorExe) -ne '.exe' -or !(Test-Path -LiteralPath $simulatorExe -PathType Leaf)) { throw 'Configure the webOS TV 23 Windows simulator executable.' }
    if ($settings.debugPort -isnot [int] -and $settings.debugPort -isnot [long]) { throw 'Invalid simulator debug port.' }
    $debugPort = [int]$settings.debugPort
    if ($debugPort -lt 1 -or $debugPort -gt 65535 -or $settings.debug -isnot [bool]) { throw 'Invalid simulator debug settings.' }
    foreach ($required in @((Join-Path $appPath 'index.html'), (Join-Path $servicePath 'main.cjs'), (Join-Path $servicePath 'credentials.private.json'))) {
        Assert-NoReparsePoint $required
        if (!(Test-Path -LiteralPath $required -PathType Leaf)) { throw 'Run npm run build before starting the simulator.' }
    }
    $appInfo = Get-Content -LiteralPath (Join-Path $appPath 'appinfo.json') -Raw | ConvertFrom-Json
    $serviceInfo = Get-Content -LiteralPath (Join-Path $servicePath 'services.json') -Raw | ConvertFrom-Json
    $servicePackage = Get-Content -LiteralPath (Join-Path $servicePath 'package.json') -Raw | ConvertFrom-Json
    if ($appInfo.id -ne 'org.webos.instaonviewer' -or $appInfo.main -ne 'index.html' -or $serviceInfo.id -ne 'org.webos.instaonviewer.service' -or @($serviceInfo.services).Count -ne 1 -or $serviceInfo.services[0].name -ne 'org.webos.instaonviewer.service' -or $servicePackage.name -ne 'org.webos.instaonviewer.service') {
        throw 'Staged app/service identities do not match this repository.'
    }
    # Do not traverse links while copying a credential-bearing service tree.
    foreach ($item in (Get-ChildItem -LiteralPath $servicePath -Recurse -Force)) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The staged service must not contain symlinks or junctions.' }
    }
    $simulatorOutput = Join-Path $projectRoot 'build\simulator'
    $sessionFile = Join-Path $simulatorOutput 'session.json'
    Assert-NoReparsePoint $sessionFile
    if ($settings.debug) {
        # Bind-test loopback; never connect to, restart, or terminate another process.
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), $debugPort)
        try { $listener.Server.ExclusiveAddressUse = $true; $listener.Start() }
        catch { throw 'The configured simulator debug port is occupied. Close your simulator or change config.local.json.' }
        finally { $listener.Stop() }
    }
    $sessionId = [Guid]::NewGuid().ToString('N')
    $runtimePath = Join-Path $serviceDirectory ('session-' + $sessionId)
    $browserProfile = Join-Path $simulatorOutput ('profile-' + $sessionId)
    New-Item -ItemType Directory -Path $runtimePath | Out-Null
    # The destination is fresh. Include generated private credentials without reading
    # them into logs, or changing the staged service or any previous runtime.
    foreach ($item in (Get-ChildItem -LiteralPath $servicePath -Force)) {
        Copy-Item -LiteralPath $item.FullName -Destination $runtimePath -Recurse
    }
    New-Item -ItemType Directory -Path $browserProfile -Force | Out-Null
    $launchParameters = @{ simulatorSession = $sessionId } | ConvertTo-Json -Compress
    # Escape quotes for the native Windows command-line parser, not a shell.
    $quotedParameters = '"' + $launchParameters.Replace('"', '\"') + '"'
    $launchArguments = @(('"' + $appPath + '"'), $quotedParameters, ('--user-data-dir="' + $browserProfile + '"'))
    if ($settings.debug) {
        $launchArguments += ('--remote-debugging-port=' + $debugPort)
        $launchArguments += '--remote-debugging-address=127.0.0.1'
    }
    $launched = Start-Process -FilePath $simulatorExe -ArgumentList $launchArguments -WorkingDirectory (Split-Path -Parent $simulatorExe) -WindowStyle Hidden -PassThru
    $session = [ordered]@{
        appId = 'org.webos.instaonviewer'; serviceId = 'org.webos.instaonviewer.service'
        sessionId = $sessionId; appPath = $appPath; runtimePath = $runtimePath
        debug = $settings.debug; debugPort = $debugPort; launcherPid = $launched.Id
        launchedAt = [DateTime]::UtcNow.ToString('o')
    }
    [IO.File]::WriteAllText($sessionFile, ($session | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    Write-Output 'Started this repository app in the Windows simulator. No physical-TV command was used.'
    Write-Output ('Add this fresh service directory using File > Add Service, then enable it in Tools > Service List: ' + $runtimePath)
    if ($settings.debug) { Write-Output ('Simulator CDP is bound to loopback on the configured port (' + $debugPort + ').') }
} catch {
    # Do not dump settings, generated credentials, or child command lines on failure.
    Write-Error 'Simulator launch failed. Check the local staging paths, simulator settings, and directory permissions in docs/SIMULATOR.md.'
    exit 1
}
