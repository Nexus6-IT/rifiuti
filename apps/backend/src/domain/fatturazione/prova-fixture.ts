import type { RigaLegameDaFatturare, RigaListinoDaFatturare } from './tipi'

/** Fixture dei test del calcolo di fatturazione (solo per gli spec). */
export function listinoDi(p: Partial<RigaListinoDaFatturare> = {}): RigaListinoDaFatturare {
  return {
    id: 'r1',
    versione: 1,
    elencoId: 'E1',
    daAllegato: false,
    tipo: 'F',
    descrizione: null,
    categoriaId: null,
    unitaMisura: 'KG',
    prezzo: '10.00',
    quantitaFissa: null,
    sconto: null,
    prezzoSpeciale: false,
    applicaA: null,
    condizione: null,
    condizioniRiferite: null,
    scaglioni: [],
    scadenze: [],
    periodoScadenze: null,
    minimoFatturabile: null,
    minimoPerCategoria: false,
    codiceIva: {
      id: 'iva22',
      versione: 1,
      aliquota: '22.00',
      natura: null,
      descrizione: 'IVA 22%',
    },
    ...p,
  }
}

let n = 0
export function legameDi(p: Partial<RigaLegameDaFatturare> = {}): RigaLegameDaFatturare {
  n += 1
  return {
    legameId: `L${n}`,
    rigaLegameId: `RL${n}`,
    legameVersione: 1,
    elencoId: 'E1',
    movimentoVigenteId: `M${n}`,
    dataMovimento: '2026-11-02',
    quantitaMovimento: '1000',
    unitaMovimento: 'KG',
    cerCode: '150101',
    numeroFir: null,
    rigaAddebitoId: 'r1',
    tipo: 'CER',
    descrizione: null,
    unitaMisura: 'KG',
    quantita: '1000',
    prezzo: '0.1',
    prezzoSpeciale: false,
    sconto: null,
    codiceIvaId: 'iva22',
    aliquotaIva: '22.00',
    naturaIva: null,
    ...p,
  }
}
