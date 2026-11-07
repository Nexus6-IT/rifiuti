import { DocumentoDettaglio } from '../fatturazione.model'
import { documentoRiga } from '../elaborazioni/anteprima.fixture'

/** Dati di prova per le spec dei documenti (non entra nel bundle). */
export function dettaglioDocumento(extra: Partial<DocumentoDettaglio> = {}): DocumentoDettaglio {
  return {
    ...documentoRiga(1, {
      stato: 'DEFINITIVO',
      numeroTesto: '15/A',
      annullabile: true,
      stornabile: true,
    }),
    righe: [
      {
        numeroLinea: 1,
        tipoRiga: 'MOVIMENTO',
        legameId: 'l1',
        rigaAddebitoId: null,
        descrizione: 'Smaltimento 170904',
        dataMovimento: '2026-10-12',
        cerCode: '170904',
        numeroFir: 'FIR123',
        quantita: '1234.500',
        unitaMisura: 'kg',
        prezzoUnitario: '0.50',
        sconto: null,
        importoLordo: '617.25',
        importoSconto: '0.00',
        prezzoTotale: '617.25',
        aliquotaIva: '22.00',
        naturaIva: null,
      },
    ],
    riepiloghi: [
      {
        aliquota: '22.00',
        natura: null,
        imponibile: '1000.00',
        imposta: '220.00',
        esigibilita: 'I',
        riferimentoNormativo: null,
      },
    ],
    rate: [],
    nettoAPagare: '1220.00',
    bolloDovuto: false,
    importoBollo: null,
    versione: 3,
    documentoOrigineId: null,
    stornoId: null,
    xmlGenerato: false,
    ...extra,
  }
}

/** Errore HTTP di un download (`responseType: 'blob'`): il corpo JSON sta dentro un Blob. */
export function erroreBlob(status: number, corpo: unknown): unknown {
  return { status, error: new Blob([JSON.stringify(corpo)]) }
}

/** Lascia girare le promesse (lettura del Blob) e ridisegna. */
export async function svuotaPromesse(): Promise<void> {
  // La lettura di un Blob è asincrona fuori dal ciclo degli eventi: margine largo per i PC carichi.
  for (let i = 0; i < 10; i++) await new Promise<void>(r => setTimeout(r, 20))
}
