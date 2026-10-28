import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { PiazzaleController } from './piazzale.controller'
import { FIRResponseDto } from '../fir/dtos/fir-response.dto'

/** Risoluzione del ruolo effettivo finta: restituisce sempre il ruolo indicato. */
const ruoli = (ruolo: string) => ({ ruoloEffettivo: jest.fn().mockResolvedValue(ruolo) }) as any

describe('PiazzaleController — GET /piazzale/arrivi', () => {
  // switch di azienda: il token resta sul tenant A (studio), l'azienda selezionata è B
  const richiesta = (role = 'OPERATOR') => ({
    tenantId: 'B',
    user: { id: 'user-1', email: 'c@example.com', tenantId: 'A', role },
  })
  const risultato = {
    azienda: { id: 'B', ragioneSociale: 'Impianto B SRL' },
    codiciAziendaConfigurati: true,
    arrivi: [{ id: 'f1' }, { id: 'f2' }],
  }
  let servizio: { elenca: jest.Mock }

  beforeEach(() => {
    jest
      .spyOn(FIRResponseDto, 'fromDomain')
      .mockImplementation((fir: any) => ({ mappato: fir.id }) as any)
    servizio = { elenca: jest.fn().mockResolvedValue(risultato) }
  })
  afterEach(() => jest.restoreAllMocks())

  it("usa il tenant dell'azienda selezionata, non quello del token", async () => {
    const controller = new PiazzaleController(servizio as any, ruoli('OPERATOR'))

    await controller.arrivi('rossi', richiesta() as any)

    expect(servizio.elenca).toHaveBeenCalledWith('B', 'rossi')
  })

  it("VIEWER nell'azienda selezionata: 403 e nessuna lettura", async () => {
    const controller = new PiazzaleController(servizio as any, ruoli('VIEWER'))

    await expect(controller.arrivi(undefined, richiesta('ADMIN') as any)).rejects.toThrow(
      ForbiddenException
    )
    expect(servizio.elenca).not.toHaveBeenCalled()
  })

  it('OPERATOR: arrivi mappati con FIRResponseDto.fromDomain', async () => {
    const controller = new PiazzaleController(servizio as any, ruoli('OPERATOR'))

    const out = await controller.arrivi(undefined, richiesta() as any)

    expect(out.azienda).toEqual(risultato.azienda)
    expect(out.codiciAziendaConfigurati).toBe(true)
    expect(out.arrivi).toEqual([{ mappato: 'f1' }, { mappato: 'f2' }])
  })

  it('cerca oltre 50 caratteri: BadRequestException e nessuna lettura', async () => {
    const controller = new PiazzaleController(servizio as any, ruoli('OPERATOR'))

    await expect(controller.arrivi('x'.repeat(51), richiesta() as any)).rejects.toThrow(
      new BadRequestException('La ricerca accetta al massimo 50 caratteri.')
    )
    expect(servizio.elenca).not.toHaveBeenCalled()
  })

  it('cerca di esattamente 50 caratteri: accettata', async () => {
    const controller = new PiazzaleController(servizio as any, ruoli('OPERATOR'))

    await controller.arrivi('x'.repeat(50), richiesta() as any)

    expect(servizio.elenca).toHaveBeenCalled()
  })
})
