import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { ADATTATORI_EXPORT } from '../../application/fatturazione/adattatori/adattatore-export-contabile'
import { MappatureService } from '../../application/fatturazione/adattatori/mappature.service'
import { TeamSystemAdattatore } from '../../application/fatturazione/adattatori/teamsystem.adattatore'
import { RegistroAdattatori } from '../../application/fatturazione/adattatori/registro-adattatori'
import { AnnulloStornoService } from '../../application/fatturazione/annullo-storno.service'
import { CedenteService } from '../../application/fatturazione/cedente.service'
import { DocumentiFatturaService } from '../../application/fatturazione/documenti-fattura.service'
import {
  CODA_FATTURAZIONE,
  ElaborazioniService,
} from '../../application/fatturazione/elaborazioni.service'
import { ExportService } from '../../application/fatturazione/export.service'
import { PdfCortesiaService } from '../../application/fatturazione/pdf-cortesia'
import { NumerazioniService } from '../../application/fatturazione/numerazioni.service'
import { ScostamentiService } from '../../application/fatturazione/scostamenti.service'
import { XmlDocumentoService } from '../../application/fatturazione/xml-documento.service'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { FatturazioneManutenzioneJob } from '../../infrastructure/jobs/fatturazione-manutenzione.job'
import { FatturazioneJobProcessor } from '../../infrastructure/queue/jobs/fatturazione.job'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { CedenteController } from './cedente.controller'
import { DocumentiFatturaController } from './documenti-fattura.controller'
import { ExportContabileController } from './export-contabile.controller'
import { ElaborazioniController } from './elaborazioni.controller'
import { NumerazioniController } from './numerazioni.controller'
import { ScostamentiController } from './scostamenti.controller'

/** FatturazioneModule — valorizzazione per periodo ed export (4.4): cedente, numerazione, elaborazioni e coda `fatturazione`. */
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    RuoloEffettivoModule,
    // La connessione root BullMQ e' globale (`PermissionsModule`): qui solo la coda.
    BullModule.registerQueue({ name: CODA_FATTURAZIONE }),
  ],
  controllers: [
    CedenteController,
    NumerazioniController,
    ElaborazioniController,
    DocumentiFatturaController,
    ScostamentiController,
    ExportContabileController,
  ],
  providers: [
    CedenteService,
    NumerazioniService,
    DocumentiFatturaService,
    AnnulloStornoService,
    ScostamentiService,
    ElaborazioniService,
    XmlDocumentoService,
    ExportService,
    PdfCortesiaService,
    // Elenco degli adattatori contabili (provider multi): TeamSystem e gli altri vi si aggiungono.
    { provide: ADATTATORI_EXPORT, useFactory: () => [new TeamSystemAdattatore()] },
    RegistroAdattatori,
    MappatureService,
    FatturazioneJobProcessor,
    FatturazioneManutenzioneJob,
  ],
  exports: [
    CedenteService,
    NumerazioniService,
    DocumentiFatturaService,
    AnnulloStornoService,
    ScostamentiService,
    ElaborazioniService,
    XmlDocumentoService,
    ExportService,
    RegistroAdattatori,
    MappatureService,
  ],
})
export class FatturazioneModule {}
