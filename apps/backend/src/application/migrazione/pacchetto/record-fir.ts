/**
 * Record delle fasi `fir` e `fir-digitali` (ambito FIR, pezzo I5) e loro validazione. Pura: la usano
 * `migrazione:prepara` (workstation) e il caricamento lato server, che NON si fida del pacchetto e
 * rivalida ogni riga. Gli errori non riportano mai valori: solo la fase e il nome del campo.
 *
 * Le parti del FIR si legano per CHIAVE LEGACY (come in I4): nome, partita IVA e indirizzo dello
 * snapshot si leggono dal database in fase di caricamento (la ditta puo' essere un aggancio gia'
 * presente in WasteFlow, di cui il pacchetto non ha i dati). Una parte «propria» e' un'unita' locale
 * dell'azienda stessa (VERSIS `X...`), legata a una sede dalla mappa.
 */
import { dataValida } from '../../../domain/migrazione/winwaste/risultato'
import { PacchettoError } from './errori-pacchetto'
import { MappaImport } from './mappa-import'
import { riferimentoDitta } from './record-anagrafiche'

export type StatoFirPacchetto = 'AWAITING_RECEIVER' | 'COMPLETED'
export type OperazionePacchetto = 'RECOVERY' | 'DISPOSAL'

export type ParteFir =
  | {
      readonly tipo: 'ditta'
      readonly dittaKey: string
      /** Id della ditta gia' presente in WasteFlow (aggancio della mappa), altrimenti `null`. */
      readonly dittaId: string | null
      /** Sede dell'unita' locale citata dal FIR; `null` = nessuna sede importata per quella UL. */
      readonly sedeKey: string | null
      /** Ruolo (produttore/trasportatore/destinatario) importato per quella ditta, se c'e'. */
      readonly ruoloKey: string | null
    }
  | { readonly tipo: 'propria'; readonly sedeId: string }

export interface RecordFir {
  /** `ditta|anno|FORMULARI|COD`. */
  readonly legacyKey: string
  /** `FORMU` cosi' com'e' (serie e numero fiscale, o numero del blocco vidimato). */
  readonly firNumber: string
  readonly stato: StatoFirPacchetto
  /** `AAAA-MM-GG`: data del documento (`DATD`), altrimenti `DTUK`. */
  readonly dataTrasporto: string
  /** Data di fine trasporto (`DATF`): presente se e solo se `COMPLETED`. */
  readonly dataFine: string | null
  /** Formato del catalogo: `NN NN NN` con `*` se pericoloso. */
  readonly cerCode: string
  readonly pericoloso: boolean
  readonly descrizione: string
  readonly quantitaKg: number
  /** Targa dell'automezzo (AUTOMEZZI), `''` se non risolta. */
  readonly targa: string
  readonly operazione: OperazionePacchetto
  readonly produttore: ParteFir
  readonly trasportatore: ParteFir | null
  readonly destinatario: ParteFir
}

export interface RecordFirDigitale {
  /** `ditta|anno|FORMULARI|COD`: la riga sorgente (il FIR digitale NON e' nel database). */
  readonly legacyKey: string
  /** `FORMU`: numero del formulario su RENTRI. */
  readonly numeroFir: string
  /** `XRENTRIFIRTRASMESSI.IDRENTRI` quando la riga corrisponde, altrimenti `null`. */
  readonly idRentri: string | null
  /** Unita' locale dell'azienda coinvolta nel FIR (mappa), per la riacquisizione. */
  readonly unitaLocaleId: string | null
}

const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// eslint-disable-next-line no-control-regex
const CONTROLLO = /[\u0000-\u001f\u007f]/

type FaseFir = 'fir' | 'fir-digitale'

function riga(fase: FaseFir, campo: string): never {
  throw new PacchettoError('RIGA_NON_VALIDA', `${fase}: ${campo}`)
}

function oggetto(v: unknown, fase: FaseFir, chiavi: readonly string[]): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return riga(fase, 'FORMA')
  const o = v as Record<string, unknown>
  const k = Object.keys(o)
  if (k.length !== chiavi.length || !chiavi.every(c => c in o)) return riga(fase, 'FORMA')
  return o
}

function testo(v: unknown, fase: FaseFir, campo: string, min: number, max: number): string {
  if (typeof v !== 'string') return riga(fase, campo)
  if (v.length < min || v.length > max || CONTROLLO.test(v) || v !== v.trim()) {
    return riga(fase, campo)
  }
  return v
}

function dataIso(v: unknown, fase: FaseFir, campo: string): string {
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null
  if (!m || !dataValida(+m[1], +m[2], +m[3])) return riga(fase, campo)
  return v as string
}

function chiaveFirValida(v: unknown, fase: FaseFir, mappa: MappaImport): string {
  const ok =
    typeof v === 'string' &&
    new RegExp(`^${re(mappa.ditta)}\\|${mappa.anno}\\|FORMULARI\\|[1-9][0-9]{0,9}$`).test(v)
  return ok ? (v as string) : riga(fase, 'CHIAVE')
}

function parte(v: unknown, campo: string, mappa: MappaImport): ParteFir {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return riga('fir', campo)
  const tipo = (v as Record<string, unknown>).tipo
  if (tipo === 'propria') {
    const o = oggetto(v, 'fir', ['tipo', 'sedeId'])
    const sedeId = o.sedeId
    if (
      typeof sedeId !== 'string' ||
      !UUID.test(sedeId) ||
      !mappa.unitaLocali.some(u => u.sedeId === sedeId.toLowerCase())
    ) {
      return riga('fir', campo)
    }
    return { tipo: 'propria', sedeId: sedeId.toLowerCase() }
  }
  if (tipo !== 'ditta') return riga('fir', campo)
  const o = oggetto(v, 'fir', ['tipo', 'dittaKey', 'dittaId', 'sedeKey', 'ruoloKey'])
  let rif
  try {
    rif = riferimentoDitta(o, 'ruolo', mappa)
  } catch {
    return riga('fir', campo)
  }
  const dt = re(mappa.ditta)
  const sedeKey = o.sedeKey
  if (
    sedeKey !== null &&
    (typeof sedeKey !== 'string' ||
      !new RegExp(`^${dt}\\|[CF]\\|[0-9A-Za-z]{1,6}\\|[0-9A-Za-z]{1,4}$`).test(sedeKey))
  ) {
    return riga('fir', campo)
  }
  const ruoloKey = o.ruoloKey
  if (
    ruoloKey !== null &&
    (typeof ruoloKey !== 'string' ||
      !new RegExp(`^${dt}\\|[CF]\\|[0-9A-Za-z]{1,6}$`).test(ruoloKey))
  ) {
    return riga('fir', campo)
  }
  return {
    tipo: 'ditta',
    ...rif,
    sedeKey: sedeKey as string | null,
    ruoloKey: ruoloKey as string | null,
  }
}

export function validaRecordFir(valore: unknown, mappa: MappaImport): RecordFir {
  const o = oggetto(valore, 'fir', [
    'legacyKey',
    'firNumber',
    'stato',
    'dataTrasporto',
    'dataFine',
    'cerCode',
    'pericoloso',
    'descrizione',
    'quantitaKg',
    'targa',
    'operazione',
    'produttore',
    'trasportatore',
    'destinatario',
  ])
  const legacyKey = chiaveFirValida(o.legacyKey, 'fir', mappa)
  const firNumber = testo(o.firNumber, 'fir', 'NUMERO', 1, 50)
  if (o.stato !== 'AWAITING_RECEIVER' && o.stato !== 'COMPLETED') riga('fir', 'STATO')
  const dataTrasporto = dataIso(o.dataTrasporto, 'fir', 'DATA')
  // Il completamento nasce dalla data di fine trasporto: l'una senza l'altro e' incoerente.
  if ((o.stato === 'COMPLETED') !== (o.dataFine !== null)) riga('fir', 'DATA_FINE')
  const dataFine = o.dataFine === null ? null : dataIso(o.dataFine, 'fir', 'DATA_FINE')
  if (typeof o.cerCode !== 'string' || !/^\d{2} \d{2} \d{2}\*?$/.test(o.cerCode)) riga('fir', 'CER')
  if (typeof o.pericoloso !== 'boolean') riga('fir', 'PERICOLOSO')
  const descrizione = o.descrizione === '' ? '' : testo(o.descrizione, 'fir', 'DESCRIZIONE', 1, 500)
  const q = o.quantitaKg
  if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0 || q >= 100_000_000) {
    riga('fir', 'QUANTITA')
  }
  if (typeof o.targa !== 'string' || !/^([A-Z0-9]{2,15})?$/.test(o.targa)) riga('fir', 'TARGA')
  if (o.operazione !== 'RECOVERY' && o.operazione !== 'DISPOSAL') riga('fir', 'OPERAZIONE')
  return {
    legacyKey,
    firNumber,
    stato: o.stato,
    dataTrasporto,
    dataFine,
    cerCode: o.cerCode as string,
    pericoloso: o.pericoloso as boolean,
    descrizione,
    quantitaKg: q as number,
    targa: o.targa as string,
    operazione: o.operazione,
    produttore: parte(o.produttore, 'PRODUTTORE', mappa),
    trasportatore: o.trasportatore === null ? null : parte(o.trasportatore, 'TRASPORTATORE', mappa),
    destinatario: parte(o.destinatario, 'DESTINATARIO', mappa),
  }
}

export function validaRecordFirDigitale(valore: unknown, mappa: MappaImport): RecordFirDigitale {
  const o = oggetto(valore, 'fir-digitale', ['legacyKey', 'numeroFir', 'idRentri', 'unitaLocaleId'])
  const legacyKey = chiaveFirValida(o.legacyKey, 'fir-digitale', mappa)
  const numeroFir = testo(o.numeroFir, 'fir-digitale', 'NUMERO', 1, 50)
  if (/\s/.test(numeroFir)) riga('fir-digitale', 'NUMERO')
  const idRentri =
    o.idRentri === null ? null : testo(o.idRentri, 'fir-digitale', 'ID_RENTRI', 1, 255)
  const ul = o.unitaLocaleId
  if (ul !== null && (typeof ul !== 'string' || !UUID.test(ul))) riga('fir-digitale', 'UNITA')
  return {
    legacyKey,
    numeroFir,
    idRentri,
    unitaLocaleId: ul === null ? null : (ul as string).toLowerCase(),
  }
}
