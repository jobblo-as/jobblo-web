Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ------------------------------------------------------------
# Paths
# ------------------------------------------------------------

$RootDir = Split-Path -Parent $PSScriptRoot

$AlwaysRulesDir = Join-Path $RootDir "rules\always"
$ScopedRulesDir = Join-Path $RootDir "rules\scoped"

$OutputFile = Join-Path $RootDir "AGENTS.md"
$TempFile = Join-Path $RootDir "AGENTS.md.tmp"

# ------------------------------------------------------------
# Cleanup
# ------------------------------------------------------------

function Remove-TempFile {
    if (Test-Path -LiteralPath $TempFile) {
        Remove-Item -LiteralPath $TempFile -Force
    }
}

# ------------------------------------------------------------
# Validation
# ------------------------------------------------------------

if (-not (Test-Path -LiteralPath $AlwaysRulesDir -PathType Container)) {
    Write-Error "rules\always directory does not exist: $AlwaysRulesDir"
    exit 1
}

if (-not (Test-Path -LiteralPath $ScopedRulesDir -PathType Container)) {
    Write-Warning "rules\scoped directory does not exist: $ScopedRulesDir"
}

# ------------------------------------------------------------
# Helpers
# ------------------------------------------------------------

function Get-RuleContentWithoutFrontmatter {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath
    )

    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        throw "Required rule file not found: $FilePath"
    }

    $Lines = Get-Content -LiteralPath $FilePath

    if ($Lines.Count -eq 0) {
        return ""
    }

    $Result = New-Object System.Collections.Generic.List[string]

    $InFrontmatter = $false
    $FirstLine = $true

    foreach ($Line in $Lines) {

        if ($FirstLine -and $Line.Trim() -eq "---") {
            $InFrontmatter = $true
            $FirstLine = $false
            continue
        }

        $FirstLine = $false

        if ($InFrontmatter) {
            if ($Line.Trim() -eq "---") {
                $InFrontmatter = $false
            }

            continue
        }

        $Result.Add($Line)
    }

    return ($Result -join [Environment]::NewLine).Trim()
}

function Add-Rule {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FileName,

        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.List[string]]$Sections
    )

    $FilePath = Join-Path $AlwaysRulesDir $FileName

    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        throw "Required rule file not found: $FilePath"
    }

    $Content = Get-RuleContentWithoutFrontmatter -FilePath $FilePath

    if (-not [string]::IsNullOrWhiteSpace($Content)) {
        $Sections.Add($Content)
    }
}

# ------------------------------------------------------------
# Generate AGENTS.md
# ------------------------------------------------------------

try {

    Remove-TempFile

    $Sections = New-Object System.Collections.Generic.List[string]

    $Header = @'
# Agent rules

> AUTO-GENERATED FILE.
>
> Do not edit `AGENTS.md` directly.
>
> Edit the source files inside `rules/always/`, then run:
>
> `powershell -ExecutionPolicy Bypass -File .\scripts\sync-agent-rules.ps1`
>
> Scoped rules inside `rules/scoped/` are intentionally not copied into
> this file. They apply only to matching project paths.

These rules define how AI coding agents must work inside this repository.

If an agent's default behavior conflicts with these repository rules,
these repository rules take priority for project structure, engineering
standards, safety, and response style.
'@

    $Sections.Add($Header.Trim())

    # --------------------------------------------------------
    # Explicit rule order
    # --------------------------------------------------------

    Add-Rule -FileName "project.md" -Sections $Sections
    Add-Rule -FileName "engineering.md" -Sections $Sections
    Add-Rule -FileName "quality.md" -Sections $Sections
    Add-Rule -FileName "security.md" -Sections $Sections
    Add-Rule -FileName "response-style.md" -Sections $Sections
    Add-Rule -FileName "jobblo.md" -Sections $Sections

    # --------------------------------------------------------
    # Build final content
    # --------------------------------------------------------

    $FinalContent =
        ($Sections -join (
            [Environment]::NewLine +
            [Environment]::NewLine
        )) +
        [Environment]::NewLine

    # UTF-8 without BOM
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    [System.IO.File]::WriteAllText(
        $TempFile,
        $FinalContent,
        $Utf8NoBom
    )

    # --------------------------------------------------------
    # Atomic-ish replacement
    # --------------------------------------------------------

    Move-Item `
        -LiteralPath $TempFile `
        -Destination $OutputFile `
        -Force

    # --------------------------------------------------------
    # Result
    # --------------------------------------------------------

    Write-Host ""
    Write-Host "Agent rules synced successfully."
    Write-Host ""

    Write-Host "Generated:"
    Write-Host "  $OutputFile"
    Write-Host ""

    Write-Host "Sources:"
    Write-Host "  rules\always\project.md"
    Write-Host "  rules\always\engineering.md"
    Write-Host "  rules\always\quality.md"
    Write-Host "  rules\always\security.md"
    Write-Host "  rules\always\response-style.md"
    Write-Host "  rules\always\jobblo.md"
    Write-Host ""

    Write-Host "Scoped rules were not copied:"
    Write-Host "  rules\scoped\"
    Write-Host ""
}
catch {

    Remove-TempFile

    Write-Error $_
    exit 1
}