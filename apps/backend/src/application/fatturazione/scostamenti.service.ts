// Scostamenti dopo la fattura e presa d'atto (fase 4.4b1, Task 21, spec §5.7).
//
// Lista: legami `FATTURATO` con `scostamento_dopo_fattura` e senza presa d'atto, uno per legame
// (Q40). La pagina dei legami si legge con un join su `documenti_fattura`; il resto (testa della
// catena, righe `MOVIMENTO` del documento) si legge per pagina con `= ANY(ids)`, mai per tenant
// dopo `joinLineari`. Non scrive nulla e non prende lock.
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
import { DIMENSIONE_MASSIMA_PAGINA, type Pagina } from './documenti-fattura.service'

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

interface TestaLetta {
  id: string
  tipoAnnotazione: 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
  cerCode: string | null
  quantity: string | null
}

interface RigaLetta {
  legameId: string
  documentoId: string
  quantita: string | null
  cerCode: string | null
  prezzoUnitario: string
  sconto: string | null
  prezzoTotale: string
}

/**
 * Condizione comune di "scostamento aperto". Esportata con i costruttori delle query della
 * pagina perche' il test di volume ne fa l'EXPLAIN: sono le query che girano davvero.
 */
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
    Prisma.sql`l.scostamento_dopo_fattura`,
    Prisma.sql`l.scostamento_gestito_il IS NULL`,
  ]
  if (clienteId !== undefined) {
    condizioni.push(Prisma.sql`d.cliente_fatturazione_id = ${clienteId}::uuid`)
  }
  return Prisma.join(condizioni, ' AND ')
}

/** Testa vigente di ciascun legame della pagina, per chiave primaria. */
export function sqlTestePerVigenti(tenantId: string, vigenteIds: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT m.id::text AS id, m.tipo_annotazione::text AS "tipoAnnotazione",
           m.cer_code AS "cerCode", m.quantity::text AS quantity
    FROM waste_movements m
    WHERE m.tenant_id = ${tenantId}::uuid AND m.id = ANY(${vigenteIds}::uuid[])`
}

/** Righe `MOVIMENTO` dei documenti della pagina, per legame e per documento. */
export function sqlRigheDellaPagina(
  tenantId: string,
  legameIds: string[],
  documentoIds: string[]
): Prisma.Sql {
  return Prisma.sql`
    SELECT r.legame_id::text AS "legameId", r.documento_id::text AS "documentoId",
           r.quantita::text AS quantita, r.cer_code AS "cerCode",
           r.prezzo_unitario::text AS "prezzoUnitario", r.sconto AS sconto,
           r.prezzo_totale::text AS "prezzoTotale"
    FROM righe_documento_fattura r
    WHERE r.tenant_id = ${tenantId}::uuid AND r.tipo_riga = 'MOVIMENTO'::tipo_riga_documento_fattura
      AND r.legame_id = ANY(${legameIds}::uuid[]) AND r.documento_id = ANY(${documentoIds}::uuid[])
    ORDER BY r.documento_id, r.numero_linea`
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
    q.dimensione > DIMENSIONE_MASSIMA_PAGINA
  ) {
    throw new BadRequestException({
      error: 'PAGINAZIONE_NON_VALIDA',
      message: `La pagina parte da 1 e la dimensione va da 1 a ${DIMENSIONE_MASSIMA_PAGINA}.`,
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
      this.prisma.$transaction(async tx => {
        const [{ totale }] = await tx.$queryRaw<{ totale: number }[]>(
          sqlTotaleScostamenti(tenantId, q.clienteId)
        )
        const legami = await tx.$queryRaw<LegameInPagina[]>(
          sqlPaginaScostamenti(tenantId, q.clienteId, q.dimensione, (q.pagina - 1) * q.dimensione)
        )
        const elementi = await this.costruisci(tx, tenantId, legami)
        return { elementi, totale, pagina: q.pagina, dimensione: q.dimensione }
      })
    )
  }

  /** Una `ScostamentoRiga` per legame della pagina, nell'ordine della pagina. */
  private async costruisci(
    tx: Prisma.TransactionClient,
    tenantId: string,
    legami: LegameInPagina[]
  ): Promise<ScostamentoRiga[]> {
    if (legami.length === 0) return []
    const teste = new Map(
      (
        await tx.$queryRaw<TestaLetta[]>(
          sqlTestePerVigenti(tenantId, [...new Set(legami.map(l => l.movimentoVigenteId))])
        )
      ).map(t => [t.id, t])
    )
    const righeLette = await tx.$queryRaw<RigaLetta[]>(
      sqlRigheDellaPagina(
        tenantId,
        legami.map(l => l.id),
        [...new Set(legami.map(l => l.documentoId))]
      )
    )
    const righePerLegame = new Map<string, RigaLetta[]>()
    for (const r of righeLette) {
      const l = r.legameId
      const lista = righePerLegame.get(l) ?? []
      lista.push(r)
      righePerLegame.set(l, lista)
    }

    return legami.map(l => {
      // Solo le righe del documento che ha fatturato il legame (un documento annullato o stornato
      // prima puo' avere citato lo stesso legame).
      const righe = (righePerLegame.get(l.id) ?? []).filter(r => r.documentoId === l.documentoId)
      const testa = teste.get(l.movimentoVigenteId)
      const fatturato: RigaFatturataScostamento[] = righe.map(r => ({
        quantita: r.quantita,
        prezzoTotale: r.prezzoTotale,
        prezzoUnitario: r.prezzoUnitario,
        sconto: r.sconto,
        tipoRiga: 'MOVIMENTO',
        // Il prezzo 0 e' la riga a prezzo speciale: l'importo sta nelle fasce (Task 2).
        prezzoSpeciale: new Prisma.Decimal(r.prezzoUnitario).isZero(),
      }))
      const annullato = testa?.tipoAnnotazione === 'ANNULLAMENTO'
      const attuale = valoreAttualeScostamento({
        fatturato,
        testa: { quantita: quantita3(testa?.quantity ?? null), annullato },
      })
      const quantitaFatturata = quantita3(righe[0]?.quantita ?? null)
      return {
        legameId: l.id,
        versioneLegame: l.versione,
        documento: {
          id: l.documentoId,
          numeroTesto: l.numeroTesto ?? '',
          dataDocumento: l.dataDocumento,
        },
        tipoCorrezione: tipoCorrezioneScostamento({
          tipoAnnotazione: testa?.tipoAnnotazione ?? 'RETTIFICA',
          cerTesta: testa?.cerCode ?? null,
          cerFatturato: righe.find(r => r.cerCode !== null)?.cerCode ?? null,
          quantitaTesta: quantita3(testa?.quantity ?? null),
          quantitaFatturata,
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
                   (scostamento_dopo_fattura AND scostamento_gestito_il IS NULL) AS aperto,
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
              AND stato = 'FATTURATO' AND scostamento_dopo_fattura
              AND scostamento_gestito_il IS NULL AND versione = ${versione}::int`
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
