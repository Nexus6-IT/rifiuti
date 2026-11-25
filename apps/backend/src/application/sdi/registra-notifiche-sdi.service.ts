// Registrazione delle notifiche SDI di una trasmissione e ricalcolo del suo stato (4.5c, piano §4.3).
// Unico punto che scrive `notifiche_sdi` e sposta lo stato dopo l'invio: lo usano sia il job degli
// eventi del webhook sia la riconciliazione col polling, cosi' le due strade non possono divergere.
import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import {
  STATI_DOPO_INVIO,
  type AvvisoTrasmissioneSdi,
  type FonteNotificaSdi,
  type StatoTrasmissioneSdi,
} from '../../domain/fatturazione/sdi/codici'
import { avvisiScarto } from '../../domain/fatturazione/sdi/avvisi'
import { statoDaNotifiche } from '../../domain/fatturazione/sdi/stato'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type { NotificaSdiGrezza } from '../fatturazione/sdi/provider-sdi.port'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'

export interface EsitoRegistrazioneNotifiche {
  /** Notifiche davvero inserite (le gia' note, per chiave di dedup, non contano). */
  inserite: number
  statoPrima: StatoTrasmissioneSdi
  statoDopo: StatoTrasmissioneSdi
  avvisi: AvvisoTrasmissioneSdi[]
}

/** Stati in cui il documento e' arrivato al destinatario o ha un esito: uno scarto tardivo non li annulla. */
const STATI_CONSEGNATI: readonly StatoTrasmissioneSdi[] = [
  'CONSEGNATA',
  'NON_CONSEGNATA',
  'ACCETTATA',
  'RIFIUTATA',
  'DECORSI_TERMINI',
  'NON_RECAPITABILE',
]

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** Chiave di idempotenza: id della notifica presso il provider/SDI, poi sha del file, poi tipo+esito+data. */
export function chiaveDedupNotifica(n: NotificaSdiGrezza): string {
  if (n.idNotifica && n.idNotifica.trim().length > 0) return n.idNotifica.trim().slice(0, 200)
  if (n.file) return `sha:${sha256(n.file)}`
  return `${n.tipo}|${n.esitoCommittente ?? ''}|${n.dataRicezioneSdi?.toISOString() ?? ''}`.slice(
    0,
    200
  )
}

@Injectable()
export class RegistraNotificheSdiService {
  private readonly logger = new Logger(RegistraNotificheSdiService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserisce le notifiche (idempotente per `chiave_dedup`) e ricalcola lo stato dall'INSIEME di tutte
   * le notifiche della trasmissione, sotto il lock della riga. `null` se la trasmissione non esiste
   * per l'azienda. Lo stato non regredisce: uno scarto (NS) arrivato dopo una consegna o un esito
   * resta come notifica e come avviso `NOTIFICHE_INCOERENTI`, ma non marca il documento «scartato»
   * (renderebbe annullabile una fattura che il destinatario ha forse ricevuto).
   */
  async registra(
    tenantId: string,
    trasmissioneId: string,
    notifiche: readonly NotificaSdiGrezza[],
    fonte: FonteNotificaSdi,
    ora: Date
  ): Promise<EsitoRegistrazioneNotifiche | null> {
    const esito = await nelContestoTenant(tenantId, async () =>
      this.prisma.$transaction(async tx => {
        await impostaTimeoutLock(tx)
        const righe = await tx.$queryRaw<{ stato: StatoTrasmissioneSdi }[]>`
          SELECT stato::text AS stato FROM "trasmissioni_sdi"
          WHERE id = ${trasmissioneId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`
        const t = righe[0]
        if (!t) return null

        let inserite = 0
        for (const n of notifiche) {
          const file = n.file
          inserite += await tx.$executeRaw`
            INSERT INTO "notifiche_sdi"
              (tenant_id, trasmissione_id, tipo, esito_committente, codici_errore, data_ricezione_sdi,
               ricevuta_il, file, file_sha256, fonte, chiave_dedup)
            VALUES (${tenantId}::uuid, ${trasmissioneId}::uuid, ${n.tipo}, ${n.esitoCommittente},
                    ${n.codiciErrore}::text[], ${n.dataRicezioneSdi}::timestamptz, ${ora}::timestamptz,
                    ${file}::bytea, ${file ? sha256(file) : null}::text, ${fonte},
                    ${chiaveDedupNotifica(n)})
            ON CONFLICT (tenant_id, trasmissione_id, chiave_dedup) DO NOTHING`
        }

        const tutte = await tx.$queryRaw<
          { tipo: string; esito_committente: string | null; codici_errore: string[] }[]
        >`
          SELECT tipo, esito_committente, codici_errore FROM "notifiche_sdi"
          WHERE trasmissione_id = ${trasmissioneId}::uuid AND tenant_id = ${tenantId}::uuid`
        const calcolato = statoDaNotifiche(
          t.stato,
          tutte.map(r => ({
            tipo: r.tipo as never,
            esitoCommittente: r.esito_committente as never,
          }))
        )
        const avvisi: AvvisoTrasmissioneSdi[] = [...calcolato.avvisi]
        let nuovo = calcolato.stato
        if (nuovo === 'SCARTATA' && STATI_CONSEGNATI.includes(t.stato)) nuovo = t.stato
        if (nuovo === 'SCARTATA') {
          for (const r of tutte.filter(x => x.tipo === 'NS')) {
            for (const a of avvisiScarto(r.codici_errore)) if (!avvisi.includes(a)) avvisi.push(a)
          }
        }
        if (nuovo !== t.stato && (STATI_DOPO_INVIO as readonly string[]).includes(t.stato)) {
          await tx.$executeRaw`
            UPDATE "trasmissioni_sdi"
            SET stato = ${nuovo}::"stato_trasmissione_sdi",
                chiusa_il = CASE WHEN ${nuovo}::text = 'SCARTATA' THEN ${ora}::timestamptz ELSE chiusa_il END,
                versione = versione + 1, updated_at = ${ora}::timestamptz
            WHERE id = ${trasmissioneId}::uuid AND tenant_id = ${tenantId}::uuid
              AND stato = ${t.stato}::"stato_trasmissione_sdi"`
        } else {
          nuovo = t.stato
        }
        return { inserite, statoPrima: t.stato, statoDopo: nuovo, avvisi }
      }, OPZIONI_TRANSAZIONE_SCRITTURA)
    )
    if (esito?.avvisi.includes('NOTIFICHE_INCOERENTI')) {
      this.logger.warn(
        `Notifiche SDI incoerenti per la trasmissione ${trasmissioneId} (azienda ${tenantId})`
      )
    }
    return esito
  }

  /** Segna che la trasmissione e' stata controllata col polling (sposta `updated_at`, base del prossimo controllo). */
  async segnaControllata(tenantId: string, trasmissioneId: string, ora: Date): Promise<void> {
    await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$executeRaw`
        UPDATE "trasmissioni_sdi" SET updated_at = ${ora}::timestamptz
        WHERE id = ${trasmissioneId}::uuid AND tenant_id = ${tenantId}::uuid
          AND stato NOT IN ('ERRORE_INVIO', 'SCARTATA')`
    )
  }
}
