import type { ContrattoDaFatturare, InputDocumento } from '../domain/fatturazione/calcola-documento'
import type {
  CodiceIvaDaFatturare,
  RigaLegameDaFatturare,
  RigaListinoDaFatturare,
} from '../domain/fatturazione/tipi'

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
    categoriaCodice: null,
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
/** Azzera il contatore degli id dei legami (da chiamare in `beforeEach`). */
export function azzeraContatoreLegami(): void {
  n = 0
}

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

export const IVA_22: CodiceIvaDaFatturare = {
  id: 'iva22',
  versione: 1,
  aliquota: '22.00',
  natura: null,
  descrizione: 'IVA 22%',
}
export const IVA_N4: CodiceIvaDaFatturare = {
  id: 'ivaN4',
  versione: 1,
  aliquota: '0.00',
  natura: 'N4',
  descrizione: 'Esente art. 10',
}
export const IVA_N1: CodiceIvaDaFatturare = {
  id: 'ivaN1',
  versione: 1,
  aliquota: '0.00',
  natura: 'N1',
  descrizione: 'Escluso art. 15',
}

/** Contratto attivo, completo, a 30 giorni con bonifico non richiesto (MP08): nessun errore. */
export function contrattoDi(p: Partial<ContrattoDaFatturare> = {}): ContrattoDaFatturare {
  return {
    id: 'C1',
    versione: 1,
    stato: 'ATTIVO',
    dataInizio: '2026-01-01',
    dataFine: null,
    esigibilita: 'I',
    ritenutaPercentuale: null,
    condizione: { modalita: 'MP08', giorniRate: [30], fineMese: false },
    contoCedente: null,
    bancaCliente: null,
    speseIncasso: null,
    bollo: null,
    registroIvaId: 'REG1',
    codiceDestinatario: 'ABCDEFG',
    pec: null,
    cig: null,
    cup: null,
    idDocumento: null,
    clienteCompleto: { datiFiscali: true, sede: true },
    ...p,
  }
}

/** Ingresso del calcolo del documento: `listino` dalle righe date (nell'ordine dato). */
export function inputDocumentoDi(
  p: Partial<InputDocumento> & { righeListino?: RigaListinoDaFatturare[] } = {}
): InputDocumento {
  const { righeListino, ...resto } = p
  const listino = new Map<string, RigaListinoDaFatturare>(
    (righeListino ?? [listinoDi({ id: 'r1', tipo: 'CER' })]).map(r => [r.id, r])
  )
  return {
    raggruppamento: 'PER_CONTRATTO',
    contratto: contrattoDi(),
    periodo: { dal: '2026-11-01', al: '2026-11-30' },
    dataDocumento: '2026-12-05',
    legami: [],
    listino,
    righeFisse: [],
    righeQuantita: [],
    minimi: [],
    marcatori: [],
    codiciIva: new Map([IVA_22, IVA_N4, IVA_N1].map(c => [c.id, c])),
    legamiDaCollegareEsclusi: 0,
    arretrati: 0,
    ...resto,
  }
}
