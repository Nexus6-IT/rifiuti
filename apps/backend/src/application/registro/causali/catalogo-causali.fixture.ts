// Righe del catalogo di sistema delle causali per i mock degli spec (copia della tabella C3 del
// piano F2-5; la migration e' la fonte). Usato SOLO dagli spec.
import type { RigaCausaleSistema } from '../../../domain/waste-movement/catalogo-causali'

type Tupla = [
  string,
  RigaCausaleSistema['verso'],
  string,
  RigaCausaleSistema['ruoloMud'],
  string | null,
  string | null,
  number,
]

const TUPLE: Tupla[] = [
  ['PRODUZIONE_INTERNA', 'CARICO', 'Produzione interna', 'PRODOTTO', 'DT', null, 10],
  ['INGRESSO_ESTERNO', 'CARICO', 'Ingresso da esterno', 'RICEVUTO_DA_TERZI', 'T*', null, 20],
  ['RICLASSIFICAZIONE', 'CARICO', 'Riclassificazione CER', 'ESCLUSO', null, null, 30],
  ['RECUPERO_PARZIALE', 'CARICO', 'Recupero parziale', 'PRODOTTO', null, null, 40],
  ['ALTRO_CARICO', 'CARICO', 'Altro carico', 'ESCLUSO', null, null, 50],
  [
    'CONFERIMENTO_TRASPORTATORE',
    'SCARICO',
    'Conferimento a trasportatore',
    'AVVIATO',
    'aT',
    null,
    10,
  ],
  ['AVVIO_RECUPERO', 'SCARICO', 'Avvio a recupero (R)', 'AVVIATO', 'aT', 'R', 20],
  ['AVVIO_SMALTIMENTO', 'SCARICO', 'Avvio a smaltimento (D)', 'AVVIATO', 'aT', 'D', 30],
  ['CESSIONE', 'SCARICO', 'Cessione a terzi', 'AVVIATO', 'aT', null, 40],
  ['RICLASSIFICAZIONE', 'SCARICO', 'Riclassificazione CER', 'ESCLUSO', null, null, 50],
  ['ALTRO_SCARICO', 'SCARICO', 'Altro scarico', 'ESCLUSO', null, null, 60],
]

/** Le 11 righe di sistema, nella forma che `caricaCatalogoCausali` restituisce dal database. */
export function righeCausaliSistema(): RigaCausaleSistema[] {
  return TUPLE.map(([codice, verso, descrizione, ruoloMud, codiceRentri, operazione, ordine]) => ({
    codice,
    verso,
    descrizione,
    ruoloMud,
    codiceRentri,
    operazione,
    ordine,
    attiva: true,
  }))
}
