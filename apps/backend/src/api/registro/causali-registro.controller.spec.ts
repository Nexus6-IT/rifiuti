import { ForbiddenException } from '@nestjs/common'
import { CausaliRegistroController } from './causali-registro.controller'

const SELEZIONATA = '5a5a5a5a-0000-4000-8000-000000000001'
const DEL_TOKEN = 'c1c1c1c1-0000-4000-8000-000000000002'

describe('CausaliRegistroController (unit)', () => {
  const servizio = {
    opzioni: jest.fn().mockResolvedValue([]),
    gestione: jest.fn().mockResolvedValue({ sistema: [], aziendali: [] }),
    crea: jest.fn().mockResolvedValue({ id: 'x' }),
  }
  const ruoloEffettivo = jest.fn()
  const controller = new CausaliRegistroController(servizio as never, { ruoloEffettivo } as never)
  // L'azienda e quella selezionata (req.tenantId), non quella scritta nel token.
  const req = { tenantId: SELEZIONATA, user: { id: 'u1', tenantId: DEL_TOKEN, role: 'ADMIN' } }

  beforeEach(() => jest.clearAllMocks())

  it('le opzioni valgono per qualunque ruolo e usano l azienda selezionata', async () => {
    const r = await controller.opzioni({ tipo: 'CARICO', data: '2026-10-28' } as never, req)
    expect(r).toEqual({ tipo: 'CARICO', data: '2026-10-28', causali: [] })
    expect(servizio.opzioni).toHaveBeenCalledWith(SELEZIONATA, 'CARICO', '2026-10-28')
    expect(ruoloEffettivo).not.toHaveBeenCalled()
  })

  it('la gestione chiede il ruolo effettivo nell azienda selezionata', async () => {
    ruoloEffettivo.mockResolvedValue('ADMIN')
    await controller.gestione(req)
    expect(ruoloEffettivo).toHaveBeenCalledWith(req.user, SELEZIONATA)
    expect(servizio.gestione).toHaveBeenCalledWith(SELEZIONATA)
  })

  it('un ruolo diverso da ADMIN e SUPER_ADMIN: 403 e nessuna scrittura', async () => {
    ruoloEffettivo.mockResolvedValue('OPERATOR')
    await expect(controller.crea({} as never, req)).rejects.toBeInstanceOf(ForbiddenException)
    expect(servizio.crea).not.toHaveBeenCalled()
  })

  it('la creazione passa utente e azienda selezionata al servizio', async () => {
    ruoloEffettivo.mockResolvedValue('SUPER_ADMIN')
    await controller.crea(
      { codice: 'AZ_X', verso: 'CARICO', descrizione: 'x', ruoloMud: 'ESCLUSO' } as never,
      req
    )
    expect(servizio.crea).toHaveBeenCalledWith(
      SELEZIONATA,
      'u1',
      expect.objectContaining({ codice: 'AZ_X' })
    )
  })
})
