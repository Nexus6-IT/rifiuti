// Impostazione «fatturazione da» (4.3, decisione 11, spec §4.9): una riga per azienda con lock
// ottimistico. Senza riga o con data vuota la fatturazione e' SPENTA. Spostare la data tocca i
// movimenti vigenti con causale fatturabile compresi fra la vecchia e la nuova data: il cambio
// chiede conferma col numero esatto di movimenti toccati e scrive l'audit (date precedente e
// nuova). Questo servizio non tocca mai `legami_movimento`: spostare la data in avanti non
// cancella i legami gia' CONFERMATO o FATTURATO (la lista dei legami li filtra).
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  dataFatturazioneValida,
  movimentiToccati,
} from '../../domain/legami-movimento/fatturazione-da'
import { sqlVigente } from '../../domain/waste-movement/vigenza'
import type { VersoCausale } from '../../domain/waste-movement/catalogo-causali'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { traduciErrorePrisma, type DescrizioneEntita } from '../clienti/anagrafica-versionata'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { caricaCatalogoCausali } from '../registro/causali/catalogo-causali.repository'

export interface ImpostazioneFatturazioneVista {
  /** `AAAA-MM-GG` o null (fatturazione spenta). */
  fatturazioneDa: string | null
  versione: number
  modificatoIl: string | null
}

export interface DatiImpostazioneFatturazione {
  fatturazioneDa: string | null
  versione: number
  confermaMovimenti?: number
}

const ENTITA: DescrizioneEntita = {
  prefisso: 'IMPOSTAZIONE_FATTURAZIONE',
  soggetto: 'L’impostazione',
  femminile: true,
}

const MSG_DATA_NON_VALIDA = 'Data non valida: usa il formato AAAA-MM-GG con un giorno esistente.'
const MSG_VERSIONE_SUPERATA =
  'L’impostazione è stata modificata nel frattempo: ricarica per vedere i dati aggiornati.'

const versioneSuperata = () =>
  new ConflictException({ error: 'VERSIONE_SUPERATA', message: MSG_VERSIONE_SUPERATA })

interface RigaImpostazione {
  id: string
  da: string | null
  versione: number
}

/** Un movimento e' "toccato" solo se la sua causale e' fatturabile: raggruppati per causale. */
interface GruppoCausale {
  tipo: string
  causale: string
  causale_azienda_id: string | null
  n: number
}

@Injectable()
export class ImpostazioniFatturazioneService {
  constructor(private readonly prisma: PrismaService) {}

  async leggi(tenantId: string): Promise<ImpostazioneFatturazioneVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.impostazioneFatturazione.findFirst({ where: { tenantId } })
      if (!riga) return { fatturazioneDa: null, versione: 0, modificatoIl: null }
      return vista(riga)
    })
  }

  /**
   * Movimenti vigenti (testa della catena, non ANNULLAMENTO) con causale fatturabile il cui
   * giorno italiano cade nell'intervallo toccato passando dalla data attuale a `nuova`.
   */
  async contaMovimentiToccati(tenantId: string, nuova: string | null): Promise<number> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.impostazioneFatturazione.findFirst({ where: { tenantId } })
      return contaToccati(this.prisma, tenantId, giorno(riga?.fatturazioneDa ?? null), nuova)
    })
  }

  async imposta(
    tenantId: string,
    utenteId: string,
    dati: DatiImpostazioneFatturazione
  ): Promise<ImpostazioneFatturazioneVista> {
    if (dati.fatturazioneDa !== null && !dataFatturazioneValida(dati.fatturazioneDa)) {
      const errori = [{ campo: 'fatturazioneDa', messaggio: MSG_DATA_NON_VALIDA }]
      throw new BadRequestException({
        message: [MSG_DATA_NON_VALIDA],
        error: 'IMPOSTAZIONE_FATTURAZIONE_NON_VALIDA',
        details: { errori },
      })
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          // La riga si blocca FOR UPDATE: due PUT con la stessa versione si accodano e il secondo
          // trova la versione cambiata. Il conteggio dei movimenti sta nella stessa transazione.
          const righe = await tx.$queryRaw<RigaImpostazione[]>`
            SELECT id, fatturazione_da::text AS da, versione
            FROM "impostazioni_fatturazione"
            WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
          const attuale = righe[0]
          if ((attuale?.versione ?? 0) !== dati.versione) throw versioneSuperata()

          const prima = attuale?.da ?? null
          if (attuale && prima === dati.fatturazioneDa) {
            const letta = await tx.impostazioneFatturazione.findFirst({ where: { tenantId } })
            return vista(letta!)
          }

          const toccati = await contaToccati(tx, tenantId, prima, dati.fatturazioneDa)
          if (toccati > 0 && dati.confermaMovimenti !== toccati) {
            throw new ConflictException({
              error: 'CONFERMA_RICHIESTA',
              message: `Il cambio di data tocca ${toccati} ${toccati === 1 ? 'movimento' : 'movimenti'}: conferma per procedere.`,
              details: { movimentiToccati: toccati },
            })
          }

          const nuovaData = dati.fatturazioneDa
            ? new Date(`${dati.fatturazioneDa}T00:00:00Z`)
            : null
          const scritta = attuale
            ? await tx.impostazioneFatturazione.update({
                where: { id: attuale.id },
                data: {
                  fatturazioneDa: nuovaData,
                  versione: { increment: 1 },
                  modificatoDa: utenteId,
                },
              })
            : await tx.impostazioneFatturazione.create({
                data: { tenantId, fatturazioneDa: nuovaData, modificatoDa: utenteId },
              })
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'IMPOSTAZIONE_FATTURAZIONE_MODIFICATA',
              description: 'Impostazione «fatturazione da» modificata',
              metadata: {
                precedente: prima,
                nuova: dati.fatturazioneDa,
                movimentiToccati: toccati,
              } as Prisma.InputJsonValue,
            },
          })
          return vista(scritta)
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => {
          // Due prime impostazioni insieme (versione 0): l'unico del tenant fa perdere la seconda.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw versioneSuperata()
          }
          return traduciErrorePrisma(err, ENTITA, {})
        })
    )
  }
}

function giorno(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function vista(r: {
  fatturazioneDa: Date | null
  versione: number
  updatedAt: Date
}): ImpostazioneFatturazioneVista {
  return {
    fatturazioneDa: giorno(r.fatturazioneDa),
    versione: r.versione,
    modificatoIl: r.updatedAt.toISOString(),
  }
}

async function contaToccati(
  db: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  vecchia: string | null,
  nuova: string | null
): Promise<number> {
  const intervallo = movimentiToccati(vecchia, nuova)
  if (!intervallo) return 0
  const fine =
    intervallo.a === null ? Prisma.empty : Prisma.sql`AND m.giorno < ${intervallo.a}::date`
  const gruppi = await db.$queryRaw<GruppoCausale[]>`
    SELECT m.type::text AS tipo, m.causale, m.causale_azienda_id::text AS causale_azienda_id,
           count(*)::int AS n
    FROM (
      SELECT m.*, ((m.movement_date AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date AS giorno
      FROM "waste_movements" m
      WHERE m.tenant_id = ${tenantId}::uuid
        AND ${sqlVigente('m')}
    ) m
    WHERE m.giorno >= ${intervallo.da}::date ${fine}
    GROUP BY m.type, m.causale, m.causale_azienda_id`
  if (gruppi.length === 0) return 0
  const catalogo = await caricaCatalogoCausali(db as Prisma.TransactionClient, tenantId)
  let totale = 0
  for (const g of gruppi) {
    const def = catalogo.comportamento(
      g.tipo as VersoCausale,
      g.causale,
      intervallo.da,
      g.causale_azienda_id
    )
    if (def?.fatturabile) totale += g.n
  }
  return totale
}
