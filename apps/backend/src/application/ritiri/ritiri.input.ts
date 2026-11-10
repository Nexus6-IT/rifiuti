/**
 * Validazione e normalizzazione dei campi del ritiro, pura. Le regole numeriche e di stato sono
 * quelle del dominio (`validaRitiro`); qui si aggiungono i campi di testo, l'unità e la
 * traduzione in messaggi per l'utente.
 */
import type { ProvenienzaRifiuto, TipoTratta, WasteOperationType } from '@prisma/client'
import {
  giornoValido,
  unitaDaRitiro,
  validaRitiro,
  type CodiceErroreRitiro,
  type FasciaRitiro,
  type StatoVisibileRitiro,
  type StatoFirDb,
  statoVisibile,
} from '../../domain/ritiri'
import type { DatiRitiro } from './ritiri.tipi'

export interface ValoriRitiro {
  dataPrevista: string
  fascia: FasciaRitiro | null
  ordineGiro: number | null
  produttoreId: string
  produttoreSedeId: string
  trasportatoreId: string
  destinatarioId: string
  destinatarioSedeId: string
  automezzoId: string | null
  cerCode: string
  descrizione: string
  statoFisico: string | null
  caratteristichePericolo: string | null
  numeroColli: number | null
  /** Sempre con due decimali, es. '12.50'. */
  quantitaPresunta: string
  unita: string
  tipoOperazione: WasteOperationType
  codiceOperazione: string
  provenienza: ProvenienzaRifiuto | null
  tipoTratta: TipoTratta | null
  annotazioni: string | null
  noteInterne: string | null
}

export type EsitoNormalizzazione =
  | { ok: true; valori: ValoriRitiro }
  | { ok: false; messaggi: string[] }

const MESSAGGI: Record<CodiceErroreRitiro, string> = {
  DATA_NON_VALIDA: 'La data del ritiro non è valida.',
  QUANTITA_NON_VALIDA: 'La quantità deve essere maggiore di zero, con al massimo due decimali.',
  ORDINE_GIRO_NON_VALIDO: "L'ordine nel giro deve essere un intero positivo.",
  FASCIA_NON_VALIDA: 'La fascia oraria non è valida.',
  STATO_NON_VALIDO: 'Lo stato del ritiro non è valido.',
  MOTIVO_OBBLIGATORIO: 'Il motivo è obbligatorio.',
  MOTIVO_NON_AMMESSO: 'Il motivo non è ammesso per un ritiro programmato.',
  MOTIVO_TROPPO_LUNGO: 'Il motivo può avere al massimo 500 caratteri.',
}

export function messaggiErrori(codici: CodiceErroreRitiro[]): string[] {
  return codici.map(c => MESSAGGI[c])
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const eUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

const vuotoANull = (v: string | null | undefined): string | null => {
  const t = v?.trim()
  return t ? t : null
}

/** Codice operazione dell'allegato B/C alla parte IV del D.Lgs 152/2006: D1-D15, R1-R13. */
const CODICE_OPERAZIONE = /^[DR]\d{1,2}$/

function tipoOperazioneDa(codice: string): WasteOperationType {
  return codice.startsWith('D') ? 'DISPOSAL' : 'RECOVERY'
}

export function normalizzaDatiRitiro(dati: DatiRitiro): EsitoNormalizzazione {
  const messaggi: string[] = []

  const quantitaGrezza = (dati.quantitaPresunta ?? '').toString().trim()
  const quantitaOk = /^\d{1,8}(\.\d{1,2})?$/.test(quantitaGrezza)
  const quantita = quantitaOk ? Number(quantitaGrezza) : Number.NaN

  const codici = validaRitiro({
    dataPrevista: dati.dataPrevista,
    quantitaPresunta: quantita,
    fascia: dati.fascia ?? null,
    ordineGiro: dati.ordineGiro ?? null,
  })
  messaggi.push(...messaggiErrori(codici))

  for (const [campo, nome] of [
    [dati.produttoreId, 'produttore'],
    [dati.produttoreSedeId, 'sede del produttore'],
    [dati.trasportatoreId, 'trasportatore'],
    [dati.destinatarioId, 'destinatario'],
    [dati.destinatarioSedeId, 'sede del destinatario'],
  ] as const) {
    if (!eUuid(campo)) messaggi.push(`Indica il ${nome}.`)
  }
  if (dati.automezzoId != null && !eUuid(dati.automezzoId)) {
    messaggi.push("L'automezzo indicato non è valido.")
  }

  const cerCode = (dati.cerCode ?? '').trim()
  if (!cerCode || cerCode.length > 10) messaggi.push('Il codice CER non è valido.')

  const descrizione = (dati.descrizione ?? '').trim()
  if (!descrizione) messaggi.push('La descrizione è obbligatoria.')
  if (descrizione.length > 500) messaggi.push('La descrizione può avere al massimo 500 caratteri.')

  const statoFisico = vuotoANull(dati.statoFisico)
  if ((statoFisico?.length ?? 0) > 50) {
    messaggi.push('Lo stato fisico può avere al massimo 50 caratteri.')
  }
  const colli = dati.numeroColli ?? null
  if (colli !== null && (!Number.isInteger(colli) || colli < 0 || colli > 2_147_483_647)) {
    messaggi.push('Il numero di colli non è valido.')
  }

  const unita = (dati.unita ?? 'KG').trim().toUpperCase()
  try {
    unitaDaRitiro(unita)
  } catch {
    messaggi.push("L'unità di misura non è supportata.")
  }

  const codiceOperazione = vuotoANull(dati.codiceOperazione)?.toUpperCase() ?? null
  if (codiceOperazione === null) {
    messaggi.push("Il codice dell'operazione è obbligatorio.")
  } else if (!CODICE_OPERAZIONE.test(codiceOperazione)) {
    messaggi.push("Il codice dell'operazione deve essere un codice R o D (es. R13, D10).")
  }

  if (messaggi.length > 0) return { ok: false, messaggi }

  return {
    ok: true,
    valori: {
      dataPrevista: dati.dataPrevista,
      fascia: dati.fascia ?? null,
      ordineGiro: dati.ordineGiro ?? null,
      produttoreId: dati.produttoreId,
      produttoreSedeId: dati.produttoreSedeId,
      trasportatoreId: dati.trasportatoreId,
      destinatarioId: dati.destinatarioId,
      destinatarioSedeId: dati.destinatarioSedeId,
      automezzoId: dati.automezzoId ?? null,
      cerCode,
      descrizione,
      statoFisico,
      caratteristichePericolo: vuotoANull(dati.caratteristichePericolo),
      numeroColli: colli,
      quantitaPresunta: quantita.toFixed(2),
      unita,
      tipoOperazione: tipoOperazioneDa(codiceOperazione ?? ''),
      codiceOperazione: codiceOperazione ?? '',
      provenienza: dati.provenienza ?? null,
      tipoTratta: dati.tipoTratta ?? null,
      annotazioni: vuotoANull(dati.annotazioni),
      noteInterne: vuotoANull(dati.noteInterne),
    },
  }
}

/** Motivo di annullo / non eseguito: obbligatorio, al massimo 500 caratteri. */
export function normalizzaMotivo(motivo: unknown):
  | { ok: true; motivo: string }
  | {
      ok: false
      messaggi: string[]
    } {
  const t = typeof motivo === 'string' ? motivo.trim() : ''
  const codici = validaRitiro({
    dataPrevista: '2000-01-01',
    quantitaPresunta: 1,
    stato: 'ANNULLATO',
    motivo: t,
  })
  return codici.length === 0
    ? { ok: true, motivo: t }
    : { ok: false, messaggi: messaggiErrori(codici) }
}

export function dataValida(data: unknown): data is string {
  return typeof data === 'string' && giornoValido(data)
}

/**
 * Condizione sullo stato FIR (colonna `f.status` del FIR attivo) che realizza un filtro
 * `statoVisibile`, ricavata dalla stessa funzione di dominio che calcola lo stato mostrato:
 * i due non possono divergere.
 */
export function statiFirPerVisibile(visibile: StatoVisibileRitiro): StatoFirDb[] {
  const tutti: StatoFirDb[] = [
    'DRAFT',
    'AWAITING_PRODUCER',
    'AWAITING_CARRIER',
    'AWAITING_RECEIVER',
    'COMPLETED',
    'SYNCED_TO_RENTRI',
  ]
  return tutti.filter(s => statoVisibile('PROGRAMMATO', s) === visibile)
}
