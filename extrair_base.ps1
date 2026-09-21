param(
    [string]$DownloadsDir = "C:\Users\blaminma\Downloads",
    [string]$ExcelPath = "",
    [string]$TargetDir = "$PSScriptRoot"
)

if (-not $TargetDir) { $TargetDir = Get-Location }

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "   DHL SUPPLY CHAIN - ATUALIZACAO DA BASE DE STAGE       " -ForegroundColor Green
Write-Host "=========================================================" -ForegroundColor Cyan

# Se ExcelPath nao informado, busca automaticamente
if (-not $ExcelPath) {
    # 1. Procura Guia de Conferencia na pasta da aplicacao (prioridade se acabou de ser ajustada)
    $foundGuia = Get-ChildItem -Path $TargetDir -Filter "*GUIA*CONFER*.xlsx" -ErrorAction SilentlyContinue | 
                 Sort-Object LastWriteTime -Descending | 
                 Select-Object -First 1

    # 2. Procura se tem adhc8 recente em Downloads
    $foundAdhc8 = Get-ChildItem -Path $DownloadsDir -Filter "*adhc8*.xlsx" -ErrorAction SilentlyContinue | 
                  Sort-Object LastWriteTime -Descending | 
                  Select-Object -First 1

    if ($foundGuia) {
        $ExcelPath = $foundGuia.FullName
    } elseif ($foundAdhc8) {
        $ExcelPath = $foundAdhc8.FullName
    } else {
        $ExcelPath = Join-Path $DownloadsDir "adhc8-.xlsx"
    }
}

if (-not (Test-Path $ExcelPath)) {
    Write-Host "ERRO: Arquivo Excel nao encontrado em: $ExcelPath" -ForegroundColor Red
    exit 1
}

Write-Host " Planilha de Origem: $ExcelPath" -ForegroundColor Yellow
Write-Host " Pasta de Destino:   $TargetDir" -ForegroundColor Yellow

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Extract-WorkbookData($path) {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
    
    # Shared Strings
    $ssEntry = $zip.GetEntry("xl/sharedStrings.xml")
    $strings = @()
    if ($ssEntry) {
        $r = [System.IO.StreamReader]::new($ssEntry.Open())
        $xml = [xml]$r.ReadToEnd()
        $r.Close()
        foreach ($si in $xml.sst.si) {
            $t = if ($si.t) { $si.t } else { ($si.r | ForEach-Object { $_.t }) -join "" }
            $strings += [string]$t
        }
    }

    function Get-CellVal($c) {
        if (-not $c) { return "" }
        $v = if ($c.v) { [string]$c.v } else { [string]$c.InnerText }
        if ($c.t -eq "s") {
            $idx = 0
            if ([int]::TryParse($v, [ref]$idx) -and $idx -lt $strings.Count) {
                return $strings[$idx]
            }
        }
        return $v
    }

    $embarquesResult = @{}

    # 1. Verifica se tem sheet1 e se é o formato TABULAR (car_move | order_num | etiqueta | stage)
    $sheet1Entry = $zip.GetEntry("xl/worksheets/sheet1.xml")
    $isTabular = $false
    $headerMap = @{}

    if ($sheet1Entry) {
        $r1 = [System.IO.StreamReader]::new($sheet1Entry.Open())
        $xml1 = [xml]$r1.ReadToEnd()
        $r1.Close()

        $firstRow = $xml1.worksheet.sheetData.row | Select-Object -First 1
        if ($firstRow) {
            foreach ($c in $firstRow.c) {
                $col = ($c.r -replace '\d+', '')
                $val = ([string](Get-CellVal $c)).Trim().ToLower()
                $headerMap[$val] = $col
                if ($val -match 'car_move' -or $val -match 'etiqueta' -or $val -match 'ordnum' -or $val -match 'pallet_id') {
                    $isTabular = $true
                }
            }
        }
    }

    if ($isTabular) {
        Write-Host " -> Detectado Formato TABULAR DE VIEW / CONSULTA SQL (car_move, etiqueta, stage)..." -ForegroundColor Cyan
        
        $colCarMove  = if ($headerMap.ContainsKey('car_move')) { $headerMap['car_move'] } elseif ($headerMap.ContainsKey('car_move_id')) { $headerMap['car_move_id'] } else { 'A' }
        $colEtiqueta = if ($headerMap.ContainsKey('etiqueta')) { $headerMap['etiqueta'] } elseif ($headerMap.ContainsKey('pallet_id')) { $headerMap['pallet_id'] } else { 'C' }
        $colStage    = if ($headerMap.ContainsKey('stage')) { $headerMap['stage'] } elseif ($headerMap.ContainsKey('dstloc')) { $headerMap['dstloc'] } else { 'D' }
        $colSku      = if ($headerMap.ContainsKey('sku')) { $headerMap['sku'] } elseif ($headerMap.ContainsKey('prtnum')) { $headerMap['prtnum'] } else { 'E' }
        $colLote     = if ($headerMap.ContainsKey('lote')) { $headerMap['lote'] } else { 'F' }
        $colCaixas   = if ($headerMap.ContainsKey('caixas')) { $headerMap['caixas'] } elseif ($headerMap.ContainsKey('qtd_caixas')) { $headerMap['qtd_caixas'] } elseif ($headerMap.ContainsKey('qtd')) { $headerMap['qtd'] } else { 'G' }

        $rows = $xml1.worksheet.sheetData.row
        for ($i = 1; $i -lt $rows.Count; $i++) {
            $row = $rows[$i]
            $cells = @{}
            foreach ($c in $row.c) {
                $col = ($c.r -replace '\d+', '')
                $cells[$col] = [string](Get-CellVal $c)
            }

            $embId = if ($cells.ContainsKey($colCarMove)) { $cells[$colCarMove].Trim() } else { "" }
            $palId = if ($cells.ContainsKey($colEtiqueta)) { $cells[$colEtiqueta].Trim() } else { "" }
            $stg   = if ($cells.ContainsKey($colStage)) { $cells[$colStage].Trim() } else { "" }
            $sku   = if ($cells.ContainsKey($colSku)) { $cells[$colSku].Trim() } else { "" }
            $lote  = if ($cells.ContainsKey($colLote)) { $cells[$colLote].Trim() } else { "" }
            $qtdRaw = if ($cells.ContainsKey($colCaixas)) { $cells[$colCaixas].Trim() } else { "0" }
            $qtd = 0
            [int]::TryParse($qtdRaw, [ref]$qtd) | Out-Null

            if (-not $embId -or -not $palId) { continue }

            if (-not $embarquesResult.ContainsKey($embId)) {
                $embarquesResult[$embId] = @{
                    embarque = $embId
                    stages = [System.Collections.Generic.HashSet[string]]::new()
                    paletes = @{}
                }
            }

            $embObj = $embarquesResult[$embId]
            if ($stg) { [void]$embObj.stages.Add($stg) }

            if (-not $embObj.paletes.ContainsKey($palId)) {
                $embObj.paletes[$palId] = [ordered]@{
                    palete = $palId
                    stage = $stg
                    itens = [System.Collections.Generic.List[object]]::new()
                    qtd_total = 0
                    sku_resumo = $sku
                    desc_resumo = "SKU $sku"
                }
            }

            $pObj = $embObj.paletes[$palId]
            $pObj.itens.Add([ordered]@{ sku = $sku; lote = $lote; qtd = $qtd })
            $pObj.qtd_total += $qtd
        }
    } else {
        # 2. Verifica se tem sheet4 e sheet5 (formato adhc8 WMS)
        $entry4 = $zip.GetEntry("xl/worksheets/sheet4.xml")
        $entry5 = $zip.GetEntry("xl/worksheets/sheet5.xml")

        if ($entry4 -and $entry5) {
            Write-Host " -> Detectado formato WMS Completo (adhc8 com alocacoes e materiais)..." -ForegroundColor Cyan
            # sheet5 materiais
            $r5 = [System.IO.StreamReader]::new($entry5.Open())
            $xml5 = [xml]$r5.ReadToEnd()
            $r5.Close()
            $skuMap = @{}
            foreach ($row in $xml5.worksheet.sheetData.row) {
                $cCode = $row.c | Where-Object { $_.r -match "^A" }
                $cDesc = $row.c | Where-Object { $_.r -match "^H" }
                $code = Get-CellVal $cCode
                $desc = Get-CellVal $cDesc
                if ($code -and $desc -and -not $skuMap.ContainsKey($code)) {
                    $skuMap[$code] = $desc
                }
            }

            # sheet4 alocações
            $r4 = [System.IO.StreamReader]::new($entry4.Open())
            $xml4 = [xml]$r4.ReadToEnd()
            $r4.Close()

            foreach ($row in $xml4.worksheet.sheetData.row) {
                $cRemessa  = $row.c | Where-Object { $_.r -match "^A" }
                $cEmbarque = $row.c | Where-Object { $_.r -match "^B" }
                $cPalete   = $row.c | Where-Object { $_.r -match "^C" }
                $cStage    = $row.c | Where-Object { $_.r -match "^D" }
                $cSku      = $row.c | Where-Object { $_.r -match "^E" }
                $cLote     = $row.c | Where-Object { $_.r -match "^F" }
                $cQtd      = $row.c | Where-Object { $_.r -match "^G" }

                $embId = Get-CellVal $cEmbarque
                $palId = Get-CellVal $cPalete
                if (-not $embId -or -not $palId) { continue }

                $sku = Get-CellVal $cSku
                $desc = if ($skuMap.ContainsKey($sku)) { $skuMap[$sku] } else { "Material $sku" }
                $qtd = 0
                [int]::TryParse((Get-CellVal $cQtd), [ref]$qtd) | Out-Null
                $stage = Get-CellVal $cStage

                if (-not $embarquesResult.ContainsKey($embId)) {
                    $embarquesResult[$embId] = @{
                        embarque = $embId
                        stages = [System.Collections.Generic.HashSet[string]]::new()
                        paletes = @{}
                    }
                }

                $embObj = $embarquesResult[$embId]
                if ($stage) { [void]$embObj.stages.Add($stage) }

                if (-not $embObj.paletes.ContainsKey($palId)) {
                    $embObj.paletes[$palId] = [ordered]@{
                        palete = $palId
                        stage = $stage
                        itens = [System.Collections.Generic.List[object]]::new()
                        qtd_total = 0
                        sku_resumo = $sku
                        desc_resumo = $desc
                    }
                }

                $pObj = $embObj.paletes[$palId]
                $pObj.itens.Add([ordered]@{ sku = $sku; lote = (Get-CellVal $cLote); qtd = $qtd })
                $pObj.qtd_total += $qtd
            }
        }
    }

    $zip.Dispose()
    return $embarquesResult
}

# 1. Processa planilha principal
$allEmbarques = Extract-WorkbookData $ExcelPath

# 2. Se a planilha principal for adhc8 e houver também GUIA DE CONFERENCIA na pasta, mescla!
$guiaNaPasta = Join-Path $TargetDir "GUIA DE CONFERÊNCIA.xlsx"
if ((Test-Path $guiaNaPasta) -and ($ExcelPath -ne $guiaNaPasta)) {
    Write-Host " -> Mesclando tambem a Guia/Base local ($guiaNaPasta)..." -ForegroundColor Green
    $guiaEmbs = Extract-WorkbookData $guiaNaPasta
    foreach ($k in $guiaEmbs.Keys) {
        $allEmbarques[$k] = $guiaEmbs[$k]
    }
}

# Se a principal foi a Guia e houver adhc8 em Downloads, mescla o adhc8 também!
$adhc8Path = Join-Path $DownloadsDir "adhc8-.xlsx"
if ((Test-Path $adhc8Path) -and ($ExcelPath -ne $adhc8Path)) {
    Write-Host " -> Mesclando tambem adhc8 em Downloads..." -ForegroundColor Green
    $adhc8Embs = Extract-WorkbookData $adhc8Path
    foreach ($k in $adhc8Embs.Keys) {
        if (-not $allEmbarques.ContainsKey($k)) {
            $allEmbarques[$k] = $adhc8Embs[$k]
        }
    }
}

# 3. Monta o objeto final
$outputObj = [ordered]@{
    total_embarques = 0
    gerado_em       = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    arquivo_origem  = [System.IO.Path]::GetFileName($ExcelPath)
    embarques       = [ordered]@{}
}

# Indexa tanto pelo ID original quanto pelo ID sem zeros à esquerda para facilitar busca
foreach ($k in ($allEmbarques.Keys | Sort-Object)) {
    $emb = $allEmbarques[$k]
    $palList = [System.Collections.Generic.List[object]]::new()
    $stages = [System.Collections.Generic.HashSet[string]]::new()
    $qtdTotal = 0

    foreach ($pKey in $emb.paletes.Keys) {
        $pObj = $emb.paletes[$pKey]
        $palList.Add($pObj)
        if ($pObj.stage) { [void]$stages.Add($pObj.stage) }
        $qtdTotal += $pObj.qtd_total
    }

    if ($emb.stages) {
        foreach ($s in $emb.stages) { [void]$stages.Add($s) }
    }
    $stagesArray = ($stages | Sort-Object)

    $embData = [ordered]@{
        embarque      = [string]$k
        total_paletes = $palList.Count
        total_pecas   = $qtdTotal
        stages        = $stagesArray
        paletes       = $palList
    }

    $outputObj.embarques[[string]$k] = $embData

    # Adiciona alias sem zeros à esquerda se for diferente
    $cleanKey = ([string]$k) -replace '^0+', ''
    if ($cleanKey -and $cleanKey -ne [string]$k) {
        $outputObj.embarques[$cleanKey] = $embData
    }
}

$outputObj.total_embarques = $outputObj.embarques.Count

$jsonPath = Join-Path $TargetDir "stage_data.json"
$jsPath   = Join-Path $TargetDir "stage_data.js"

$json = $outputObj | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($jsonPath, $json, [System.Text.Encoding]::UTF8)

$jsContent = "window.EMBEDDED_STAGE_DATA = $json;"
[System.IO.File]::WriteAllText($jsPath, $jsContent, [System.Text.Encoding]::UTF8)

Write-Host "=========================================================" -ForegroundColor Green
Write-Host " ATUALIZACAO CONCLUIDA COM SUCESSO!" -ForegroundColor Green
Write-Host " Total de Registros de Embarques: $($outputObj.total_embarques)" -ForegroundColor White
Write-Host " Arquivos Atualizados:" -ForegroundColor White
Write-Host "  -> $jsonPath" -ForegroundColor Gray
Write-Host "  -> $jsPath" -ForegroundColor Gray
Write-Host "=========================================================" -ForegroundColor Green
