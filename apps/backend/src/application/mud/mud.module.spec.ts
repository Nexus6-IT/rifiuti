import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { MUDModule } from './mud.module'
import { MUDGeneratorService } from './mud-generator.service'
import { MudExportService } from './export/mud-export.service'
import { MudAggregazioneService } from './aggregazione/mud-aggregazione.service'
import { MudController } from '../../api/mud/mud.controller'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import { MudObbligoService } from './mud-obbligo.service'
import { MudPresentazioneService } from './mud-presentazione.service'
import { MudIntegrazioniService } from './mud-integrazioni.service'

describe('MUDModule (DI wiring)', () => {
  it('risolve generator, export service, aggregazione, controller e ruolo effettivo', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), MUDModule],
    }).compile()

    expect(moduleRef.get(MUDGeneratorService)).toBeDefined()
    expect(moduleRef.get(MudExportService)).toBeDefined()
    expect(moduleRef.get(MudAggregazioneService)).toBeDefined()
    expect(moduleRef.get(MudController)).toBeDefined()
    // ruolo nell'azienda selezionata, senza MeModule (che porta AuthModule e Redis)
    expect(moduleRef.get(RuoloEffettivoService)).toBeDefined()
    // flag "MUD non dovuto" (A-W-10)
    expect(moduleRef.get(MudObbligoService)).toBeDefined()
    // segnatura della presentazione (Task 8)
    expect(moduleRef.get(MudPresentazioneService)).toBeDefined()
    // integrazioni dell'anno (Task 10)
    expect(moduleRef.get(MudIntegrazioniService)).toBeDefined()

    await moduleRef.close()
  })
})
