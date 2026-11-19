// Ricezione dei webhook SDI (4.5c, piano §4.5). Chiamata dalla rotta pubblica `POST /sdi/webhook/:provider/:token`.
//
// Ordine (ogni passo esce subito, e NESSUNA risposta riporta dati dell'azienda: tutti i rifiuti sono generici):
//   1. token ben formato (altrimenti 404 senza toccare il database);
//   2. azienda dal token (client di sistema, un solo lookup) e provider della configurazione uguale a quello
//      dell'URL; azienda col modulo `sdi` (in modalita' `registra`: avviso e si passa);
//   3. nel contesto dell'azienda: firma, timestamp e interpretazione dell'adattatore (`interpretaWebhook`, a
//      tempo costante), col segreto della configurazione;
//   4. INSERT idempotente in `eventi_sdi_ricevuti` (unico per azienda, provider, id evento): un evento
//      consegnato due volte (consegna «almeno una volta») produce UN solo inserimento e due risposte 200.
// L'elaborazione (notifiche e stato) NON e' qui: la fa `SdiEventiJob`, cosi' la risposta al provider e' veloce.
import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { ModuliAttiviService } from '../admin/moduli-attivi.service'
import { modalitaModuli } from '../../core/interceptors/modulo-attivo.interceptor'
import { eProviderSdi } from '../../domain/fatturazione/sdi/codici'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RegistroProviderSdi } from '../fatturazione/sdi/registro-provider-sdi'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { ConfigurazioneSdiService } from './configurazione-sdi.service'
import { corpoDaNotifica } from './evento-sdi'
import { RisoluzioneTenantSdiService } from './risoluzione-tenant-sdi.service'

/** Token del webhook: 32 byte casuali in base64url (43 caratteri). */
export const FORMATO_TOKEN_WEBHOOK_SDI = /^[A-Za-z0-9_-]{43}$/

export type EsitoRicezioneWebhookSdi =
  | { tipo: 'RICEVUTO' }
  /** Token, provider o modulo non validi: la rotta risponde 404 generico. */
  | { tipo: 'NON_TROVATO' }
  /** Firma, timestamp o formato non validi: la rotta risponde 401 generico. */
  | { tipo: 'NON_AUTENTICO' }

@Injectable()
export class WebhookSdiService {
  private readonly logger = new Logger(WebhookSdiService.name)
  /** Sostituibile nei test. */
  orologio: () => Date = () => new Date()

  constructor(
    private readonly risoluzione: RisoluzioneTenantSdiService,
    private readonly moduli: ModuliAttiviService,
    private readonly configurazione: ConfigurazioneSdiService,
    private readonly registro: RegistroProviderSdi,
    private readonly prisma: PrismaService
  ) {}

  async ricevi(
    providerUrl: string,
    token: string,
    intestazioni: Record<string, string>,
    corpoGrezzo: Buffer
  ): Promise<EsitoRicezioneWebhookSdi> {
    if (!FORMATO_TOKEN_WEBHOOK_SDI.test(token) || !eProviderSdi(providerUrl)) {
      return { tipo: 'NON_TROVATO' }
    }
    const tenant = await this.risoluzione.daToken(
      createHash('sha256').update(token, 'utf8').digest('hex')
    )
    if (!tenant || tenant.provider !== providerUrl) return { tipo: 'NON_TROVATO' }

    const attivi = await this.moduli.moduliAttivi(tenant.tenantId)
    if (!attivi.includes('sdi')) {
      if (modalitaModuli() !== 'registra') return { tipo: 'NON_TROVATO' }
      this.logger.warn(
        `Modulo non attivo (solo registrato): webhook SDI, azienda=${tenant.tenantId}, richiesti=sdi`
      )
    }

    let adattatore
    try {
      adattatore = this.registro.trova(tenant.provider)
    } catch {
      return { tipo: 'NON_TROVATO' }
    }
    const segreto = await this.configurazione.leggiSegretoWebhook(tenant.tenantId)
    // Senza segreto non c'e' nulla con cui verificare la firma: mai accettare alla cieca.
    if (segreto === null) return { tipo: 'NON_AUTENTICO' }

    const esito = adattatore.interpretaWebhook(intestazioni, corpoGrezzo, segreto, this.orologio())
    if (esito.tipo === 'NON_AUTENTICO') return { tipo: 'NON_AUTENTICO' }
    if (esito.tipo === 'IGNORATO') return { tipo: 'RICEVUTO' }

    const corpo = JSON.stringify(corpoDaNotifica(esito.idProvider, esito.notifica))
    const inseriti = await nelContestoTenant(
      tenant.tenantId,
      async () =>
        this.prisma.$executeRaw`
        INSERT INTO "eventi_sdi_ricevuti" (tenant_id, provider, id_evento_provider, corpo)
        VALUES (${tenant.tenantId}::uuid, ${tenant.provider}, ${esito.idEvento.slice(0, 100)},
                ${corpo}::jsonb)
        ON CONFLICT (tenant_id, provider, id_evento_provider) DO NOTHING`
    )
    if (inseriti === 0) this.logger.debug(`Evento SDI gia' ricevuto (azienda ${tenant.tenantId})`)
    return { tipo: 'RICEVUTO' }
  }
}
