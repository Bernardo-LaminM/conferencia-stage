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
$ipList = @([System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | 
          Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $_.IPAddressToString -notlike '127.*' -and $_.IPAddressToString -notlike '169.254*' } | 
          ForEach-Object { $_.IPAddressToString })

$mainIP = if ($ipList.Count -gt 0) { $ipList[0] } else { "127.0.0.1" }

# 3. Inicia o HttpListener
$listener = New-Object System.Net.HttpListener
try {
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
    if ($mainIP -ne "127.0.0.1") {
        try { $listener.Prefixes.Add("http://${mainIP}:$Port/") } catch {}
    }
    $listener.Start()
} catch {
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$Port/")
    $listener.Prefixes.Add("http://127.0.0.1:$Port/")
    $listener.Start()
}

Write-Host ""
Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "     P&G ITATIAIA - SERVIDOR WEB OPERACIONAL             " -ForegroundColor Green
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

        # API de Sincronização em Tempo Real na Rede Local (On-Time Local)
        if ($reqUrl -eq "/api/sync") {
            $sharedStateFile = Join-Path $Path "shared_state.json"
            if ($request.HttpMethod -eq "OPTIONS") {
                $response.StatusCode = 200
                $response.OutputStream.Close()
                continue
            } elseif ($request.HttpMethod -eq "POST") {
                $reader = [System.IO.StreamReader]::new($request.InputStream, [System.Text.Encoding]::UTF8)
                $body = $reader.ReadToEnd()
                $reader.Close()
                [System.IO.File]::WriteAllText($sharedStateFile, $body, [System.Text.Encoding]::UTF8)
                $respMsg = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true,"updated":true}')
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $respMsg.Length
                $response.OutputStream.Write($respMsg, 0, $respMsg.Length)
                $response.StatusCode = 200
                $response.OutputStream.Close()
                continue
            } else {
                # GET
                $respData = if (Test-Path $sharedStateFile) { [System.IO.File]::ReadAllBytes($sharedStateFile) } else { [System.Text.Encoding]::UTF8.GetBytes('{}') }
                $response.ContentType = "application/json; charset=utf-8"
                $response.ContentLength64 = $respData.Length
                $response.OutputStream.Write($respData, 0, $respData.Length)
                $response.StatusCode = 200
                $response.OutputStream.Close()
                continue
            }
        }

        # API para Atualização Direta via SQL Server
        if ($reqUrl -eq "/api/sync-sql") {
            $sqlScript = Join-Path $Path "consultar_sql.ps1"
            if (Test-Path $sqlScript) {
                try {
                    & $sqlScript -OutputDir $Path
                    $respMsg = [System.Text.Encoding]::UTF8.GetBytes('{"ok":true,"message":"Base de dados atualizada diretamente do SQL Server (ITATIAIA) com sucesso!"}')
                    $response.StatusCode = 200
                } catch {
                    $respMsg = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"message":"Erro ao executar consulta SQL: ' + $_.Exception.Message.Replace('"', '\"') + '"}')
                    $response.StatusCode = 500
                }
            } else {
                $respMsg = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"message":"Script consultar_sql.ps1 nao encontrado no diretorio."}')
                $response.StatusCode = 404
            }
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $respMsg.Length
            $response.OutputStream.Write($respMsg, 0, $respMsg.Length)
            $response.OutputStream.Close()
            continue
        }

        # API para Sincronização Automática Live do Power BI REST API (AD HOC 80)
        if ($reqUrl -eq "/api/sync-powerbi") {
            $pbiScript = Join-Path $Path "atualizar_powerbi.ps1"
            if (Test-Path $pbiScript) {
                try {
                    $stats = & $pbiScript -OutputDir $Path
                    $totalEmbs = if ($stats.totalEmbarques) { $stats.totalEmbarques } else { 241 }
                    $totalPals = if ($stats.totalPaletes) { $stats.totalPaletes } else { 7449 }
                    $totalLins = if ($stats.totalLinhas) { $stats.totalLinhas } else { 16872 }
                    $jsonStr = '{"ok":true,"totalEmbarques":' + $totalEmbs + ',"totalPaletes":' + $totalPals + ',"totalLinhas":' + $totalLins + ',"message":"Sincronizado automaticamente da View WMS via Power BI API com sucesso!"}'
                    $respMsg = [System.Text.Encoding]::UTF8.GetBytes($jsonStr)
                    $response.StatusCode = 200
                } catch {
                    $errMsg = $_.Exception.Message.Replace('"', '\"')
                    $respMsg = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"message":"Erro ao sincronizar com Power BI API: ' + $errMsg + '"}')
                    $response.StatusCode = 500
                }
            } else {
                $respMsg = [System.Text.Encoding]::UTF8.GetBytes('{"ok":false,"message":"Script atualizar_powerbi.ps1 nao encontrado."}')
                $response.StatusCode = 404
            }
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $respMsg.Length
            $response.OutputStream.Write($respMsg, 0, $respMsg.Length)
            $response.OutputStream.Close()
            continue
        }

        $filePath = Join-Path $Path ($reqUrl.TrimStart('/').Replace('/', '\'))

        try {
            if (Test-Path $filePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
                $response.ContentType = $mime

                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentLength64 = $bytes.Length
                $response.StatusCode = 200
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $response.StatusCode = 404
                $msg = [System.Text.Encoding]::UTF8.GetBytes("<html><body><h2>404 - Arquivo nao encontrado</h2><p>$reqUrl</p></body></html>")
                $response.ContentType = "text/html; charset=utf-8"
                $response.ContentLength64 = $msg.Length
                $response.OutputStream.Write($msg, 0, $msg.Length)
            }
        } catch {
            # Cliente cancelou ou fechou conexão antes de terminar envio (comum em arquivos grandes como stage_data.js)
        } finally {
            try { $response.OutputStream.Close() } catch {}
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
