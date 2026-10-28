import { NotFoundException } from '@nestjs/common'
import { RentriScortaController } from './rentri-scorta.controller'
import { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { DomainException } from '../../domain/shared/domain-exception'

const user: CurrentUserPayload = {
  id: 'user-1',
  email: 'admin@example.com',
  tenantId: 'tenant-1',
  role: 'admin',
  permissions: [],
}

// richiesta senza switch di azienda: l'azienda selezionata coincide con quella del token
const req = { tenantId: user.tenantId, user }

describe('RentriScortaController', () => {
  const mockLogger = {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }

  function build() {
    const elencaBlocchi = { execute: jest.fn() }
    const getScorta = { execute: jest.fn() }
    const avviaVidimazione = {
      verificaBlocco: jest.fn().mockResolvedValue(undefined),
      execute: jest.fn().mockResolvedValue({ richiesti: 5, riusciti: 5, falliti: 0 }),
    }
    const impostaBloccoPredefinito = { execute: jest.fn() }
    const verificaEmissionePossibile = { execute: jest.fn() }

    const controller = new RentriScortaController(
      elencaBlocchi as any,
      getScorta as any,
      avviaVidimazione as any,
      impostaBloccoPredefinito as any,
      verificaEmissionePossibile as any,
      mockLogger as any
    )

    return {
      controller,
      elencaBlocchi,
      getScorta,
      avviaVidimazione,
      impostaBloccoPredefinito,
      verificaEmissionePossibile,
    }
  }

  afterEach(() => jest.clearAllMocks())

  it('GET /rentri/blocchi delega allo use case con il tenant corrente', async () => {
    const { controller, elencaBlocchi } = build()
    elencaBlocchi.execute.mockResolvedValue({ blocchi: [] })

    const risultato = await controller.getBlocchi(req)

    expect(elencaBlocchi.execute).toHaveBeenCalledWith('tenant-1')
    expect(risultato).toEqual({ blocchi: [] })
  })

  it('GET /rentri/scorta delega allo use case', async () => {
    const { controller, getScorta } = build()
    getScorta.execute.mockResolvedValue({ totaleDisponibili: 0, perBlocco: [] })

    const risultato = await controller.getScortaCorrente(req)

    expect(getScorta.execute).toHaveBeenCalledWith('tenant-1')
    expect(risultato).toEqual({ totaleDisponibili: 0, perBlocco: [] })
  })

  it('POST /rentri/scorta/vidima risponde subito 202-shape senza attendere l’esito (fire-and-forget)', async () => {
    const { controller, avviaVidimazione } = build()
    let risolviVidimazione!: () => void
    avviaVidimazione.execute.mockReturnValue(
      new Promise(resolve => {
        risolviVidimazione = () => resolve({ richiesti: 5, riusciti: 5, falliti: 0 })
      })
    )

    const risultato = await controller.vidimaLotto({ codiceBlocco: 'BLK-A', quantita: 5 }, req)

    expect(risultato).toEqual({ avviato: true, richiesti: 5 })
    expect(avviaVidimazione.verificaBlocco).toHaveBeenCalledWith('tenant-1', 'BLK-A')
    expect(avviaVidimazione.execute).toHaveBeenCalledWith('tenant-1', 'BLK-A', 5)
    risolviVidimazione() // evita una promise pendente a fine test
  })

  it('POST /rentri/scorta/vidima rifiuta con 404 se il blocco non esiste, e NON avvia la vidimazione (verifica attesa PRIMA del 202)', async () => {
    const { controller, avviaVidimazione } = build()
    avviaVidimazione.verificaBlocco.mockRejectedValue(
      new NotFoundException(
        'Nessun blocco virtuale RENTRI con codice BLK-X trovato per questo operatore.'
      )
    )

    await expect(
      controller.vidimaLotto({ codiceBlocco: 'BLK-X', quantita: 5 }, req)
    ).rejects.toThrow(NotFoundException)

    expect(avviaVidimazione.execute).not.toHaveBeenCalled()
  })

  it('PUT /rentri/blocchi/:codiceBlocco/predefinito mappa NotFoundException del dominio', async () => {
    const { controller, impostaBloccoPredefinito } = build()
    impostaBloccoPredefinito.execute.mockRejectedValue(new NotFoundException('non trovato'))

    await expect(controller.impostaPredefinito('BLK-X', req)).rejects.toThrow(NotFoundException)
  })

  it('GET /rentri/emissione-possibile propaga numIscrSito opzionale', async () => {
    const { controller, verificaEmissionePossibile } = build()
    verificaEmissionePossibile.execute.mockResolvedValue({ possibile: true, numeriDisponibili: 3 })

    const risultato = await controller.getEmissionePossibile(req, 'OP1234ABC123456-RM1234')

    expect(verificaEmissionePossibile.execute).toHaveBeenCalledWith(
      'tenant-1',
      'OP1234ABC123456-RM1234'
    )
    expect(risultato).toEqual({ possibile: true, numeriDisponibili: 3 })
  })

  it('mappa una DomainException BUSINESS_RULE_VIOLATION su BadRequestException', async () => {
    const { controller, elencaBlocchi } = build()
    elencaBlocchi.execute.mockRejectedValue(
      DomainException.businessRuleViolation('CF_TENANT_MANCANTE', 'manca il CF')
    )

    await expect(controller.getBlocchi(req)).rejects.toMatchObject({ status: 400 })
  })
})
