/**
 * Record delle fasi `sedi`, `produttori`, `trasportatori`, `destinatari`, `automezzi` (ambito
 * ANAGRAFICHE, pezzo I4) e loro validazione. Pura: la usano sia `migrazione:prepara` sia il
 * caricamento lato server, che NON si fida del pacchetto e rivalida ogni riga. Gli errori non
 * riportano mai valori (sono dati dell'azienda): solo la fase e il nome del campo.
 *
 * Le parti si legano per CHIAVE LEGACY, non per id: il server risolve gli id dentro il blocco.
 * Una ditta gia' presente in WasteFlow (aggancio della mappa) porta il suo `dittaId`.
 */
import { dataValida } from '../../../domain/migrazione/winwaste/risultato'
import { PacchettoError } from './errori-pacchetto'
import { MappaImport } from './mappa-import'

export interface RiferimentoDitta {
  /** `ditta|FISC|<P.IVA o CF>`. */
  readonly dittaKey: string
  /** Id della ditta gia' presente in WasteFlow (aggancio della mappa), altrimenti `null`. */
  readonly dittaId: string | null
}

export interface RecordSede extends RiferimentoDitta {
  /** `ditta|PRECOD|COD|UL` (UNITA LOCALI) oppure UL riservata `SL`/`S2` (sede legale, seconda sede). */
  readonly legacyKey: string
  readonly denominazione: string | null
  readonly via: string
  readonly civico: string
  readonly cap: string
  readonly comune: string
  readonly provincia: string
  readonly telefono: string | null
  readonly principale: boolean
}

export interface RecordRuolo extends RiferimentoDitta {
  /** `ditta|PRECOD|COD` del soggetto (CLIFOR). */
  readonly legacyKey: string
  /** Sede predefinita del ruolo: chiave di una sede dello STESSO soggetto. */
  readonly sedeKey: string
}
export type RecordProduttore = RecordRuolo
export interface RecordTrasportatore extends RecordRuolo {
  readonly numeroIscrizione: string
  readonly scadenzaIscrizione: string | null
}
export interface RecordDestinatario extends RecordRuolo {
  readonly numeroAutorizzazione: string
  readonly scadenzaAutorizzazione: string | null
}

export interface RecordAutomezzo {
  /** `ditta|MEZ|<PRECOD>|<COD>` (vedi `chiaveAutomezzo`). */
  readonly legacyKey: string
  readonly targa: string
  /** Chiave del ruolo trasportatore proprietario, o `null` (parco proprio, nessun ruolo). */
  readonly trasportatoreKey: string | null
  readonly taraKg: number | null
  readonly note: string | null
}

type Fase = 'sede' | 'ruolo' | 'automezzo'

function riga(fase: Fase, campo: string): never {
  throw new PacchettoError('RIGA_NON_VALIDA', `${fase}: ${campo}`)
}

const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// eslint-disable-next-line no-control-regex
const CONTROLLO = /[\u0000-\u001f\u007f]/

function oggetto(v: unknown, fase: Fase, chiavi: readonly string[]): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) riga(fase, 'FORMA')
  const o = v as Record<string, unknown>
  const k = Object.keys(o)
  if (k.length !== chiavi.length || !chiavi.every(c => c in o)) riga(fase, 'FORMA')
  return o
}

function testo(
  v: unknown,
  fase: Fase,
  campo: string,
  max: number,
  nullable: boolean
): string | null {
  if (v === null && nullable) return null
  if (typeof v !== 'string') return riga(fase, campo)
  const t = v.trim()
  if (t.length === 0 || t.length > max || CONTROLLO.test(t) || t !== v) return riga(fase, campo)
  return t
}

function riferimentoDitta(
  o: Record<string, unknown>,
  fase: Fase,
  mappa: MappaImport
): RiferimentoDitta {
  const m = new RegExp(`^${re(mappa.ditta)}\\|FISC\\|([A-Z0-9]{1,16})$`).exec(String(o.dittaKey))
  if (typeof o.dittaKey !== 'string' || !m) return riga(fase, 'DITTA')
  const aggancio = mappa.agganci.find(a => a.partitaIva === m[1])
  const dittaId = o.dittaId
  if (dittaId === null) {
    if (aggancio) return riga(fase, 'AGGANCIO')
  } else {
    if (typeof dittaId !== 'string' || !UUID.test(dittaId)) return riga(fase, 'AGGANCIO')
    if (!aggancio || aggancio.dittaId !== dittaId.toLowerCase()) return riga(fase, 'AGGANCIO')
  }
  return {
    dittaKey: o.dittaKey,
    dittaId: dittaId === null ? null : (dittaId as string).toLowerCase(),
  }
}

export function validaRecordSede(valore: unknown, mappa: MappaImport): RecordSede {
  const o = oggetto(valore, 'sede', [
    'legacyKey',
    'dittaKey',
    'dittaId',
    'denominazione',
    'via',
    'civico',
    'cap',
    'comune',
    'provincia',
    'telefono',
    'principale',
  ])
  if (
    typeof o.legacyKey !== 'string' ||
    !new RegExp(`^${re(mappa.ditta)}\\|[CF]\\|[0-9A-Za-z]{1,6}\\|[0-9A-Za-z]{1,4}$`).test(
      o.legacyKey
    )
  ) {
    riga('sede', 'CHIAVE')
  }
  const rif = riferimentoDitta(o, 'sede', mappa)
  const denominazione = testo(o.denominazione, 'sede', 'DENOMINAZIONE', 255, true)
  const via = testo(o.via, 'sede', 'INDIRIZZO', 255, false) as string
  const civico = testo(o.civico, 'sede', 'INDIRIZZO', 20, false) as string
  const comune = testo(o.comune, 'sede', 'INDIRIZZO', 100, false) as string
  if (typeof o.cap !== 'string' || !/^[0-9]{5}$/.test(o.cap)) riga('sede', 'INDIRIZZO')
  if (typeof o.provincia !== 'string' || !/^[A-Z]{2}$/.test(o.provincia)) riga('sede', 'INDIRIZZO')
  if (
    o.telefono !== null &&
    (typeof o.telefono !== 'string' || !/^[0-9+ ./()-]{3,20}$/.test(o.telefono))
  )
    riga('sede', 'TELEFONO')
  if (typeof o.principale !== 'boolean') riga('sede', 'PRINCIPALE')
  return {
    legacyKey: o.legacyKey as string,
    ...rif,
    denominazione,
    via,
    civico,
    cap: o.cap as string,
    comune,
    provincia: o.provincia as string,
    telefono: o.telefono as string | null,
    principale: o.principale as boolean,
  }
}

function ruolo(o: Record<string, unknown>, mappa: MappaImport): RecordRuolo {
  if (
    typeof o.legacyKey !== 'string' ||
    !new RegExp(`^${re(mappa.ditta)}\\|[CF]\\|[0-9A-Za-z]{1,6}$`).test(o.legacyKey)
  ) {
    riga('ruolo', 'CHIAVE')
  }
  const rif = riferimentoDitta(o, 'ruolo', mappa)
  if (
    typeof o.sedeKey !== 'string' ||
    !o.sedeKey.startsWith(`${o.legacyKey as string}|`) ||
    !/^[0-9]{4}\|[CF]\|[0-9A-Za-z]{1,6}\|[0-9A-Za-z]{1,4}$/.test(o.sedeKey)
  ) {
    riga('ruolo', 'SEDE')
  }
  return { legacyKey: o.legacyKey as string, ...rif, sedeKey: o.sedeKey as string }
}

function dataIsoOppureNull(v: unknown, campo: string): string | null {
  if (v === null) return null
  const m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null
  if (!m || !dataValida(+m[1], +m[2], +m[3])) return riga('ruolo', campo)
  return v as string
}

const CHIAVI_RUOLO = ['legacyKey', 'dittaKey', 'dittaId', 'sedeKey'] as const

export function validaRecordProduttore(valore: unknown, mappa: MappaImport): RecordProduttore {
  return ruolo(oggetto(valore, 'ruolo', CHIAVI_RUOLO), mappa)
}

export function validaRecordTrasportatore(
  valore: unknown,
  mappa: MappaImport
): RecordTrasportatore {
  const o = oggetto(valore, 'ruolo', [...CHIAVI_RUOLO, 'numeroIscrizione', 'scadenzaIscrizione'])
  return {
    ...ruolo(o, mappa),
    numeroIscrizione: testo(o.numeroIscrizione, 'ruolo', 'NUMERO', 50, false) as string,
    scadenzaIscrizione: dataIsoOppureNull(o.scadenzaIscrizione, 'SCADENZA'),
  }
}

export function validaRecordDestinatario(valore: unknown, mappa: MappaImport): RecordDestinatario {
  const o = oggetto(valore, 'ruolo', [
    ...CHIAVI_RUOLO,
    'numeroAutorizzazione',
    'scadenzaAutorizzazione',
  ])
  return {
    ...ruolo(o, mappa),
    numeroAutorizzazione: testo(o.numeroAutorizzazione, 'ruolo', 'NUMERO', 50, false) as string,
    scadenzaAutorizzazione: dataIsoOppureNull(o.scadenzaAutorizzazione, 'SCADENZA'),
  }
}

export function validaRecordAutomezzo(valore: unknown, mappa: MappaImport): RecordAutomezzo {
  const o = oggetto(valore, 'automezzo', [
    'legacyKey',
    'targa',
    'trasportatoreKey',
    'taraKg',
    'note',
  ])
  if (
    typeof o.legacyKey !== 'string' ||
    !new RegExp(`^${re(mappa.ditta)}\\|MEZ\\|[^|]{1,11}\\|[^|]{1,4}$`).test(o.legacyKey) ||
    CONTROLLO.test(o.legacyKey)
  ) {
    riga('automezzo', 'CHIAVE')
  }
  if (typeof o.targa !== 'string' || !/^[A-Z0-9]{2,15}$/.test(o.targa)) riga('automezzo', 'TARGA')
  if (
    o.trasportatoreKey !== null &&
    (typeof o.trasportatoreKey !== 'string' ||
      !new RegExp(`^${re(mappa.ditta)}\\|[CF]\\|[0-9A-Za-z]{1,6}$`).test(o.trasportatoreKey))
  ) {
    riga('automezzo', 'TRASPORTATORE')
  }
  if (
    o.taraKg !== null &&
    (typeof o.taraKg !== 'number' ||
      !Number.isInteger(o.taraKg) ||
      o.taraKg < 1 ||
      o.taraKg > 999_999)
  ) {
    riga('automezzo', 'TARA')
  }
  const note = o.note === null ? null : testo(o.note, 'automezzo', 'NOTE', 500, false)
  return {
    legacyKey: o.legacyKey as string,
    targa: o.targa as string,
    trasportatoreKey: o.trasportatoreKey as string | null,
    taraKg: o.taraKg as number | null,
    note,
  }
}
