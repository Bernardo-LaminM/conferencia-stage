-- ====================================================================
-- CONSULTA SQL SUGERIDA PARA EXTRAÇÃO DE DADOS DE STAGE / CARA-CRACHÁ
-- ====================================================================
-- Esta consulta reflete a estrutura exata encontrada na sua base adhc8-.xlsx

SELECT 
    A.REMESSA         AS REMESSA,
    A.EMBARQUE        AS EMBARQUE,
    A.PALETE_SSCC     AS PALETE,
    A.LOCAL_STAGE     AS STAGE,          -- ex: SO004, SO023
    A.COD_MATERIAL    AS SKU,            -- ex: 80753358
    M.DESCRICAO       AS DESCRICAO_SKU,  -- ex: PA BW AV TIT 3x4x48 LA
    A.LOTE            AS LOTE,
    A.QTD_ALOCADA     AS QUANTIDADE,
    A.TIPO_EMBALAGEM  AS TIPO_EMB,
    A.CAPACIDADE_TOTAL AS CAPACIDADE
FROM 
    TB_ALOCACAO_STAGE A
LEFT JOIN 
    TB_CADASTRO_MATERIAIS M ON A.COD_MATERIAL = M.COD_MATERIAL
WHERE 
    A.STATUS_STAGE = 'STAGED'            -- ou filtro desejado
ORDER BY 
    A.EMBARQUE, A.PALETE_SSCC;
