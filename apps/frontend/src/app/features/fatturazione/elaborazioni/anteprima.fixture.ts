import { ElaborazioneDettaglio, DocumentoRiga, Pagina } from '../fatturazione.model'

/** Dati di prova per le spec della pagina dell'anteprima (non entra nel bundle). */
export function dettaglio(extra: Partial<ElaborazioneDettaglio> = {}): ElaborazioneDettaglio {
  return {
    id: 'e1',
    stato: 'ANTEPRIMA_PRONTA',
    createdAt: '2026-11-03T09:30:00.000Z',
    periodoDal: '2026-10-01',
    periodoAl: '2026-10-31',
    dataDocumento: '2026-11-03',
    documenti: 28,
    totale: '12345.60',
    errori: 1,
    avvisi: 2,
    raggruppamento: 'PER_CONTRATTO',
    includiArretrati: false,
    filtri: {},
    impronta: 'a'.repeat(64),
    versione: 3,
    definitiveAttive: true,
    erroriGenerali: [],
    erroriPeriodo: [],
    numerazionePrevista: [{ registroIvaId: 'r1', codiceRegistro: 'A', da: '15/A', a: '42/A' }],
    totaliPerRegistro: [
      { registroIvaId: 'r1', imponibile: '10000.00', iva: '2345.60', totale: '12345.60' },
    ],
    documentiNonGenerati: [],
    errore: null,
    erroreTecnico: null,
    ...extra,
  }
}

export function documentoRiga(n: number, extra: Partial<DocumentoRiga> = {}): DocumentoRiga {
  return {
    id: `d${n}`,
    stato: 'BOZZA',
    tipoDocumento: 'TD01',
    numeroTesto: null,
    dataDocumento: '2026-11-03',
    cliente: { id: `c${n}`, denominazione: `Cliente ${n} Srl` },
    contratto: { id: `k${n}`, numero: `CC-2026-00${n}` },
    registro: { id: 'r1', codice: 'A' },
    totaleImponibile: '1000.00',
    totaleIva: '220.00',
    totaleDocumento: '1220.00',
    errori: [],
    avvisi: [],
    esclusoDaDefinitiva: false,
    emessoIl: null,
    annullabile: false,
    motivoNonAnnullabile: null,
    stornabile: false,
    ...extra,
  }
}

export const paginaDocumenti = (
  elementi: DocumentoRiga[],
  totale = elementi.length
): Pagina<DocumentoRiga> => ({ elementi, totale, pagina: 1, dimensione: 50 })
