-- ==============================================================================
-- CONSULTA SQL OFICIAL: EXTRAÇÃO IDÊNTICA À "GUIA DE CONFERÊNCIA.xlsx"
-- Banco de Dados: ITATIAIA (Azure SQL / WMS PROD)
-- ==============================================================================
-- Retorna as 9 colunas idênticas à planilha utilizada na Conferência de Stage:
-- 1. car_move    : Número do Embarque / Carga
-- 2. order_num   : Número do Pedido do Cliente
-- 3. etiqueta    : Código de barras / LPN do Palete (18 a 20 dígitos)
-- 4. stage       : Local físico de destino no armazém (ex: SO16)
-- 5. sku         : Código do material
-- 6. lote        : Lote de fabricação
-- 7. caixas      : Quantidade calculada de caixas (pckqty / untcas)
-- 8. area_origem : Endereço/Área de separação de origem
-- 9. sps         : Identificador de SPS
-- ==============================================================================

SELECT
    stop.car_move_id                                    AS car_move,
    pckwrk_view.ordnum                                  AS order_num,
    pckwrk_view.pallet_id                               AS etiqueta,
    pckwrk_view.dstloc                                  AS stage,
    pckwrk_view.prtnum                                  AS sku,
    ISNULL(pckwrk_view.lotnum, '')                      AS lote,
    pckwrk_view.pckqty / NULLIF(pckwrk_view.untcas, 0)   AS caixas,
    ISNULL(pckwrk_view.srcloc, '')                      AS area_origem,
    ISNULL(shipment.sps, '')                            AS sps
FROM prodwms.pckwrk_view AS pckwrk_view

INNER JOIN prodwms.ord AS ord
    ON pckwrk_view.ordnum = ord.ordnum
    AND pckwrk_view.client_id = ord.client_id

INNER JOIN prodwms.shipment AS shipment
    ON pckwrk_view.ship_id = shipment.ship_id

LEFT JOIN prodwms.stop AS stop
    ON shipment.stop_id = stop.stop_id

LEFT JOIN prodwms.car_move AS car_move
    ON stop.car_move_id = car_move.car_move_id

WHERE shipment.ship_id IS NOT NULL
  -- ==========================================================================
  -- FILTRO PARA BUSCAR SEMPRE OS EMBARQUES DE HOJE (Escolha a regra do seu WMS):
  -- ==========================================================================
  -- Opção 1: Por data de expedição programada do embarque (Mais comum):
  AND CAST(shipment.early_shpdte AS DATE) = CAST(GETDATE() AS DATE)
  
  -- Opção 2 (Alternativa): Por data de alocação/separação do trabalho:
  -- AND CAST(pckwrk_view.adddte AS DATE) = CAST(GETDATE() AS DATE)

  -- Opção 3 (Alternativa): Por data de criação da carga:
  -- AND CAST(car_move.adddte AS DATE) = CAST(GETDATE() AS DATE)
  -- ==========================================================================

ORDER BY 
    stop.car_move_id,
    pckwrk_view.dstloc,
    pckwrk_view.pallet_id;
