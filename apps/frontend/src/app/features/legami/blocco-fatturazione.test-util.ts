import { PropostaLegame, RigaLegame } from './legami.model'
import { DatiMovimentoLegame } from './blocco-fatturazione.component'

/** Dati di prova condivisi dagli spec del blocco «Fatturazione». Solo per i test. */

export const DATI: DatiMovimentoLegame = {
  causale: 'SCARICO_A_TERZI',
  type: 'SCARICO',
  cerCode: '17 04 05',
  movementDate: '2026-11-03',
  unit: 'KG',
  quantity: '120',
}

export function riga(parziale: Partial<RigaLegame> = {}): RigaLegame {
  return {
    rigaAddebitoId: 'ra-1',
    ordine: 1,
    origine: 'PRINCIPALE',
    tipo: 'SMALTIMENTO',
    descrizione: 'Ferro e acciaio',
    tipoQuantita: 'PESO',
    unitaMisura: 'KG',
    quantita: '120',
    quantitaOrigine: 'DA_MOVIMENTO',
    prezzoSpeciale: false,
    prezzo: '0.5',
    sconto: null,
    prezzoManuale: false,
    aliquotaIva: '22',
    naturaIva: null,
    congelataIl: null,
    importo: '60.00',
    ...parziale,
  }
}

/** Proposta completa: cliente dal FIR, contratto, elenco e due righe. */
export function proposta(parziale: Partial<PropostaLegame> = {}): PropostaLegame {
  return {
    fatturabile: true,
    attiva: true,
    stato: 'PROPOSTO',
    cliente: { id: 'cl-1', etichetta: 'Rossi Srl', fonte: 'FIR' },
    dettaglioCliente: null,
    contratto: { id: 'co-1', etichetta: 'Contratto 2026' },
    elenco: { id: 'el-1', etichetta: 'Listino base' },
    righe: [
      riga(),
      riga({
        rigaAddebitoId: 'ra-2',
        ordine: 2,
        origine: 'PROPOSTA',
        tipo: 'TRASPORTO',
        descrizione: 'Trasporto',
        quantita: '1',
        unitaMisura: 'NR',
        prezzo: '35',
        importo: '35.00',
      }),
    ],
    motivi: [],
    avvisi: [],
    candidati: {
      contratti: [{ id: 'co-1', etichetta: 'Contratto 2026' }],
      elenchi: [{ id: 'el-1', etichetta: 'Listino base' }],
      righe: [],
    },
    ...parziale,
  }
}
