param(
    [string]$ServerInstance = "sqlwrhitatiaiaprod.b05aaf70da1f.database.windows.net",
    [string]$Database = "ITATIAIA",
    [string]$Embarque = "",
    [switch]$UseWindowsAuth = $false,
    [string]$User = "paineloperacional.im@pg.com",
    [string]$Password = "!Powerbi00000001",
    [string]$OutputDir = "$PSScriptRoot"
)

# Constrói a Connection String para Azure SQL Database
if ($UseWindowsAuth) {
    $connString = "Server=tcp:$ServerInstance,1433;Database=$Database;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Connection Timeout=30;"
} else {
    $connString = "Server=tcp:$ServerInstance,1433;Database=$Database;User Id=$User;Password=$Password;Encrypt=True;TrustServerCertificate=True;Connection Timeout=30;"
}

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host " CONSULTA DIRETA AO DATAREPLICA AZURE SQL" -ForegroundColor Green
Write-Host " Servidor: $ServerInstance" -ForegroundColor Yellow
Write-Host " Banco:    $Database | Usuario: $User" -ForegroundColor Yellow
Write-Host " View:     [itatiaia].[SHIPPING_PCKWRK_VIEW_SIMPLIFICADA]" -ForegroundColor Yellow
Write-Host "=========================================================" -ForegroundColor Cyan

$query = @"
SELECT
    car_move_id,
    ORDNUM,
    PALLET_ID,
    DSTLOC,
    PRTNUM,
    ISNULL(QTD_CAIXAS, 0) AS QTD_CAIXAS
FROM [itatiaia].[SHIPPING_PCKWRK_VIEW_SIMPLIFICADA]
WHERE (@Embarque = '' OR car_move_id = @Embarque);
"@

try {
    $connection = New-Object System.Data.SqlClient.SqlConnection($connString)
    $connection.Open()
    Write-Host "Conexao com SQL Server estabelecida com sucesso!" -ForegroundColor Green

    $command = $connection.CreateCommand()
    $command.CommandText = $query
    $command.CommandTimeout = 60
    
    $p = $command.Parameters.AddWithValue("@Embarque", $Embarque)

    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter($command)
    $dataset = New-Object System.Data.DataSet
    [void]$adapter.Fill($dataset)
    $connection.Close()

    $table = $dataset.Tables[0]
    Write-Host "Total de registros retornados: $($table.Rows.Count)" -ForegroundColor Green

    if ($table.Rows.Count -eq 0) {
        Write-Host "Nenhum registro encontrado para a consulta." -ForegroundColor Yellow
        exit 0
    }

    # Agrupar por Embarque (car_move_id) e Palete (PALLET_ID)
    $embarques = [System.Collections.Generic.Dictionary[string, object]]::new()

    foreach ($row in $table.Rows) {
        $embId = $row["car_move_id"].ToString().Trim()
        $palId = $row["PALLET_ID"].ToString().Trim()
        $stage = $row["DSTLOC"].ToString().Trim()
        $sku   = $row["PRTNUM"].ToString().Trim()
        $qtd   = [int]$row["QTD_CAIXAS"]
        $ord   = $row["ORDNUM"].ToString().Trim()

        if (-not $embId -or -not $palId) { continue }

        if (-not $embarques.ContainsKey($embId)) {
            $embarques[$embId] = [ordered]@{
                embarque = $embId
                paletes  = [System.Collections.Generic.Dictionary[string, object]]::new()
            }
        }

        $palDict = $embarques[$embId].paletes
        if (-not $palDict.ContainsKey($palId)) {
            $palDict[$palId] = [ordered]@{
                palete      = $palId
                stage       = $stage
                itens       = [System.Collections.Generic.List[object]]::new()
                qtd_total   = 0
                sku_resumo  = $sku
                desc_resumo = "SKU: $sku"
            }
        }

        $pObj = $palDict[$palId]
        $pObj.itens.Add([ordered]@{
            ordnum    = $ord
            palete    = $palId
            stage     = $stage
            sku       = $sku
            descricao = "SKU: $sku"
            qtd       = $qtd
        })
        $pObj.qtd_total += $qtd
    }

    $outputObj = [ordered]@{
        total_embarques = $embarques.Count
        gerado_em       = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        origem          = "SQL_SERVER_DATAREPLICA"
        embarques       = [ordered]@{}
    }

    foreach ($k in $embarques.Keys) {
        $emb = $embarques[$k]
        $palList = [System.Collections.Generic.List[object]]::new()
        $stages = [System.Collections.Generic.HashSet[string]]::new()
        $qtdTotal = 0

        foreach ($p in $emb.paletes.Keys) {
            $pObj = $emb.paletes[$p]
            $palList.Add($pObj)
            if ($pObj.stage) { [void]$stages.Add($pObj.stage) }
            $qtdTotal += $pObj.qtd_total
        }

        $outputObj.embarques[$k] = [ordered]@{
            embarque      = $k
            total_paletes = $palList.Count
            total_pecas   = $qtdTotal
            stages        = ($stages | Sort-Object)
            paletes       = $palList
        }
    }

    $jsonPath = Join-Path $OutputDir "stage_data.json"
    $jsPath   = Join-Path $OutputDir "stage_data.js"

    $json = $outputObj | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($jsonPath, $json, [System.Text.Encoding]::UTF8)

    $jsContent = "window.EMBEDDED_STAGE_DATA = $json;"
    [System.IO.File]::WriteAllText($jsPath, $jsContent, [System.Text.Encoding]::UTF8)

    Write-Host "=========================================================" -ForegroundColor Green
    Write-Host " BASE ATUALIZADA DIRETO DO SQL COM SUCESSO!" -ForegroundColor Green
    Write-Host " Total Embarques: $($embarques.Count)" -ForegroundColor White
    Write-Host " Arquivos Atualizados:" -ForegroundColor White
    Write-Host "  -> $jsonPath" -ForegroundColor Gray
    Write-Host "  -> $jsPath" -ForegroundColor Gray
    Write-Host "=========================================================" -ForegroundColor Green

} catch {
    Write-Host "ERRO ao conectar ou consultar SQL Server: $_" -ForegroundColor Red
}
