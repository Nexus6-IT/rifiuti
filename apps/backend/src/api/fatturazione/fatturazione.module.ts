import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { AnnulloStornoService } from '../../application/fatturazione/annullo-storno.service'
import { CedenteService } from '../../application/fatturazione/cedente.service'
import { DocumentiFatturaService } from '../../application/fatturazione/documenti-fattura.service'
import {
  CODA_FATTURAZIONE,
  ElaborazioniService,
} from '../../application/fatturazione/elaborazioni.service'
import { NumerazioniService } from '../../application/fatturazione/numerazioni.service'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { FatturazioneManutenzioneJob } from '../../infrastructure/jobs/fatturazione-manutenzione.job'
import { FatturazioneJobProcessor } from '../../infrastructure/queue/jobs/fatturazione.job'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { CedenteController } from './cedente.controller'
import { NumerazioniController } from './numerazioni.controller'

/** FatturazioneModule — valorizzazione per periodo ed export (4.4): cedente, numerazione, elaborazioni e coda `fatturazione`. */
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    RuoloEffettivoModule,
    // La connessione root BullMQ e' globale (`PermissionsModule`): qui solo la coda.
    BullModule.registerQueue({ name: CODA_FATTURAZIONE }),
  ],
  controllers: [CedenteController, NumerazioniController],
  providers: [
    CedenteService,
    NumerazioniService,
    DocumentiFatturaService,
    AnnulloStornoService,
    ElaborazioniService,
    FatturazioneJobProcessor,
    FatturazioneManutenzioneJob,
  ],
  exports: [
    CedenteService,
    NumerazioniService,
    DocumentiFatturaService,
    AnnulloStornoService,
    ElaborazioniService,
  ],
})
export class FatturazioneModule {}
