// Lista «da collegare» dei legami movimento-cliente-prezzo (fase 4.3, Task 18; spec §7.3,
// decisioni 5, 11 e 13). Sola lettura: nessuna scrittura, nessun lock, niente su `waste_movements`.
//
// Una riga per catena di correzioni, sulla sua TESTA (nessuna correzione che la sostituisca; la
// testa puo' essere anche un ANNULLAMENTO). Entra se:
//   (A) la testa non e' un ANNULLAMENTO, la causale e' fatturabile (sistema: `causali_registro`;
//       propria: la versione indicata da `causale_azienda_id`, come `CatalogoCausali.comportamento`
//       e come il conteggio dei «movimenti toccati») e il giorno italiano (`sqlGiornoMovimento`) e'
//       >= «fatturazione da» (senza data: lista vuota); stato MANCANTE / DA_COLLEGARE / PROPOSTO /
//       ESCLUSO (solo con `esclusi`); CONFERMATO allineato, FATTURATO e ANNULLATO non compaiono; oppure
//   (B) il legame e' rimasto INDIETRO rispetto alla testa (`movimento_vigente_id` <> testa): stato
//       DA_RIALLINEARE, QUALUNQUE sia la testa (annullo, causale diventata non fatturabile, data
//       spostata prima di «fatturazione da») e qualunque lo stato del legame tranne ANNULLATO.
//       Decisione di precedenza: «indietro» vince su ESCLUSO e su FATTURATO/IMPORTATO_FATTURATO,
//       perche' ogni esito della correzione (Task 21) aggiorna `movimento_vigente_id`: indietro
//       significa sempre allineamento fallito, e la 4.4 non deve fatturare o escludere sulla base
//       di un legame che non segue piu' il registro. Per un fatturato la riga porta `fatturato:
//       true` (decisione 21): l'unica azione e' registrare lo scostamento, la fattura non cambia.
//   Un movimento importato non ha marcatore su `waste_movements`: compare come MANCANTE se
//   «fatturazione da» e' anteriore all'import (la 3.8 dovra' gestirlo).
//
// Ordine: data del movimento crescente, poi `id` (deterministico anche a parita' di data). La
// pagina e il totale sono due istruzioni sullo STESSO frammento SQL e nella stessa transazione
// (REPEATABLE READ): il totale e' esatto per la pagina. I contatori usano lo stesso frammento.
//
// Prestazioni: il filtro per periodo si scrive anche in forma «sargable» su `movement_date`
// (indice `(tenant_id, movement_date)`), un giorno di margine verso l'esterno perche' il giorno
// italiano sposta l'istante UTC di al piu' due ore; la forma esatta resta quella sul giorno. Il
// nome del cliente si legge DOPO la paginazione (al massimo `MAX_DIMENSIONE` righe).
import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  MOTIVI_LEGAME,
  STATI_LEGAME,
  type AvvisoLegame,
  type MotivoLegame,
  type StatoLegame,
} from '../../domain/legami-movimento/codici'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { sqlGiornoMovimento } from './giorno-movimento'
import { leggiFatturazioneDaInTx } from './impostazioni-fatturazione.service'
import { normalizzaDecimale } from './proposta-legame.service'

export type StatoListaLegame = StatoLegame | 'MANCANTE' | 'DA_RIALLINEARE'

export const MAX_DIMENSIONE = 200
export const DIMENSIONE_PREDEFINITA = 50
/** Oltre questa pagina l'OFFSET non ha senso: 400 invece di un errore del database. */
export const MAX_PAGINA = 10_000

export interface FiltriLista {
  /** `AAAA-MM-GG`, estremi inclusi, sul giorno italiano del movimento. */
  dal?: string
  al?: string
  clienteId?: string
  registroId?: string
  motivo?: MotivoLegame
  /** Restringe agli stati indicati (fra quelli che la lista puo' mostrare). */
  stati?: StatoListaLegame[]
  /** Scorciatoia del FE: un solo stato (equivale a `stati: [stato]`). */
  stato?: StatoListaLegame
  /** Include i movimenti ESCLUSO (per riammetterli). */
  esclusi?: boolean
  /** Da 1. */
  pagina?: number
  /** Da 1 a 200; predefinito 50. */
  dimensione?: number
}

/** Nomi di `RigaLista` di `legami.model.ts`, piu' quantita' e unita' del movimento. */
export interface RigaLista {
  /** La TESTA della catena (anche un ANNULLAMENTO, per DA_RIALLINEARE). */
  movimentoId: string
  /** Assente solo per MANCANTE (nessun legame); presente per DA_RIALLINEARE. */
  legameId: string | null
  stato: StatoListaLegame
  /** Giorno italiano `AAAA-MM-GG`. */
  dataMovimento: string
  cerCode: string
  descrizioneMovimento: string | null
  quantita: string
  unita: string
  cliente: { id: string; etichetta: string } | null
  motivi: MotivoLegame[]
  avvisi: AvvisoLegame[]
  versione: number | null
  /** Vera se la proposta e' completa e si puo' confermare in massa. */
  confermabile: boolean
  /**
   * Vero se il legame e' FATTURATO / IMPORTATO_FATTURATO (decisione 21): con DA_RIALLINEARE l'unica
   * azione possibile e' registrare lo scostamento, la fattura non cambia.
   */
  fatturato: boolean
}

/** Nomi di `ContatoriLegami` di `legami.model.ts`. */
export interface ContatoriLista {
  /** Il totale della lista (esclusi gli ESCLUSO). */
  daCollegare: number
  proposti: number
  mancanti: number
  daRiallineare: number
}

const STATI_VISIBILI: readonly StatoListaLegame[] = [
  'MANCANTE',
  'DA_RIALLINEARE',
  'DA_COLLEGARE',
  'PROPOSTO',
]
const STATI_AMMESSI_NEL_FILTRO: readonly string[] = [...STATI_LEGAME, 'MANCANTE', 'DA_RIALLINEARE']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function nonValido(message: string): BadRequestException {
  return new BadRequestException({ error: 'FILTRI_LISTA_NON_VALIDI', message })
}

function dataValida(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export interface FiltriNormalizzati {
  dal: string | null
  al: string | null
  clienteId: string | null
  registroId: string | null
  motivo: MotivoLegame | null
  /** Gli stati che la lista mostra, gia' intersecati con quelli visibili. */
  stati: StatoListaLegame[]
  pagina: number
  dimensione: number
}

/** Interi dalla query string: accetta numeri e stringhe di sole cifre. */
function intero(v: unknown): number {
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim())
  return typeof v === 'number' ? v : Number.NaN
}

/** Valida i filtri (400 `FILTRI_LISTA_NON_VALIDI`), converte i valori della query string e applica i predefiniti. */
export function normalizzaFiltri(f: FiltriLista | undefined): FiltriNormalizzati {
  const x = f ?? {}
  const vuoto = (v: unknown) => v === undefined || v === null || v === ''
  const dimensione = vuoto(x.dimensione) ? DIMENSIONE_PREDEFINITA : intero(x.dimensione)
  if (!Number.isInteger(dimensione) || dimensione < 1 || dimensione > MAX_DIMENSIONE) {
    throw nonValido(`La dimensione della pagina va da 1 a ${MAX_DIMENSIONE}.`)
  }
  const pagina = vuoto(x.pagina) ? 1 : intero(x.pagina)
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > MAX_PAGINA) {
    throw nonValido(`La pagina va da 1 a ${MAX_PAGINA}.`)
  }
  for (const id of [x.clienteId, x.registroId]) {
    if (!vuoto(id) && !(typeof id === 'string' && UUID.test(id))) {
      throw nonValido('Cliente o registro non valido.')
    }
  }
  for (const d of [x.dal, x.al]) {
    if (!vuoto(d) && !dataValida(d)) throw nonValido('Le date vanno scritte AAAA-MM-GG.')
  }
  const dal = vuoto(x.dal) ? null : x.dal!
  const al = vuoto(x.al) ? null : x.al!
  if (dal !== null && al !== null && dal > al) {
    throw nonValido('La data iniziale e’ dopo quella finale.')
  }
  if (!vuoto(x.motivo) && !(MOTIVI_LEGAME as readonly string[]).includes(x.motivo as string)) {
    throw nonValido('Motivo non valido.')
  }
  // `stati` (anche come testo separato da virgole) e la scorciatoia `stato` si sommano.
  let richiesti: string[] | undefined
  if (x.stati !== undefined || !vuoto(x.stato)) {
    const lista: unknown =
      typeof x.stati === 'string' ? (x.stati as string).split(',').filter(Boolean) : (x.stati ?? [])
    if (!Array.isArray(lista)) throw nonValido('Stato non valido.')
    richiesti = [...lista, ...(vuoto(x.stato) ? [] : [x.stato as string])]
    if (richiesti.some(s => !STATI_AMMESSI_NEL_FILTRO.includes(s))) {
      throw nonValido('Stato non valido.')
    }
  }
  // ESCLUSO si vede con `esclusi: true` (anche 'true' dalla query string) o se lo si chiede.
  const esclusi = x.esclusi === true || (x.esclusi as unknown) === 'true'
  const conEsclusi = esclusi || (richiesti?.includes('ESCLUSO') ?? false)
  const visibili: StatoListaLegame[] = conEsclusi
    ? [...STATI_VISIBILI, 'ESCLUSO']
    : [...STATI_VISIBILI]
  const stati = richiesti === undefined ? visibili : visibili.filter(s => richiesti.includes(s))
  return {
    dal,
    al,
    clienteId: vuoto(x.clienteId) ? null : x.clienteId!,
    registroId: vuoto(x.registroId) ? null : x.registroId!,
    motivo: vuoto(x.motivo) ? null : (x.motivo as MotivoLegame),
    stati,
    pagina,
    dimensione,
  }
}

/**
 * L'espressione dello stato che l'utente vede (alias `m` testa, `l` legame). «Indietro» prevale
 * su ESCLUSO e sui fatturati (vedi il commento di testa); ANNULLATO e' terminale.
 */
const SQL_STATO_LISTA = Prisma.sql`CASE
  WHEN l.id IS NULL THEN 'MANCANTE'
  WHEN l.stato <> 'ANNULLATO' AND l.movimento_vigente_id <> m.id THEN 'DA_RIALLINEARE'
  ELSE l.stato::text
END`

/**
 * Le teste di catena dell'azienda che entrano nella lista (rami A e B del commento di testa), con
 * il loro legame (se c'e') e lo stato visto dall'utente. Un solo frammento per pagina, totale e
 * contatori. Il prefiltro su `movement_date` e' solo un aiuto per l'indice (margine di un giorno).
 */
export function sqlCandidati(
  tenantId: string,
  fatturazioneDa: string,
  f: Pick<FiltriNormalizzati, 'dal' | 'al' | 'clienteId' | 'registroId' | 'motivo'>
): Prisma.Sql {
  const giorno = sqlGiornoMovimento('m')
  const dal =
    f.dal === null
      ? Prisma.empty
      : Prisma.sql`AND m.movement_date >= (${f.dal}::date - 1)::timestamp
      AND ${giorno} >= ${f.dal}::date`
  const al =
    f.al === null
      ? Prisma.empty
      : Prisma.sql`AND m.movement_date < (${f.al}::date + 1)::timestamp
      AND ${giorno} <= ${f.al}::date`
  const registro =
    f.registroId === null ? Prisma.empty : Prisma.sql`AND m.registro_id = ${f.registroId}::uuid`
  const cliente =
    f.clienteId === null ? Prisma.empty : Prisma.sql`AND l.cliente_id = ${f.clienteId}::uuid`
  const motivo = f.motivo === null ? Prisma.empty : Prisma.sql`AND ${f.motivo} = ANY(l.motivi)`
  return Prisma.sql`
    SELECT m.id AS movimento_id, m.movement_date, ${giorno} AS giorno, m.registro_id,
           m.cer_code, m.waste_description, m.quantity, m.unit,
           l.id AS legame_id, l.cliente_id, l.motivi, l.avvisi, l.versione,
           (l.stato IN ('FATTURATO', 'IMPORTATO_FATTURATO')) AS fatturato,
           ${SQL_STATO_LISTA} AS stato_lista
    FROM waste_movements m
    LEFT JOIN legami_movimento l
      ON l.tenant_id = m.tenant_id
     AND l.movimento_originale_id = COALESCE(m.movimento_originale_id, m.id)
    LEFT JOIN causali_registro cs
      ON cs.codice = m.causale AND cs.verso = m.type AND m.causale_azienda_id IS NULL
    LEFT JOIN causali_registro_azienda ca
      ON ca.id = m.causale_azienda_id AND ca.tenant_id = m.tenant_id AND ca.natura = 'PROPRIA'
     AND ca.codice = m.causale AND ca.verso = m.type
    WHERE m.tenant_id = ${tenantId}::uuid
      AND NOT EXISTS (SELECT 1 FROM waste_movements c_testa WHERE c_testa.movimento_rettificato_id = m.id)
      AND (
        (m.tipo_annotazione <> 'ANNULLAMENTO'
          AND COALESCE(ca.fatturabile, cs.fatturabile, false)
          AND m.movement_date >= (${fatturazioneDa}::date - 1)::timestamp
          AND ${giorno} >= ${fatturazioneDa}::date)
        OR (l.id IS NOT NULL AND l.stato <> 'ANNULLATO' AND l.movimento_vigente_id <> m.id)
      )
      ${dal} ${al} ${registro} ${cliente} ${motivo}`
}

/** La pagina: ordina e taglia PRIMA di leggere il nome del cliente. */
export function sqlPagina(
  tenantId: string,
  candidati: Prisma.Sql,
  f: Pick<FiltriNormalizzati, 'stati' | 'pagina' | 'dimensione'>
): Prisma.Sql {
  return Prisma.sql`
    SELECT c.movimento_id::text AS movimento_id, c.giorno::text AS giorno, c.cer_code,
           c.waste_description, c.quantity::text AS quantity, c.unit,
           c.legame_id::text AS legame_id, c.cliente_id::text AS cliente_id,
           dt.ragione_sociale AS etichetta_cliente, c.motivi, c.avvisi, c.versione,
           c.fatturato, c.stato_lista
    FROM (
      SELECT c.* FROM (${candidati}) c
      WHERE c.stato_lista = ANY(${f.stati}::text[])
      ORDER BY c.movement_date, c.movimento_id
      LIMIT ${f.dimensione} OFFSET ${(f.pagina - 1) * f.dimensione}
    ) c
    LEFT JOIN clienti cl ON cl.id = c.cliente_id AND cl.tenant_id = ${tenantId}::uuid
    LEFT JOIN ditte dt ON dt.id = cl.ditta_id AND dt.tenant_id = cl.tenant_id
    ORDER BY c.movement_date, c.movimento_id`
}

/** Il totale delle righe che corrispondono ai filtri (stesso frammento della pagina). */
export function sqlConteggio(
  candidati: Prisma.Sql,
  stati: readonly StatoListaLegame[]
): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*)::int AS n FROM (${candidati}) c
    WHERE c.stato_lista = ANY(${[...stati]}::text[])`
}

interface RigaSql {
  movimento_id: string
  giorno: string
  cer_code: string
  waste_description: string | null
  quantity: string
  unit: string
  legame_id: string | null
  cliente_id: string | null
  etichetta_cliente: string | null
  motivi: string[] | null
  avvisi: string[] | null
  versione: number | null
  fatturato: boolean | null
  stato_lista: StatoListaLegame
}

interface ContatoriSql {
  totale: number
  proposti: number
  mancanti: number
  da_riallineare: number
}

@Injectable()
export class ListaLegamiService {
  constructor(private readonly prisma: PrismaService) {}

  /** La pagina richiesta e il totale delle righe che corrispondono ai filtri. */
  lista(
    tenantId: string,
    filtri: FiltriLista = {}
  ): Promise<{ elementi: RigaLista[]; totale: number }> {
    const f = normalizzaFiltri(filtri)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(
        async tx => {
          const da = await leggiFatturazioneDaInTx(tx, tenantId)
          if (da === null || f.stati.length === 0) return { elementi: [], totale: 0 }
          const base = sqlCandidati(tenantId, da, f)
          const righe = await tx.$queryRaw<RigaSql[]>(sqlPagina(tenantId, base, f))
          const conteggio = await tx.$queryRaw<{ n: number }[]>(sqlConteggio(base, f.stati))
          return { elementi: righe.map(vista), totale: conteggio[0]?.n ?? 0 }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 }
      )
    )
  }

  /** Quanti movimenti aspettano un'azione, per tipo (la lista senza gli esclusi). */
  contatori(tenantId: string): Promise<ContatoriLista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(
        async tx => {
          const zero = { daCollegare: 0, proposti: 0, mancanti: 0, daRiallineare: 0 }
          const da = await leggiFatturazioneDaInTx(tx, tenantId)
          if (da === null) return zero
          const base = sqlCandidati(tenantId, da, {
            dal: null,
            al: null,
            clienteId: null,
            registroId: null,
            motivo: null,
          })
          const r = await tx.$queryRaw<ContatoriSql[]>`
            SELECT count(*) FILTER (WHERE c.stato_lista = ANY(${[...STATI_VISIBILI]}::text[]))::int AS totale,
                   count(*) FILTER (WHERE c.stato_lista = 'PROPOSTO')::int AS proposti,
                   count(*) FILTER (WHERE c.stato_lista = 'MANCANTE')::int AS mancanti,
                   count(*) FILTER (WHERE c.stato_lista = 'DA_RIALLINEARE')::int AS da_riallineare
            FROM (${base}) c`
          const x = r[0]
          if (!x) return zero
          return {
            daCollegare: x.totale,
            proposti: x.proposti,
            mancanti: x.mancanti,
            daRiallineare: x.da_riallineare,
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 }
      )
    )
  }
}

function vista(r: RigaSql): RigaLista {
  const motivi = (r.motivi ?? []) as MotivoLegame[]
  return {
    movimentoId: r.movimento_id,
    legameId: r.legame_id,
    stato: r.stato_lista,
    dataMovimento: r.giorno.slice(0, 10),
    cerCode: r.cer_code,
    descrizioneMovimento: r.waste_description,
    quantita: normalizzaDecimale(r.quantity) ?? r.quantity,
    unita: r.unit,
    cliente:
      r.cliente_id !== null ? { id: r.cliente_id, etichetta: r.etichetta_cliente ?? '' } : null,
    motivi,
    avvisi: (r.avvisi ?? []) as AvvisoLegame[],
    versione: r.versione,
    confermabile: r.stato_lista === 'PROPOSTO' && motivi.length === 0,
    fatturato: r.fatturato === true,
  }
}
