import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { RegistroModule } from './registro.module'
import { RegistroController } from './registro.controller'
import { CausaliRegistroController } from './causali-registro.controller'
import { CausaliRegistroService } from '../../application/registro/causali/causali-registro.service'
import { RegistriService } from '../../application/registro/registri.service'
import { RegistraMovimentoUseCase } from '../../application/registro/use-cases/registra-movimento.use-case'
import { CorreggiMovimentoUseCase } from '../../application/registro/use-cases/correggi-movimento.use-case'
import { ProgressivoInizialeService } from '../../application/registro/progressivo-iniziale.service'
import { GiacenzeInizialiService } from '../../application/registro/giacenze-iniziali.service'
import { VerificaCatenaRegistroService } from '../../application/registro/verifica-catena-registro.service'

describe('RegistroModule (DI wiring)', () => {
  it('risolve controller, use case e servizi dei registri con la DI di Nest', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), RegistroModule],
    }).compile()

    expect(moduleRef.get(RegistroController)).toBeDefined()
    expect(moduleRef.get(RegistriService)).toBeDefined()
    expect(moduleRef.get(RegistraMovimentoUseCase)).toBeDefined()
    expect(moduleRef.get(CorreggiMovimentoUseCase)).toBeDefined()
    expect(moduleRef.get(ProgressivoInizialeService)).toBeDefined()
    expect(moduleRef.get(GiacenzeInizialiService)).toBeDefined()
    expect(moduleRef.get(VerificaCatenaRegistroService)).toBeDefined()
    expect(moduleRef.get(CausaliRegistroController)).toBeDefined()
    expect(moduleRef.get(CausaliRegistroService)).toBeDefined()

    await moduleRef.close()
  })
})
