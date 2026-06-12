import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import { RentriModule } from './rentri.module'
import { RENTRIApiClient } from './rentri-api.client'
import { RentriAuthService } from './rentri-auth.service'
import { RentriSignatureService } from './rentri-signature.service'
import { RentriCredentialService } from './rentri-credential.service'
import { RentriCredentialResolver } from './rentri-credential.resolver'
import { RentriCredentialController } from '../../api/rentri/rentri-credential.controller'

/**
 * DI smoke test per RentriModule (cablato in AppModule).
 *
 * `.compile()` risolve l'intero grafo DI (provider, controller, RENTRI_CONFIG,
 * resolver, credential service) SENZA invocare i lifecycle hooks → nessuna
 * connessione reale. Intercetta errori di wiring senza infrastruttura.
 */
describe('RentriModule (DI wiring)', () => {
  it('risolve client, auth, firma, credential service/resolver e controller', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), RentriModule],
    }).compile()

    expect(moduleRef.get(RENTRIApiClient)).toBeDefined()
    expect(moduleRef.get(RentriAuthService)).toBeDefined()
    expect(moduleRef.get(RentriSignatureService)).toBeDefined()
    expect(moduleRef.get(RentriCredentialService)).toBeDefined()
    expect(moduleRef.get(RentriCredentialResolver)).toBeDefined()
    expect(moduleRef.get(RentriCredentialController)).toBeDefined()

    await moduleRef.close()
  })
})
