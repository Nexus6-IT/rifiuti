import { ForbiddenException } from '@nestjs/common'
import { AbbinamentiController } from './abbinamenti.controller'

const T = '5a5a5a5a-0000-4000-8000-00000000000b'
const U = 'e1e1e1e1-0000-4000-8000-000000000003'
const REG = '3b3b3b3b-0000-4000-8000-000000000006'
const SC = '4c4c4c4c-0000-4000-8000-000000000007'

describe('AbbinamentiController - ruoli', () => {
  let ruolo: string
  let servizio: Record<string, jest.Mock>
  let c: AbbinamentiController
  const req = { user: { id: U, tenantId: 'altro' }, tenantId: T }

  beforeEach(() => {
    ruolo = 'OPERATOR'
    servizio = {
      vista: jest.fn().mockResolvedValue({ ambiti: [] }),
      proposta: jest.fn().mockResolvedValue({}),
      salvaManuale: jest.fn().mockResolvedValue({ scarico: {}, avvisi: [] }),
      ricalcola: jest.fn().mockResolvedValue({ scarichiAbbinati: 0 }),
      differenze: jest.fn().mockResolvedValue([]),
    }
    c = new AbbinamentiController(
      servizio as never,
      {
        ruoloEffettivo: jest.fn(async () => ruolo),
      } as never
    )
  })

  it('la vista passa azienda selezionata e ruolo effettivo', async () => {
    await c.vista({ registroId: REG } as never, req)
    expect(servizio.vista).toHaveBeenCalledWith(T, REG, undefined, 'OPERATOR')
  })

  it.each(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])('%s puo salvare l override', async r => {
    ruolo = r
    await c.salva(SC, { righe: [{ caricoId: REG, quantita: 1 }] } as never, req)
    expect(servizio.salvaManuale).toHaveBeenCalledWith(T, U, SC, [{ caricoId: REG, quantita: 1 }])
  })

  it('VIEWER non puo salvare: 403 e il servizio non e toccato', async () => {
    ruolo = 'VIEWER'
    await expect(c.salva(SC, { righe: [] } as never, req)).rejects.toThrow(
      new ForbiddenException('Il tuo ruolo non consente di modificare gli abbinamenti.')
    )
    expect(servizio.salvaManuale).not.toHaveBeenCalled()
  })

  it('una riga con carico e giacenza insieme, o nessuno dei due, e 400', async () => {
    await expect(
      c.salva(
        SC,
        { righe: [{ caricoId: REG, giacenzaInizialeId: REG, quantita: 1 }] } as never,
        req
      )
    ).rejects.toThrow('Indica un carico oppure una giacenza iniziale, non entrambi.')
    await expect(c.salva(SC, { righe: [{ quantita: 1 }] } as never, req)).rejects.toThrow(
      'Indica per ogni riga un carico oppure una giacenza iniziale.'
    )
  })

  it('OPERATOR ricalcola i NON_ABBINATI ma non gli AUTOMATICI', async () => {
    await c.ricalcolo({ registroId: REG, modalita: 'NON_ABBINATI' } as never, req)
    expect(servizio.ricalcola).toHaveBeenCalledWith(T, U, {
      registroId: REG,
      modalita: 'NON_ABBINATI',
    })
    await expect(
      c.ricalcolo({ registroId: REG, modalita: 'AUTOMATICI' } as never, req)
    ).rejects.toThrow(
      new ForbiddenException(
        "Solo un amministratore dell'azienda può ricalcolare gli abbinamenti automatici."
      )
    )
  })

  it('ADMIN ricalcola gli AUTOMATICI; VIEWER nessuno dei due', async () => {
    ruolo = 'ADMIN'
    await c.ricalcolo({ registroId: REG, modalita: 'AUTOMATICI' } as never, req)
    expect(servizio.ricalcola).toHaveBeenCalledTimes(1)
    ruolo = 'VIEWER'
    await expect(
      c.ricalcolo({ registroId: REG, modalita: 'NON_ABBINATI' } as never, req)
    ).rejects.toThrow('Il tuo ruolo non consente di modificare gli abbinamenti.')
  })

  it('proposta e differenze sono in lettura per ogni ruolo', async () => {
    ruolo = 'VIEWER'
    await c.proposta(SC, req)
    expect(servizio.proposta).toHaveBeenCalledWith(T, SC)
    await c.differenze({ registroId: REG, cerCode: '99 99 11' } as never, req)
    expect(servizio.differenze).toHaveBeenCalledWith(T, REG, '99 99 11')
  })
})
