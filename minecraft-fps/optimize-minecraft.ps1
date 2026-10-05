<#
.SYNOPSIS
    Tunes Minecraft: Java Edition and Windows for the highest framerate, or checks
    a PC for what is holding the framerate back.

.DESCRIPTION
    With no switch it changes settings (Minecraft must be closed):
      1. Rewrites the framerate-relevant lines of every options.txt it finds
         (a backup is kept beside each).
      2. Tells Windows to run every Java runtime Minecraft uses on the high-performance GPU.
      3. Turns Game Mode on and Xbox background recording off.
      4. Switches the power plan to High performance.
    Everything is per-user. No admin rights are needed and nothing is installed.

    -Check changes nothing. It reports what limits FPS on this PC: RAM speed and
    channels, which graphics chip drives the display, driver age, battery and
    power plan, and for every Minecraft instance: Sodium, FPS-heavy mods,
    shaders, high-resolution resource packs and the video settings.

    -Restore puts each options.txt back the way it was before the first run and
    switches to the Balanced power plan.

.PARAMETER RenderDistance
    Chunks drawn around you. 2 is the minimum and the fastest; 4 is the default here.

.PARAMETER SimulationDistance
    Chunks that tick around you. 5 is the minimum.

.PARAMETER GameDir
    One game folder that holds options.txt. Without it, every one found is used:
    the official launcher's %APPDATA%\.minecraft and each Modrinth App, Prism
    Launcher and CurseForge instance.

.PARAMETER SkipWindowsTweaks
    Only change options.txt; leave GPU, Game Mode and power settings alone.

.PARAMETER Check
    Report what limits FPS on this PC. Changes nothing.

.PARAMETER Restore
    Undo: restore the original options.txt files and the Balanced power plan.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\optimize-minecraft.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\optimize-minecraft.ps1 -Check

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\optimize-minecraft.ps1 -RenderDistance 8
#>
param(
    [ValidateRange(2, 32)][int]$RenderDistance = 4,
    [ValidateRange(5, 32)][int]$SimulationDistance = 5,
    [string]$GameDir,
    [switch]$SkipWindowsTweaks,
    [switch]$Check,
    [switch]$Restore
)

$ErrorActionPreference = 'Stop'

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Done($text) { Write-Host "   $text" -ForegroundColor Green }
function Write-Note($text) { Write-Host "   $text" -ForegroundColor Yellow }

# Report lines for -Check. Every [FIX] is also collected for the summary.
$script:fixes = New-Object System.Collections.Generic.List[string]
function Write-Ok($text) { Write-Host "   [ OK ] $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "   [INFO] $text" }
function Write-Fix($problem, $fix) {
    Write-Host "   [FIX ] $problem" -ForegroundColor Yellow
    Write-Host "          $fix" -ForegroundColor Yellow
    $script:fixes.Add("$problem $fix")
}

function Set-UserDword($path, $name, $value) {
    if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
    New-ItemProperty -Path $path -Name $name -Value $value -PropertyType DWord -Force | Out-Null
}

function Get-Cim($class) { Get-CimInstance -ClassName $class -ErrorAction SilentlyContinue }

# Every options.txt to work on: the one in -GameDir, or else the official
# launcher's plus each Modrinth App, Prism Launcher and CurseForge instance.
function Get-OptionsFiles {
    if ($GameDir) {
        $dirs = @($GameDir)
    } else {
        # Modrinth App and CurseForge keep options.txt in the instance folder itself;
        # Prism keeps it in a minecraft (older versions: .minecraft) folder inside it.
        $dirs = @("$env:APPDATA\.minecraft")
        $dirs += Get-ChildItem -Directory -ErrorAction SilentlyContinue -Path @(
            "$env:APPDATA\ModrinthApp\profiles",
            "$env:APPDATA\com.modrinth.theseus\profiles",
            "$env:USERPROFILE\curseforge\minecraft\Instances"
        ) | ForEach-Object { $_.FullName }
        $dirs += Get-ChildItem -Directory -ErrorAction SilentlyContinue -Path "$env:APPDATA\PrismLauncher\instances" |
            ForEach-Object { "$($_.FullName)\minecraft"; "$($_.FullName)\.minecraft" }
    }
    $dirs | ForEach-Object { Join-Path $_ 'options.txt' } | Where-Object { Test-Path $_ } |
        ForEach-Object { (Resolve-Path $_).Path } | Select-Object -Unique
}

# A readable name for the instance an options.txt belongs to.
function Get-InstanceName($optionsPath) {
    $dir = Split-Path $optionsPath -Parent
    $leaf = Split-Path $dir -Leaf
    if ($dir -eq (Join-Path $env:APPDATA '.minecraft')) { return 'Minecraft Launcher' }
    if ($leaf -eq 'minecraft' -or $leaf -eq '.minecraft') { return Split-Path (Split-Path $dir -Parent) -Leaf }
    return $leaf
}

# The game saves options.txt when it quits, which would undo any change to it.
function Assert-GameClosed {
    $game = Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -like 'Minecraft*' -and $_.MainWindowTitle -notlike '*Launcher*' }
    if ($game) {
        Write-Host 'Minecraft is running. Quit the game, then run this again.' -ForegroundColor Red
        exit 1
    }
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

function Read-KeyValues($path, $separator) {
    $values = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($path)) {
        $at = $line.IndexOf($separator)
        if ($at -gt 0) { $values[$line.Substring(0, $at).Trim()] = $line.Substring($at + 1).Trim() }
    }
    return $values
}

# A section of the -Check report. One failing query doesn't stop the rest.
function Invoke-Section($title, [scriptblock]$body) {
    Write-Step $title
    try { & $body } catch { Write-Info "Could not check this: $($_.Exception.Message)" }
}

function Test-Instance($optionsPath, $onlyInstance) {
    $dir = Split-Path $optionsPath -Parent
    Write-Info $dir
    $opts = Read-KeyValues $optionsPath ':'

    # Video settings
    $slow = @()
    if ($opts['enableVsync'] -eq 'true') { $slow += 'VSync is on' }
    if ($opts['maxFps'] -match '^\d+$' -and [int]$opts['maxFps'] -lt 260) { $slow += "FPS is capped at $($opts['maxFps'])" }
    if ($opts['graphicsMode'] -eq '2') { $slow += 'graphics are on Fabulous' }
    if ($opts['renderDistance'] -match '^\d+$' -and [int]$opts['renderDistance'] -gt 8) { $slow += "render distance is $($opts['renderDistance'])" }
    if ($slow.Count) {
        Write-Fix "Video settings: $($slow -join ', ')." 'Run the optimizer (without -Check) to fix these.'
    } else {
        Write-Ok "Video settings tuned (render distance $($opts['renderDistance']))"
    }

    if ($opts['resourcePacks'] -match '(?<!\d)(64|128|256|512)x') {
        Write-Fix "A $($Matches[1])x resource pack is on." 'High-resolution packs cost FPS and memory. Use a 16x or 32x pack.'
    }

    # Mods
    $modsDir = Join-Path $dir 'mods'
    $jars = @()
    if (Test-Path $modsDir) {
        $jars = @(Get-ChildItem -Path $modsDir -File | Where-Object { $_.Extension -eq '.jar' } | ForEach-Object { $_.Name })
    }
    if ($jars.Count -eq 0 -and $onlyInstance) {
        Write-Fix 'No mods, so this is plain Minecraft.' 'Install Fabric and Sodium, or the Fabulously Optimized modpack. Sodium is the biggest FPS gain there is.'
    } elseif ($jars.Count -eq 0) {
        Write-Info 'No mods (plain Minecraft). If you play this one, install Fabric and Sodium.'
    } else {
        Write-Info "$($jars.Count) mods"
        if ($jars -match '^(sodium-(fabric|neoforge|forge|mc|\d)|embeddium|rubidium|celeritas)') {
            Write-Ok 'Sodium installed'
        } else {
            Write-Fix 'Sodium is not installed.' 'Add it from Modrinth. It is the biggest FPS gain there is.'
        }

        $recommended = [ordered]@{
            'Lithium'         = '^lithium'
            'FerriteCore'     = '^ferritecore'
            'ImmediatelyFast' = '^immediatelyfast'
            'Entity Culling'  = '^entityculling'
            'More Culling'    = '^moreculling'
            'ModernFix'       = '^modernfix'
        }
        $missing = @($recommended.Keys | Where-Object { -not ($jars -match $recommended[$_]) })
        if ($missing.Count) {
            Write-Info "Also worth adding: $($missing -join ', ')"
        } else {
            Write-Ok 'All the recommended performance mods are installed'
        }

        # File-name pattern, what it is, what to do about it.
        $heavy = @(
            @('^(optifine|optifabric|preview_optifine)', 'OptiFine', 'It is slower than Sodium and breaks it. Remove it.'),
            @('^distanthorizons', 'Distant Horizons', 'It draws terrain far past your render distance. Remove it, or turn its distance right down.'),
            @('^physics-?mod', 'Physics Mod', 'It is very heavy on the CPU. Remove it.'),
            @('^bobby', 'Bobby', 'It keeps drawing chunks past the server render distance. Lower its setting or remove it.'),
            @('^(xaero|journeymap|voxelmap)', 'A map mod', 'Maps cost some FPS. Remove it if you can do without.'),
            @('^(skinlayers3d|3dskinlayers)', '3D Skin Layers', 'It costs FPS around other players. Remove it for max FPS.'),
            @('^notenoughanimations', 'Not Enough Animations', 'It costs some FPS. Remove it for max FPS.'),
            @('^(entity_model_features|entity_texture_features)', 'EMF / ETF (Fresh Animations)', 'Animated mob models cost FPS. Remove them for max FPS.')
        )
        foreach ($h in $heavy) {
            $found = @($jars -match $h[0])
            if ($found.Count) { Write-Fix "$($h[1]) is installed ($($found[0]))." $h[2] }
        }

        if ($jars.Count -gt 100) { Write-Info 'Big modpack: give it at least 6 GB of memory.' }
    }

    # Shaders (Iris)
    $iris = Join-Path (Join-Path $dir 'config') 'iris.properties'
    if (Test-Path $iris) {
        $props = Read-KeyValues $iris '='
        if ($props['enableShaders'] -eq 'true' -and $props['shaderPack']) {
            Write-Fix "Shaders are on ($($props['shaderPack']))." 'Press K in game to turn them off. Shaders can cost 80-90% of your FPS.'
        } else {
            Write-Ok 'Shaders off'
        }
    }
}

# --- Check -------------------------------------------------------------------
if ($Check) {
    Write-Host 'Checking what limits Minecraft FPS on this PC. Nothing will be changed.' -ForegroundColor Cyan

    $batteries = @(Get-Cim Win32_Battery)
    $chassis = @(Get-Cim Win32_SystemEnclosure | ForEach-Object { $_.ChassisTypes })
    $isLaptop = $batteries.Count -gt 0 -or @($chassis | Where-Object { $_ -in 8, 9, 10, 14, 30, 31, 32 }).Count -gt 0

    Invoke-Section 'Processor' {
        $cpu = @(Get-Cim Win32_Processor)[0]
        Write-Info ('{0}: {1} cores, {2} threads' -f $cpu.Name.Trim(), $cpu.NumberOfCores, $cpu.NumberOfLogicalProcessors)
        Write-Info 'Minecraft leans on one core, so this sets your FPS ceiling more than the graphics card does.'
    }

    Invoke-Section 'Memory' {
        $sticks = @(Get-Cim Win32_PhysicalMemory)
        if ($sticks.Count -eq 0) { Write-Info 'Windows did not report the memory details.'; return }
        $totalGB = [math]::Round(($sticks | Measure-Object -Property Capacity -Sum).Sum / 1GB)
        Write-Info "$totalGB GB in $($sticks.Count) stick(s)"
        if ($totalGB -lt 8) {
            Write-Fix "Only $totalGB GB of RAM." 'Modded Minecraft wants 8 GB at least; 16 GB is comfortable.'
        }
        if ($sticks.Count -eq 1 -and -not $isLaptop) {
            Write-Fix 'One RAM stick, so memory runs single-channel.' 'Two matching sticks are noticeably faster in Minecraft.'
        }

        $memType = switch ([int]$sticks[0].SMBIOSMemoryType) { 26 { 'DDR4' } 34 { 'DDR5' } default { '' } }
        $speed = [int]($sticks | Measure-Object -Property ConfiguredClockSpeed -Minimum).Minimum
        # Some boards report the clock, which is half the transfer rate.
        if (($memType -eq 'DDR4' -and $speed -le 1600) -or ($memType -eq 'DDR5' -and $speed -lt 3000)) { $speed *= 2 }

        # Most kits print their rated speed in the part number (F4-3600C16..., CMK16GX4M2B3200C16).
        $rated = 0
        foreach ($stick in $sticks) {
            foreach ($m in [regex]::Matches([string]$stick.PartNumber, '(?<!\d)([2-8]\d{3})(?!\d)')) {
                $n = [int]$m.Groups[1].Value
                if ($n -ge 2400 -and $n -le 8800 -and $n -gt $rated) { $rated = $n }
            }
        }

        if ($speed -le 0) {
            Write-Info 'RAM speed not reported.'
        } elseif ($isLaptop) {
            Write-Info ("$memType $speed MT/s").Trim()
        } elseif ($rated -gt $speed * 1.05) {
            Write-Fix "RAM runs at $speed MT/s but is rated for $rated." 'Turn on XMP / EXPO / DOCP in the BIOS (Profile 1).'
        } elseif ($rated -eq 0 -and (($memType -eq 'DDR4' -and $speed -le 2666) -or ($memType -eq 'DDR5' -and $speed -le 4800))) {
            Write-Fix "RAM runs at $speed MT/s, the standard default speed." 'If the RAM box or label shows a higher number, turn on XMP / EXPO in the BIOS.'
        } else {
            Write-Ok ("$memType $speed MT/s").Trim()
        }

        $share = if ($totalGB -le 8) { '3 GB (3072 MB)' } elseif ($totalGB -le 16) { '4-6 GB (4096-6144 MB)' } else { '6-8 GB (6144-8192 MB)' }
        Write-Info "Give Minecraft $share in your launcher's memory setting."
    }

    Invoke-Section 'Graphics' {
        $all = @(Get-Cim Win32_VideoController)
        if (@($all | Where-Object { $_.Name -match 'Basic Display' }).Count) {
            Write-Fix 'A graphics chip has no driver (Windows calls it Microsoft Basic Display Adapter).' 'Install the driver from nvidia.com, amd.com or intel.com.'
        }
        $gpus = @($all | Where-Object { $_.Name -notmatch 'Basic Display|Remote Display|Virtual|Parsec|Idd|DisplayLink|Mirage|Citrix|Hyper-V' } |
                ForEach-Object {
                    [pscustomobject]@{
                        Name       = $_.Name.Trim()
                        # Ryzen chips with built-in graphics call them "Radeon RX Vega 8 Graphics".
                        Card       = $_.Name -match 'NVIDIA|GeForce|Quadro|Radeon RX|Radeon Pro|Arc\(TM\) [AB]\d|Arc [AB]\d' -and $_.Name -notmatch 'Vega \d+ Graphics'
                        Display    = $_.CurrentHorizontalResolution -gt 0
                        Hz         = $_.CurrentRefreshRate
                        DriverDate = $_.DriverDate
                    }
                })

        foreach ($g in $gpus) {
            $kind = if ($g.Card) { 'graphics card' } else { 'built-in graphics' }
            $shows = if ($g.Display) { ', drives the display' } else { '' }
            Write-Info "$($g.Name) ($kind$shows)"
        }

        $cards = @($gpus | Where-Object { $_.Card })
        if ($cards.Count -eq 0) {
            Write-Info 'Built-in graphics only, so Sodium and a low render distance matter even more.'
        } elseif (-not $isLaptop -and -not @($cards | Where-Object { $_.Display }).Count -and @($gpus | Where-Object { $_.Display }).Count) {
            Write-Fix 'The monitor is plugged into the motherboard, so the graphics card sits idle.' 'Move the cable to the ports on the graphics card (lower down on the back of the PC).'
        }

        $checkDrivers = if ($cards.Count) { $cards } else { $gpus }
        foreach ($g in $checkDrivers) {
            if (-not $g.DriverDate) { continue }
            $when = ([datetime]$g.DriverDate).ToString('MMMM yyyy')
            if ([datetime]$g.DriverDate -lt (Get-Date).AddMonths(-12)) {
                Write-Fix "The $($g.Name) driver is from $when." 'Update it from nvidia.com, amd.com or intel.com, or the NVIDIA app / AMD Adrenalin.'
            } else {
                Write-Ok "Driver from $when"
            }
        }

        $hz = @($gpus | Where-Object { $_.Display -and $_.Hz -gt 0 } | ForEach-Object { [int]$_.Hz })
        if ($hz.Count) {
            $top = ($hz | Measure-Object -Maximum).Maximum
            if ($top -le 60) {
                Write-Info "Display runs at $top Hz. If it is a 120/144/165/240 Hz monitor, set that in Settings > System > Display > Advanced display."
            } else {
                Write-Ok "Display runs at $top Hz"
            }
        }

        if ($cards.Count -and $gpus.Count -gt 1) {
            $key = 'HKCU:\Software\Microsoft\DirectX\UserGpuPreferences'
            $set = @()
            if (Test-Path $key) {
                $item = Get-Item $key
                $set = @($item.GetValueNames() | Where-Object { $_ -match 'javaw?\.exe$' -and $item.GetValue($_) -match 'GpuPreference=2' })
            }
            if ($set.Count) {
                Write-Ok 'Java is set to use the graphics card'
            } else {
                Write-Fix 'Java is not set to use the graphics card.' 'Run the optimizer (without -Check); it sets this.'
            }
        }
    }

    Invoke-Section 'Power' {
        if ($isLaptop) {
            if (@($batteries | Where-Object { $_.BatteryStatus -eq 1 }).Count) {
                Write-Fix 'Running on battery, which slows the CPU and graphics a lot.' 'Plug the charger in while you play.'
            } else {
                Write-Ok 'Plugged in'
            }
        }
        # Matched by GUID because plan names are translated.
        $scheme = (cmd /c 'powercfg /getactivescheme 2>nul') -join ' '
        $name = if ($scheme -match '\(([^)]+)\)') { $Matches[1] } else { 'unknown' }
        if ($scheme -match 'a1841308-3541-4fab-bc81-f71556f20b4a') {
            Write-Fix "Power plan is $name." 'Run the optimizer, or pick High performance in Control Panel > Power Options.'
        } elseif ($scheme -match '381b4222-f694-41f0-9685-ff5bb260df2e') {
            Write-Info "Power plan is $name. The optimizer switches to High performance where the PC offers it."
        } else {
            Write-Ok "Power plan is $name"
        }
    }

    Invoke-Section 'Windows gaming settings' {
        $gameBar = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\GameBar' -ErrorAction SilentlyContinue
        if ($gameBar -and $gameBar.AutoGameModeEnabled -eq 0) {
            Write-Fix 'Game Mode is off.' 'Run the optimizer, or turn it on in Settings > Gaming > Game Mode.'
        } else {
            Write-Ok 'Game Mode on'
        }
        $capture = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR' -ErrorAction SilentlyContinue
        if ($capture -and $capture.HistoricalCaptureEnabled -eq 1 -and $capture.AppCaptureEnabled -ne 0) {
            Write-Fix 'Xbox background recording is on; it keeps recording the last few minutes of play.' 'Run the optimizer, or Settings > Gaming > Captures > Record what happened: Off.'
        } else {
            Write-Ok 'Background recording off'
        }
    }

    Invoke-Section 'Programs using the most memory right now' {
        $top = Get-Process | Where-Object { $_.ProcessName -notmatch '^(Idle|System|Registry|Memory Compression|svchost|dwm|explorer|MsMpEng|javaw?)$' } |
            Group-Object ProcessName |
            ForEach-Object { [pscustomobject]@{ Name = $_.Name; MB = [math]::Round(($_.Group | Measure-Object -Property WorkingSet64 -Sum).Sum / 1MB) } } |
            Sort-Object MB -Descending | Select-Object -First 5
        foreach ($p in $top) { Write-Info ('{0,-28} {1,7:N0} MB' -f $p.Name, $p.MB) }
        if (@($top | Where-Object { $_.Name -match '^(chrome|msedge|firefox|opera|brave)$' -and $_.MB -gt 1500 }).Count) {
            Write-Info 'Your browser is using a lot. Close tabs you are not using, especially video, while you play.'
        }
    }

    $optionsFiles = @(Get-OptionsFiles)
    if ($optionsFiles.Count -eq 0) {
        Write-Step 'Minecraft'
        Write-Info 'No Minecraft instance found. Start the game once and quit it, or pass -GameDir.'
    }
    foreach ($f in $optionsFiles) {
        Invoke-Section "Minecraft: $(Get-InstanceName $f)" { Test-Instance $f ($optionsFiles.Count -eq 1) }
    }

    Write-Step 'Summary'
    if ($script:fixes.Count -eq 0) {
        Write-Ok 'Nothing to fix. This PC is set up well for Minecraft.'
    } else {
        Write-Host "   $($script:fixes.Count) thing(s) to fix:" -ForegroundColor Yellow
        $n = 0
        foreach ($fix in $script:fixes) { $n++; Write-Host "   $n. $fix" -ForegroundColor Yellow }
    }
    Write-Host ''
    Write-Info 'Not checked: temperatures. If FPS sags after a few minutes of play, check them with the free app HWiNFO.'
    exit 0
}

# --- Restore -----------------------------------------------------------------
if ($Restore) {
    Assert-GameClosed
    Write-Step 'Putting options.txt back'
    foreach ($f in @(Get-OptionsFiles)) {
        $dir = Split-Path $f -Parent
        # The oldest backup is the file as it was before the optimizer first ran.
        $original = Get-ChildItem -Path $dir -Filter 'options.txt.bak-*' -File | Sort-Object Name | Select-Object -First 1
        if (-not $original) { Write-Note "$dir`: no backup, left as is"; continue }
        Copy-Item -Path $f -Destination "$f.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
        Copy-Item -Path $original.FullName -Destination $f -Force
        Write-Done "$dir`: restored from $($original.Name)"
    }

    Write-Step 'Power plan'
    cmd /c 'powercfg /setactive SCHEME_BALANCED >nul 2>&1'
    if ($LASTEXITCODE -eq 0) { Write-Done 'Balanced' } else { Write-Note 'Could not switch to Balanced.' }

    Write-Host ''
    Write-Note 'GPU choice and Game Mode were left as they are; both are harmless. Change them in'
    Write-Note 'Settings > System > Display > Graphics and Settings > Gaming.'
    exit 0
}

# --- Optimize ----------------------------------------------------------------
Assert-GameClosed

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

$optionsFiles = @(Get-OptionsFiles)
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
    Write-Done 'High performance (undo: run with -Restore)'
} else {
    Write-Note 'This PC only offers Balanced, which is normal for many laptops.'
    Write-Note 'Use Settings > System > Power > Power mode > Best performance, and keep it plugged in.'
}

Write-Host "`nDone. Run with -Check to see what else holds FPS back." -ForegroundColor Cyan
