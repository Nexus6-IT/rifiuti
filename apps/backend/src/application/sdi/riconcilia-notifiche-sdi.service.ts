// Polling di ripiego delle notifiche SDI di UNA azienda (4.5c, piano §4.5): se un webhook va perso, la
// trasmissione resterebbe ferma per sempre. La chiama `SdiRiconciliazioneJob` ogni 15 minuti.
//
// Cosa si controlla (solo `notifiche()` del provider: letture, nessun invio, niente di fiscale che cambi
// se il provider e' lento):
//   - `INVIATA` da piu' di 2 ore senza nessuna notifica registrata;
//   - `CONSEGNATA` di una FPA12 (PA) da piu' di 15 giorni senza esito: il DT (decorrenza termini) arriva a 15
//     giorni dalla consegna.
// La base del «da quanto» e' `updated_at`, che il controllo stesso sposta (`segnaControllata`): senza un
// controllo riuscito si riprova al giro dopo, con un controllo riuscito si riparte da capo. Cosi' una
// trasmissione senza novita' non si interroga ogni 15 minuti (costo, rischio R7 del piano).
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  ProviderSdiNonDisponibileError,
  RegistroProviderSdi,
} from '../fatturazione/sdi/registro-provider-sdi'
import type { ProviderSdi } from '../fatturazione/sdi/provider-sdi.port'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { ConfigurazioneSdiService } from './configurazione-sdi.service'
import { RegistraNotificheSdiService } from './registra-notifiche-sdi.service'

/** `INVIATA` senza notifiche dopo cosi' tanto: si interroga il provider. */
export const ATTESA_POLLING_INVIATA_SDI_MS = 2 * 3_600_000
/** `CONSEGNATA` di una FPA12 senza esito dopo cosi' tanto: si interroga il provider (il DT arriva a 15 giorni). */
export const ATTESA_POLLING_PA_SDI_MS = 15 * 86_400_000
export const LIMITE_POLLING_PER_GIRO = 50

export interface EsitoGiroRiconciliazioneSdi {
  controllate: number
  /** Trasmissioni il cui stato e' cambiato grazie al polling. */
  aggiornate: number
  errori: number
}

@Injectable()
export class RiconciliaNotificheSdiService {
  private readonly logger = new Logger(RiconciliaNotificheSdiService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configurazione: ConfigurazioneSdiService,
    private readonly registro: RegistroProviderSdi,
    private readonly notifiche: RegistraNotificheSdiService
  ) {}

  async giroAzienda(tenantId: string, ora: Date): Promise<EsitoGiroRiconciliazioneSdi> {
    const esito: EsitoGiroRiconciliazioneSdi = { controllate: 0, aggiornate: 0, errori: 0 }
    const config = await this.configurazione.leggiPerInvio(tenantId)
    if (!config) return esito
    let provider: ProviderSdi
    try {
      provider = this.registro.trova(config.provider)
    } catch (e) {
      if (e instanceof ProviderSdiNonDisponibileError) {
        this.logger.warn(`Provider SDI non disponibile per l'azienda ${tenantId}: polling saltato`)
        return esito
      }
      throw e
    }

    const sogliaInviata = new Date(ora.getTime() - ATTESA_POLLING_INVIATA_SDI_MS)
    const sogliaPa = new Date(ora.getTime() - ATTESA_POLLING_PA_SDI_MS)
    const candidate = await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$queryRaw<{ id: string; idProvider: string }[]>`
        SELECT t.id::text AS id, t.id_provider AS "idProvider"
        FROM "trasmissioni_sdi" t
        JOIN "documenti_fattura" d ON d.id = t.documento_id AND d.tenant_id = t.tenant_id
        WHERE t.tenant_id = ${tenantId}::uuid AND t.provider = ${config.provider}
          AND t.ambiente = ${config.ambiente}
          AND t.id_provider IS NOT NULL
          AND ((t.stato = 'INVIATA' AND t.updated_at < ${sogliaInviata}::timestamptz)
            OR (t.stato = 'CONSEGNATA' AND d.formato_trasmissione = 'FPA12'
                AND t.updated_at < ${sogliaPa}::timestamptz))
        ORDER BY t.updated_at, t.id LIMIT ${LIMITE_POLLING_PER_GIRO}::int`
    )

    for (const t of candidate) {
      try {
        const grezze = await provider.notifiche(config.contesto, t.idProvider)
        esito.controllate++
        const r = await this.notifiche.registra(tenantId, t.id, grezze, 'POLLING', ora)
        if (r && r.statoDopo !== r.statoPrima) esito.aggiornate++
        else await this.notifiche.segnaControllata(tenantId, t.id, ora)
      } catch (e) {
        // Provider non raggiungibile: la trasmissione resta com'e' e si riprova al giro dopo.
        esito.errori++
        // Rinvio: senza spostare `updated_at` la trasmissione resterebbe in testa alla coda e si
        // riinterrogherebbe ogni giro, bloccando le altre.
        await this.notifiche.segnaControllata(tenantId, t.id, ora).catch(() => undefined)
        this.logger.warn(
          `Polling SDI della trasmissione ${t.id} (azienda ${tenantId}) non riuscito: ${
            e instanceof Error ? e.message : 'errore'
          }`
        )
      }
    }
    return esito
  }
}
