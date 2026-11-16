import { errore, Esito, ok } from './risultato'

/**
 * `OPER`: tipologia dell'operazione = `TIP` + `OPE` della causale
 * (`docs/movimenti.md` §2.4). La tabella e' un'INFERENZA (confidenza
 * media-alta) dal comportamento del codice; le righe con confidenza media sono
 * marcate `dedotta: true` e finiscono cosi' nel rapporto.
 *
 *  - `classe` e' la classe di giacenza che l'operazione tocca: `T` deposito
 *    temporaneo, `R_D` stoccaggio R13/D15, `X` deposito del produttore. Per
 *    `ENTRAMBI` e' quella dello scarico.
 *  - `richiedeRelazione`: con `MAG1 > 0` e `NETTO > 0`, l'operazione senza
 *    `RELAZ` viene rifiutata da WinWaste ("manca relazione di carico/scarico").
 */
export type TipoOperazione =
  | 'CARICO'
  | 'SCARICO'
  | 'ENTRAMBI'
  | 'NESSUNA_GIACENZA'
  | 'SOLO_FATTURAZIONE'

export type ClasseOperazione = 'T' | 'R_D' | 'X'

export interface OperDecodificata {
  readonly codice: string
  readonly tipo: TipoOperazione
  readonly classe: ClasseOperazione | null
  readonly richiedeRelazione: boolean
  readonly dedotta: boolean
}

export type CodiceOper = 'OPER_SCONOSCIUTO'

type Riga = [TipoOperazione, ClasseOperazione | null, boolean, boolean]

// codice -> [tipo, classe, richiedeRelazione, dedotta]
const TABELLA: Readonly<Record<string, Riga>> = {
  '10': ['CARICO', 'T', false, false],
  '11': ['SCARICO', 'T', true, false],
  '12': ['NESSUNA_GIACENZA', null, false, false],
  '13': ['ENTRAMBI', 'T', true, false],
  '14': ['CARICO', 'R_D', false, false],
  '15': ['ENTRAMBI', 'T', true, false],
  '16': ['CARICO', null, false, false],
  '20': ['CARICO', 'R_D', false, false],
  '21': ['SCARICO', 'R_D', true, false],
  '22': ['CARICO', 'R_D', false, false],
  '23': ['SCARICO', 'R_D', true, false],
  '24': ['ENTRAMBI', 'R_D', true, false],
  '25': ['CARICO', 'R_D', false, false],
  '26': ['CARICO', null, false, false],
  '27': ['NESSUNA_GIACENZA', null, false, true],
  '28': ['NESSUNA_GIACENZA', null, false, false],
  '30': ['NESSUNA_GIACENZA', null, false, false],
  '40': ['NESSUNA_GIACENZA', null, false, false],
  '50': ['CARICO', 'X', false, false],
  '51': ['SCARICO', 'X', true, true],
  '52': ['SCARICO', 'X', false, true],
}

export function decodificaOper(valore: string | null): Esito<OperDecodificata, CodiceOper> {
  const t = (valore ?? '').trim()
  if (!/^\d{2}$/.test(t)) return errore('OPER_SCONOSCIUTO', 'OPER: attese 2 cifre')
  if (Number(t) >= 60) {
    return ok({
      codice: t,
      tipo: 'SOLO_FATTURAZIONE',
      classe: null,
      richiedeRelazione: false,
      dedotta: false,
    })
  }
  const riga = TABELLA[t]
  if (!riga) return errore('OPER_SCONOSCIUTO', 'OPER: codice non presente nella tabella di §2.4')
  const [tipo, classe, richiedeRelazione, dedotta] = riga
  return ok({ codice: t, tipo, classe, richiedeRelazione, dedotta })
}
