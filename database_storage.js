/**
 * =======================================================================
 * DHL SUPPLY CHAIN — BANCO DE DADOS NATIVO (IndexedDB)
 * =======================================================================
 * Armazenamento transacional robusto, persistente e ilimitado no navegador.
 * Grava:
 *  1. Conferências concluídas e auditorias salvas
 *  2. Bipagens individuais com carimbo de tempo, stage físico e vaga
 *  3. Ocorrências de divergência / chamados para Inventário
 *  4. Snapshots de evolução da base (histórico de cargas WMS / Power BI)
 *  5. Exportador corporativo para Excel (.xlsx) e JSON
 * =======================================================================
 */

(function (window) {
  'use strict';

  const DB_NAME = 'DHL_Stage_Conferencia_DB';
  const DB_VERSION = 1;

  let dbInstance = null;
  let isReadyPromise = null;

  function abrirBanco() {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (isReadyPromise) return isReadyPromise;

    isReadyPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        console.warn('[DHL DB] IndexedDB não suportado neste navegador. Operando com fallback.');
        resolve(null);
        return;
      }

      const req = window.indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (ev) {
        const db = ev.target.result;

        // 1. Tabela de Conferências Realizadas
        if (!db.objectStoreNames.contains('conferencias')) {
          const storeConf = db.createObjectStore('conferencias', { keyPath: 'id' });
          storeConf.createIndex('embarque', 'embarque', { unique: false });
          storeConf.createIndex('data', 'data', { unique: false });
          storeConf.createIndex('operador', 'operador', { unique: false });
          storeConf.createIndex('status', 'status', { unique: false });
        }

        // 2. Tabela de Bipagens Físicas (Rastreabilidade Total por Palete)
        if (!db.objectStoreNames.contains('bipagens')) {
          const storeBip = db.createObjectStore('bipagens', { keyPath: 'id', autoIncrement: true });
          storeBip.createIndex('embarque', 'embarque', { unique: false });
          storeBip.createIndex('lpn', 'lpn', { unique: false });
          storeBip.createIndex('stage', 'stageFisico', { unique: false });
          storeBip.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 3. Tabela de Ocorrências / Inventário (Paletes Divergentes)
        if (!db.objectStoreNames.contains('ocorrencias')) {
          const storeOcorr = db.createObjectStore('ocorrencias', { keyPath: 'id', autoIncrement: true });
          storeOcorr.createIndex('embarque', 'embAuditado', { unique: false });
          storeOcorr.createIndex('lpn', 'lpn', { unique: false });
          storeOcorr.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 4. Tabela de Evolução da Base (Versionamento das Planilhas)
        if (!db.objectStoreNames.contains('snapshots_base')) {
          const storeSnap = db.createObjectStore('snapshots_base', { keyPath: 'id' });
          storeSnap.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };

      req.onsuccess = function (ev) {
        dbInstance = ev.target.result;
        console.log('[DHL DB] Banco de Dados IndexedDB conectado com sucesso.');
        resolve(dbInstance);
      };

      req.onerror = function (ev) {
        console.error('[DHL DB] Erro ao abrir IndexedDB:', ev.target.error);
        resolve(null);
      };
    });

    return isReadyPromise;
  }

  // Inicializa o banco automaticamente
  abrirBanco();

  // Executa transação auxiliar
  function transacao(storeName, mode, callback) {
    return abrirBanco().then(db => {
      if (!db) return null;
      return new Promise((resolve, reject) => {
        try {
          const tx = db.transaction(storeName, mode);
          const store = tx.objectStore(storeName);
          const res = callback(store);
          tx.oncomplete = () => resolve(res);
          tx.onerror = (e) => reject(e.target.error);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  /* =========================================================
     MÉTODOS PÚBLICOS DA API DO BANCO DE DADOS
     ========================================================= */
  const DHL_DB = {
    // 1. Salvar Bipagem Individual
    salvarBipagem: function (dados) {
      if (!dados || !dados.lpn) return Promise.resolve(null);
      const registro = {
        timestamp: Date.now(),
        dataHora: new Date().toLocaleString('pt-BR'),
        embarque: dados.embarque || '',
        operador: dados.operador || '',
        lpn: dados.lpn || '',
        stageFisico: dados.stageFisico || '',
        vaga: dados.vaga !== undefined ? dados.vaga : '',
        modoCarga: dados.modoCarga || '1x',
        status: dados.status || 'done',
        isDivergente: !!dados.isDivergente,
        sku: dados.sku || '',
        lote: dados.lote || '',
        qtd: dados.qtd || 0,
        motivo: dados.motivo || ''
      };

      return transacao('bipagens', 'readwrite', store => {
        store.add(registro);
        return registro;
      }).catch(err => {
        console.warn('[DHL DB] Erro ao gravar bipagem:', err);
        return null;
      });
    },

    // 2. Salvar Conferência Completa
    salvarConferencia: function (conf) {
      if (!conf || !conf.embarqueId) return Promise.resolve(null);
      const id = String(conf.embarqueId) + '_' + (conf.iniciadoEm || Date.now());
      const registro = {
        id: id,
        embarque: conf.embarqueId,
        operador: conf.operador || 'Operador DHL',
        iniciadoEm: conf.iniciadoEm || Date.now(),
        finalizadoEm: conf.finalizadoEm || Date.now(),
        data: new Date(conf.iniciadoEm || Date.now()).toLocaleDateString('pt-BR'),
        hora: new Date(conf.iniciadoEm || Date.now()).toLocaleTimeString('pt-BR'),
        status: conf.status || 'Concluída',
        stagesFisicos: conf.stagesFisicos || [],
        totalPaletes: conf.totalPaletes || 0,
        conferidos: conf.conferidosCount || 0,
        divergencias: conf.divergenciasCount || 0,
        amostragemFeita: !!conf.amostragemFeita,
        paletesConferidos: conf.paletesConferidos || []
      };

      return transacao('conferencias', 'readwrite', store => {
        store.put(registro);
        return registro;
      }).catch(err => {
        console.warn('[DHL DB] Erro ao gravar conferência:', err);
        return null;
      });
    },

    // 3. Salvar Ocorrência para Inventário
    salvarOcorrencia: function (ocorr) {
      if (!ocorr || !ocorr.lpn) return Promise.resolve(null);
      const registro = {
        timestamp: Date.now(),
        dataHora: new Date().toLocaleString('pt-BR'),
        lpn: ocorr.lpn,
        stageFisico: ocorr.stageFisico || '',
        embAuditado: ocorr.embAuditado || '',
        embCorreto: ocorr.embCorreto || 'DESCONHECIDO',
        stageCorreto: ocorr.stageCorreto || '',
        sku: ocorr.sku || '',
        operador: ocorr.operador || 'Operador DHL',
        status: 'Pendente Inventário'
      };

      return transacao('ocorrencias', 'readwrite', store => {
        store.add(registro);
        return registro;
      }).catch(err => {
        console.warn('[DHL DB] Erro ao gravar ocorrência:', err);
        return null;
      });
    },

    // 4. Salvar Snapshot de Evolução da Base (ao importar novo arquivo)
    salvarSnapshotBase: function (meta) {
      if (!meta) return Promise.resolve(null);
      const now = Date.now();
      const registro = {
        id: 'snapshot_' + now,
        timestamp: now,
        dataHora: new Date(now).toLocaleString('pt-BR'),
        nomeArquivo: meta.nomeArquivo || 'Base Local',
        totalEmbarques: meta.totalEmbarques || 0,
        totalPaletes: meta.totalPaletes || 0,
        totalPecas: meta.totalPecas || 0,
        totalStages: meta.totalStages || 0,
        alteracoes: meta.alteracoes || 'Carga de dados'
      };

      return transacao('snapshots_base', 'readwrite', store => {
        store.put(registro);
        return registro;
      }).catch(err => {
        console.warn('[DHL DB] Erro ao gravar snapshot da base:', err);
        return null;
      });
    },

    // 5. Listar Todas as Conferências
    obterConferencias: function () {
      return abrirBanco().then(db => {
        if (!db) return [];
        return new Promise((resolve) => {
          try {
            const tx = db.transaction('conferencias', 'readonly');
            const store = tx.objectStore('conferencias');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          } catch (e) { resolve([]); }
        });
      });
    },

    // 6. Listar Todas as Bipagens (com opção de filtro por embarque)
    obterBipagens: function (filtroEmbarque) {
      return abrirBanco().then(db => {
        if (!db) return [];
        return new Promise((resolve) => {
          try {
            const tx = db.transaction('bipagens', 'readonly');
            const store = tx.objectStore('bipagens');
            let req;
            if (filtroEmbarque) {
              const idx = store.index('embarque');
              req = idx.getAll(filtroEmbarque);
            } else {
              req = store.getAll();
            }
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          } catch (e) { resolve([]); }
        });
      });
    },

    // 7. Listar Ocorrências de Inventário
    obterOcorrencias: function () {
      return abrirBanco().then(db => {
        if (!db) return [];
        return new Promise((resolve) => {
          try {
            const tx = db.transaction('ocorrencias', 'readonly');
            const store = tx.objectStore('ocorrencias');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          } catch (e) { resolve([]); }
        });
      });
    },

    // 8. Listar Histórico de Evolução da Base
    obterSnapshotsBase: function () {
      return abrirBanco().then(db => {
        if (!db) return [];
        return new Promise((resolve) => {
          try {
            const tx = db.transaction('snapshots_base', 'readonly');
            const store = tx.objectStore('snapshots_base');
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
          } catch (e) { resolve([]); }
        });
      });
    },

    // 9. EXPORTADOR CORPORATIVO COMPLETO PARA EXCEL (.xlsx)
    exportarBancoExcel: function () {
      return Promise.all([
        DHL_DB.obterConferencias(),
        DHL_DB.obterBipagens(),
        DHL_DB.obterOcorrencias(),
        DHL_DB.obterSnapshotsBase()
      ]).then(([confs, bips, ocorrs, snaps]) => {
        if (!window.XLSX) {
          alert('Biblioteca SheetJS (XLSX) não encontrada para gerar a planilha.');
          return;
        }

        const wb = window.XLSX.utils.book_new();

        // Aba 1: Conferências
        const dadosConf = confs.map(c => ({
          'Data': c.data,
          'Hora': c.hora,
          'Embarque': c.embarque,
          'Operador': c.operador,
          'Status': c.status,
          'Stages': Array.isArray(c.stagesFisicos) ? c.stagesFisicos.join(', ') : c.stagesFisicos,
          'Total Paletes': c.totalPaletes,
          'Conferidos': c.conferidos,
          'Divergências': c.divergencias
        }));
        const wsConf = window.XLSX.utils.json_to_sheet(dadosConf.length ? dadosConf : [{ Info: 'Nenhuma conferência salva' }]);
        window.XLSX.utils.book_append_sheet(wb, wsConf, 'Conferências');

        // Aba 2: Bipagens Detalhadas
        const dadosBip = bips.map(b => ({
          'Data/Hora': b.dataHora,
          'Embarque': b.embarque,
          'Operador': b.operador,
          'LPN': b.lpn,
          'Stage Físico': b.stageFisico,
          'Vaga': b.vaga,
          'Modo Carga': b.modoCarga,
          'Status': b.isDivergente ? 'Divergência' : 'Conferido',
          'SKU': b.sku,
          'Lote': b.lote,
          'Qtd': b.qtd,
          'Motivo': b.motivo
        }));
        const wsBip = window.XLSX.utils.json_to_sheet(dadosBip.length ? dadosBip : [{ Info: 'Nenhuma bipagem registrada' }]);
        window.XLSX.utils.book_append_sheet(wb, wsBip, 'Bipagens');

        // Aba 3: Ocorrências de Inventário
        const dadosOcorr = ocorrs.map(o => ({
          'Data/Hora': o.dataHora,
          'LPN Bipada': o.lpn,
          'Stage Físico': o.stageFisico,
          'Embarque Auditado': o.embAuditado,
          'Embarque Correto (WMS)': o.embCorreto,
          'Stage Correto': o.stageCorreto,
          'SKU': o.sku,
          'Operador': o.operador,
          'Status': o.status
        }));
        const wsOcorr = window.XLSX.utils.json_to_sheet(dadosOcorr.length ? dadosOcorr : [{ Info: 'Nenhuma ocorrência registrada' }]);
        window.XLSX.utils.book_append_sheet(wb, wsOcorr, 'Ocorrências Inventário');

        // Aba 4: Evolução da Base
        const dadosSnap = snaps.map(s => ({
          'Data/Hora': s.dataHora,
          'Arquivo Origem': s.nomeArquivo,
          'Total Embarques': s.totalEmbarques,
          'Total Paletes': s.totalPaletes,
          'Total Peças': s.totalPecas,
          'Total Stages': s.totalStages,
          'Detalhes': s.alteracoes
        }));
        const wsSnap = window.XLSX.utils.json_to_sheet(dadosSnap.length ? dadosSnap : [{ Info: 'Nenhum snapshot de base registrado' }]);
        window.XLSX.utils.book_append_sheet(wb, wsSnap, 'Evolução da Base');

        const hoje = new Date().toISOString().slice(0, 10);
        window.XLSX.writeFile(wb, `DHL_Historico_Conferencia_${hoje}.xlsx`);
        console.log('[DHL DB] Arquivo Excel do Histórico Completo gerado com sucesso.');
      });
    },

    // 10. Exportador em JSON Completo
    exportarBancoJSON: function () {
      return Promise.all([
        DHL_DB.obterConferencias(),
        DHL_DB.obterBipagens(),
        DHL_DB.obterOcorrencias(),
        DHL_DB.obterSnapshotsBase()
      ]).then(([confs, bips, ocorrs, snaps]) => {
        const payload = {
          exportado_em: new Date().toISOString(),
          conferencias: confs,
          bipagens: bips,
          ocorrencias: ocorrs,
          snapshots_base: snaps
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DHL_Banco_Completo_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }
  };

  window.DHL_DB = DHL_DB;
})(window);
