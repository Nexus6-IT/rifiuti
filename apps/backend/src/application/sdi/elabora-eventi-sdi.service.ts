// Elaborazione dell'inbox del webhook SDI di UNA azienda (4.5c, piano §4.5): `eventi_sdi_ricevuti` ->
// `notifiche_sdi` -> ricalcolo dello stato. La chiama `SdiEventiJob` azienda per azienda; i test la
// chiamano direttamente. Tutto locale (nessuna chiamata al provider): gira anche con gli invii spenti.
//
// Ogni evento e' elaborato per conto suo e l'elaborazione e' idempotente (dedup delle notifiche, UPDATE
// condizionato), quindi due processi sullo stesso evento non fanno danni: basta che il segno finale
// `elaborato_il` sia condizionato a `IS NULL`.
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { notificaDaCorpo } from './evento-sdi'
import { RegistraNotificheSdiService } from './registra-notifiche-sdi.service'

/** Eventi elaborati al massimo per azienda e per giro. */
export const LIMITE_EVENTI_PER_GIRO = 100
/** Un evento che non trova la sua trasmissione dopo cosi' tanto si chiude come sconosciuto. */
export const ATTESA_MASSIMA_TRASMISSIONE_SDI_MS = 24 * 3_600_000

export interface EsitoGiroEventiSdi {
  elaborati: number
  /** Eventi la cui trasmissione non e' ancora nota (webhook arrivato prima dell'esito dell'invio). */
  inAttesa: number
  scartati: number
  errori: number
}

interface EventoDaElaborare {
  id: string
  provider: string
  corpo: unknown
  ricevutoIl: Date
}

@Injectable()
export class ElaboraEventiSdiService {
  private readonly logger = new Logger(ElaboraEventiSdiService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifiche: RegistraNotificheSdiService
  ) {}

  async giroAzienda(tenantId: string, ora: Date): Promise<EsitoGiroEventiSdi> {
    const esito: EsitoGiroEventiSdi = { elaborati: 0, inAttesa: 0, scartati: 0, errori: 0 }
    const eventi = await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$queryRaw<EventoDaElaborare[]>`
        SELECT id::text AS id, provider, corpo, ricevuto_il AS "ricevutoIl" FROM "eventi_sdi_ricevuti"
        WHERE tenant_id = ${tenantId}::uuid AND elaborato_il IS NULL
        ORDER BY esito_elaborazione NULLS FIRST, ricevuto_il, id LIMIT ${LIMITE_EVENTI_PER_GIRO}::int`
    )
    for (const e of eventi) {
      try {
        const r = await this.elaboraUno(tenantId, e, ora)
        esito[r]++
      } catch (errore) {
        esito.errori++
        // Solo l'id dell'evento: il corpo puo' riportare dati del documento.
        this.logger.error(
          `Evento SDI ${e.id} (azienda ${tenantId}) non elaborato: ${
            errore instanceof Error ? errore.message : 'errore'
          }`
        )
        await this.segnaErrore(tenantId, e, ora).catch(() => undefined)
      }
    }
    return esito
  }

  private async elaboraUno(
    tenantId: string,
    e: EventoDaElaborare,
    ora: Date
  ): Promise<'elaborati' | 'inAttesa' | 'scartati'> {
    const letto = notificaDaCorpo(e.corpo)
    if (!letto) {
      await this.chiudi(tenantId, e.id, ora, 'CORPO_NON_VALIDO')
      return 'scartati'
    }
    const righe = await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM "trasmissioni_sdi"
        WHERE tenant_id = ${tenantId}::uuid AND provider = ${e.provider} AND id_provider = ${letto.idProvider}
        ORDER BY created_at DESC LIMIT 1`
    )
    const trasmissione = righe[0]
    if (!trasmissione) {
      if (ora.getTime() - new Date(e.ricevutoIl).getTime() > ATTESA_MASSIMA_TRASMISSIONE_SDI_MS) {
        await this.chiudi(tenantId, e.id, ora, 'TRASMISSIONE_SCONOSCIUTA')
        return 'scartati'
      }
      // Il provider puo' notificare prima che noi abbiamo scritto l'esito dell'invio: si riprova al giro dopo.
      await nelContestoTenant(
        tenantId,
        async () =>
          this.prisma.$executeRaw`
          UPDATE "eventi_sdi_ricevuti" SET esito_elaborazione = 'IN_ATTESA_TRASMISSIONE'
          WHERE id = ${e.id}::uuid AND tenant_id = ${tenantId}::uuid AND elaborato_il IS NULL`
      )
      return 'inAttesa'
    }
    const r = await this.notifiche.registra(
      tenantId,
      trasmissione.id,
      [letto.notifica],
      'WEBHOOK',
      ora
    )
    await this.chiudi(tenantId, e.id, ora, r ? `OK:${r.statoDopo}` : 'TRASMISSIONE_SCONOSCIUTA')
    return 'elaborati'
  }

  /** Evento che lancia: dopo 24 ore si chiude, prima passa dietro agli eventi mai provati. */
  private async segnaErrore(tenantId: string, e: EventoDaElaborare, ora: Date): Promise<void> {
    if (ora.getTime() - new Date(e.ricevutoIl).getTime() > ATTESA_MASSIMA_TRASMISSIONE_SDI_MS) {
      await this.chiudi(tenantId, e.id, ora, 'ERRORE')
      return
    }
    await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$executeRaw`
        UPDATE "eventi_sdi_ricevuti" SET esito_elaborazione = 'ERRORE'
        WHERE id = ${e.id}::uuid AND tenant_id = ${tenantId}::uuid AND elaborato_il IS NULL`
    )
  }

  private async chiudi(tenantId: string, id: string, ora: Date, esito: string): Promise<void> {
    await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$executeRaw`
        UPDATE "eventi_sdi_ricevuti"
        SET elaborato_il = ${ora}::timestamptz, esito_elaborazione = ${esito.slice(0, 200)}
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND elaborato_il IS NULL`
    )
  }
}
