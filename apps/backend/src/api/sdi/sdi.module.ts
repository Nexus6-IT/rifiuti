import { Module } from '@nestjs/common'
import { PROVIDER_SDI } from '../../application/fatturazione/sdi/provider-sdi.port'
import { RegistroProviderSdi } from '../../application/fatturazione/sdi/registro-provider-sdi'
import { ConfigurazioneSdiService } from '../../application/sdi/configurazione-sdi.service'
import { ElaboraInvioSdiService } from '../../application/sdi/elabora-invio-sdi.service'
import { ElaboraEventiSdiService } from '../../application/sdi/elabora-eventi-sdi.service'
import { InvioSdiService } from '../../application/sdi/invio-sdi.service'
import { LetturaSdiService } from '../../application/sdi/lettura-sdi.service'
import { RegistraNotificheSdiService } from '../../application/sdi/registra-notifiche-sdi.service'
import { RiconciliaNotificheSdiService } from '../../application/sdi/riconcilia-notifiche-sdi.service'
import { RisoluzioneTenantSdiService } from '../../application/sdi/risoluzione-tenant-sdi.service'
import { WebhookSdiService } from '../../application/sdi/webhook-sdi.service'
import { ModuliAttiviModule } from '../../application/admin/moduli-attivi.module'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { SdiEventiJob } from '../../infrastructure/jobs/sdi-eventi.job'
import { SdiInvioJob } from '../../infrastructure/jobs/sdi-invio.job'
import { SdiRiconciliazioneJob } from '../../infrastructure/jobs/sdi-riconciliazione.job'
import { ProviderSdiFake } from '../../infrastructure/sdi/fake/provider-sdi-fake'
import { FatturazioneModule } from '../fatturazione/fatturazione.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { ConfigurazioneSdiController } from './configurazione-sdi.controller'
import { InvioSdiController } from './invio-sdi.controller'
import { LetturaSdiController } from './lettura-sdi.controller'
import { ThrottlerWebhookSdiGuard } from './throttler-webhook-sdi.guard'
import { WebhookSdiController } from './webhook-sdi.controller'

/**
 * SdiModule (4.5a-b): emissione delle fatture allo SDI tramite provider. Configurazione per azienda,
 * porta `ProviderSdi` con l'adattatore `fake` (rifiutato in produzione da `RegistroProviderSdi`),
 * ricevute (webhook pubblico, inbox, polling di ripiego, 4.5c), accodamento dell'invio (`/documenti-fattura/invio-sdi`) e job d'invio (spento di default:
 * `SDI_INVII_ATTIVI`). Il modulo commerciale e' `sdi` (`@RichiedeModulo`).
 */
@Module({
  // FatturazioneModule: `XmlDocumentoService` (l'XML e l'emissione). ModuliAttiviModule: il job filtra le aziende col modulo `sdi`.
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule, FatturazioneModule, ModuliAttiviModule],
  controllers: [
    ConfigurazioneSdiController,
    InvioSdiController,
    LetturaSdiController,
    WebhookSdiController,
  ],
  providers: [
    { provide: PROVIDER_SDI, useFactory: () => [new ProviderSdiFake()] },
    RegistroProviderSdi,
    ConfigurazioneSdiService,
    InvioSdiService,
    ElaboraInvioSdiService,
    LetturaSdiService,
    RisoluzioneTenantSdiService,
    WebhookSdiService,
    ThrottlerWebhookSdiGuard,
    RegistraNotificheSdiService,
    ElaboraEventiSdiService,
    RiconciliaNotificheSdiService,
    // Solo provider (nessun export): il suo `@Cron` non si registra due volte.
    SdiInvioJob,
    SdiEventiJob,
    SdiRiconciliazioneJob,
  ],
  exports: [RegistroProviderSdi, ConfigurazioneSdiService],
})
export class SdiModule {}
