param(
    [string]$OutputDir = "$PSScriptRoot"
)

$ErrorActionPreference = "Stop"

$workspaceId = "f0810a12-fd37-4f7a-ba46-4a447e425649"
$datasetAdHoc80 = "5939ef54-f0ca-4d0b-8821-f8cfc989bf80"
$datasetTracking = "6a45bb09-480d-4dd4-a3a5-81e3d09c0e4b"
$datasetInventory = "cb4c3572-5bb3-4333-b61c-18afe71aa36a"
$tenantId    = "3596192b-fdf5-4e2c-a6fa-acb706c963d8"
$user        = "paineloperacional.im@pg.com"
$pwd         = $env:PBI_PASSWORD; if (-not $pwd) { throw "Defina a variavel de ambiente PBI_PASSWORD antes de rodar (ver README)." }

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " P&G ITATIAIA - OPERAÇÃO INTELIGENTE VIA POWER BI LIVE   " -ForegroundColor Green
Write-Host " Workspace: $workspaceId" -ForegroundColor Gray
Write-Host " Modelos:   AD HOC 80 + Tracking 2.0 + Operational Inv   " -ForegroundColor Gray
Write-Host "=========================================================" -ForegroundColor Cyan

# 1. Obter Token OAuth via Microsoft Entra ID
Write-Host "[1/4] Autenticando com Microsoft Entra ID..." -ForegroundColor Yellow
$bodyAuth = @{
    grant_type = "password"
    client_id  = "ea0616ba-638b-4df5-95b9-636659ae5121"
    username   = $user
    password   = $pwd
    scope      = "https://analysis.windows.net/powerbi/api/.default"
}

$tokenUri = "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token"
$authRes  = Invoke-RestMethod -Method Post -Uri $tokenUri -Body $bodyAuth
$token    = $authRes.access_token

Write-Host "Token obtido com sucesso! Validade: $($authRes.expires_in)s" -ForegroundColor Green

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type"  = "application/json"
}

# 2. Executar DAX Query no Power BI Service para Carregar Paletes/Stages (AD HOC 80)
Write-Host "[2/4] Executando DAX Query: Visão de Picking & Stages..." -ForegroundColor Yellow
$queryUriPck = "https://api.powerbi.com/v1.0/myorg/groups/$workspaceId/datasets/$datasetAdHoc80/executeQueries"

$daxBodyPck = @{
    queries = @(
        @{ query = "EVALUATE 'itatiaia SHIPPING_PCKWRK_VIEW_SIMPLIFICADA'" }
    )
    serializerSettings = @{ includeNulls = $true }
} | ConvertTo-Json -Depth 5

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$resPck = Invoke-RestMethod -Method Post -Uri $queryUriPck -Headers $headers -Body $daxBodyPck -TimeoutSec 180
$sw.Stop()

$rows = $resPck.results[0].tables[0].rows
Write-Host "Picking retornado em $($sw.ElapsedMilliseconds) ms! Total de linhas: $($rows.Count)" -ForegroundColor Green

if ($rows.Count -eq 0) {
    throw "Nenhum registro retornado da view de picking do Power BI."
}

# 3. Executar DAX Queries Inteligentes Adicionais (Trailers & Descrição de Materiais)
Write-Host "[3/4] Consultando inteligência de Transportes & Catálogo de SKUs..." -ForegroundColor Yellow

# 3.1 Trailers (Tracking Performance 2.0)
$trailersDict = @{}
try {
    $queryUriTrailers = "https://api.powerbi.com/v1.0/myorg/groups/$workspaceId/datasets/$datasetTracking/executeQueries"
    $daxTrailers = @{
        queries = @(
            @{ query = "EVALUATE 'itatiaia Trailers (2)'" }
        )
        serializerSettings = @{ includeNulls = $true }
    } | ConvertTo-Json -Depth 5

    $resTrailers = Invoke-RestMethod -Method Post -Uri $queryUriTrailers -Headers $headers -Body $daxTrailers -TimeoutSec 120
    $trailerRows = $resTrailers.results[0].tables[0].rows
    Write-Host "  -> Registros de Carretas/Transportes retornados: $($trailerRows.Count)" -ForegroundColor Green

    foreach ($tr in $trailerRows) {
        $cMove = [string]$tr.'itatiaia Trailers (2)[car_move_id]'
        if (-not $cMove) { continue }
        $cMoveClean = $cMove.TrimStart('0')
        $info = [ordered]@{
            car_move_id    = $cMove
            transportadora = [string]$tr.'itatiaia Trailers (2)[carnam]'
            placa          = [string]$tr.'itatiaia Trailers (2)[trlr_num]'
            broker         = [string]$tr.'itatiaia Trailers (2)[TRLR_BROKER]'
            horario_doca   = [string]$tr.'itatiaia Trailers (2)[dock_date]'
            janela_limite  = [string]$tr.'itatiaia Trailers (2)[late_shpdte]'
            data_alocacao  = [string]$tr.'itatiaia Trailers (2)[alcdte]'
            data_stage     = [string]$tr.'itatiaia Trailers (2)[stgdte]'
            data_carregado = [string]$tr.'itatiaia Trailers (2)[loddte]'
            data_despacho  = [string]$tr.'itatiaia Trailers (2)[dispatch_date]'
        }
        $trailersDict[$cMove] = $info
        if ($cMoveClean) { $trailersDict[$cMoveClean] = $info }
    }
} catch {
    Write-Host "  -> Aviso: Não foi possível obter dados de Trailers no momento: $_" -ForegroundColor Yellow
}

# 3.2 Descrição de Materiais (Operational Inventory)
$materiaisDict = @{}
try {
    $queryUriInv = "https://api.powerbi.com/v1.0/myorg/groups/$workspaceId/datasets/$datasetInventory/executeQueries"
    $daxMateriais = @{
        queries = @(
            @{ query = "EVALUATE 'SQL_Descrição do Material'" }
        )
        serializerSettings = @{ includeNulls = $true }
    } | ConvertTo-Json -Depth 5

    $resMateriais = Invoke-RestMethod -Method Post -Uri $queryUriInv -Headers $headers -Body $daxMateriais -TimeoutSec 120
    $matRows = $resMateriais.results[0].tables[0].rows
    Write-Host "  -> Registros de SKUs descritivos retornados: $($matRows.Count)" -ForegroundColor Green

    foreach ($mr in $matRows) {
        $skuCode = [string]$mr.'SQL_Descrição do Material[Item Number]'
        $skuDesc = [string]$mr.'SQL_Descrição do Material[Descrição]'
        if ($skuCode -and $skuDesc -and -not $materiaisDict.Contains($skuCode)) {
            $materiaisDict[$skuCode] = $skuDesc
        }
    }
} catch {
    Write-Host "  -> Aviso: Não foi possível obter catálogo de SKUs no momento: $_" -ForegroundColor Yellow
}

# 4. Estruturar Base Inteligente Unificada
Write-Host "[4/4] Estruturando base inteligente para a Conferência de Stage..." -ForegroundColor Yellow

$embarquesDict = [ordered]@{}
$totalPaletes = 0

foreach ($r in $rows) {
    $embId = [string]$r.'itatiaia SHIPPING_PCKWRK_VIEW_SIMPLIFICADA[car_move_id]'
    $palId = [string]$r.'itatiaia SHIPPING_PCKWRK_VIEW_SIMPLIFICADA[PALLET_ID]'
    $stg   = [string]$r.'itatiaia SHIPPING_PCKWRK_VIEW_SIMPLIFICADA[DSTLOC]'
    $ord   = [string]$r.'itatiaia SHIPPING_PCKWRK_VIEW_SIMPLIFICADA[ORDNUM]'
    $sku   = [string]$r.'itatiaia SHIPPING_PCKWRK_VIEW_SIMPLIFICADA[PRTNUM]'
    $lote  = [string]$r.'itatiaia SHIPPING_PCKWRK_VIEW_SIMPLIFICADA[Origem]'
    $qtdR  = [string]$r.'itatiaia SHIPPING_PCKWRK_VIEW_SIMPLIFICADA[QTD_CAIXAS]'
    $qtd   = 0
    [int]::TryParse($qtdR, [ref]$qtd) | Out-Null

    if (-not $embId -or -not $palId) { continue }

    if (-not $embarquesDict.Contains($embId)) {
        # Busca inteligência de transporte
        $trInfo = $trailersDict[$embId]
        if (-not $trInfo) { $trInfo = $trailersDict[$embId.TrimStart('0')] }

        $embarquesDict[$embId] = [ordered]@{
            embarque        = $embId
            total_paletes   = 0
            total_pecas     = 0
            stages          = [System.Collections.Generic.HashSet[string]]::new()
            transportadora  = if ($trInfo) { $trInfo.transportadora } else { "A Definir" }
            placa           = if ($trInfo) { $trInfo.placa } else { "Pátio" }
            horario_doca    = if ($trInfo) { $trInfo.horario_doca } else { "" }
            janela_embarque = if ($trInfo) { $trInfo.janela_limite } else { "" }
            broker          = if ($trInfo) { $trInfo.broker } else { "" }
            data_stage      = if ($trInfo) { $trInfo.data_stage } else { "" }
            paletesMap      = [ordered]@{}
        }
    }

    $embObj = $embarquesDict[$embId]
    if ($stg) { [void]$embObj.stages.Add($stg) }

    # Descrição do produto em catálogo
    $nomeProduto = if ($materiaisDict.Contains($sku)) { $materiaisDict[$sku] } elseif ($sku) { "SKU $sku" } else { "Material" }

    if (-not $embObj.paletesMap.Contains($palId)) {
        $embObj.paletesMap[$palId] = [ordered]@{
            palete      = $palId
            stage       = $stg
            order_num   = $ord
            itens       = [System.Collections.Generic.List[object]]::new()
            qtd_total   = 0
            sku_resumo  = $sku
            desc_resumo = $nomeProduto
        }
        $embObj.total_paletes++
        $totalPaletes++
    }

    $pObj = $embObj.paletesMap[$palId]
    $pObj.itens.Add([ordered]@{
        sku          = $sku
        desc_produto = $nomeProduto
        lote         = $lote
        qtd          = $qtd
        order_num    = $ord
    })
    $pObj.qtd_total += $qtd
    $embObj.total_pecas += $qtd
}

$finalEmbarques = [ordered]@{}
foreach ($k in $embarquesDict.Keys) {
    $e = $embarquesDict[$k]
    $palList = [System.Collections.ArrayList]::new()
    foreach ($pk in $e.paletesMap.Keys) {
        $palList.Add($e.paletesMap[$pk]) | Out-Null
    }

    $embData = [ordered]@{
        embarque        = $e.embarque
        total_paletes   = $e.total_paletes
        total_pecas     = $e.total_pecas
        stages          = [string[]]$e.stages
        transportadora  = $e.transportadora
        placa           = $e.placa
        horario_doca    = $e.horario_doca
        janela_embarque = $e.janela_embarque
        broker          = $e.broker
        paletes         = $palList
    }

    $finalEmbarques[$k] = $embData
    $cleanKey = $k.TrimStart('0')
    if ($cleanKey -and $cleanKey -ne $k) {
        $finalEmbarques[$cleanKey] = $embData
    }
}

$finalDatabase = [ordered]@{
    origem        = "PowerBI_Live_Operacao_Inteligente"
    atualizado_em = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    modelos_usados = @(
        "AD HOC 80 (Picking)",
        "Tracking Performance 2.0 (Carretas/Docas/Transportes)",
        "Operational Inventory (Catálogo Descritivo SKUs)"
    )
    embarques     = $finalEmbarques
}

# Grava em stage_data.json e stage_data.js
$jsonPath = Join-Path $OutputDir "stage_data.json"
$jsPath   = Join-Path $OutputDir "stage_data.js"

$jsonContent = $finalDatabase | ConvertTo-Json -Depth 6 -Compress
[System.IO.File]::WriteAllText($jsonPath, $jsonContent, [System.Text.Encoding]::UTF8)

$jsContent = "window.EMBEDDED_STAGE_DATA = " + $jsonContent + ";"
[System.IO.File]::WriteAllText($jsPath, $jsContent, [System.Text.Encoding]::UTF8)

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " SINCRONIZAÇÃO INTELIGENTE CONCLUÍDA COM SUCESSO!" -ForegroundColor Green
Write-Host " Total de Embarques: $($embarquesDict.Keys.Count)" -ForegroundColor Yellow
Write-Host " Total de Paletes:   $totalPaletes" -ForegroundColor Yellow
Write-Host " SKUs Mapeados:      $($materiaisDict.Keys.Count)" -ForegroundColor Yellow
Write-Host " Carretas Mapeadas:  $($trailersDict.Keys.Count)" -ForegroundColor Yellow
Write-Host " Arquivos Gravados:  $jsonPath e $jsPath" -ForegroundColor Gray
Write-Host "=========================================================" -ForegroundColor Cyan

return @{
    ok             = $true
    totalEmbarques = $embarquesDict.Keys.Count
    totalPaletes   = $totalPaletes
    totalLinhas    = $rows.Count
}
