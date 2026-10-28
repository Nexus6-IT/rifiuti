import { ForbiddenException } from '@nestjs/common'
import { GiacenzeController } from './giacenze.controller'

describe('GiacenzeController — azienda selezionata', () => {
  // switch di azienda: il token resta sul tenant A, l'azienda selezionata è B
  const richiesta = { tenantId: 'B', user: { id: 'u1', tenantId: 'A', role: 'ADMIN' } }
  let service: {
    getGiacenze: jest.Mock
    getDepositoTemporaneo: jest.Mock
    getDepositoTemporaneoAlerts: jest.Mock
  }
  let controller: GiacenzeController

  beforeEach(() => {
    service = {
      getGiacenze: jest.fn().mockResolvedValue([]),
      getDepositoTemporaneo: jest.fn().mockResolvedValue({ oggi: '2026-10-28', registri: [] }),
      getDepositoTemporaneoAlerts: jest.fn().mockResolvedValue([]),
    }
    controller = new GiacenzeController(service as any, {} as any, {} as any)
  })

  it("giacenze: usa l'azienda selezionata (non quella del token) e passa registroId", async () => {
    await controller.getGiacenze(richiesta, { registroId: 'reg-1' })

    expect(service.getGiacenze).toHaveBeenCalledWith('B', 'reg-1')
  })

  it("vista del deposito: usa l'azienda selezionata e passa registroId", async () => {
    await controller.getDepositoTemporaneo(richiesta, { registroId: 'reg-1' })

    expect(service.getDepositoTemporaneo).toHaveBeenCalledWith('B', { registroId: 'reg-1' })
  })

  it("alert di deposito: usa l'azienda selezionata e passa registroId", async () => {
    await controller.getDepositoTemporaneoAlerts(richiesta, { registroId: 'reg-1' })

    expect(service.getDepositoTemporaneoAlerts).toHaveBeenCalledWith('B', 'reg-1')
  })

  it('senza azienda determinabile: 403, nessuna lettura', async () => {
    const senza = { user: { id: 'u1', role: 'ADMIN' } }

    await expect(controller.getGiacenze(senza, {})).rejects.toBeInstanceOf(ForbiddenException)
    expect(service.getGiacenze).not.toHaveBeenCalled()
  })
})
