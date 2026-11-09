import { Module } from '@nestjs/common'
import { BillingModule } from '../billing/billing.module'
import { ModuliAttiviService } from './moduli-attivi.service'

/** Espone `ModuliAttiviService` a `MeModule` e all'interceptor globale di `AppModule`. */
@Module({
  imports: [BillingModule],
  providers: [ModuliAttiviService],
  exports: [ModuliAttiviService],
})
export class ModuliAttiviModule {}
