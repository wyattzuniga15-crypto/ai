<#
.SYNOPSIS
    Tunes Minecraft: Java Edition and Windows for the highest framerate.

.DESCRIPTION
    Run it with Minecraft closed. It:
      1. Rewrites the framerate-relevant lines of options.txt (a backup is kept beside it).
      2. Tells Windows to run every Java runtime Minecraft uses on the high-performance GPU.
      3. Turns Game Mode on and Xbox background recording off.
      4. Switches the power plan to High performance.
    Everything is per-user. No admin rights are needed and nothing is installed.

.PARAMETER RenderDistance
    Chunks drawn around you. 2 is the minimum and the fastest; 4 is the default here.

.PARAMETER SimulationDistance
    Chunks that tick around you. 5 is the minimum.

.PARAMETER GameDir
    One game folder that holds options.txt. Without it, every one found is tuned:
    the official launcher's %APPDATA%\.minecraft and each Modrinth App, Prism
    Launcher and CurseForge instance.

.PARAMETER SkipWindowsTweaks
    Only change options.txt; leave GPU, Game Mode and power settings alone.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\optimize-minecraft.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\optimize-minecraft.ps1 -RenderDistance 8
#>
param(
    [ValidateRange(2, 32)][int]$RenderDistance = 4,
    [ValidateRange(5, 32)][int]$SimulationDistance = 5,
    [string]$GameDir,
    [switch]$SkipWindowsTweaks
)

$ErrorActionPreference = 'Stop'

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Done($text) { Write-Host "   $text" -ForegroundColor Green }
function Write-Note($text) { Write-Host "   $text" -ForegroundColor Yellow }

function Set-UserDword($path, $name, $value) {
    if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
    New-ItemProperty -Path $path -Name $name -Value $value -PropertyType DWord -Force | Out-Null
}

# options.txt stores booleans, numbers and quoted strings. A replacement is only
# written when it has the same kind as the value already there, so a setting a
# given version stores differently is left alone rather than corrupted.
function Get-ValueKind($value) {
    if ($value -match '^-?\d+(\.\d+)?$') { return 'number' }
    if ($value -match '^(true|false)$') { return 'bool' }
    if ($value -match '^".*"$') { return 'string' }
    return 'other'
}

# The game saves options.txt when it quits, which would undo everything below.
$game = Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like 'Minecraft*' -and $_.MainWindowTitle -notlike '*Launcher*' }
if ($game) {
    Write-Host 'Minecraft is running. Quit the game, then run this again.' -ForegroundColor Red
    exit 1
}

# --- 1. Video settings ------------------------------------------------------
Write-Step 'Minecraft video settings'

# First match wins, by kind. Keys this version doesn't have are skipped.
$wanted = [ordered]@{
    'maxFps'                 = '260'              # 260 is the slider's "Unlimited"
    'enableVsync'            = 'false'
    'renderDistance'         = "$RenderDistance"
    'simulationDistance'     = "$SimulationDistance"
    'graphicsMode'           = '0'                # Fast
    'fancyGraphics'          = 'false'            # Fast, on versions before 1.16
    'ao'                     = 'false', '0'       # Smooth lighting off (a number in older versions)
    'renderClouds'           = '"false"', 'false'
    'particles'              = '2'                # Minimal
    'entityShadows'          = 'false'
    'biomeBlendRadius'       = '0'
    'mipmapLevels'           = '0'
    'entityDistanceScaling'  = '0.5'
    'prioritizeChunkUpdates' = '0'
    'fullscreen'             = 'true'
}

function Optimize-OptionsFile($optionsPath) {
    Write-Host "   $(Split-Path $optionsPath -Parent)"
    $lines = [System.IO.File]::ReadAllLines($optionsPath)
    $changed = @()
    $skipped = @()
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -notmatch '^([^:]+):(.*)$') { continue }
        $key = $Matches[1]
        $old = $Matches[2]
        if (-not $wanted.Contains($key)) { continue }

        $kind = Get-ValueKind $old
        $new = @($wanted[$key]) | Where-Object { (Get-ValueKind $_) -eq $kind } | Select-Object -First 1
        if ($null -eq $new) { $skipped += $key; continue }
        if ($new -ne $old) {
            $lines[$i] = "${key}:$new"
            $changed += ('{0,-24} {1} -> {2}' -f $key, $old, $new)
        }
    }

    if ($changed.Count -eq 0) {
        Write-Done '  Already tuned; nothing to change.'
    } else {
        $backup = "$optionsPath.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
        Copy-Item -Path $optionsPath -Destination $backup
        # No byte-order mark: the game would read it as part of the first key.
        [System.IO.File]::WriteAllLines($optionsPath, $lines, (New-Object System.Text.UTF8Encoding $false))
        $changed | ForEach-Object { Write-Done "  $_" }
        Write-Note "  Backup: $backup"
    }
    if ($skipped.Count -gt 0) {
        Write-Note "  Left alone (stored in an unexpected format): $($skipped -join ', ')"
    }
}

if ($GameDir) {
    $gameDirs = @($GameDir)
} else {
    # Modrinth App and CurseForge keep options.txt in the instance folder itself;
    # Prism keeps it in a minecraft (older versions: .minecraft) folder inside it.
    $gameDirs = @("$env:APPDATA\.minecraft")
    $gameDirs += Get-ChildItem -Directory -ErrorAction SilentlyContinue -Path @(
        "$env:APPDATA\ModrinthApp\profiles",
        "$env:APPDATA\com.modrinth.theseus\profiles",
        "$env:USERPROFILE\curseforge\minecraft\Instances"
    ) | ForEach-Object { $_.FullName }
    $gameDirs += Get-ChildItem -Directory -ErrorAction SilentlyContinue -Path "$env:APPDATA\PrismLauncher\instances" |
        ForEach-Object { "$($_.FullName)\minecraft"; "$($_.FullName)\.minecraft" }
}

$optionsFiles = @($gameDirs | ForEach-Object { Join-Path $_ 'options.txt' } | Where-Object { Test-Path $_ } |
        ForEach-Object { (Resolve-Path $_).Path } | Select-Object -Unique)
if ($optionsFiles.Count -eq 0) {
    Write-Note 'No options.txt found. Start Minecraft once and quit it, then run this again,'
    Write-Note 'or pass -GameDir with the folder that holds options.txt.'
}
foreach ($optionsFile in $optionsFiles) { Optimize-OptionsFile $optionsFile }

if ($SkipWindowsTweaks) {
    Write-Host "`nDone. Windows settings were skipped." -ForegroundColor Cyan
    exit 0
}

# --- 2. High-performance GPU for Java ---------------------------------------
Write-Step 'High-performance GPU for Java'

# Wherever the launchers keep their bundled Java. Missing folders are ignored.
$javaRoots = @(
    "$env:LOCALAPPDATA\Packages\Microsoft.4297127D64EC6_8wekyb3d8bbwe\LocalCache\Local\runtime",
    "${env:ProgramFiles(x86)}\Minecraft Launcher\runtime",
    "$env:ProgramFiles\Minecraft Launcher\runtime",
    "$env:APPDATA\.minecraft\runtime",
    "$env:APPDATA\PrismLauncher\java",
    "$env:APPDATA\ModrinthApp\meta\java_versions",
    "$env:APPDATA\com.modrinth.theseus\meta\java_versions",
    "$env:USERPROFILE\curseforge\minecraft\Install\runtime",
    "$env:ProgramFiles\Java",
    "$env:ProgramFiles\Eclipse Adoptium",
    "$env:ProgramFiles\Zulu"
) | Where-Object { Test-Path $_ }

$javas = @($javaRoots | ForEach-Object {
        Get-ChildItem -Path $_ -Recurse -File -Include 'javaw.exe', 'java.exe' -ErrorAction SilentlyContinue
    } | Select-Object -ExpandProperty FullName -Unique)

if ($javas.Count -eq 0) {
    Write-Note 'No Java runtime found in the usual launcher folders.'
    Write-Note 'Set it by hand: Settings > System > Display > Graphics > add javaw.exe > High performance.'
} else {
    try {
        foreach ($java in $javas) {
            $key = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
            if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
            New-ItemProperty -Path $key -Name $java -Value 'GpuPreference=2;' -PropertyType String -Force | Out-Null
            Write-Done $java
        }
        Write-Note 'Only matters on PCs with two GPUs (most gaming laptops). Harmless otherwise.'
    } catch {
        Write-Note "Could not set GPU preference: $($_.Exception.Message)"
    }
}

# --- 3. Game Mode on, background recording off -------------------------------
Write-Step 'Game Mode and Xbox recording'
try {
    Set-UserDword 'HKCU:\Software\Microsoft\GameBar' 'AutoGameModeEnabled' 1
    Set-UserDword 'HKCU:\Software\Microsoft\GameBar' 'AllowAutoGameMode' 1
    Write-Done 'Game Mode on'
    Set-UserDword 'HKCU:\System\GameConfigStore' 'GameDVR_Enabled' 0
    Set-UserDword 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' 'AppCaptureEnabled' 0
    Write-Done 'Background recording off'
} catch {
    Write-Note "Could not change Game Mode settings: $($_.Exception.Message)"
}

# --- 4. Power plan ------------------------------------------------------------
Write-Step 'Power plan'
cmd /c 'powercfg /setactive SCHEME_MIN >nul 2>&1'
if ($LASTEXITCODE -eq 0) {
    Write-Done 'High performance (undo: powercfg /setactive SCHEME_BALANCED)'
} else {
    Write-Note 'This PC only offers Balanced, which is normal for many laptops.'
    Write-Note 'Use Settings > System > Power > Power mode > Best performance, and keep it plugged in.'
}

Write-Host "`nDone. Next: install Sodium (see README.md); it is the biggest single gain." -ForegroundColor Cyan
