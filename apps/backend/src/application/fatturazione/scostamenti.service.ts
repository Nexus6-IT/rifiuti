// Scostamenti dopo la fattura e presa d'atto (fase 4.4b1, Task 21, spec §5.7).
//
// Lista: legami `FATTURATO` con scostamento aperto, uno per legame (Q40). La pagina dei legami si
// legge con un join su `documenti_fattura`; il resto (movimento fatturato e testa della catena,
// righe `MOVIMENTO` del documento, righe del legame) si legge per pagina con `= ANY(ids)`, mai per
// tenant dopo `joinLineari`. La lettura e' una sola transazione REPEATABLE READ: totale e pagina
// vedono lo stesso istante. Non scrive nulla e non prende lock.
//
// Scostamento APERTO (un solo punto, `condizioneScostamentoAperto`, usato da lista, totale, presa
// d'atto e suo UPDATE): `scostamento_dopo_fattura AND (scostamento_gestito_il IS NULL OR
// scostamento_il > scostamento_gestito_il)`. Una nuova rettifica dopo la presa d'atto (la 4.3
// aggiorna `scostamento_il`, non tocca `scostamento_gestito_*`) riapre lo scostamento: e' una
// differenza nuova. La 4.3 non si tocca.
//
// La testa e' `movimento_vigente_id` del legame. Se un riallineamento e' fallito (legame
// `DA_RIALLINEARE`, decisione 21) il vigente puo' essere rimasto indietro: la lista mostra allora
// il valore della testa vecchia. Lo segnala la UI del 25b/4.4c, non questo servizio.
//
// Presa d'atto: il legame si blocca `FOR UPDATE` per id, da solo (nessun altro lock: ne' quello del
// registro, ne' quello consultivo per radice, S5). Una correzione concorrente del registro che
// vuole riallineare lo stesso legame aspetta sulla riga. L'aperto/chiuso si controlla PRIMA della
// versione (come l'annullo del Task 20): per il secondo di due click "gia' gestito" e' piu' utile
// di "ricarica". Il testo della nota e' libero e non entra nell'audit.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  importoFatturatoScostamento,
  tipoCorrezioneScostamento,
  valoreAttualeScostamento,
  type RigaFatturataScostamento,
  type TipoCorrezioneScostamento,
} from '../../domain/fatturazione/scostamento'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { traduciErrorePrisma, type DescrizioneEntita } from '../clienti/anagrafica-versionata'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { DIMENSIONE_MASSIMA_PAGINA, MAX_PAGINA, type Pagina } from './documenti-fattura.service'

/** = `ScostamentoRiga` del frontend (Task 14). */
export interface ScostamentoRiga {
  legameId: string
  /** Versione del legame: serve alla presa d'atto. */
  versioneLegame: number
  documento: { id: string; numeroTesto: string; dataDocumento: string }
  tipoCorrezione: TipoCorrezioneScostamento
  quantitaFatturata: string | null
  importoFatturato: string
  quantitaAttuale: string | null
  importoAttuale: string | null
  soloQuantita: boolean
}

export interface FiltriScostamenti {
  pagina: number
  dimensione: number
  clienteId?: string
}

export interface RichiestaPresaAtto {
  nota: string
  versione: number
}

const ENTITA: DescrizioneEntita = {
  prefisso: 'SCOSTAMENTO_FATTURA',
  soggetto: 'Il legame',
  femminile: false,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOTA_MAX = 200

interface LegameInPagina {
  id: string
  versione: number
  documentoId: string
  movimentoVigenteId: string
  numeroTesto: string | null
  dataDocumento: string
}

interface MovimentoLetto {
  id: string
  tipoAnnotazione: 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
  cerCode: string | null
  quantity: string | null
  unit: string | null
  causale: string | null
}

interface RigaLetta {
  legameId: string
  documentoId: string
  rigaAddebitoId: string | null
  movimentoFatturatoId: string | null
  quantita: string | null
  prezzoUnitario: string
  sconto: string | null
  prezzoTotale: string
}

interface RigaLegameLetta {
  legameId: string
  rigaAddebitoId: string
  tipoQuantita: RigaFatturataScostamento['tipoQuantita']
  unitaMisura: string
  quantitaOrigine: RigaFatturataScostamento['quantitaOrigine']
  prezzoSpeciale: boolean
}

/**
 * Scostamento aperto: l'UNICA definizione, per la lista, il totale, la presa d'atto e il suo
 * UPDATE. `alias` e' un nome fisso scritto qui dentro (mai input), vuoto per la tabella senza alias.
 */
export function condizioneScostamentoAperto(alias: string): Prisma.Sql {
  const c = Prisma.raw(alias === '' ? '' : `${alias}.`)
  return Prisma.sql`(${c}scostamento_dopo_fattura AND (${c}scostamento_gestito_il IS NULL OR ${c}scostamento_il > ${c}scostamento_gestito_il))`
}

/** Costruttori delle query della pagina: esportati perche' il test di volume ne fa l'EXPLAIN. */
export function sqlPaginaScostamenti(
  tenantId: string,
  clienteId: string | undefined,
  limite: number,
  scarto: number
): Prisma.Sql {
  return Prisma.sql`
    SELECT l.id::text AS id, l.versione::int AS versione, l.documento_id::text AS "documentoId",
           l.movimento_vigente_id::text AS "movimentoVigenteId", d.numero_testo AS "numeroTesto",
           d.data_documento::text AS "dataDocumento"
    FROM legami_movimento l
    JOIN documenti_fattura d ON d.tenant_id = l.tenant_id AND d.id = l.documento_id
    WHERE ${condizioniScostamentiAperti(tenantId, clienteId)}
    ORDER BY d.data_documento, d.anno, d.numero NULLS LAST, l.id
    LIMIT ${limite}::int OFFSET ${scarto}::int`
}

export function sqlTotaleScostamenti(tenantId: string, clienteId: string | undefined): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*)::int AS totale
    FROM legami_movimento l
    JOIN documenti_fattura d ON d.tenant_id = l.tenant_id AND d.id = l.documento_id
    WHERE ${condizioniScostamentiAperti(tenantId, clienteId)}`
}

function condizioniScostamentiAperti(tenantId: string, clienteId: string | undefined): Prisma.Sql {
  const condizioni: Prisma.Sql[] = [
    Prisma.sql`l.tenant_id = ${tenantId}::uuid`,
    Prisma.sql`l.stato = 'FATTURATO'::stato_legame_movimento`,
    condizioneScostamentoAperto('l'),
  ]
  if (clienteId !== undefined) {
    condizioni.push(Prisma.sql`d.cliente_fatturazione_id = ${clienteId}::uuid`)
  }
  return Prisma.join(condizioni, ' AND ')
}

/** Movimenti (testa vigente e movimento fatturato) della pagina, per chiave primaria. */
export function sqlMovimentiPerId(tenantId: string, movimentoIds: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT m.id::text AS id, m.tipo_annotazione::text AS "tipoAnnotazione",
           m.cer_code AS "cerCode", m.quantity::text AS quantity, m.unit AS unit,
           m.causale AS causale
    FROM waste_movements m
    WHERE m.tenant_id = ${tenantId}::uuid AND m.id = ANY(${movimentoIds}::uuid[])`
}

/** Righe `MOVIMENTO` dei documenti della pagina, per legame e per documento. */
export function sqlRigheDellaPagina(
  tenantId: string,
  legameIds: string[],
  documentoIds: string[]
): Prisma.Sql {
  return Prisma.sql`
    SELECT r.legame_id::text AS "legameId", r.documento_id::text AS "documentoId",
           r.riga_addebito_id::text AS "rigaAddebitoId",
           r.movimento_fatturato_id::text AS "movimentoFatturatoId",
           r.quantita::text AS quantita, r.prezzo_unitario::text AS "prezzoUnitario",
           r.sconto AS sconto, r.prezzo_totale::text AS "prezzoTotale"
    FROM righe_documento_fattura r
    WHERE r.tenant_id = ${tenantId}::uuid AND r.tipo_riga = 'MOVIMENTO'::tipo_riga_documento_fattura
      AND r.legame_id = ANY(${legameIds}::uuid[]) AND r.documento_id = ANY(${documentoIds}::uuid[])
    ORDER BY r.documento_id, r.numero_linea`
}

/**
 * Righe dei legami della pagina: dicono come si ricalcola la quantita' di ciascuna riga del
 * documento. `riga_legame_id` e' NULL nei documenti (Q1): la chiave e' `(legame, riga_addebito)`.
 */
export function sqlRigheDeiLegami(tenantId: string, legameIds: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT g.legame_id::text AS "legameId", g.riga_addebito_id::text AS "rigaAddebitoId",
           g.tipo_quantita::text AS "tipoQuantita", g.unita_misura AS "unitaMisura",
           g.quantita_origine::text AS "quantitaOrigine", g.prezzo_speciale AS "prezzoSpeciale"
    FROM righe_legame_movimento g
    WHERE g.tenant_id = ${tenantId}::uuid AND g.legame_id = ANY(${legameIds}::uuid[])`
}

const quantita3 = (q: string | null): string | null =>
  q === null ? null : new Prisma.Decimal(q).toFixed(3)

const legameNonTrovato = () =>
  new NotFoundException({ error: 'LEGAME_MOVIMENTO_NON_TROVATO', message: 'Legame non trovato.' })

const scostamentoNonAperto = () =>
  new ConflictException({
    error: 'SCOSTAMENTO_NON_APERTO',
    message: 'Il legame non ha uno scostamento aperto da gestire.',
  })

function paginaValida(q: FiltriScostamenti): void {
  if (
    !Number.isInteger(q.pagina) ||
    q.pagina < 1 ||
    !Number.isInteger(q.dimensione) ||
    q.dimensione < 1 ||
    q.dimensione > DIMENSIONE_MASSIMA_PAGINA ||
    q.pagina > MAX_PAGINA
  ) {
    throw new BadRequestException({
      error: 'PAGINAZIONE_NON_VALIDA',
      message: `La pagina va da 1 a ${MAX_PAGINA} e la dimensione da 1 a ${DIMENSIONE_MASSIMA_PAGINA}.`,
    })
  }
  if (q.clienteId !== undefined && !UUID.test(q.clienteId)) {
    throw new BadRequestException({
      error: 'FILTRO_NON_VALIDO',
      message: 'Un filtro per identificativo non è valido.',
    })
  }
}

function notaValida(nota: unknown): string {
  const n = typeof nota === 'string' ? nota.trim() : ''
  if (n.length < 1 || n.length > NOTA_MAX) {
    throw new BadRequestException({
      error: 'NOTA_NON_VALIDA',
      message: `La nota è obbligatoria e al massimo di ${NOTA_MAX} caratteri.`,
    })
  }
  return n
}

function versioneValida(versione: unknown): number {
  if (typeof versione !== 'number' || !Number.isInteger(versione) || versione < 1) {
    throw new BadRequestException({
      error: 'VERSIONE_NON_VALIDA',
      message: 'La versione del legame non è valida.',
    })
  }
  return versione
}

@Injectable()
export class ScostamentiService {
  constructor(private readonly prisma: PrismaService) {}

  async lista(tenantId: string, q: FiltriScostamenti): Promise<Pagina<ScostamentoRiga>> {
    paginaValida(q)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(
        async tx => {
          const [{ totale }] = await tx.$queryRaw<{ totale: number }[]>(
            sqlTotaleScostamenti(tenantId, q.clienteId)
          )
          const legami = await tx.$queryRaw<LegameInPagina[]>(
            sqlPaginaScostamenti(tenantId, q.clienteId, q.dimensione, (q.pagina - 1) * q.dimensione)
          )
          const elementi = await this.costruisci(tx, tenantId, legami)
          return { elementi, totale, pagina: q.pagina, dimensione: q.dimensione }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
      )
    )
  }

  /** Una `ScostamentoRiga` per legame della pagina, nell'ordine della pagina. */
  private async costruisci(
    tx: Prisma.TransactionClient,
    tenantId: string,
    legami: LegameInPagina[]
  ): Promise<ScostamentoRiga[]> {
    if (legami.length === 0) return []
    const legameIds = legami.map(l => l.id)
    const righeLette = await tx.$queryRaw<RigaLetta[]>(
      sqlRigheDellaPagina(tenantId, legameIds, [...new Set(legami.map(l => l.documentoId))])
    )
    const righeLegame = new Map(
      (await tx.$queryRaw<RigaLegameLetta[]>(sqlRigheDeiLegami(tenantId, legameIds))).map(g => [
        `${g.legameId}:${g.rigaAddebitoId}`,
        g,
      ])
    )
    const movimentoIds = new Set<string>(legami.map(l => l.movimentoVigenteId))
    for (const r of righeLette) if (r.movimentoFatturatoId) movimentoIds.add(r.movimentoFatturatoId)
    const movimenti = new Map(
      (await tx.$queryRaw<MovimentoLetto[]>(sqlMovimentiPerId(tenantId, [...movimentoIds]))).map(
        m => [m.id, m]
      )
    )
    const righePerLegame = new Map<string, RigaLetta[]>()
    for (const r of righeLette) {
      const lista = righePerLegame.get(r.legameId) ?? []
      lista.push(r)
      righePerLegame.set(r.legameId, lista)
    }

    return legami.map(l => {
      // Solo le righe del documento che ha fatturato il legame (un documento annullato o stornato
      // prima puo' avere citato lo stesso legame).
      const righe = (righePerLegame.get(l.id) ?? []).filter(r => r.documentoId === l.documentoId)
      const testa = movimenti.get(l.movimentoVigenteId)
      // FK composta legame -> movimento vigente: la testa c'e' sempre. Se manca e' un difetto.
      if (!testa) throw new Error('Scostamenti: movimento vigente del legame non trovato.')
      const idFatturato = righe.find(r => r.movimentoFatturatoId)?.movimentoFatturatoId
      const fatturatoMov = idFatturato ? movimenti.get(idFatturato) : undefined
      const fatturato: RigaFatturataScostamento[] = righe.map(r => {
        const g = r.rigaAddebitoId ? righeLegame.get(`${l.id}:${r.rigaAddebitoId}`) : undefined
        return {
          quantita: r.quantita,
          prezzoTotale: r.prezzoTotale,
          prezzoUnitario: r.prezzoUnitario,
          sconto: r.sconto,
          tipoRiga: 'MOVIMENTO',
          prezzoSpeciale: g?.prezzoSpeciale ?? false,
          tipoQuantita: g?.tipoQuantita ?? null,
          unitaMisura: g?.unitaMisura ?? null,
          quantitaOrigine: g?.quantitaOrigine ?? null,
        }
      })
      const annullato = testa.tipoAnnotazione === 'ANNULLAMENTO'
      const quantitaTesta = quantita3(testa.quantity)
      const attuale = valoreAttualeScostamento({
        fatturato,
        testa: { quantity: quantitaTesta, unit: testa.unit, annullato },
      })
      const quantitaFatturata = quantita3(fatturatoMov?.quantity ?? null)
      return {
        legameId: l.id,
        versioneLegame: l.versione,
        documento: {
          id: l.documentoId,
          numeroTesto: l.numeroTesto ?? '',
          dataDocumento: l.dataDocumento,
        },
        tipoCorrezione: tipoCorrezioneScostamento({
          tipoAnnotazione: testa.tipoAnnotazione,
          cerTesta: testa.cerCode,
          cerFatturato: fatturatoMov?.cerCode ?? testa.cerCode,
          quantitaTesta,
          unitaTesta: testa.unit,
          quantitaFatturata: fatturatoMov ? quantitaFatturata : quantitaTesta,
          unitaFatturata: fatturatoMov ? fatturatoMov.unit : testa.unit,
          causaleTesta: testa.causale,
          causaleFatturata: fatturatoMov ? fatturatoMov.causale : testa.causale,
        }),
        quantitaFatturata,
        importoFatturato: importoFatturatoScostamento(fatturato),
        quantitaAttuale: attuale.quantitaAttuale,
        importoAttuale: attuale.importoAttuale,
        soloQuantita: attuale.soloQuantita,
      }
    })
  }

  /**
   * Chiude lo scostamento senza documento (decisione 1): `scostamento_gestito_*` e nota. Il ruolo
   * (solo amministratori) lo controlla il controller (Task 25a, Q31).
   */
  async presaAtto(
    tenantId: string,
    utenteId: string,
    legameId: string,
    b: RichiestaPresaAtto
  ): Promise<void> {
    const nota = notaValida(b.nota)
    const versione = versioneValida(b.versione)
    if (!UUID.test(legameId)) throw legameNonTrovato()
    await nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const righe = await tx.$queryRaw<
            {
              stato: string
              versione: number
              aperto: boolean
              documentoId: string | null
            }[]
          >`
            SELECT stato::text AS stato, versione::int AS versione,
                   ${condizioneScostamentoAperto('')} AS aperto,
                   documento_id::text AS "documentoId"
            FROM legami_movimento
            WHERE tenant_id = ${tenantId}::uuid AND id = ${legameId}::uuid
            FOR UPDATE`
          if (righe.length === 0) throw legameNonTrovato()
          const l = righe[0]
          if (l.stato !== 'FATTURATO' || !l.aperto) throw scostamentoNonAperto()
          if (l.versione !== versione) {
            throw new ConflictException({
              error: 'VERSIONE_SUPERATA',
              message:
                'Il legame è stato modificato nel frattempo: ricarica per vedere i dati aggiornati.',
            })
          }
          const aggiornati = await tx.$executeRaw`
            UPDATE legami_movimento
            SET scostamento_gestito_il = now(), scostamento_gestito_da = ${utenteId}::uuid,
                scostamento_nota = ${nota}, versione = versione + 1, updated_at = now()
            WHERE tenant_id = ${tenantId}::uuid AND id = ${legameId}::uuid
              AND stato = 'FATTURATO' AND ${condizioneScostamentoAperto('')}
              AND versione = ${versione}::int`
          if (aggiornati !== 1) throw new Error('Presa d’atto: legame non aggiornato.')
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'SCOSTAMENTO_FATTURA_PRESO_IN_CARICO',
              description: 'Scostamento dopo la fattura preso in carico',
              metadata: { legameId, documentoId: l.documentoId } as Prisma.InputJsonValue,
            },
          })
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, {}))
    )
  }
}
