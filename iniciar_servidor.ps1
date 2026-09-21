$port = 8080
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://*:$port/")

try {
    $listener.Start()
} catch {
    # Se falhar bind com *, tenta localhost
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
}

$localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback' -and $_.IPAddress -match '^1[09]' } | Select-Object -First 1).IPAddress
if (-not $localIp) { $localIp = "SEU_IP_LOCAL" }

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  GESTAO & CONFERENCIA DE STAGE - CARA-CRACHA" -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " Servidor rodando com sucesso!"
Write-Host " Acesse no seu PC:             http://localhost:$port" -ForegroundColor Yellow
Write-Host " Acesse no Coletor / Celular:   http://${localIp}:$port" -ForegroundColor Yellow
Write-Host " Pressione Ctrl+C nesta janela para parar o servidor." -ForegroundColor Gray
Write-Host "=========================================================" -ForegroundColor Cyan

# Abre no navegador
Start-Process "http://localhost:$port"

$baseDir = $PSScriptRoot
if (-not $baseDir) { $baseDir = Get-Location }

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.LocalPath.TrimStart('/')
        if (-not $path -or $path -eq "") { $path = "index.html" }

        $filePath = Join-Path $baseDir $path

        if (Test-Path $filePath -PathType Leaf) {
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = switch ($ext) {
                ".html" { "text/html; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".csv"  { "text/csv; charset=utf-8" }
                default { "application/octet-stream" }
            }

            $response.ContentType = $mime
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $err = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($err, 0, $err.Length)
        }
        $response.OutputStream.Close()
    } catch {
        # Ignora cancelamentos na parada do loop
    }
}
