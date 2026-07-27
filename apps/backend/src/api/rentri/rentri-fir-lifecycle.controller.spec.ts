import { NotFoundException, BadRequestException } from '@nestjs/common'
import { RentriFirLifecycleController } from './rentri-fir-lifecycle.controller'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * RentriFirLifecycleController — `GET :id/pdf` (R3 Task 7).
 *
 * Il controller è istanziato direttamente con dipendenze mockate (stesso
 * stile di `pdf.controller.spec.ts`): evita il bootstrap di
 * JwtAuthGuard/RolesGuard/TestingModule, irrilevante per verificare la
 * logica del singolo metodo.
 *
 * **Il punto che questa suite dimostra**: l'endpoint è un TRAMITE (scarica
 * il PDF e lo trasmette come byte), non un redirect. Se il controller
 * chiamasse `res.redirect(...)` verso il portale RENTRI, il criterio di
 * valore del programma (l'utente non cambia mai piattaforma) sarebbe
 * violato — la suite verifica ESPLICITAMENTE che `res.redirect` non venga
 * mai chiamato e che i byte trasmessi a `res.send` corrispondano
 * esattamente al contenuto decodificato dallo use case, non a un URL.
 */
describe('RentriFirLifecycleController — scaricaPdf', () => {
  const FIR_ID = 'fir-1'
  const TENANT_ID = 'tenant-1'
  const USER_ID = 'utente-1'

  let controller: RentriFirLifecycleController
  let scaricaPdfFirUseCase: { execute: jest.Mock }
  let res: { set: jest.Mock; send: jest.Mock; status: jest.Mock; redirect: jest.Mock }

  function creaLogger(): any {
    return {
      setContext: jest.fn(),
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
  }

  beforeEach(() => {
    scaricaPdfFirUseCase = { execute: jest.fn() }
    res = {
      set: jest.fn(),
      send: jest.fn(),
      status: jest.fn().mockReturnThis(),
      redirect: jest.fn(),
    }

    controller = new RentriFirLifecycleController(
      {} as any, // GetAzioniDisponibiliUseCase — non usato da questo endpoint
      {} as any, // AccettaORespingiFIRUseCase
      {} as any, // AnnullaFIRRentriUseCase
      {} as any, // GestisciAllegatiFIRUseCase
      scaricaPdfFirUseCase as any,
      creaLogger()
    )
  })

  it('trasmette i byte del PDF (TRAMITE) e non chiama MAI un redirect al portale RENTRI', async () => {
    const contenutoBase64 = Buffer.from('%PDF-1.4 contenuto di prova').toString('base64')
    scaricaPdfFirUseCase.execute.mockResolvedValue({
      disponibile: true,
      nomeFile: 'FIR-BCDFGH00001JK.pdf',
      mime: 'application/pdf',
      contenutoBase64,
    })

    await controller.scaricaPdf(FIR_ID, TENANT_ID, USER_ID, res as any)

    expect(scaricaPdfFirUseCase.execute).toHaveBeenCalledWith(FIR_ID, TENANT_ID)
    expect(res.redirect).not.toHaveBeenCalled()

    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'application/pdf',
        'Content-Disposition': expect.stringContaining('FIR-BCDFGH00001JK.pdf'),
      })
    )

    // I byte trasmessi sono ESATTAMENTE quelli decodificati dal contenuto
    // restituito dallo use case: prova che il controller trasmette il
    // documento stesso, non un riferimento/URL a esso.
    const bufferInviato = res.send.mock.calls[0][0]
    expect(Buffer.isBuffer(bufferInviato)).toBe(true)
    expect(bufferInviato.toString('base64')).toBe(contenutoBase64)
  })

  it('risponde 204, non un errore, quando il PDF non è ancora disponibile presso l’ente', async () => {
    scaricaPdfFirUseCase.execute.mockResolvedValue({ disponibile: false })

    await controller.scaricaPdf(FIR_ID, TENANT_ID, USER_ID, res as any)

    expect(res.status).toHaveBeenCalledWith(204)
    expect(res.redirect).not.toHaveBeenCalled()
  })

  it('mappa NOT_FOUND (FIR inesistente o di un altro tenant) su 404, non 403/401', async () => {
    scaricaPdfFirUseCase.execute.mockRejectedValue(DomainException.notFound('FIR', FIR_ID))

    await expect(
      controller.scaricaPdf(FIR_ID, TENANT_ID, USER_ID, res as any)
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(res.send).not.toHaveBeenCalled()
  })

  it('mappa un FIR non legato a RENTRI su 400', async () => {
    scaricaPdfFirUseCase.execute.mockRejectedValue(
      DomainException.businessRuleViolation('FIR_NON_LEGATO_RENTRI', 'non legato')
    )

    await expect(
      controller.scaricaPdf(FIR_ID, TENANT_ID, USER_ID, res as any)
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(res.send).not.toHaveBeenCalled()
  })
})
