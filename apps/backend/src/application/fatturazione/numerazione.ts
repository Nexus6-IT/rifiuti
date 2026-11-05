// Numerazione delle fatture senza buchi (4.4a, spec §4.6 e §5.4 passo 2). Tutto ruota intorno al
// lock sulla riga `numerazioni_fattura` della coppia (registro IVA, anno): chi numera, chi annulla
// l'ultimo numero e chi imposta il numero di partenza prendono lo STESSO lock `FOR UPDATE`, quindi
// si serializzano. Le funzioni lavorano dentro una transazione gia' aperta nel contesto del tenant
// (RLS) e non la chiudono: se la transazione fa rollback, i numeri riservati tornano liberi.
//
// Ordine dei lock (spec §8): le coppie si bloccano SEMPRE in ordine di `registro_iva_id`, poi di
// `anno`, sia nell'INSERT sia nel `FOR UPDATE`: due transazioni con le stesse coppie in ordine
// opposto non si incrociano (niente 40P01).
import { BadRequestException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { nonTrovato } from '../clienti/registri-iva.service'

export interface RichiestaNumeri {
  registroIvaId: string
  anno: number
  quanti: number
  /** `AAAA-MM-GG`: l'anno deve essere quello della coppia. */
  dataDocumento: string
}

export interface NumeriRiservati {
  registroIvaId: string
  anno: number
  /** Primo e ultimo numero riservati, estremi inclusi. */
  da: number
  a: number
  suffisso: string | null
}

export interface StatoNumerazione {
  ultimoNumero: number
  ultimaData: string | null
  numeroPartenza: number
  dataPartenza: string | null
}

export interface CoppiaNumerazione {
  registroIvaId: string
  anno: number
}

const INT4_MAX = 2_147_483_647
const ANNO_MIN = 2000
const ANNO_MAX = 2100

/** Gli id sono confrontati in minuscolo: il database li restituisce cosi', il chiamante no. */
export const chiaveNumerazione = (registroIvaId: string, anno: number): string =>
  `${registroIvaId.toLowerCase()}:${anno}`

/** `AAAA-MM-GG` di oggi nel fuso italiano (a cavallo di mezzanotte l'UTC darebbe il giorno prima). */
export function oggiRoma(adesso: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(adesso)
}

/** `15` con suffisso `/A` diventa `15/A`; senza suffisso resta `15`. */
export function numeroTesto(numero: number, suffisso: string | null): string {
  return `${numero}${suffisso ?? ''}`
}

export const annulloNonAmmesso = (message: string) =>
  new ConflictException({ error: 'ANNULLO_NON_AMMESSO', message })

/** `AAAA-MM-GG` esistente nel calendario. */
export function eDataIso(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function validaAnno(anno: number): void {
  if (!Number.isInteger(anno) || anno < ANNO_MIN || anno > ANNO_MAX) {
    throw new BadRequestException({
      error: 'ANNO_NON_VALIDO',
      message: `L'anno deve essere compreso fra ${ANNO_MIN} e ${ANNO_MAX}.`,
    })
  }
}

/** Coppie senza doppioni, in ordine di `registro_iva_id` e poi di anno (l'ordine dei lock). */
function coppieOrdinate(coppie: readonly CoppiaNumerazione[]): CoppiaNumerazione[] {
  const viste = new Map<string, CoppiaNumerazione>()
  for (const c of coppie) {
    validaAnno(c.anno)
    viste.set(chiaveNumerazione(c.registroIvaId, c.anno), {
      registroIvaId: c.registroIvaId.toLowerCase(),
      anno: c.anno,
    })
  }
  return [...viste.values()].sort((x, y) =>
    x.registroIvaId < y.registroIvaId ? -1 : x.registroIvaId > y.registroIvaId ? 1 : x.anno - y.anno
  )
}

interface RigaNumerazione {
  registroIvaId: string
  anno: number
  ultimoNumero: number
  ultimaData: string | null
  numeroPartenza: number
  dataPartenza: string | null
}

/**
 * Crea (se mancano) e blocca `FOR UPDATE` le righe delle coppie, in ordine di registro e anno.
 * Una sola INSERT e una sola SELECT: nessun ciclo. Dopo la chiamata la transazione tiene il lock
 * fino al commit o al rollback. Restituisce lo stato letto SOTTO lock, per chiave `registro:anno`.
 */
export async function bloccaNumerazioni(
  tx: Prisma.TransactionClient,
  tenantId: string,
  coppie: readonly CoppiaNumerazione[]
): Promise<Map<string, StatoNumerazione>> {
  const ordinate = coppieOrdinate(coppie)
  const stato = new Map<string, StatoNumerazione>()
  if (ordinate.length === 0) return stato
  const registri = ordinate.map(c => c.registroIvaId)
  const anni = ordinate.map(c => c.anno)

  // Un registro di un'altra azienda (o inesistente) non si vede con la RLS: 404 pulito invece di
  // una violazione di FK.
  const presenti = await tx.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM "registri_iva"
    WHERE tenant_id = ${tenantId}::uuid
      AND id = ANY(${[...new Set(registri)]}::uuid[])`
  if (presenti[0].n !== new Set(registri).size) throw nonTrovato()

  // ORDER BY: l'INSERT scrive le righe nell'ordine della SELECT; due inserimenti concorrenti della
  // stessa coppia si accodano sull'indice unico (il secondo aspetta il commit del primo).
  await tx.$executeRaw`
    INSERT INTO "numerazioni_fattura" (tenant_id, registro_iva_id, anno, updated_at)
    SELECT ${tenantId}::uuid, c.registro_iva_id, c.anno, now()
    FROM unnest(${registri}::uuid[], ${anni}::int[]) AS c(registro_iva_id, anno)
    ORDER BY c.registro_iva_id, c.anno
    ON CONFLICT DO NOTHING`

  const righe = await tx.$queryRaw<RigaNumerazione[]>`
    SELECT n.registro_iva_id::text AS "registroIvaId", n.anno::int AS anno,
           n.ultimo_numero AS "ultimoNumero", n.ultima_data::text AS "ultimaData",
           n.numero_partenza AS "numeroPartenza", n.data_partenza::text AS "dataPartenza"
    FROM "numerazioni_fattura" n
    JOIN unnest(${registri}::uuid[], ${anni}::int[]) AS c(registro_iva_id, anno)
      ON n.registro_iva_id = c.registro_iva_id AND n.anno = c.anno
    WHERE n.tenant_id = ${tenantId}::uuid
    ORDER BY n.registro_iva_id, n.anno
    FOR UPDATE OF n`
  for (const r of righe) {
    stato.set(chiaveNumerazione(r.registroIvaId, r.anno), {
      ultimoNumero: r.ultimoNumero,
      ultimaData: r.ultimaData,
      numeroPartenza: r.numeroPartenza,
      dataPartenza: r.dataPartenza,
    })
  }
  if (stato.size !== ordinate.length) {
    // La riga e' stata appena inserita: se manca, il registro non e' dell'azienda (RLS) o e' sparito.
    throw nonTrovato()
  }
  return stato
}

function validaRichiesta(r: RichiestaNumeri): void {
  validaAnno(r.anno)
  if (!Number.isInteger(r.quanti) || r.quanti < 1) {
    throw new BadRequestException({
      error: 'QUANTITA_NUMERI_NON_VALIDA',
      message: 'La quantità di numeri da riservare deve essere un intero positivo.',
    })
  }
  if (!eDataIso(r.dataDocumento) || Number(r.dataDocumento.slice(0, 4)) !== r.anno) {
    // Un documento di una data va numerato nella serie dell'anno di quella data: altrimenti il
    // numero sarebbe fiscalmente sbagliato.
    throw new BadRequestException({
      error: 'DATA_DOCUMENTO_NON_VALIDA',
      message: "La data del documento non è valida o non appartiene all'anno della numerazione.",
    })
  }
}

const dataIt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * Riserva numeri consecutivi per ciascuna richiesta (spec §5.4 passo 2), nell'ordine delle
 * richieste. Prende il lock su tutte le coppie PRIMA di leggere, poi:
 * - data anteriore a `ultima_data` della coppia: 409 `DATA_ANTERIORE_ULTIMA_FATTURA`, nulla scritto;
 * - `da = ultimo_numero + 1`, `a = ultimo_numero + quanti`;
 * - una sola `UPDATE … FROM unnest` con `ultimo_numero`, `ultima_data = dataDocumento`, `versione + 1`.
 * Piu' richieste sulla stessa coppia nella stessa chiamata si numerano in sequenza: le date devono
 * essere non decrescenti (chi chiama le ordina). I numeri vivono solo finche' la transazione non
 * fa commit: un rollback li restituisce.
 */
export async function riservaNumeri(
  tx: Prisma.TransactionClient,
  tenantId: string,
  r: readonly RichiestaNumeri[]
): Promise<NumeriRiservati[]> {
  if (r.length === 0) return []
  r.forEach(validaRichiesta)

  const stato = await bloccaNumerazioni(tx, tenantId, r)

  const idRegistri = [...new Set(r.map(x => x.registroIvaId.toLowerCase()))]
  const suffissi = await tx.$queryRaw<{ id: string; suffisso: string | null }[]>`
    SELECT id::text AS id, suffisso_numero AS suffisso FROM "registri_iva"
    WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${idRegistri}::uuid[])`
  const suffissoDi = new Map(suffissi.map(s => [s.id, s.suffisso]))

  const corrente = new Map<string, { ultimo: number; data: string | null }>()
  for (const [chiave, s] of stato)
    corrente.set(chiave, { ultimo: s.ultimoNumero, data: s.ultimaData })

  const riservati: NumeriRiservati[] = []
  for (const x of r) {
    const c = corrente.get(chiaveNumerazione(x.registroIvaId, x.anno))!
    if (c.data !== null && x.dataDocumento < c.data) {
      throw new ConflictException({
        error: 'DATA_ANTERIORE_ULTIMA_FATTURA',
        message: `La data del documento è anteriore a quella dell'ultima fattura numerata (${dataIt(c.data)}).`,
        details: { ultimaData: c.data },
      })
    }
    const da = c.ultimo + 1
    const a = c.ultimo + x.quanti
    if (a > INT4_MAX) {
      throw new ConflictException({
        error: 'NUMERAZIONE_ESAURITA',
        message: 'La numerazione ha raggiunto il limite massimo.',
      })
    }
    c.ultimo = a
    c.data = x.dataDocumento
    riservati.push({
      registroIvaId: x.registroIvaId.toLowerCase(),
      anno: x.anno,
      da,
      a,
      suffisso: suffissoDi.get(x.registroIvaId.toLowerCase()) ?? null,
    })
  }

  const chiavi = [...corrente.keys()].sort()
  const finali = chiavi.map(k => {
    const [registroIvaId, anno] = k.split(':')
    const c = corrente.get(k)!
    return { registroIvaId, anno: Number(anno), ultimo: c.ultimo, data: c.data as string }
  })
  const aggiornate = await tx.$executeRaw`
    UPDATE "numerazioni_fattura" n
    SET ultimo_numero = u.ultimo, ultima_data = u.data::date, versione = n.versione + 1,
        updated_at = now()
    FROM unnest(${finali.map(f => f.registroIvaId)}::uuid[], ${finali.map(f => f.anno)}::int[],
                ${finali.map(f => f.ultimo)}::int[], ${finali.map(f => f.data)}::text[])
         AS u(registro_iva_id, anno, ultimo, data)
    WHERE n.tenant_id = ${tenantId}::uuid AND n.registro_iva_id = u.registro_iva_id
      AND n.anno = u.anno`
  if (aggiornate !== finali.length) {
    throw new Error('Numerazione: aggiornamento incompleto delle coppie bloccate.')
  }
  return riservati
}

/**
 * Annullo dell'ultimo numero (decisione 3, §5.5): restituisce `numero` alla serie. Ammesso solo se
 * `numero` e' l'`ultimo_numero` della coppia e il documento e' un `DEFINITIVO` che porta quel
 * numero, non e' una nota di credito (decisione 18) e non e' stato emesso. Un documento
 * `ANNULLATO` e' rifiutato (409 `ANNULLO_NON_AMMESSO`): il suo numero puo' essere gia' stato
 * riassegnato a un altro definitivo, e rilasciarlo romperebbe la serie.
 *
 * Uso previsto (Task 19/20): l'annullo chiama questa funzione NELLA STESSA transazione, mentre il
 * documento e' ancora `DEFINITIVO`, e subito dopo lo porta ad `ANNULLATO`. La coppia e il
 * documento si bloccano in quest'ordine (numerazione, poi documento), come l'annullo. `ultima_data`
 * torna alla data del definitivo precedente della coppia o, se non ce ne sono, alla data di
 * partenza (P1).
 */
export async function rilasciaUltimo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  c: { registroIvaId: string; anno: number; numero: number; documentoId: string }
): Promise<void> {
  validaAnno(c.anno)
  const [n] = await tx.$queryRaw<
    { ultimoNumero: number; numeroPartenza: number; dataPartenza: string | null }[]
  >`
    SELECT ultimo_numero AS "ultimoNumero", numero_partenza AS "numeroPartenza",
           data_partenza::text AS "dataPartenza"
    FROM "numerazioni_fattura"
    WHERE tenant_id = ${tenantId}::uuid AND registro_iva_id = ${c.registroIvaId}::uuid
      AND anno = ${c.anno}::int
    FOR UPDATE`
  if (
    !n ||
    !Number.isInteger(c.numero) ||
    c.numero !== n.ultimoNumero ||
    c.numero <= n.numeroPartenza
  ) {
    throw annulloNonAmmesso(
      "Si può annullare solo l'ultimo numero emesso: per gli altri usa la nota di credito di storno."
    )
  }

  const [doc] = await tx.$queryRaw<
    { stato: string; tipo: string; numero: number | null; emesso: boolean }[]
  >`
    SELECT stato::text AS stato, tipo_documento AS tipo, numero, (emesso_il IS NOT NULL) AS emesso
    FROM "documenti_fattura"
    WHERE tenant_id = ${tenantId}::uuid AND id = ${c.documentoId}::uuid
      AND registro_iva_id = ${c.registroIvaId}::uuid AND anno = ${c.anno}::int
    FOR UPDATE`
  if (!doc || doc.numero !== c.numero || doc.stato !== 'DEFINITIVO') {
    throw annulloNonAmmesso("Il documento non è l'ultimo numero emesso della serie.")
  }
  if (doc.tipo === 'TD04') {
    throw annulloNonAmmesso(
      'Una nota di credito non si annulla: si corregge con un nuovo documento.'
    )
  }
  if (doc.emesso) {
    throw annulloNonAmmesso('Il documento è già stato emesso: usa la nota di credito di storno.')
  }

  const [prec] = await tx.$queryRaw<{ data: string | null }[]>`
    SELECT max(data_documento)::text AS data FROM "documenti_fattura"
    WHERE tenant_id = ${tenantId}::uuid AND registro_iva_id = ${c.registroIvaId}::uuid
      AND anno = ${c.anno}::int AND stato = 'DEFINITIVO' AND numero < ${c.numero}::int
      AND id <> ${c.documentoId}::uuid`
  const aggiornate = await tx.$executeRaw`
    UPDATE "numerazioni_fattura"
    SET ultimo_numero = ${c.numero - 1}::int, ultima_data = ${prec?.data ?? n.dataPartenza}::date,
        versione = versione + 1, updated_at = now()
    WHERE tenant_id = ${tenantId}::uuid AND registro_iva_id = ${c.registroIvaId}::uuid
      AND anno = ${c.anno}::int AND ultimo_numero = ${c.numero}::int`
  if (aggiornate !== 1) throw new Error('Numerazione: rilascio non applicato.')
}
