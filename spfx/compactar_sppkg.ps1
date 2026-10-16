param (
    [string]$Src,
    [string]$Dst
)

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $Dst) {
    Remove-Item $Dst -Force
}

$zip = [System.IO.Compression.ZipFile]::Open($Dst, [System.IO.Compression.ZipArchiveMode]::Create)
$srcDir = (Get-Item $Src).FullName

Get-ChildItem -Path $srcDir -Recurse | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
    $relPath = $_.FullName.Substring($srcDir.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $relPath)
}

$zip.Dispose()
Write-Host "ZIP criado com sucesso em: $Dst"
