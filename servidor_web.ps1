param(
    [int]$Port = 8080,
    [string]$Path = ""
)

# 1. Localiza com precisão a pasta contendo o index.html
if (-not $Path -or -not (Test-Path (Join-Path $Path "index.html"))) {
    if (Test-Path "$PSScriptRoot\index.html") {
        $Path = "$PSScriptRoot"
    } elseif (Test-Path "$PSScriptRoot\Conferencia_Stage\index.html") {
        $Path = "$PSScriptRoot\Conferencia_Stage"
    } elseif (Test-Path "C:\Users\blaminma\Downloads\Conferencia_Stage\index.html") {
        $Path = "C:\Users\blaminma\Downloads\Conferencia_Stage"
    } else {
        $Path = (Get-Location).Path
    }
}
$Path = (Resolve-Path $Path).Path

# 2. Obtem o IP de rede local da maquina
$ipList = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | 
          Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $_.IPAddressToString -notlike '127.*' -and $_.IPAddressToString -notlike '169.254*' } | 
          ForEach-Object { $_.IPAddressToString }

$mainIP = if ($ipList -and $ipList.Count -gt 0) { $ipList[0] } else { "127.0.0.1" }

# 3. Inicia o HttpListener
$listener = New-Object System.Net.HttpListener
$prefix = "http://*:$Port/"
$boundAll = $false

try {
    $listener.Prefixes.Add($prefix)
    $listener.Start()
    $boundAll = $true
} catch {
    # Se falhar bind em * (exige admin as vezes), faz bind em localhost e no IP
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
    if ($mainIP -ne "127.0.0.1") {
        try { $listener.Prefixes.Add("http://${mainIP}:$Port/") } catch {}
    }
    $listener.Start()
}

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "     DHL SUPPLY CHAIN - SERVIDOR WEB ATIVO               " -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " Pasta Raiz Servida: $Path" -ForegroundColor Gray
Write-Host ""
Write-Host " [1] Acesse no seu Computador:" -ForegroundColor Yellow
Write-Host "     -> http://localhost:$Port" -ForegroundColor White
Write-Host "     -> http://127.0.0.1:$Port" -ForegroundColor Gray
Write-Host ""
Write-Host " [2] Acesse no Coletor de Dados / Celular (mesmo Wi-Fi):" -ForegroundColor Yellow
Write-Host "     -> http://${mainIP}:$Port" -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " Servidor em execucao... (Nao feche esta janela)" -ForegroundColor Gray
Write-Host " Para encerrar o servidor, pressione Ctrl + C" -ForegroundColor Gray
Write-Host ""

# Abre diretamente http://localhost:8080 no navegador padrao
Start-Process "http://localhost:$Port"

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".xlsx" = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "*")

        $reqUrl = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
        if ($reqUrl -eq "/" -or $reqUrl -eq "") { $reqUrl = "/index.html" }

        $filePath = Join-Path $Path ($reqUrl.TrimStart('/').Replace('/', '\'))

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $response.ContentType = $mime

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.StatusCode = 200
        } else {
            $response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("<html><body><h2>404 - Arquivo nao encontrado</h2><p>$reqUrl</p></body></html>")
            $response.ContentType = "text/html; charset=utf-8"
            $response.ContentLength64 = $msg.Length
            $response.OutputStream.Write($msg, 0, $msg.Length)
        }

        $response.OutputStream.Close()
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
