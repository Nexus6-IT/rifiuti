import { Module } from '@nestjs/common'
import { PROVIDER_SDI } from '../../application/fatturazione/sdi/provider-sdi.port'
import { RegistroProviderSdi } from '../../application/fatturazione/sdi/registro-provider-sdi'
import { ConfigurazioneSdiService } from '../../application/sdi/configurazione-sdi.service'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { ProviderSdiFake } from '../../infrastructure/sdi/fake/provider-sdi-fake'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { ConfigurazioneSdiController } from './configurazione-sdi.controller'

/**
 * SdiModule (4.5a): emissione delle fatture allo SDI tramite provider. Per ora solo la
 * configurazione per azienda, la porta `ProviderSdi` con l'adattatore `fake` (rifiutato in
 * produzione da `RegistroProviderSdi`). Nessun invio: arriva con la 4.5b. Il modulo commerciale
 * e' `sdi` (`@RichiedeModulo`).
 */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [ConfigurazioneSdiController],
  providers: [
    { provide: PROVIDER_SDI, useFactory: () => [new ProviderSdiFake()] },
    RegistroProviderSdi,
    ConfigurazioneSdiService,
  ],
  exports: [RegistroProviderSdi, ConfigurazioneSdiService],
})
export class SdiModule {}
