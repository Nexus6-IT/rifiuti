/** ScostamentiController (4.4b1, Task 25a): lista a tutti, presa d'atto agli amministratori (Q31). */
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { ScostamentiController } from './scostamenti.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000002'
const ID = '6b6b6b6b-0000-4000-8000-000000000003'
const req: any = { tenantId: TENANT, user: { id: 'utente-1', tenantId: 'altro-tenant' } }

describe('ScostamentiController', () => {
  const reflector = new Reflector()
  const proto = ScostamentiController.prototype as any
  const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

  it('ruoli', () => {
    expect(ruoli('lista')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    expect(ruoli('presaAtto')).toEqual(['SUPER_ADMIN', 'ADMIN'])
  })

  it('passaggio dei valori', async () => {
    const servizio = {
      lista: jest.fn().mockResolvedValue({ elementi: [], totale: 0, pagina: 1, dimensione: 50 }),
      presaAtto: jest.fn().mockResolvedValue(undefined),
    }
    const c = new ScostamentiController(servizio as never)
    expect(await c.lista(req, { pagina: 1, dimensione: 50 })).toEqual({
      elementi: [],
      totale: 0,
      pagina: 1,
      dimensione: 50,
    })
    expect(servizio.lista).toHaveBeenCalledWith(TENANT, { pagina: 1, dimensione: 50 })
    await c.presaAtto(req, { id: ID }, { nota: 'ok', versione: 3 })
    expect(servizio.presaAtto).toHaveBeenCalledWith(TENANT, 'utente-1', ID, {
      nota: 'ok',
      versione: 3,
    })
  })
})
