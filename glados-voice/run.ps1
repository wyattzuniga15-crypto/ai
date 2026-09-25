# GLaDOSVoice bootstrap: installs uv + Python 3.12 into the workspace, builds the
# pipeline's small venv, then runs glados_pipeline.py. Safe to run again at any
# time: it resumes where it stopped.
#
#   powershell -ExecutionPolicy Bypass -File run.ps1          (or double-click run.bat)
#   run.bat --redo select
#   run.bat --root D:\GLaDOSVoice --game-dir "D:\SteamLibrary\steamapps\common\Portal 2"
#
# No param() block on purpose: every argument except --root is passed through
# to glados_pipeline.py untouched (PowerShell would reject "--redo" and friends).
$Root = "C:\GLaDOSVoice"
$PipelineArgs = @()
for ($i = 0; $i -lt $args.Count; $i++) {
    $a = [string]$args[$i]
    if (($a -ieq "--root" -or $a -ieq "-root") -and $i + 1 -lt $args.Count) { $i++; $Root = [string]$args[$i]; continue }
    if ($a -eq "--") { continue }
    $PipelineArgs += $a
}

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest is 10x slower with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Logs = Join-Path $Root "logs"
$Tools = Join-Path $Root "tools"
New-Item -ItemType Directory -Force -Path $Root, $Logs, $Tools | Out-Null
$BootLog = Join-Path $Logs "bootstrap.log"

function Log([string]$msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path $BootLog -Value $line -Encoding UTF8
}

function Invoke-Native([string]$exe, [string[]]$arguments, [string]$what) {
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        & $exe @arguments
        if ($LASTEXITCODE -eq 0) { return }
        Log "$what failed (exit $LASTEXITCODE), attempt $attempt of 3"
        Start-Sleep -Seconds (5 * $attempt)
    }
    throw "$what failed three times. See the messages above."
}

try {
    Log "GLaDOSVoice bootstrap. Workspace: $Root"

    # 1. uv: a single self-contained exe, kept inside the workspace (no admin, nothing global).
    $UvDir = Join-Path $Tools "uv"
    $Uv = Join-Path $UvDir "uv.exe"
    if (-not (Test-Path $Uv)) {
        Log "Downloading uv (Python installer)"
        $zip = Join-Path $Tools "uv.zip"
        $url = "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip"
        for ($attempt = 1; $attempt -le 4; $attempt++) {
            try { Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing; break }
            catch { Log "Download failed: $($_.Exception.Message)"; if ($attempt -eq 4) { throw }; Start-Sleep -Seconds (2 * $attempt) }
        }
        Expand-Archive -Path $zip -DestinationPath $UvDir -Force
        Remove-Item $zip
        $found = Get-ChildItem -Path $UvDir -Recurse -Filter uv.exe | Select-Object -First 1
        if ($found.FullName -ne $Uv) { Move-Item $found.FullName $Uv -Force }
    }

    # Keep Python, caches and wheels under the workspace so deleting it removes everything.
    $env:UV_PYTHON_INSTALL_DIR = Join-Path $Tools "python"
    $env:UV_CACHE_DIR = Join-Path $Tools "uv-cache"
    $env:UV_LINK_MODE = "copy"
    $env:UV_HTTP_TIMEOUT = "300"

    # 2. Python 3.12 (Applio 3.6.5 targets 3.12)
    Invoke-Native $Uv @("python", "install", "3.12") "Installing Python 3.12"

    # 3. The pipeline's own small venv
    $Venv = Join-Path $Root "env\pipeline"
    $Py = Join-Path $Venv "Scripts\python.exe"
    if (-not (Test-Path $Py)) {
        Log "Creating the pipeline venv"
        Invoke-Native $Uv @("venv", $Venv, "--python", "3.12") "Creating the pipeline venv"
    }
    Invoke-Native $Uv @("pip", "install", "--python", $Py, "-r", (Join-Path $Here "requirements-pipeline.txt")) "Installing pipeline packages"

    # 4. Run the pipeline
    # A tool name first (from glados_mode.bat, tune.bat, ...) runs that tool instead.
    $ToolNames = @("glados-mode")
    if ($PipelineArgs.Count -gt 0 -and $ToolNames -contains $PipelineArgs[0]) {
        $rest = @()
        if ($PipelineArgs.Count -gt 1) { $rest = $PipelineArgs[1..($PipelineArgs.Count - 1)] }
        $argsList = @((Join-Path $Here "glados_pipeline.py"), $PipelineArgs[0], "--root", $Root, "--uv", $Uv) + $rest
    } else {
        $argsList = @((Join-Path $Here "glados_pipeline.py"), "--root", $Root, "--uv", $Uv) + $PipelineArgs
    }
    Log "Starting the pipeline (log: $Logs\pipeline.log)"
    & $Py @argsList
    $code = $LASTEXITCODE
    Log "Pipeline exited with code $code"
    exit $code
}
catch {
    Log "BOOTSTRAP ERROR: $($_.Exception.Message)"
    Log "Check your internet connection, then run run.bat again."
    exit 1
}
